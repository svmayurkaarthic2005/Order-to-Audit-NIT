import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "PROD-TEST-";

async function makeTestItem(cookie: string, type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD") {
  const sku = `${TEST_SKU_PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie)
    .send({ sku, name: "Production Test Item", type, baseUnit: "G" });
  return res.body.data.id as string;
}

async function makeTestBom(cookie: string) {
  const finishedId = await makeTestItem(cookie, "FINISHED_GOOD");
  const rawId = await makeTestItem(cookie, "RAW_MATERIAL");
  const packagingId = await makeTestItem(cookie, "PACKAGING");

  await request(app)
    .post("/inventory/opening-stock")
    .set("Cookie", cookie)
    .send({ itemId: rawId, qtyBase: 10_000, totalCostPaise: 10_000 });
  await request(app)
    .post("/inventory/opening-stock")
    .set("Cookie", cookie)
    .send({ itemId: packagingId, qtyBase: 1_000, totalCostPaise: 1_000 });

  const bomRes = await request(app)
    .post("/boms")
    .set("Cookie", cookie)
    .send({
      finishedItemId: finishedId,
      expectedYieldQty: 100,
      lines: [
        { rawItemId: rawId, qtyPerBatch: 1_000 },
        { rawItemId: packagingId, qtyPerBatch: 100 },
      ],
    });
  return { bomId: bomRes.body.data.id as string, finishedId, rawId, packagingId };
}

describe("production lifecycle", () => {
  afterAll(async () => {
    // ProductionRun has no soft-delete flag (unlike Item/BomHeader) and
    // listProductionRuns returns everything, so test runs would otherwise
    // linger in the real production list/UI forever. Hard-delete them —
    // production_run_materials and stock_movements have no FK back to the
    // run (sourceId is a plain string), so only the run, its materials and
    // (once batch/lot tracking added FinishedGoodsBatch.productionRunId) any
    // finished-goods batch it produced need explicit cleanup first.
    const testBoms = await prisma.bomHeader.findMany({
      where: { finishedItem: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { id: true },
    });
    const testRuns = await prisma.productionRun.findMany({
      where: { bomHeaderId: { in: testBoms.map((b) => b.id) } },
      select: { id: true },
    });
    const runIds = testRuns.map((r) => r.id);
    await prisma.productionRunMaterial.deleteMany({ where: { productionRunId: { in: runIds } } });
    await prisma.finishedGoodsBatch.deleteMany({ where: { productionRunId: { in: runIds } } });
    await prisma.stockMovement.deleteMany({ where: { sourceId: { in: runIds } } });
    await prisma.productionRun.deleteMany({ where: { id: { in: runIds } } });

    await prisma.bomHeader.updateMany({
      where: { finishedItem: { sku: { startsWith: TEST_SKU_PREFIX } } },
      data: { active: false },
    });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });

  it("creates a DRAFT run with no stock movement", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const { bomId, rawId } = await makeTestBom(cookie);

    const res = await request(app).post("/production-runs").set("Cookie", cookie).send({ bomHeaderId: bomId, batchSize: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("DRAFT");

    const onHand = await request(app).get(`/inventory/${rawId}/on-hand`).set("Cookie", cookie);
    expect(onHand.body.data.qtyBase).toBe(10_000); // unchanged — DRAFT posts nothing
  });

  it("STARTED issues raw material for real and snapshots planned qty; COMPLETE posts output and packaging", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const { bomId, finishedId, rawId, packagingId } = await makeTestBom(cookie);

    const createRes = await request(app).post("/production-runs").set("Cookie", cookie).send({ bomHeaderId: bomId, batchSize: 1 });
    const runId = createRes.body.data.id;

    const startRes = await request(app)
      .post(`/production-runs/${runId}/start`)
      .set("Cookie", cookie)
      .send({ actualConsumption: [{ itemId: rawId, qtyBase: 1_050 }] }); // 5% over the 1,000 planned
    expect(startRes.status).toBe(200);
    expect(startRes.body.data.status).toBe("STARTED");
    const material = startRes.body.data.materials.find((m: { itemId: string }) => m.itemId === rawId);
    expect(material.plannedQtyBase).toBe(1_000); // planned stays the BOM's own number
    expect(material.actualQtyBase).toBe(1_050); // actual can differ from planned

    const rawOnHand = await request(app).get(`/inventory/${rawId}/on-hand`).set("Cookie", cookie);
    expect(rawOnHand.body.data.qtyBase).toBe(10_000 - 1_050); // moved at STARTED, not later

    const completeRes = await request(app)
      .post(`/production-runs/${runId}/complete`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", `complete-${runId}`)
      .send({ actualOutputQty: 94, packagingConsumed: [{ itemId: packagingId, qtyBase: 94, damagedQty: 3 }] });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe("COMPLETED");

    const finishedOnHand = await request(app).get(`/inventory/${finishedId}/on-hand`).set("Cookie", cookie);
    expect(finishedOnHand.body.data.qtyBase).toBe(94);

    const packagingOnHand = await request(app).get(`/inventory/${packagingId}/on-hand`).set("Cookie", cookie);
    expect(packagingOnHand.body.data.qtyBase).toBe(1_000 - 94 - 3);
  });

  it("replaying the same Idempotency-Key on complete is a no-op — stock is posted only once", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const { bomId, finishedId, rawId, packagingId } = await makeTestBom(cookie);
    const createRes = await request(app).post("/production-runs").set("Cookie", cookie).send({ bomHeaderId: bomId, batchSize: 1 });
    const runId = createRes.body.data.id;
    await request(app)
      .post(`/production-runs/${runId}/start`)
      .set("Cookie", cookie)
      .send({ actualConsumption: [{ itemId: rawId, qtyBase: 1_000 }] });

    const key = `replay-${runId}`;
    const first = await request(app)
      .post(`/production-runs/${runId}/complete`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", key)
      .send({ actualOutputQty: 100, packagingConsumed: [{ itemId: packagingId, qtyBase: 100, damagedQty: 0 }] });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post(`/production-runs/${runId}/complete`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", key)
      .send({ actualOutputQty: 100, packagingConsumed: [{ itemId: packagingId, qtyBase: 100, damagedQty: 0 }] });
    expect(replay.status).toBe(200);

    const finishedOnHand = await request(app).get(`/inventory/${finishedId}/on-hand`).set("Cookie", cookie);
    expect(finishedOnHand.body.data.qtyBase).toBe(100); // not 200 — the replay posted nothing
  });

  it("cancelling a STARTED run reverses exactly the raw material actually issued", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const { bomId, rawId } = await makeTestBom(cookie);
    const createRes = await request(app).post("/production-runs").set("Cookie", cookie).send({ bomHeaderId: bomId, batchSize: 1 });
    const runId = createRes.body.data.id;
    await request(app)
      .post(`/production-runs/${runId}/start`)
      .set("Cookie", cookie)
      .send({ actualConsumption: [{ itemId: rawId, qtyBase: 1_000 }] });

    const cancelRes = await request(app).post(`/production-runs/${runId}/cancel`).set("Cookie", cookie);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe("CANCELLED");

    const rawOnHand = await request(app).get(`/inventory/${rawId}/on-hand`).set("Cookie", cookie);
    expect(rawOnHand.body.data.qtyBase).toBe(10_000); // back to pre-issue, via a reversal, never a delete

    const movements = await prisma.stockMovement.findMany({ where: { itemId: rawId, sourceId: runId } });
    expect(movements.map((m) => m.source).sort()).toEqual(["PRODUCTION_ISSUE", "PRODUCTION_ISSUE_REVERSAL"]);
  });

  it("starting a non-DRAFT run returns 409, completing a non-STARTED run returns 409", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const { bomId, rawId } = await makeTestBom(cookie);
    const createRes = await request(app).post("/production-runs").set("Cookie", cookie).send({ bomHeaderId: bomId, batchSize: 1 });
    const runId = createRes.body.data.id;

    const neverStartedComplete = await request(app)
      .post(`/production-runs/${runId}/complete`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", `x-${runId}`)
      .send({ actualOutputQty: 1, packagingConsumed: [] });
    expect(neverStartedComplete.status).toBe(409);

    await request(app)
      .post(`/production-runs/${runId}/start`)
      .set("Cookie", cookie)
      .send({ actualConsumption: [{ itemId: rawId, qtyBase: 1_000 }] });

    const startAgain = await request(app)
      .post(`/production-runs/${runId}/start`)
      .set("Cookie", cookie)
      .send({ actualConsumption: [{ itemId: rawId, qtyBase: 1_000 }] });
    expect(startAgain.status).toBe(409);
  });

  it("closes the start race: two concurrent /start calls issue raw material exactly once", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const { bomId, rawId } = await makeTestBom(cookie);
    const createRes = await request(app).post("/production-runs").set("Cookie", cookie).send({ bomHeaderId: bomId, batchSize: 1 });
    const runId = createRes.body.data.id;

    const [a, b] = await Promise.all([
      request(app).post(`/production-runs/${runId}/start`).set("Cookie", cookie).send({ actualConsumption: [{ itemId: rawId, qtyBase: 1_000 }] }),
      request(app).post(`/production-runs/${runId}/start`).set("Cookie", cookie).send({ actualConsumption: [{ itemId: rawId, qtyBase: 1_000 }] }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const rawOnHand = await request(app).get(`/inventory/${rawId}/on-hand`).set("Cookie", cookie);
    expect(rawOnHand.body.data.qtyBase).toBe(10_000 - 1_000); // not 8,000 — issued only once

    const issueMovements = await prisma.stockMovement.findMany({ where: { sourceId: runId, source: "PRODUCTION_ISSUE" } });
    expect(issueMovements).toHaveLength(1);
  });

  it("closes the complete race: two concurrent /complete calls (different idempotency keys) post output exactly once", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const { bomId, finishedId, rawId, packagingId } = await makeTestBom(cookie);
    const createRes = await request(app).post("/production-runs").set("Cookie", cookie).send({ bomHeaderId: bomId, batchSize: 1 });
    const runId = createRes.body.data.id;
    await request(app)
      .post(`/production-runs/${runId}/start`)
      .set("Cookie", cookie)
      .send({ actualConsumption: [{ itemId: rawId, qtyBase: 1_000 }] });

    const [a, b] = await Promise.all([
      request(app)
        .post(`/production-runs/${runId}/complete`)
        .set("Cookie", cookie)
        .set("Idempotency-Key", `race-a-${runId}`)
        .send({ actualOutputQty: 100, packagingConsumed: [{ itemId: packagingId, qtyBase: 100, damagedQty: 0 }] }),
      request(app)
        .post(`/production-runs/${runId}/complete`)
        .set("Cookie", cookie)
        .set("Idempotency-Key", `race-b-${runId}`)
        .send({ actualOutputQty: 100, packagingConsumed: [{ itemId: packagingId, qtyBase: 100, damagedQty: 0 }] }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const finishedOnHand = await request(app).get(`/inventory/${finishedId}/on-hand`).set("Cookie", cookie);
    expect(finishedOnHand.body.data.qtyBase).toBe(100); // not 200 — two different keys, still posted once

    const outputMovements = await prisma.stockMovement.findMany({ where: { sourceId: runId, source: "PRODUCTION_OUTPUT" } });
    expect(outputMovements).toHaveLength(1);
  });

  it("variance: +5% on a material is flagged, −6% yield is flagged, a material within ±3% is not", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const { bomId, rawId, packagingId } = await makeTestBom(cookie);
    const createRes = await request(app).post("/production-runs").set("Cookie", cookie).send({ bomHeaderId: bomId, batchSize: 1 });
    const runId = createRes.body.data.id;

    await request(app)
      .post(`/production-runs/${runId}/start`)
      .set("Cookie", cookie)
      .send({ actualConsumption: [{ itemId: rawId, qtyBase: 1_050 }] }); // planned 1,000 → +5%
    await request(app)
      .post(`/production-runs/${runId}/complete`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", `variance-${runId}`)
      .send({ actualOutputQty: 94, packagingConsumed: [{ itemId: packagingId, qtyBase: 100, damagedQty: 0 }] }); // planned yield 100 → −6%

    const varianceRes = await request(app).get(`/production-runs/${runId}/variance`).set("Cookie", cookie);
    expect(varianceRes.status).toBe(200);

    const rawVariance = varianceRes.body.data.materials.find((m: { itemId: string }) => m.itemId === rawId);
    expect(rawVariance.variancePct).toBeCloseTo(0.05, 5);
    expect(rawVariance.flagged).toBe(true);

    const packagingVariance = varianceRes.body.data.materials.find((m: { itemId: string }) => m.itemId === packagingId);
    expect(packagingVariance.variancePct).toBeCloseTo(0, 5); // 100 actual vs 100 planned
    expect(packagingVariance.flagged).toBe(false);

    expect(varianceRes.body.data.yield.variancePct).toBeCloseTo(-0.06, 5);
    expect(varianceRes.body.data.yield.flagged).toBe(true);
  });

  it("costing: finished-goods unit cost is (material cost this run incurred + fixed overhead) / actual output", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const { bomId, finishedId, rawId, packagingId } = await makeTestBom(cookie);
    const createRes = await request(app).post("/production-runs").set("Cookie", cookie).send({ bomHeaderId: bomId, batchSize: 1 });
    const runId = createRes.body.data.id;

    await request(app)
      .post(`/production-runs/${runId}/start`)
      .set("Cookie", cookie)
      .send({ actualConsumption: [{ itemId: rawId, qtyBase: 1_050 }] });
    await request(app)
      .post(`/production-runs/${runId}/complete`)
      .set("Cookie", cookie)
      .set("Idempotency-Key", `costing-${runId}`)
      .send({ actualOutputQty: 94, packagingConsumed: [{ itemId: packagingId, qtyBase: 94, damagedQty: 3 }] });

    // Independently re-derive the expected cost from the ledger this run
    // actually posted, rather than hard-coding a number tied to the
    // implementation's internals.
    const materialAgg = await prisma.stockMovement.aggregate({
      where: { sourceId: runId, source: { in: ["PRODUCTION_ISSUE", "PRODUCTION_PACKAGING", "PRODUCTION_DAMAGE"] } },
      _sum: { totalCostPaise: true },
    });
    const expectedTotalCostPaise = Math.abs(materialAgg._sum.totalCostPaise ?? 0) + 50_000; // +₹500/batch overhead

    const outputMovement = await prisma.stockMovement.findFirstOrThrow({
      where: { sourceId: runId, source: "PRODUCTION_OUTPUT" },
    });
    expect(outputMovement.totalCostPaise).toBe(expectedTotalCostPaise);
    expect(outputMovement.unitCostPaise).toBe(Math.round(expectedTotalCostPaise / 94));

    const onHand = await request(app).get(`/inventory/${finishedId}/on-hand`).set("Cookie", cookie);
    expect(onHand.body.data.movingAverageCostPaise).toBe(outputMovement.unitCostPaise);
  });

  it("a salesman cannot read or manage production runs", async () => {
    const cookie = await loginAs("salesman@porulottam.test");
    const listRes = await request(app).get("/production-runs").set("Cookie", cookie);
    expect(listRes.status).toBe(403);

    const createRes = await request(app).post("/production-runs").set("Cookie", cookie).send({ bomHeaderId: "x", batchSize: 1 });
    expect(createRes.status).toBe(403);
  });

  it("an accountant can read production runs but cannot create one", async () => {
    const cookie = await loginAs("accountant@porulottam.test");
    const listRes = await request(app).get("/production-runs").set("Cookie", cookie);
    expect(listRes.status).toBe(200);

    const createRes = await request(app).post("/production-runs").set("Cookie", cookie).send({ bomHeaderId: "x", batchSize: 1 });
    expect(createRes.status).toBe(403);
  });
});
