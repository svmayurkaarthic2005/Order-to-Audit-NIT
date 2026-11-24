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

async function makeItem(cookie: string, type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD") {
  const sku = `${TEST_SKU_PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie)
    .send({ sku, name: `Cost Breakdown Test ${type}`, type, baseUnit: "PIECE" });
  return res.body.data.id as string;
}

async function openingStock(cookie: string, itemId: string, qtyBase: number, totalCostPaise: number) {
  await request(app).post("/inventory/opening-stock").set("Cookie", cookie).send({ itemId, qtyBase, totalCostPaise });
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

  it("reproduces the brief's ₹5,855 total / ₹31.14 per-packet / ₹18.86 margin from real ledger data", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");

    const flourId = await makeItem(adminCookie, "RAW_MATERIAL");
    const oilId = await makeItem(adminCookie, "RAW_MATERIAL");
    const spiceId = await makeItem(adminCookie, "RAW_MATERIAL");
    const pouchId = await makeItem(adminCookie, "PACKAGING");
    const cartonId = await makeItem(adminCookie, "PACKAGING");
    const finishedId = await makeItem(adminCookie, "FINISHED_GOOD");

    // Opening-stock rates are chosen so each item's moving-average cost is a
    // clean integer paise/base-unit (the only movement before consumption,
    // so the average is exact) — consuming the quantities below then costs
    // exactly the brief's line totals. The brief states flour's rate as
    // "₹43.125/kg": that's 4.3125 paise/gram, which this system can never
    // store (StockMovement.unitCostPaise is an integer paise/base-unit), so
    // this fixture reproduces the brief's TOTALS exactly — ₹5,855 overall,
    // ₹31.14/good-packet, ₹18.86 margin — rather than forcing an
    // unrepresentable fractional rate onto one line.
    await openingStock(adminCookie, flourId, 100_000, 100_000 * 100); // 100 paise/g
    await openingStock(adminCookie, oilId, 100_000, 100_000 * 10); // 10 paise/ml-equivalent piece
    await openingStock(adminCookie, spiceId, 100_000, 100_000 * 2); // 2 paise/g
    await openingStock(adminCookie, pouchId, 100_000, 100_000 * 5); // 5 paise/piece
    await openingStock(adminCookie, cartonId, 10_000, 10_000 * 15); // 15 paise/piece

    const bomRes = await request(app).post("/boms").set("Cookie", adminCookie).send({
      finishedItemId: finishedId,
      expectedYieldQty: 200,
      lines: [
        { rawItemId: flourId, qtyPerBatch: 1_725 },
        { rawItemId: oilId, qtyPerBatch: 14_700 },
        { rawItemId: spiceId, qtyPerBatch: 12_000 },
        { rawItemId: pouchId, qtyPerBatch: 9_700 },
        { rawItemId: cartonId, qtyPerBatch: 900 },
      ],
    });
    const bomId = bomRes.body.data.id as string;

    const runRes = await request(app).post("/production-runs").set("Cookie", adminCookie).send({ bomHeaderId: bomId });
    const runId = runRes.body.data.id as string;

    await request(app)
      .post(`/production-runs/${runId}/start`)
      .set("Cookie", adminCookie)
      .send({
        actualConsumption: [
          { itemId: flourId, qtyBase: 1_725 }, // 1725 * 100 paise = 172,500 paise = ₹1,725
          { itemId: oilId, qtyBase: 14_700 }, // 14700 * 10 paise = 147,000 paise = ₹1,470
          { itemId: spiceId, qtyBase: 12_000 }, // 12000 * 2 paise = 24,000 paise = ₹240
        ],
      });

    // 188 good (the project's own -6% yield benchmark: 200 expected, 188
    // actual) + 9700 pouches and 900 cartons consumed/damaged (combined,
    // same as the packaging-reconciliation fixture): 9694 consumed + 6
    // damaged pouches = ₹485, 900 cartons = ₹135. Labour ₹1,200 and
    // power/gas ₹600 passed explicitly, overriding the flat ₹500 default.
    await request(app)
      .post(`/production-runs/${runId}/complete`)
      .set("Cookie", adminCookie)
      .set("Idempotency-Key", `cost-test-${runId}`)
      .send({
        actualOutputQty: 188,
        packagingConsumed: [
          { itemId: pouchId, qtyBase: 9_694, damagedQty: 6 },
          { itemId: cartonId, qtyBase: 900, damagedQty: 0 },
        ],
        laborCostPaise: 120_000,
        overheadCostPaise: 60_000,
      });

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
    expect(b.materialLines.find((l: { itemId: string }) => l.itemId === flourId).totalCostPaise).toBe(172_500);
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
});
