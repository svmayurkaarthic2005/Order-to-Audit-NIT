import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "PROD-AUDIT-TEST-";

async function makeItem(cookie: string, type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD") {
  const sku = `${TEST_SKU_PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie)
    .send({ sku, name: `Production Audit Test ${type}`, type, baseUnit: "G" });
  return res.body.data.id as string;
}

async function makeBom(cookie: string) {
  const flourId = await makeItem(cookie, "RAW_MATERIAL");
  const pouchId = await makeItem(cookie, "PACKAGING");
  const finishedId = await makeItem(cookie, "FINISHED_GOOD");

  await request(app).post("/inventory/opening-stock").set("Cookie", cookie).send({ itemId: flourId, qtyBase: 1_000_000, totalCostPaise: 1_000_000 });
  await request(app).post("/inventory/opening-stock").set("Cookie", cookie).send({ itemId: pouchId, qtyBase: 10_000, totalCostPaise: 10_000 });

  const bomRes = await request(app).post("/boms").set("Cookie", cookie).send({
    finishedItemId: finishedId,
    expectedYieldQty: 10,
    lines: [
      { rawItemId: flourId, qtyPerBatch: 1_000 },
      { rawItemId: pouchId, qtyPerBatch: 10 },
    ],
  });
  return { bomId: bomRes.body.data.id as string, flourId, pouchId, finishedId };
}

describe("production lifecycle audit logging", () => {
  afterAll(async () => {
    const testBoms = await prisma.bomHeader.findMany({
      where: { finishedItem: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { id: true },
    });
    for (const bom of testBoms) {
      const runs = await prisma.productionRun.findMany({ where: { bomHeaderId: bom.id }, select: { id: true } });
      const runIds = runs.map((r) => r.id);
      await prisma.auditLog.deleteMany({ where: { entityType: "ProductionRun", entityId: { in: runIds } } });
      await prisma.finishedGoodsBatch.deleteMany({ where: { productionRunId: { in: runIds } } });
      await prisma.productionRunMaterial.deleteMany({ where: { productionRunId: { in: runIds } } });
      await prisma.stockMovement.deleteMany({ where: { sourceId: { in: runIds } } });
      await prisma.productionRun.deleteMany({ where: { bomHeaderId: bom.id } });
      await prisma.bomLine.deleteMany({ where: { bomHeaderId: bom.id } });
      await prisma.bomHeader.delete({ where: { id: bom.id } });
    }
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });

  it("start, complete and cancel each record their own audit entry with actor, run id and the status transition", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@porulottam.test" } });
    const { bomId, flourId, pouchId, finishedId } = await makeBom(adminCookie);

    // ── run 1: start then complete ──
    const run1 = await request(app).post("/production-runs").set("Cookie", adminCookie).send({ bomHeaderId: bomId });
    const run1Id = run1.body.data.id as string;

    const startRes = await request(app)
      .post(`/production-runs/${run1Id}/start`)
      .set("Cookie", adminCookie)
      .send({ actualConsumption: [{ itemId: flourId, qtyBase: 1_000 }] });
    expect(startRes.status).toBe(200);

    const startEntry = await prisma.auditLog.findFirst({ where: { entityType: "ProductionRun", entityId: run1Id, action: "PRODUCTION_RUN_STARTED" } });
    expect(startEntry).not.toBeNull();
    expect(startEntry!.userId).toBe(admin.id);
    expect(JSON.parse(startEntry!.beforeJson!).status).toBe("DRAFT");
    expect(JSON.parse(startEntry!.afterJson!).status).toBe("STARTED");

    const completeRes = await request(app)
      .post(`/production-runs/${run1Id}/complete`)
      .set("Cookie", adminCookie)
      .set("Idempotency-Key", `audit-complete-${run1Id}`)
      .send({ actualOutputQty: 10, packagingConsumed: [{ itemId: pouchId, qtyBase: 10, damagedQty: 0 }] });
    expect(completeRes.status).toBe(200);

    const completeEntry = await prisma.auditLog.findFirst({ where: { entityType: "ProductionRun", entityId: run1Id, action: "PRODUCTION_RUN_COMPLETED" } });
    expect(completeEntry).not.toBeNull();
    expect(completeEntry!.userId).toBe(admin.id);
    expect(JSON.parse(completeEntry!.afterJson!).actualOutputQty).toBe(10);
    expect(JSON.parse(completeEntry!.afterJson!).outputItemId).toBe(finishedId);

    // ── run 2: start then cancel — reversal, never deletion ──
    const run2 = await request(app).post("/production-runs").set("Cookie", adminCookie).send({ bomHeaderId: bomId });
    const run2Id = run2.body.data.id as string;
    await request(app)
      .post(`/production-runs/${run2Id}/start`)
      .set("Cookie", adminCookie)
      .send({ actualConsumption: [{ itemId: flourId, qtyBase: 1_000 }] });

    const issuedBefore = await prisma.stockMovement.count({ where: { sourceId: run2Id, source: "PRODUCTION_ISSUE" } });
    expect(issuedBefore).toBeGreaterThan(0);

    const cancelRes = await request(app).post(`/production-runs/${run2Id}/cancel`).set("Cookie", adminCookie);
    expect(cancelRes.status).toBe(200);

    const cancelEntry = await prisma.auditLog.findFirst({ where: { entityType: "ProductionRun", entityId: run2Id, action: "PRODUCTION_RUN_CANCELLED" } });
    expect(cancelEntry).not.toBeNull();
    expect(JSON.parse(cancelEntry!.beforeJson!).status).toBe("STARTED");
    expect(JSON.parse(cancelEntry!.afterJson!).status).toBe("CANCELLED");

    // The original issue rows are still there — cancellation reverses, never deletes.
    const issuedAfter = await prisma.stockMovement.count({ where: { sourceId: run2Id, source: "PRODUCTION_ISSUE" } });
    expect(issuedAfter).toBe(issuedBefore);
    const reversals = await prisma.stockMovement.count({ where: { sourceId: run2Id, source: "PRODUCTION_ISSUE_REVERSAL" } });
    expect(reversals).toBe(issuedBefore);
  });

  it("two concurrent /start requests on the same DRAFT run post exactly one audit entry and one set of stock movements", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const { bomId, flourId } = await makeBom(adminCookie);
    const run = await request(app).post("/production-runs").set("Cookie", adminCookie).send({ bomHeaderId: bomId });
    const runId = run.body.data.id as string;

    const [a, b] = await Promise.all([
      request(app).post(`/production-runs/${runId}/start`).set("Cookie", adminCookie).send({ actualConsumption: [{ itemId: flourId, qtyBase: 1_000 }] }),
      request(app).post(`/production-runs/${runId}/start`).set("Cookie", adminCookie).send({ actualConsumption: [{ itemId: flourId, qtyBase: 1_000 }] }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const entries = await prisma.auditLog.count({ where: { entityType: "ProductionRun", entityId: runId, action: "PRODUCTION_RUN_STARTED" } });
    expect(entries).toBe(1);
    const movements = await prisma.stockMovement.count({ where: { sourceId: runId, source: "PRODUCTION_ISSUE" } });
    expect(movements).toBe(1); // not double-issued
  });
});
