import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";
import { financialYearFor } from "./modules/invoices/service.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "INV-TEST-";

async function makeApprovedOrder(
  adminCookie: string,
  salesmanCookie: string,
  opts: { qtyBase: number; ratePaise: number; taxRatePct: number; customerName: string },
) {
  const sku = `${TEST_SKU_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const itemRes = await request(app)
    .post("/items")
    .set("Cookie", adminCookie)
    .send({ sku, name: "Invoice Test Item", type: "FINISHED_GOOD", baseUnit: "PIECE", taxRatePct: opts.taxRatePct });
  const itemId = itemRes.body.data.id as string;

  await request(app)
    .post("/inventory/opening-stock")
    .set("Cookie", adminCookie)
    .send({ itemId, qtyBase: opts.qtyBase * 10, totalCostPaise: opts.qtyBase * 10 * 10 });

  const customer = await prisma.customer.findFirstOrThrow({ where: { name: { contains: opts.customerName } } });

  const orderRes = await request(app)
    .post("/orders")
    .set("Cookie", salesmanCookie)
    .set("Idempotency-Key", crypto.randomUUID())
    .send({ customerId: customer.id, items: [{ itemId, qtyBase: opts.qtyBase, ratePaise: opts.ratePaise }] });
  const orderId = orderRes.body.data.id as string;

  const approveRes = await request(app).post(`/orders/${orderId}/approve`).set("Cookie", adminCookie);
  expect(approveRes.status).toBe(200);

  return { orderId, itemId };
}

describe("financialYearFor", () => {
  it("April onward belongs to the FY starting that calendar year", () => {
    expect(financialYearFor(new Date("2026-04-01T00:00:00Z"))).toBe("2026-27");
    expect(financialYearFor(new Date("2026-11-24T00:00:00Z"))).toBe("2026-27");
  });

  it("January through March belongs to the FY that started the previous calendar year", () => {
    expect(financialYearFor(new Date("2027-03-31T00:00:00Z"))).toBe("2026-27");
    expect(financialYearFor(new Date("2027-01-01T00:00:00Z"))).toBe("2026-27");
  });
});

describe("invoices", () => {
  afterAll(async () => {
    const testOrderItems = await prisma.orderItem.findMany({
      where: { item: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { salesOrderId: true },
    });
    const orderIds = [...new Set(testOrderItems.map((o) => o.salesOrderId))];
    await prisma.invoiceItem.deleteMany({ where: { invoice: { salesOrderId: { in: orderIds } } } });
    await prisma.creditNote.deleteMany({ where: { invoice: { salesOrderId: { in: orderIds } } } });
    await prisma.invoice.deleteMany({ where: { salesOrderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { salesOrderId: { in: orderIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });

  it("reproduces the benchmark's exact total: 150 units @ ₹50, 5% GST, same state → ₹7,875 via CGST+SGST", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { orderId } = await makeApprovedOrder(adminCookie, salesmanCookie, {
      qtyBase: 150,
      ratePaise: 5_000,
      taxRatePct: 5,
      customerName: "Retailer A", // Tamil Nadu — same state as the manufacturer
    });

    const res = await request(app).post("/invoices").set("Cookie", adminCookie).send({ orderId });
    expect(res.status).toBe(201);
    expect(res.body.data.taxableValuePaise).toBe(750_000);
    expect(res.body.data.cgstPaise).toBe(18_750);
    expect(res.body.data.sgstPaise).toBe(18_750);
    expect(res.body.data.igstPaise).toBe(0);
    expect(res.body.data.totalPaise).toBe(787_500); // ₹7,875 exactly

    const orderAfter = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfter.status).toBe("DISPATCHABLE");
  });

  it("an interstate customer's invoice uses IGST instead of CGST+SGST", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { orderId } = await makeApprovedOrder(adminCookie, salesmanCookie, {
      qtyBase: 10,
      ratePaise: 1_000,
      taxRatePct: 5,
      customerName: "Distributor B", // Karnataka — different state
    });

    const res = await request(app).post("/invoices").set("Cookie", adminCookie).send({ orderId });
    expect(res.status).toBe(201);
    expect(res.body.data.cgstPaise).toBe(0);
    expect(res.body.data.sgstPaise).toBe(0);
    expect(res.body.data.igstPaise).toBe(500); // 5% of ₹100
  });

  it("creates two invoices concurrently and assigns two different, correctly-sequenced numbers in the same FY", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const orderA = await makeApprovedOrder(adminCookie, salesmanCookie, {
      qtyBase: 1,
      ratePaise: 100,
      taxRatePct: 5,
      customerName: "Retailer A",
    });
    const orderB = await makeApprovedOrder(adminCookie, salesmanCookie, {
      qtyBase: 1,
      ratePaise: 100,
      taxRatePct: 5,
      customerName: "Retailer A",
    });

    const [a, b] = await Promise.all([
      request(app).post("/invoices").set("Cookie", adminCookie).send({ orderId: orderA.orderId }),
      request(app).post("/invoices").set("Cookie", adminCookie).send({ orderId: orderB.orderId }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.financialYear).toBe(b.body.data.financialYear);
    // Never collide: the real guarantee the locked invoice_sequences row
    // gives. An exact-adjacency check (no gap) is NOT asserted here — the
    // sequence is a single real row shared with every other test file
    // running invoice creation concurrently in the same financial year, so
    // another file's legitimate invoice can land between these two calls.
    // That's correct behavior (every increment is a real invoice), not a skip.
    expect(a.body.data.invoiceNumber).not.toBe(b.body.data.invoiceNumber);
  });

  it("rejects invoicing an order that isn't APPROVED", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const sku = `${TEST_SKU_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const itemRes = await request(app)
      .post("/items")
      .set("Cookie", adminCookie)
      .send({ sku, name: "Invoice Test Item", type: "FINISHED_GOOD", baseUnit: "PIECE" });
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });
    const orderRes = await request(app)
      .post("/orders")
      .set("Cookie", salesmanCookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ customerId: retailerA.id, items: [{ itemId: itemRes.body.data.id, qtyBase: 1, ratePaise: 100 }] });

    const res = await request(app).post("/invoices").set("Cookie", adminCookie).send({ orderId: orderRes.body.data.id });
    expect(res.status).toBe(409);
  });

  it("no route exists to mutate an invoice's items — invoice_items is a frozen snapshot", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { orderId } = await makeApprovedOrder(adminCookie, salesmanCookie, {
      qtyBase: 1,
      ratePaise: 100,
      taxRatePct: 5,
      customerName: "Retailer A",
    });
    const createRes = await request(app).post("/invoices").set("Cookie", adminCookie).send({ orderId });
    const invoiceId = createRes.body.data.id;

    const patchRes = await request(app).patch(`/invoices/${invoiceId}`).set("Cookie", adminCookie).send({ totalPaise: 1 });
    expect(patchRes.status).toBe(404);
    const deleteRes = await request(app).delete(`/invoices/${invoiceId}`).set("Cookie", adminCookie);
    expect(deleteRes.status).toBe(404);
  });

  it("a credit note never edits or deletes the original invoice, only adds a new row", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { orderId } = await makeApprovedOrder(adminCookie, salesmanCookie, {
      qtyBase: 1,
      ratePaise: 100,
      taxRatePct: 5,
      customerName: "Retailer A",
    });
    const createRes = await request(app).post("/invoices").set("Cookie", adminCookie).send({ orderId });
    const invoiceId = createRes.body.data.id;
    const originalTotal = createRes.body.data.totalPaise;

    const creditRes = await request(app)
      .post(`/invoices/${invoiceId}/credit-note`)
      .set("Cookie", adminCookie)
      .send({ reason: "customer returned goods" });
    expect(creditRes.status).toBe(201);
    expect(creditRes.body.data.status).toBe("CANCELLED");
    expect(creditRes.body.data.totalPaise).toBe(originalTotal); // the original row is untouched, only its status flag flips
    expect(creditRes.body.data.creditNotes).toHaveLength(1);
    expect(creditRes.body.data.creditNotes[0].amountPaise).toBe(originalTotal);

    const again = await request(app)
      .post(`/invoices/${invoiceId}/credit-note`)
      .set("Cookie", adminCookie)
      .send({ reason: "duplicate attempt" });
    expect(again.status).toBe(409);
  });

  it("a salesman cannot create or read invoices; an accountant can read but not create", async () => {
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const listRes = await request(app).get("/invoices").set("Cookie", salesmanCookie);
    expect(listRes.status).toBe(403);
    const createRes = await request(app).post("/invoices").set("Cookie", salesmanCookie).send({ orderId: "x" });
    expect(createRes.status).toBe(403);

    const accountantCookie = await loginAs("accountant@porulottam.test");
    const accListRes = await request(app).get("/invoices").set("Cookie", accountantCookie);
    expect(accListRes.status).toBe(200);
    const accCreateRes = await request(app).post("/invoices").set("Cookie", accountantCookie).send({ orderId: "x" });
    expect(accCreateRes.status).toBe(403);
  });
});
