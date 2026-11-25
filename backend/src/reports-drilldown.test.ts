import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";
import { financialYearFor } from "./modules/invoices/service.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "DRILL-TEST-";

async function makeItem(cookie: string, type: "RAW_MATERIAL" | "FINISHED_GOOD") {
  const sku = `${TEST_SKU_PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie)
    .send({ sku, name: `Drilldown Test ${type}`, type, baseUnit: "G" });
  return res.body.data.id as string;
}

describe("reports drill-downs", () => {
  afterAll(async () => {
    const boms = await prisma.bomHeader.findMany({
      where: { finishedItem: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { id: true },
    });
    for (const bom of boms) {
      const runs = await prisma.productionRun.findMany({ where: { bomHeaderId: bom.id }, select: { id: true } });
      await prisma.productionRunMaterial.deleteMany({ where: { productionRunId: { in: runs.map((r) => r.id) } } });
      await prisma.finishedGoodsBatch.deleteMany({ where: { productionRunId: { in: runs.map((r) => r.id) } } });
      await prisma.stockMovement.deleteMany({ where: { sourceId: { in: runs.map((r) => r.id) } } });
      await prisma.productionRun.deleteMany({ where: { bomHeaderId: bom.id } });
      await prisma.bomLine.deleteMany({ where: { bomHeaderId: bom.id } });
      await prisma.bomHeader.delete({ where: { id: bom.id } });
    }

    const purchaseItems = await prisma.purchaseItem.findMany({ where: { item: { sku: { startsWith: TEST_SKU_PREFIX } } } });
    await prisma.purchaseItem.deleteMany({ where: { id: { in: purchaseItems.map((p) => p.id) } } });
    const purchaseIds = [...new Set(purchaseItems.map((p) => p.purchaseId))];
    await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
    await prisma.supplier.deleteMany({ where: { name: "Drilldown Test Supplier" } });

    await prisma.stockMovement.deleteMany({ where: { item: { sku: { startsWith: TEST_SKU_PREFIX } } } });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });

    const testInvoices = await prisma.invoice.findMany({ where: { customer: { name: "Drilldown Test Customer" } } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: testInvoices.map((i) => i.id) } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: testInvoices.map((i) => i.id) } } });
    await prisma.invoice.deleteMany({ where: { id: { in: testInvoices.map((i) => i.id) } } });
    await prisma.salesOrder.deleteMany({ where: { customer: { name: "Drilldown Test Customer" } } });
    await prisma.customer.deleteMany({ where: { name: "Drilldown Test Customer" } });
  });

  it("flour's 120kg closing balance traces to opening 100kg + purchase 60kg − production issue 40kg", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");

    const flourId = await makeItem(adminCookie, "RAW_MATERIAL");
    const finishedId = await makeItem(adminCookie, "FINISHED_GOOD");

    await request(app).post("/inventory/opening-stock").set("Cookie", adminCookie)
      .send({ itemId: flourId, qtyBase: 100_000, totalCostPaise: 100_000 * 45 }); // 100 kg @ ₹45/kg

    const supplierRes = await request(app).post("/suppliers").set("Cookie", adminCookie)
      .send({ name: "Drilldown Test Supplier", state: "Tamil Nadu" });
    await request(app).post("/purchases").set("Cookie", adminCookie).send({
      supplierId: supplierRes.body.data.id,
      items: [{ itemId: flourId, qtyBase: 60_000, rateBasePaise: 45 }], // 60 kg @ ₹45/kg
    });

    const bomRes = await request(app).post("/boms").set("Cookie", adminCookie).send({
      finishedItemId: finishedId,
      expectedYieldQty: 100,
      lines: [{ rawItemId: flourId, qtyPerBatch: 40_000 }], // 40 kg per batch
    });
    const runRes = await request(app).post("/production-runs").set("Cookie", adminCookie)
      .send({ bomHeaderId: bomRes.body.data.id });
    await request(app).post(`/production-runs/${runRes.body.data.id}/start`).set("Cookie", adminCookie)
      .send({ actualConsumption: [{ itemId: flourId, qtyBase: 40_000 }] }); // production issue 40 kg

    // Drill-down: the raw ledger behind this item's stock-summary cell.
    const ledgerRes = await request(app).get(`/reports/stock-ledger?itemId=${flourId}`).set("Cookie", adminCookie);
    expect(ledgerRes.status).toBe(200);
    const sources = ledgerRes.body.data.map((m: { source: string }) => m.source);
    expect(sources).toEqual(["OPENING_STOCK", "PURCHASE", "PRODUCTION_ISSUE"]);
    const closingFromLedger = ledgerRes.body.data.reduce((sum: number, m: { qtyBase: number }) => sum + m.qtyBase, 0);
    expect(closingFromLedger).toBe(120_000); // 100,000 + 60,000 - 40,000 = 120 kg

    // Reconciles exactly with the Stock Summary cell it expands.
    const summaryRes = await request(app).get("/reports/stock-summary?type=RAW_MATERIAL").set("Cookie", adminCookie);
    const row = summaryRes.body.data.find((r: { itemId: string }) => r.itemId === flourId);
    expect(row.qtyBase).toBe(closingFromLedger);
  });

  it("an invoice's ₹3,875 outstanding (₹7,875 total − ₹4,000 payment) traces exactly through both drill-downs", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@porulottam.test" } });
    const customer = await prisma.customer.create({ data: { name: "Drilldown Test Customer", state: "Tamil Nadu" } });
    const salesOrder = await prisma.salesOrder.create({
      data: { customerId: customer.id, salesmanUserId: admin.id, status: "DISPATCHED" },
    });
    const invoice = await prisma.invoice.create({
      data: {
        salesOrderId: salesOrder.id,
        customerId: customer.id,
        financialYear: financialYearFor(new Date()),
        invoiceNumber: Math.floor(Date.now() % 1_000_000),
        taxableValuePaise: 750_000,
        cgstPaise: 18_750,
        sgstPaise: 18_750,
        totalPaise: 787_500, // ₹7,875
      },
    });
    await prisma.payment.create({ data: { invoiceId: invoice.id, amountPaise: 400_000 } }); // ₹4,000

    const invoiceDetail = await request(app).get(`/reports/invoices/${invoice.id}/detail`).set("Cookie", adminCookie);
    expect(invoiceDetail.status).toBe(200);
    expect(invoiceDetail.body.data.totalPaise).toBe(787_500);
    expect(invoiceDetail.body.data.paidPaise).toBe(400_000);
    expect(invoiceDetail.body.data.outstandingPaise).toBe(387_500); // ₹3,875

    const customerDetail = await request(app)
      .get(`/reports/customers/${customer.id}/outstanding-detail`)
      .set("Cookie", adminCookie);
    expect(customerDetail.status).toBe(200);
    expect(customerDetail.body.data).toHaveLength(1);
    expect(customerDetail.body.data[0].outstandingPaise).toBe(387_500);

    // Reconciles exactly with the Payments & Collections summary cell.
    const collectionsRes = await request(app).get("/reports/payments-collections").set("Cookie", adminCookie);
    const row = collectionsRes.body.data.find((c: { customerId: string }) => c.customerId === customer.id);
    expect(row.outstandingPaise).toBe(387_500);
  });

  it("a salesman cannot reach any report drill-down route", async () => {
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const res = await request(app).get("/reports/customers/any-id/outstanding-detail").set("Cookie", salesmanCookie);
    expect(res.status).toBe(403);
  });
});
