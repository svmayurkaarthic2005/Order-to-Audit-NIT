import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "DISP-TEST-";

async function makeIssuedInvoice(adminCookie: string, salesmanCookie: string, openingQty: number, qty: number, ratePaise: number) {
  const sku = `${TEST_SKU_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const itemRes = await request(app)
    .post("/items")
    .set("Cookie", adminCookie)
    .send({ sku, name: "Dispatch Test Item", type: "FINISHED_GOOD", baseUnit: "PIECE", taxRatePct: 5 });
  const itemId = itemRes.body.data.id as string;

  await request(app)
    .post("/inventory/opening-stock")
    .set("Cookie", adminCookie)
    .send({ itemId, qtyBase: openingQty, totalCostPaise: openingQty * 10 });

  const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });
  const orderRes = await request(app)
    .post("/orders")
    .set("Cookie", salesmanCookie)
    .set("Idempotency-Key", crypto.randomUUID())
    .send({ customerId: retailerA.id, items: [{ itemId, qtyBase: qty, ratePaise }] });
  const orderId = orderRes.body.data.id as string;

  await request(app).post(`/orders/${orderId}/approve`).set("Cookie", adminCookie);
  const invoiceRes = await request(app).post("/invoices").set("Cookie", adminCookie).send({ orderId });
  return { invoiceId: invoiceRes.body.data.id as string, itemId };
}

describe("dispatch and payments", () => {
  afterAll(async () => {
    const testOrderItems = await prisma.orderItem.findMany({
      where: { item: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { salesOrderId: true },
    });
    const orderIds = [...new Set(testOrderItems.map((o) => o.salesOrderId))];
    const invoices = await prisma.invoice.findMany({ where: { salesOrderId: { in: orderIds } }, select: { id: true } });
    const invoiceIds = invoices.map((i) => i.id);
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.dispatch.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.creditNote.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.orderItem.deleteMany({ where: { salesOrderId: { in: orderIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });

  it("reproduces the benchmark's exact post-dispatch stock: 238 on hand, dispatch 150, leaves 88", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { invoiceId, itemId } = await makeIssuedInvoice(adminCookie, salesmanCookie, 238, 150, 5_000);

    const res = await request(app).post("/dispatches").set("Cookie", adminCookie).send({ invoiceId, qty: 150 });
    expect(res.status).toBe(201);

    const onHand = await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", adminCookie);
    expect(onHand.body.data.qtyBase).toBe(88);
  });

  it("a credit note before dispatch frees the packets the order held, and each stage tells the right people", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { invoiceId, itemId } = await makeIssuedInvoice(adminCookie, salesmanCookie, 100, 30, 1_000);
    const available = async () =>
      (await request(app).get("/alerts/stock-status").set("Cookie", adminCookie)).body.data.find((s: { itemId: string }) => s.itemId === itemId)
        .availableQtyBase as number;
    expect(await available()).toBe(70); // 30 set aside for the order

    const cn = await request(app).post(`/invoices/${invoiceId}/credit-note`).set("Cookie", adminCookie).send({ reason: "Customer cancelled" });
    expect(cn.status).toBe(201);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { salesOrder: true } });
    expect(invoice.salesOrder.status).toBe("CANCELLED");
    expect(await available()).toBe(100); // free again, and nothing went out

    const titles = async (cookie: string) =>
      ((await request(app).get("/notifications").set("Cookie", cookie)).body.data.items as { sourceId: string; title: string }[])
        .filter((n) => n.sourceId === invoice.salesOrderId)
        .map((n) => n.title);
    expect((await titles(adminCookie)).some((t) => t.startsWith("New order from"))).toBe(true);
    const salesman = await titles(salesmanCookie);
    expect(salesman.some((t) => t.includes("approved"))).toBe(true);
    expect(salesman.some((t) => t.includes("cancelled"))).toBe(true);
    // The accountant isn't part of the order hand-offs.
    expect(await titles(await loginAs("accountant@porulottam.test"))).toEqual([]);
  });

  it("a dispatch and a credit note at the same moment never ship a cancelled order", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { invoiceId, itemId } = await makeIssuedInvoice(adminCookie, salesmanCookie, 100, 30, 1_000);
    await Promise.allSettled([
      request(app).post("/dispatches").set("Cookie", adminCookie).send({ invoiceId, qty: 30 }),
      request(app).post(`/invoices/${invoiceId}/credit-note`).set("Cookie", adminCookie).send({ reason: "Race" }),
    ]);
    const order = (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { salesOrder: true } })).salesOrder;
    const onHand = (await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", adminCookie)).body.data.qtyBase;
    // Shipped first (then credit-noted): goods left. Cancelled first: nothing left.
    expect([`${order.status}:${onHand}`]).toContainEqual(order.status === "DISPATCHED" ? "DISPATCHED:70" : "CANCELLED:100");
  });

  it("dispatching the same invoice twice is rejected with 409 and stock is unchanged after the second call", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { invoiceId, itemId } = await makeIssuedInvoice(adminCookie, salesmanCookie, 100, 20, 1_000);

    await request(app).post("/dispatches").set("Cookie", adminCookie).send({ invoiceId, qty: 20 });
    const onHandAfterFirst = await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", adminCookie);
    expect(onHandAfterFirst.body.data.qtyBase).toBe(80);

    const secondRes = await request(app).post("/dispatches").set("Cookie", adminCookie).send({ invoiceId, qty: 20 });
    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error.code).toBe("already_dispatched");

    const onHandAfterSecond = await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", adminCookie);
    expect(onHandAfterSecond.body.data.qtyBase).toBe(80); // unchanged by the rejected second call
  });

  it("closes the double-dispatch race: two concurrent dispatch requests on the same invoice — only one succeeds", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { invoiceId, itemId } = await makeIssuedInvoice(adminCookie, salesmanCookie, 100, 20, 1_000);

    const [a, b] = await Promise.all([
      request(app).post("/dispatches").set("Cookie", adminCookie).send({ invoiceId, qty: 20 }),
      request(app).post("/dispatches").set("Cookie", adminCookie).send({ invoiceId, qty: 20 }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const onHand = await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", adminCookie);
    expect(onHand.body.data.qtyBase).toBe(80); // not 60 — dispatched only once
  });

  it("reproduces the benchmark's exact outstanding: ₹7,875 invoice, ₹4,000 payment, leaves ₹3,875", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { invoiceId } = await makeIssuedInvoice(adminCookie, salesmanCookie, 500, 150, 5_000);

    const res = await request(app).post("/payments").set("Cookie", adminCookie).send({ invoiceId, amountPaise: 400_000 });
    expect(res.status).toBe(201);
    expect(res.body.data.outstandingPaise).toBe(387_500); // ₹3,875 exactly

    const outstandingRes = await request(app).get(`/invoices/${invoiceId}/outstanding`).set("Cookie", adminCookie);
    expect(outstandingRes.body.data.outstandingPaise).toBe(387_500);
  });

  it("allows a second partial payment but refuses one larger than what's still owed", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { invoiceId } = await makeIssuedInvoice(adminCookie, salesmanCookie, 10, 1, 1_000); // ₹10.50 total after 5% GST

    await request(app).post("/payments").set("Cookie", adminCookie).send({ invoiceId, amountPaise: 1_000 });
    const over = await request(app).post("/payments").set("Cookie", adminCookie).send({ invoiceId, amountPaise: 100 });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("overpayment");
    expect(over.body.error.message).toContain("₹0.50");

    const exact = await request(app).post("/payments").set("Cookie", adminCookie).send({ invoiceId, amountPaise: 50 });
    expect(exact.status).toBe(201);
    expect(exact.body.data.outstandingPaise).toBe(0);
    const again = await request(app).post("/payments").set("Cookie", adminCookie).send({ invoiceId, amountPaise: 1 });
    expect(again.body.error.message).toBe("This invoice is already fully paid.");
  });

  it("two payments at once can't together pay more than what's owed", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { invoiceId } = await makeIssuedInvoice(adminCookie, salesmanCookie, 10, 1, 1_000); // ₹10.50
    const pay = () => request(app).post("/payments").set("Cookie", adminCookie).send({ invoiceId, amountPaise: 1_050 });
    const statuses = (await Promise.all([pay(), pay()])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("a salesman/production cannot dispatch or record payments; an accountant can read but not write", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const { invoiceId } = await makeIssuedInvoice(adminCookie, salesmanCookie, 10, 1, 1_000);

    const dispatchRes = await request(app).post("/dispatches").set("Cookie", salesmanCookie).send({ invoiceId, qty: 1 });
    expect(dispatchRes.status).toBe(403);
    const paymentRes = await request(app).post("/payments").set("Cookie", salesmanCookie).send({ invoiceId, amountPaise: 1 });
    expect(paymentRes.status).toBe(403);

    const accountantCookie = await loginAs("accountant@porulottam.test");
    const readRes = await request(app).get("/dispatches").set("Cookie", accountantCookie);
    expect(readRes.status).toBe(200);
    const accDispatchRes = await request(app).post("/dispatches").set("Cookie", accountantCookie).send({ invoiceId, qty: 1 });
    expect(accDispatchRes.status).toBe(403);
  });
});
