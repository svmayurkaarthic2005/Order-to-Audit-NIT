import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";
import { selectFinishedBatchesFEFO } from "./modules/batches/service.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"] as unknown as string;
}

const PREFIX = "LEDGER-TEST-";
const SUPPLIER = "Ledger Test Supplier";
const CUSTOMER = "Ledger Test Customer";

async function makeItem(cookie: string, type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD", baseUnit = "G") {
  const sku = `${PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie)
    .send({ sku, name: "Ledger Test Item", type, baseUnit, ...(type === "FINISHED_GOOD" ? { hsnCode: "19059090", taxRatePct: 5 } : {}) });
  return res.body.data.id as string;
}

describe("stock and cost integrity", () => {
  const bomIds: string[] = [];

  afterAll(async () => {
    const items = await prisma.item.findMany({ where: { sku: { startsWith: PREFIX } }, select: { id: true } });
    const itemIds = items.map((i) => i.id);
    const runs = await prisma.productionRun.findMany({ where: { bomHeaderId: { in: bomIds } }, select: { id: true } });
    const runIds = runs.map((r) => r.id);
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.productionRunMaterial.deleteMany({ where: { productionRunId: { in: runIds } } });
    await prisma.finishedGoodsBatch.deleteMany({ where: { productionRunId: { in: runIds } } });
    await prisma.productionRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.rawMaterialBatch.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.purchaseItem.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.purchase.deleteMany({ where: { supplier: { name: SUPPLIER } } });
    await prisma.supplier.deleteMany({ where: { name: SUPPLIER } });
    await prisma.bomLine.deleteMany({ where: { bomHeaderId: { in: bomIds } } });
    await prisma.bomHeader.deleteMany({ where: { id: { in: bomIds } } });
    await prisma.orderItem.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.salesOrder.deleteMany({ where: { customer: { name: CUSTOMER } } });
    await prisma.customer.deleteMany({ where: { name: CUSTOMER } });
    await prisma.item.updateMany({ where: { id: { in: itemIds } }, data: { active: false } });
  });

  it("values an issue at the exact moving average: the brief's 40 kg of flour at ₹43.125/kg costs ₹1,725", async () => {
    const admin = await loginAs("admin@porulottam.test");
    const flour = await makeItem(admin, "RAW_MATERIAL");
    const finished = await makeItem(admin, "FINISHED_GOOD", "PIECE");
    const supplier = await request(app).post("/suppliers").set("Cookie", admin).send({ name: SUPPLIER, state: "Tamil Nadu" });

    // 100 kg opening at ₹42/kg, then 60 kg bought at ₹45/kg (4.5 paise per
    // gram, so sent as the line's exact total): 160 kg worth ₹6,900.
    await request(app).post("/inventory/opening-stock").set("Cookie", admin).send({ itemId: flour, qtyBase: 100_000, totalCostPaise: 420_000 });
    const bought = await request(app)
      .post("/purchases")
      .set("Cookie", admin)
      .send({ supplierId: supplier.body.data.id, items: [{ itemId: flour, qtyBase: 60_000, rateBasePaise: 5, totalCostPaise: 270_000 }] });
    expect(bought.status).toBe(201);

    const bom = await request(app).post("/boms").set("Cookie", admin).send({
      finishedItemId: finished,
      expectedYieldQty: 200,
      lines: [{ rawItemId: flour, qtyPerBatch: 40_000 }],
    });
    bomIds.push(bom.body.data.id);
    const run = await request(app).post("/production-runs").set("Cookie", admin).send({ bomHeaderId: bom.body.data.id });
    const started = await request(app)
      .post(`/production-runs/${run.body.data.id}/start`)
      .set("Cookie", admin)
      .send({ actualConsumption: [{ itemId: flour, qtyBase: 40_000 }] });
    expect(started.status).toBe(200);

    const issue = await prisma.stockMovement.findFirstOrThrow({ where: { sourceId: run.body.data.id, source: "PRODUCTION_ISSUE" } });
    // Rounding the rate to 4 paise/g first would have given ₹1,600.
    expect(issue.totalCostPaise).toBe(-172_500);
  });

  it("refuses a run start that leaves out or repeats a recipe ingredient", async () => {
    const admin = await loginAs("admin@porulottam.test");
    const flour = await makeItem(admin, "RAW_MATERIAL");
    const oil = await makeItem(admin, "RAW_MATERIAL", "ML");
    const finished = await makeItem(admin, "FINISHED_GOOD", "PIECE");
    for (const id of [flour, oil]) {
      await request(app).post("/inventory/opening-stock").set("Cookie", admin).send({ itemId: id, qtyBase: 100_000, totalCostPaise: 100_000 });
    }
    const bom = await request(app).post("/boms").set("Cookie", admin).send({
      finishedItemId: finished,
      expectedYieldQty: 10,
      lines: [
        { rawItemId: flour, qtyPerBatch: 1_000 },
        { rawItemId: oil, qtyPerBatch: 1_000 },
      ],
    });
    bomIds.push(bom.body.data.id);

    const missing = await request(app).post("/production-runs").set("Cookie", admin).send({ bomHeaderId: bom.body.data.id });
    const missingRes = await request(app)
      .post(`/production-runs/${missing.body.data.id}/start`)
      .set("Cookie", admin)
      .send({ actualConsumption: [{ itemId: flour, qtyBase: 1_000 }] });
    expect(missingRes.status).toBe(400);
    expect(missingRes.body.error.code).toBe("missing_line");

    const repeated = await request(app).post("/production-runs").set("Cookie", admin).send({ bomHeaderId: bom.body.data.id });
    const repeatedRes = await request(app)
      .post(`/production-runs/${repeated.body.data.id}/start`)
      .set("Cookie", admin)
      .send({
        actualConsumption: [
          { itemId: flour, qtyBase: 500 },
          { itemId: flour, qtyBase: 500 },
          { itemId: oil, qtyBase: 1_000 },
        ],
      });
    expect(repeatedRes.status).toBe(400);
    expect(repeatedRes.body.error.code).toBe("duplicate_line");

    // Nothing was issued by either refused start.
    const issued = await prisma.stockMovement.count({ where: { sourceId: { in: [missing.body.data.id, repeated.body.data.id] } } });
    expect(issued).toBe(0);
  });

  it("cancelling a run puts the material back on its batch, so the next run can use it", async () => {
    const admin = await loginAs("admin@porulottam.test");
    const flour = await makeItem(admin, "RAW_MATERIAL");
    const finished = await makeItem(admin, "FINISHED_GOOD", "PIECE");
    const supplier = await request(app).post("/suppliers").set("Cookie", admin).send({ name: SUPPLIER, state: "Tamil Nadu" });
    const bought = await request(app)
      .post("/purchases")
      .set("Cookie", admin)
      .send({
        supplierId: supplier.body.data.id,
        items: [{ itemId: flour, qtyBase: 5_000, rateBasePaise: 4, supplierBatchNo: "LOT-1", expiryDate: new Date(Date.now() + 60 * 86_400_000).toISOString() }],
      });
    const batch = await prisma.rawMaterialBatch.findUniqueOrThrow({ where: { purchaseItemId: bought.body.data.items[0].id } });
    // The receipt carried the batch from the moment it was posted.
    const receipt = await prisma.stockMovement.findFirstOrThrow({ where: { source: "PURCHASE", sourceId: bought.body.data.id } });
    expect(receipt.rawMaterialBatchId).toBe(batch.id);

    const bom = await request(app).post("/boms").set("Cookie", admin).send({
      finishedItemId: finished,
      expectedYieldQty: 10,
      lines: [{ rawItemId: flour, qtyPerBatch: 5_000 }],
    });
    bomIds.push(bom.body.data.id);

    const first = await request(app).post("/production-runs").set("Cookie", admin).send({ bomHeaderId: bom.body.data.id });
    await request(app).post(`/production-runs/${first.body.data.id}/start`).set("Cookie", admin).send({ actualConsumption: [{ itemId: flour, qtyBase: 5_000 }] });
    expect((await prisma.rawMaterialBatch.findUniqueOrThrow({ where: { id: batch.id } })).remainingQtyBase).toBe(0);

    const cancelled = await request(app).post(`/production-runs/${first.body.data.id}/cancel`).set("Cookie", admin).send({});
    expect(cancelled.status).toBe(200);
    expect((await prisma.rawMaterialBatch.findUniqueOrThrow({ where: { id: batch.id } })).remainingQtyBase).toBe(5_000);

    // The returned 5 kg can be issued again, from the same batch.
    const second = await request(app).post("/production-runs").set("Cookie", admin).send({ bomHeaderId: bom.body.data.id });
    const restarted = await request(app)
      .post(`/production-runs/${second.body.data.id}/start`)
      .set("Cookie", admin)
      .send({ actualConsumption: [{ itemId: flour, qtyBase: 5_000 }] });
    expect(restarted.status).toBe(200);
    const reissue = await prisma.stockMovement.findFirstOrThrow({ where: { sourceId: second.body.data.id, source: "PRODUCTION_ISSUE" } });
    expect(reissue.rawMaterialBatchId).toBe(batch.id);
  });

  it("refuses an order that lists the same product twice", async () => {
    const salesman = await loginAs("salesman@porulottam.test");
    const admin = await loginAs("admin@porulottam.test");
    const finished = await makeItem(admin, "FINISHED_GOOD", "PIECE");
    const customer = await prisma.customer.create({ data: { name: CUSTOMER, state: "Tamil Nadu" } });

    const res = await request(app)
      .post("/orders")
      .set("Cookie", salesman)
      .send({
        customerId: customer.id,
        items: [
          { itemId: finished, qtyBase: 60, ratePaise: 5_000 },
          { itemId: finished, qtyBase: 60, ratePaise: 5_000 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("refuses to change or delete stock movements and activity-log entries", async () => {
    const admin = await loginAs("admin@porulottam.test");
    const flour = await makeItem(admin, "RAW_MATERIAL");
    await request(app).post("/inventory/opening-stock").set("Cookie", admin).send({ itemId: flour, qtyBase: 1_000, totalCostPaise: 1_000 });
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { itemId: flour } });
    const entry = await prisma.auditLog.findFirstOrThrow();

    // The local and CI test databases allow cleanup deletes; turn that off
    // for this transaction to see what any production database enforces.
    const attempt = (fn: (tx: typeof prisma) => Promise<unknown>) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.allow_ledger_cleanup', 'off', true)`;
        await fn(tx as typeof prisma);
      });

    await expect(attempt((tx) => tx.stockMovement.update({ where: { id: movement.id }, data: { qtyBase: 999 } }))).rejects.toThrow(/append-only/);
    await expect(attempt((tx) => tx.stockMovement.delete({ where: { id: movement.id } }))).rejects.toThrow(/append-only/);
    await expect(attempt((tx) => tx.auditLog.update({ where: { id: entry.id }, data: { action: "TAMPERED" } }))).rejects.toThrow(/append-only/);
    await expect(attempt((tx) => tx.auditLog.delete({ where: { id: entry.id } }))).rejects.toThrow(/append-only/);

    expect((await prisma.stockMovement.findUniqueOrThrow({ where: { id: movement.id } })).qtyBase).toBe(1_000);
  });
  it("won't issue more raw material than the ledger holds when the item has no batches", async () => {
    const admin = await loginAs("admin@porulottam.test");
    const flour = await makeItem(admin, "RAW_MATERIAL");
    const finished = await makeItem(admin, "FINISHED_GOOD", "PIECE");
    await request(app).post("/inventory/opening-stock").set("Cookie", admin).send({ itemId: flour, qtyBase: 100_000, totalCostPaise: 420_000 });
    const bom = await request(app).post("/boms").set("Cookie", admin).send({
      finishedItemId: finished,
      expectedYieldQty: 200,
      lines: [{ rawItemId: flour, qtyPerBatch: 40_000 }],
    });
    bomIds.push(bom.body.data.id);
    const run = await request(app).post("/production-runs").set("Cookie", admin).send({ bomHeaderId: bom.body.data.id, batchSize: 155 });
    const res = await request(app)
      .post(`/production-runs/${run.body.data.id}/start`)
      .set("Cookie", admin)
      .send({ actualConsumption: [{ itemId: flour, qtyBase: 6_200_000 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("insufficient_batch_stock");
    const onHand = await prisma.stockMovement.aggregate({ where: { itemId: flour }, _sum: { qtyBase: true } });
    expect(onHand._sum.qtyBase).toBe(100_000); // nothing was taken
  });

  it("won't finish a run that uses more packaging than is in stock", async () => {
    const admin = await loginAs("admin@porulottam.test");
    const flour = await makeItem(admin, "RAW_MATERIAL");
    const pouch = await makeItem(admin, "PACKAGING", "PIECE");
    const finished = await makeItem(admin, "FINISHED_GOOD", "PIECE");
    await request(app).post("/inventory/opening-stock").set("Cookie", admin).send({ itemId: flour, qtyBase: 40_000, totalCostPaise: 0 });
    await request(app).post("/inventory/opening-stock").set("Cookie", admin).send({ itemId: pouch, qtyBase: 100, totalCostPaise: 25_000 });
    const bom = await request(app).post("/boms").set("Cookie", admin).send({
      finishedItemId: finished,
      expectedYieldQty: 200,
      lines: [{ rawItemId: flour, qtyPerBatch: 40_000 }, { rawItemId: pouch, qtyPerBatch: 200 }],
    });
    bomIds.push(bom.body.data.id);
    const run = (await request(app).post("/production-runs").set("Cookie", admin).send({ bomHeaderId: bom.body.data.id, batchSize: 1 })).body.data;
    await request(app).post(`/production-runs/${run.id}/start`).set("Cookie", admin).send({ actualConsumption: [{ itemId: flour, qtyBase: 40_000 }] });

    // 188 used + 6 damaged = 194 pouches, but only 100 are in stock.
    const res = await request(app)
      .post(`/production-runs/${run.id}/complete`)
      .set("Cookie", admin)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ actualOutputQty: 188, packagingConsumed: [{ itemId: pouch, qtyBase: 188, damagedQty: 6 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("Not enough Ledger Test Item: 100 pieces in stock, 194 pieces used and damaged. Record the purchase first, or correct the amounts.");
    const pouches = await prisma.stockMovement.aggregate({ where: { itemId: pouch }, _sum: { qtyBase: true } });
    expect(pouches._sum.qtyBase).toBe(100); // nothing was taken
    expect((await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("STARTED"); // still open to finish
  });

  it("uses unbatched stock (like opening stock) together with batches, never more than both", async () => {
    const admin = await loginAs("admin@porulottam.test");
    const murukku = await makeItem(admin, "FINISHED_GOOD", "PIECE");
    // 50 opening packets with no batch, plus a production batch of 188.
    await request(app).post("/inventory/opening-stock").set("Cookie", admin).send({ itemId: murukku, qtyBase: 50, totalCostPaise: 0 });
    const bomId = crypto.randomUUID();
    const bom = await prisma.bomHeader.create({ data: { id: bomId, familyId: bomId, finishedItemId: murukku, expectedYieldQty: 200 } });
    bomIds.push(bom.id);
    const run = await prisma.productionRun.create({ data: { bomHeaderId: bom.id, batchSize: 1, status: "COMPLETED" } });
    const batch = await prisma.finishedGoodsBatch.create({
      data: { itemId: murukku, internalBatchNo: `FG-${run.id.slice(0, 8)}`, productionRunId: run.id, manufactureDate: new Date(), producedQtyBase: 188, remainingQtyBase: 188 },
    });
    await prisma.stockMovement.create({
      data: { itemId: murukku, qtyBase: 188, unitCostPaise: 0, totalCostPaise: 0, source: "PRODUCTION_OUTPUT", sourceId: run.id, finishedGoodsBatchId: batch.id },
    });

    // 200 is more than the batch alone holds, but the ledger has 238.
    const selections = await selectFinishedBatchesFEFO(murukku, 200);
    expect(selections).toEqual([
      { batchId: null, qty: 50, batchType: "finished" },
      { batchId: batch.id, qty: 150, batchType: "finished" },
    ]);
    await expect(selectFinishedBatchesFEFO(murukku, 239)).rejects.toMatchObject({ code: "insufficient_batch_stock" });
  });

  it("two issues at once can't both take the same unbatched stock", async () => {
    const admin = await loginAs("admin@porulottam.test");
    const item = await makeItem(admin, "FINISHED_GOOD", "PIECE");
    await request(app).post("/inventory/opening-stock").set("Cookie", admin).send({ itemId: item, qtyBase: 50, totalCostPaise: 0 });
    // Each takes all 50 and posts the movement, as a dispatch does.
    const issueAll = () =>
      prisma.$transaction(async (tx) => {
        const [sel] = await selectFinishedBatchesFEFO(item, 50, tx);
        await new Promise((r) => setTimeout(r, 200)); // widen the race window
        await tx.stockMovement.create({ data: { itemId: item, qtyBase: -sel!.qty, unitCostPaise: 0, totalCostPaise: 0, source: "DISPATCH" } });
      });
    const results = await Promise.allSettled([issueAll(), issueAll()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const left = await prisma.stockMovement.aggregate({ where: { itemId: item }, _sum: { qtyBase: true } });
    expect(left._sum.qtyBase).toBe(0);
  });
});
