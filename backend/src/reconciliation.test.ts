import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "RECON-TEST-";

async function makeItem(
  cookie: string,
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD",
  name = `Reconciliation Test ${type}`,
) {
  const sku = `${TEST_SKU_PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie)
    .send({ sku, name, type, baseUnit: type === "RAW_MATERIAL" ? "ML" : "PIECE" });
  return res.body.data.id as string;
}

describe("reconciliation", () => {
  afterAll(async () => {
    const testBoms = await prisma.bomHeader.findMany({
      where: { finishedItem: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { id: true },
    });
    for (const bom of testBoms) {
      const runs = await prisma.productionRun.findMany({ where: { bomHeaderId: bom.id }, select: { id: true } });
      for (const run of runs) {
        await prisma.reconciliationException.deleteMany({ where: { sourceId: { contains: run.id } } });
        await prisma.finishedGoodsBatch.deleteMany({ where: { productionRunId: run.id } });
        await prisma.productionRunMaterial.deleteMany({ where: { productionRunId: run.id } });
      }
      await prisma.productionRun.deleteMany({ where: { bomHeaderId: bom.id } });
      await prisma.bomLine.deleteMany({ where: { bomHeaderId: bom.id } });
      await prisma.bomHeader.delete({ where: { id: bom.id } });
    }
    await prisma.unitConversion.deleteMany({ where: { item: { sku: { startsWith: TEST_SKU_PREFIX } } } });
    await prisma.stockMovement.deleteMany({ where: { item: { sku: { startsWith: TEST_SKU_PREFIX } } } });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });

  it("flags a production run whose raw-material, yield and packaging usage all drift past tolerance", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");

    const oilId = await makeItem(adminCookie, "RAW_MATERIAL");
    const pouchId = await makeItem(adminCookie, "PACKAGING");
    const cartonId = await makeItem(adminCookie, "PACKAGING", "Reconciliation Test Carton (holds 20)");
    const finishedId = await makeItem(adminCookie, "FINISHED_GOOD");

    await request(app).post("/inventory/opening-stock").set("Cookie", adminCookie)
      .send({ itemId: oilId, qtyBase: 100_000, totalCostPaise: 100_000 });
    await request(app).post("/inventory/opening-stock").set("Cookie", adminCookie)
      .send({ itemId: pouchId, qtyBase: 10_000, totalCostPaise: 10_000 });
    await request(app).post("/inventory/opening-stock").set("Cookie", adminCookie)
      .send({ itemId: cartonId, qtyBase: 1_000, totalCostPaise: 1_000 });

    // 1 carton = 20 pieces of this finished good — the same declaration
    // seed.ts makes for the real Murukku item. No HTTP route creates this
    // (units/service.ts is read-only, reused by orders/production), so the
    // test sets it up directly, same as seed.ts does.
    await prisma.unitConversion.create({ data: { itemId: finishedId, label: "carton", factor: 20 } });

    const bomRes = await request(app).post("/boms").set("Cookie", adminCookie).send({
      finishedItemId: finishedId,
      expectedYieldQty: 200, // planned output per batch
      lines: [
        { rawItemId: oilId, qtyPerBatch: 10_000 }, // 10 L planned
        { rawItemId: pouchId, qtyPerBatch: 200 },
        { rawItemId: cartonId, qtyPerBatch: 10 },
      ],
    });
    const bomId = bomRes.body.data.id as string;

    const runRes = await request(app).post("/production-runs").set("Cookie", adminCookie).send({ bomHeaderId: bomId });
    const runId = runRes.body.data.id as string;

    // +5% raw-material variance: 10.5 L actual vs. 10 L planned.
    await request(app).post(`/production-runs/${runId}/start`).set("Cookie", adminCookie)
      .send({ actualConsumption: [{ itemId: oilId, qtyBase: 10_500 }] });

    // -6% yield variance (200 planned, 188 good); packaging: 188 good + 6
    // damaged = 194 pouches consumed against 9 cartons × 20 = 180 capacity.
    //
    // The brief this phase was planned from claims "8 packets require
    // reconciliation" for these exact numbers, but 194 - 180 = 14, not 8 —
    // flagging that discrepancy here rather than asserting either number
    // blindly. 14 is what the stated inputs actually produce.
    await request(app)
      .post(`/production-runs/${runId}/complete`)
      .set("Cookie", adminCookie)
      .set("Idempotency-Key", `recon-test-${runId}`)
      .send({
        actualOutputQty: 188,
        packagingConsumed: [
          { itemId: pouchId, qtyBase: 188, damagedQty: 6 },
          { itemId: cartonId, qtyBase: 9, damagedQty: 0 },
        ],
      });

    const runSummary = await request(app).post("/reconciliation/run").set("Cookie", adminCookie).send({});
    expect(runSummary.status).toBe(200);
    expect(runSummary.body.data.critical + runSummary.body.data.warnings).toBeGreaterThanOrEqual(3);

    const exceptions = await request(app)
      .get("/reconciliation/exceptions")
      .set("Cookie", adminCookie)
      .then((r) => r.body.data as { checkType: string; sourceId: string; differenceValue: string }[]);

    const materialVariance = exceptions.find(
      (e) => e.checkType === "PRODUCTION_VARIANCE" && e.sourceId === `${runId}:${oilId}`,
    );
    expect(materialVariance?.differenceValue).toBe("5.0%");

    const yieldVariance = exceptions.find((e) => e.checkType === "PRODUCTION_VARIANCE" && e.sourceId === runId);
    expect(yieldVariance?.differenceValue).toBe("-6.0%");

    const packaging = exceptions.find((e) => e.checkType === "PACKAGING" && e.sourceId === runId);
    expect(packaging?.differenceValue).toBe("14"); // 194 consumed - 180 capacity, not the brief's "8"

    // Every new exception above also notified ACCOUNTANT (and OWNER, who
    // sees every type) — ADMIN deliberately doesn't get AUDIT_EXCEPTION,
    // see notifications.test.ts.
    const accountantCookie = await loginAs("accountant@porulottam.test");
    const accountantNotifications = await request(app).get("/notifications").set("Cookie", accountantCookie);
    const auditExceptionTitles = accountantNotifications.body.data.items
      .filter((n: { type: string }) => n.type === "AUDIT_EXCEPTION")
      .map((n: { message: string }) => n.message);
    expect(auditExceptionTitles.some((m: string) => m.includes("5.0%"))).toBe(true);

    // reviewException never touches the source run/items it was raised against.
    const packagingRow = await prisma.reconciliationException.findFirst({
      where: { checkType: "PACKAGING", sourceId: runId },
    });
    expect(packagingRow).not.toBeNull();
    const before = await prisma.productionRun.findUniqueOrThrow({ where: { id: runId } });
    await request(app)
      .patch(`/reconciliation/exceptions/${packagingRow!.id}`)
      .set("Cookie", adminCookie)
      .send({ status: "RESOLVED", explanation: "Known shortfall from a damaged carton", resolutionNote: "Carton written off" });
    const after = await prisma.productionRun.findUniqueOrThrow({ where: { id: runId } });
    expect(after).toEqual(before); // the source transaction itself is untouched

    const resolved = await prisma.reconciliationException.findUniqueOrThrow({ where: { id: packagingRow!.id } });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.reviewedByUserId).not.toBeNull();
  });

  it("rejects reconciliation routes for a salesman", async () => {
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const res = await request(app).get("/reconciliation/exceptions").set("Cookie", salesmanCookie);
    expect(res.status).toBe(403);
  });
});
