import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";
import { financialYearFor } from "./modules/invoices/service.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "COST-TEST-";

async function makeItem(cookie: string, type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD", baseUnit: "G" | "ML" | "PIECE" = "PIECE") {
  const sku = `${TEST_SKU_PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie)
    .send({ sku, name: `Cost Breakdown Test ${type}`, type, baseUnit });
  return res.body.data.id as string;
}

async function openingStock(cookie: string, itemId: string, qtyBase: number, totalCostPaise: number) {
  await request(app).post("/inventory/opening-stock").set("Cookie", cookie).send({ itemId, qtyBase, totalCostPaise });
}

async function benchmarkRun(adminCookie: string, costs: { laborCostPaise?: number; overheadCostPaise?: number }) {
  const flourId = await makeItem(adminCookie, "RAW_MATERIAL", "G");
  const oilId = await makeItem(adminCookie, "RAW_MATERIAL", "ML");
  const spiceId = await makeItem(adminCookie, "RAW_MATERIAL", "G");
  const pouchId = await makeItem(adminCookie, "PACKAGING");
  const cartonId = await makeItem(adminCookie, "PACKAGING");
  const finishedId = await makeItem(adminCookie, "FINISHED_GOOD");

  // The brief's own master data, in base units (g, ml, pieces) and paise:
  // flour 100 kg at ₹42, oil 30 L at ₹140, spice 5 kg at ₹200, pouches 500
  // at ₹2.50, cartons 30 at ₹15. Then step 1: buy 60 kg of flour at ₹45/kg,
  // which makes flour's moving average ₹43.125/kg (4.3125 paise per gram).
  await openingStock(adminCookie, flourId, 100_000, 420_000);
  await openingStock(adminCookie, oilId, 30_000, 420_000);
  await openingStock(adminCookie, spiceId, 5_000, 100_000);
  await openingStock(adminCookie, pouchId, 500, 125_000);
  await openingStock(adminCookie, cartonId, 30, 45_000);
  const flourSupplier = await request(app)
    .post("/suppliers")
    .set("Cookie", adminCookie)
    .send({ name: "Cost Test Supplier", state: "Tamil Nadu" });
  const purchase = await request(app)
    .post("/purchases")
    .set("Cookie", adminCookie)
    .send({ supplierId: flourSupplier.body.data.id, items: [{ itemId: flourId, qtyBase: 60_000, rateBasePaise: 5, totalCostPaise: 270_000 }] });
  expect(purchase.status).toBe(201);

  // One batch = 200 packets: 40 kg flour, 10 L oil, 1.2 kg spice, 200
  // pouches, 10 cartons.
  const bomRes = await request(app).post("/boms").set("Cookie", adminCookie).send({
    finishedItemId: finishedId,
    expectedYieldQty: 200,
    lines: [
      { rawItemId: flourId, qtyPerBatch: 40_000 },
      { rawItemId: oilId, qtyPerBatch: 10_000 },
      { rawItemId: spiceId, qtyPerBatch: 1_200 },
      { rawItemId: pouchId, qtyPerBatch: 200 },
      { rawItemId: cartonId, qtyPerBatch: 10 },
    ],
  });
  const bomId = bomRes.body.data.id as string;

  const runRes = await request(app).post("/production-runs").set("Cookie", adminCookie).send({ bomHeaderId: bomId });
  const runId = runRes.body.data.id as string;

  // Step 2: 40 kg flour, 10.5 L oil (0.5 L over), 1.2 kg spice.
  const started = await request(app)
    .post(`/production-runs/${runId}/start`)
    .set("Cookie", adminCookie)
    .send({
      actualConsumption: [
        { itemId: flourId, qtyBase: 40_000 },
        { itemId: oilId, qtyBase: 10_500 },
        { itemId: spiceId, qtyBase: 1_200 },
      ],
    });
  expect(started.status).toBe(200);

  // Steps 3 and 8: 188 good packets, 188 pouches used and 6 damaged, 9
  // cartons; labour ₹1,200 and gas/power ₹600.
  const completed = await request(app)
    .post(`/production-runs/${runId}/complete`)
    .set("Cookie", adminCookie)
    .set("Idempotency-Key", `cost-test-${runId}`)
    .send({
      actualOutputQty: 188,
      packagingConsumed: [
        { itemId: pouchId, qtyBase: 188, damagedQty: 6 },
        { itemId: cartonId, qtyBase: 9, damagedQty: 0 },
      ],
      ...costs,
    });
  expect(completed.status).toBe(200);
  return { runId, finishedId, flourId, oilId, spiceId, pouchId, cartonId };
}

describe("production run cost breakdown", () => {
  afterAll(async () => {
    const boms = await prisma.bomHeader.findMany({
      where: { finishedItem: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { id: true, finishedItemId: true },
    });
    for (const bom of boms) {
      const runs = await prisma.productionRun.findMany({ where: { bomHeaderId: bom.id }, select: { id: true } });
      for (const run of runs) {
        const invoices = await prisma.invoice.findMany({ where: { items: { some: { itemId: bom.finishedItemId } } } });
        await prisma.invoiceItem.deleteMany({ where: { itemId: bom.finishedItemId } });
        await prisma.invoice.deleteMany({ where: { id: { in: invoices.map((i) => i.id) } } });
        await prisma.finishedGoodsBatch.deleteMany({ where: { productionRunId: run.id } });
        await prisma.productionRunMaterial.deleteMany({ where: { productionRunId: run.id } });
      }
      await prisma.stockMovement.deleteMany({ where: { sourceId: { in: runs.map((r) => r.id) } } });
      await prisma.productionRun.deleteMany({ where: { bomHeaderId: bom.id } });
      await prisma.bomLine.deleteMany({ where: { bomHeaderId: bom.id } });
      await prisma.bomHeader.delete({ where: { id: bom.id } });
    }
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });

    const testCustomers = await prisma.customer.findMany({ where: { name: "Cost Test Customer" }, select: { id: true } });
    const customerIds = testCustomers.map((c) => c.id);
    const staleInvoices = await prisma.invoice.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: staleInvoices.map((i) => i.id) } } });
    await prisma.invoice.deleteMany({ where: { id: { in: staleInvoices.map((i) => i.id) } } });
    await prisma.salesOrder.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    // The later-purchase supplier/purchase/batch chain is left in place —
    // same as this suite's sibling tests, which don't unwind purchases
    // either; it's harmless local test data, not a real entity.
  });

  it("reproduces the brief's ₹5,855 total / ₹31.14 per packet / ₹18.86 margin from the brief's own quantities and rates", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");

    const { runId, finishedId, flourId, oilId, spiceId, pouchId, cartonId } = await benchmarkRun(adminCookie, { laborCostPaise: 120_000, overheadCostPaise: 60_000 });

    // A ₹50 selling price for this finished good, as the most recent invoice
    // rate — created directly since the full order→approve→invoice flow
    // isn't what this test is exercising.
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@porulottam.test" } });
    const customer = await prisma.customer.create({ data: { name: "Cost Test Customer", state: "Tamil Nadu" } });
    const salesOrder = await prisma.salesOrder.create({
      data: { customerId: customer.id, salesmanUserId: admin.id, status: "DISPATCHED" },
    });
    const invoice = await prisma.invoice.create({
      data: {
        salesOrderId: salesOrder.id,
        customerId: customer.id,
        financialYear: financialYearFor(new Date()),
        invoiceNumber: Math.floor(Date.now() % 1_000_000),
        taxableValuePaise: 5_000,
        totalPaise: 5_000,
      },
    });
    await prisma.invoiceItem.create({
      data: {
        invoiceId: invoice.id,
        itemId: finishedId,
        description: "Cost test finished good",
        qtyBase: 1,
        ratePaise: 5_000, // ₹50
        taxableValuePaise: 5_000,
        taxRatePct: 5,
      },
    });

    const res = await request(app).get(`/production-runs/${runId}/cost-breakdown`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const b = res.body.data;

    expect(b.materialLines).toHaveLength(3);
    expect(b.materialLines.find((l: { itemId: string }) => l.itemId === flourId).totalCostPaise).toBe(172_500); // 40 kg x ₹43.125
    expect(b.materialLines.find((l: { itemId: string }) => l.itemId === oilId).totalCostPaise).toBe(147_000);
    expect(b.materialLines.find((l: { itemId: string }) => l.itemId === spiceId).totalCostPaise).toBe(24_000);

    expect(b.packagingLines).toHaveLength(2);
    expect(b.packagingLines.find((l: { itemId: string }) => l.itemId === pouchId).totalCostPaise).toBe(48_500);
    expect(b.packagingLines.find((l: { itemId: string }) => l.itemId === cartonId).totalCostPaise).toBe(13_500);

    expect(b.laborCostPaise).toBe(120_000);
    expect(b.overheadCostPaise).toBe(60_000);
    expect(b.totalCostPaise).toBe(585_500); // ₹5,855.00 — matches the brief exactly
    expect(b.goodOutputQty).toBe(188);
    expect(b.costPerGoodUnitPaise).toBe(3_114); // ₹31.14 — matches the brief exactly
    expect(b.sellingPricePaise).toBe(5_000);
    expect(b.marginPaise).toBe(1_886); // ₹18.86 — matches the brief exactly

    // A later purchase at a very different price must not move this run's
    // already-displayed cost — it was never recomputed from today's moving
    // average, only from already-posted StockMovement rows and the run's
    // own stored labour/overhead.
    const supplierRes = await request(app)
      .post("/suppliers")
      .set("Cookie", adminCookie)
      .send({ name: "Cost Test Supplier", state: "Tamil Nadu" });
    await request(app)
      .post("/purchases")
      .set("Cookie", adminCookie)
      .send({
        supplierId: supplierRes.body.data.id,
        items: [{ itemId: flourId, qtyBase: 1_000, rateBasePaise: 1 }], // a much cheaper later purchase
      });
    const res2 = await request(app).get(`/production-runs/${runId}/cost-breakdown`).set("Cookie", adminCookie);
    expect(res2.body.data.totalCostPaise).toBe(585_500);
    expect(res2.body.data.costPerGoodUnitPaise).toBe(3_114);
  });

  it("labour and gas/power added after the run: the cost becomes ₹31.14, and only the difference posts to the ledger", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const { runId, finishedId } = await benchmarkRun(adminCookie, {});

    // Left blank when recorded: ₹500 a batch is assumed. ₹4,055 + ₹500 = ₹4,555 over 188.
    const before = await request(app).get(`/production-runs/${runId}/cost-breakdown`).set("Cookie", adminCookie);
    expect(before.body.data.totalCostPaise).toBe(455_500);
    const valueBefore = await prisma.stockMovement.aggregate({ where: { itemId: finishedId }, _sum: { totalCostPaise: true, qtyBase: true } });

    const res = await request(app)
      .post(`/production-runs/${runId}/running-costs`)
      .set("Cookie", adminCookie)
      .send({ laborCostPaise: 120_000, overheadCostPaise: 60_000 });
    expect(res.status).toBe(200);

    const after = await request(app).get(`/production-runs/${runId}/cost-breakdown`).set("Cookie", adminCookie);
    expect(after.body.data.laborCostPaise).toBe(120_000);
    expect(after.body.data.overheadCostPaise).toBe(60_000);
    expect(after.body.data.totalCostPaise).toBe(585_500);
    expect(after.body.data.costPerGoodUnitPaise).toBe(3_114);

    // ₹1,800 replaces the assumed ₹500: +₹1,300 of value, no packets.
    const valueAfter = await prisma.stockMovement.aggregate({ where: { itemId: finishedId }, _sum: { totalCostPaise: true, qtyBase: true } });
    expect((valueAfter._sum.totalCostPaise ?? 0) - (valueBefore._sum.totalCostPaise ?? 0)).toBe(130_000);
    expect(valueAfter._sum.qtyBase).toBe(valueBefore._sum.qtyBase);

    // Saving the same figures again changes nothing in the ledger.
    const rows = await prisma.stockMovement.count({ where: { sourceId: runId } });
    await request(app).post(`/production-runs/${runId}/running-costs`).set("Cookie", adminCookie).send({ laborCostPaise: 120_000, overheadCostPaise: 60_000 });
    expect(await prisma.stockMovement.count({ where: { sourceId: runId } })).toBe(rows);

    const audit = await prisma.auditLog.findFirst({ where: { entityId: runId, action: "PRODUCTION_RUN_COSTS_UPDATED" } });
    expect(JSON.parse(audit!.beforeJson!)).toEqual({ laborCostPaise: 0, overheadCostPaise: 50_000 });
  });

  it("refuses running costs on a run that isn't done, and for a salesman", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const finishedId = await makeItem(adminCookie, "FINISHED_GOOD");
    const flourId = await makeItem(adminCookie, "RAW_MATERIAL", "G");
    const bom = await request(app).post("/boms").set("Cookie", adminCookie).send({
      finishedItemId: finishedId,
      expectedYieldQty: 10,
      lines: [{ rawItemId: flourId, qtyPerBatch: 1_000 }],
    });
    const run = await request(app).post("/production-runs").set("Cookie", adminCookie).send({ bomHeaderId: bom.body.data.id });

    const planned = await request(app)
      .post(`/production-runs/${run.body.data.id}/running-costs`)
      .set("Cookie", adminCookie)
      .send({ laborCostPaise: 100, overheadCostPaise: 100 });
    expect(planned.status).toBe(409);

    const salesman = await request(app)
      .post(`/production-runs/${run.body.data.id}/running-costs`)
      .set("Cookie", await loginAs("salesman@porulottam.test"))
      .send({ laborCostPaise: 100, overheadCostPaise: 100 });
    expect(salesman.status).toBe(403);
  });
});
