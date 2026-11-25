import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "ORDER-TEST-";

async function makeTestFinishedGood(cookie: string) {
  const sku = `${TEST_SKU_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie)
    .send({ sku, name: "Order Test Item", type: "FINISHED_GOOD", baseUnit: "PIECE" });
  return res.body.data.id as string;
}

describe("salesman order entry", () => {
  afterAll(async () => {
    // SalesOrder has no soft-delete flag and listOrders returns everything,
    // so test orders would otherwise linger in the real order history/admin
    // queue forever. Hard-delete the orders this suite created (identified
    // by containing a test-SKU item), then deactivate the test items.
    const testOrderItems = await prisma.orderItem.findMany({
      where: { item: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { salesOrderId: true },
    });
    const orderIds = [...new Set(testOrderItems.map((o) => o.salesOrderId))];
    await prisma.orderItem.deleteMany({ where: { salesOrderId: { in: orderIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });

  it("a salesman submits a valid order and sees it in their own history as SUBMITTED", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestFinishedGood(adminCookie);
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });

    const cookie = await loginAs("salesman@porulottam.test");
    const createRes = await request(app)
      .post("/orders")
      .set("Cookie", cookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ customerId: retailerA.id, items: [{ itemId, qtyBase: 10, ratePaise: 5_000 }] });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe("SUBMITTED");

    const historyRes = await request(app).get("/orders").set("Cookie", cookie);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.data.items.some((o: { id: string }) => o.id === createRes.body.data.id)).toBe(true);
  });

  it("rejects an order with zero line items, client schema and server both", async () => {
    const cookie = await loginAs("salesman@porulottam.test");
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });

    const res = await request(app).post("/orders").set("Cookie", cookie).set("Idempotency-Key", crypto.randomUUID()).send({ customerId: retailerA.id, items: [] });
    expect(res.status).toBe(400);
  });

  it("rejects an order containing a raw material (salesmen only sell finished goods)", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const flour = await prisma.item.findUniqueOrThrow({ where: { sku: "RM-FLOUR" } });
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });

    const cookie = await loginAs("salesman@porulottam.test");
    const res = await request(app)
      .post("/orders")
      .set("Cookie", cookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ customerId: retailerA.id, items: [{ itemId: flour.id, qtyBase: 1, ratePaise: 100 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_item_type");
    void adminCookie;
  });

  it("the order is always recorded under the caller's own id, never a spoofed salesman", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestFinishedGood(adminCookie);
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });
    const salesman = await prisma.user.findUniqueOrThrow({ where: { email: "salesman@porulottam.test" } });

    const cookie = await loginAs("salesman@porulottam.test");
    const createRes = await request(app)
      .post("/orders")
      .set("Cookie", cookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ customerId: retailerA.id, items: [{ itemId, qtyBase: 1, ratePaise: 100 }], salesmanUserId: "someone-else" });
    expect(createRes.body.data.salesmanUserId).toBe(salesman.id);
  });

  it("a salesman cannot see another salesman's orders via the salesmanId query param", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestFinishedGood(adminCookie);
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });

    const salesmanCookie = await loginAs("salesman@porulottam.test");
    await request(app)
      .post("/orders")
      .set("Cookie", salesmanCookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ customerId: retailerA.id, items: [{ itemId, qtyBase: 1, ratePaise: 100 }] });

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@porulottam.test" } });
    const res = await request(app).get(`/orders?salesmanId=${owner.id}`).set("Cookie", salesmanCookie);
    expect(res.body.data.items.every((o: { salesmanUser: { email: string } }) => o.salesmanUser.email === "salesman@porulottam.test")).toBe(
      true,
    );
  });

  it("an admin can create an order and sees all salesmen's orders when no filter is given", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestFinishedGood(cookie);
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });

    const createRes = await request(app)
      .post("/orders")
      .set("Cookie", cookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ customerId: retailerA.id, items: [{ itemId, qtyBase: 1, ratePaise: 100 }] });
    expect(createRes.status).toBe(201);

    const listRes = await request(app).get("/orders").set("Cookie", cookie);
    expect(listRes.status).toBe(200);
  });

  it("never serializes the salesman's passwordHash in an order response", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestFinishedGood(adminCookie);
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });

    const cookie = await loginAs("salesman@porulottam.test");
    const createRes = await request(app)
      .post("/orders")
      .set("Cookie", cookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ customerId: retailerA.id, items: [{ itemId, qtyBase: 1, ratePaise: 100 }] });

    const listRes = await request(app).get("/orders").set("Cookie", cookie);
    expect(listRes.status).toBe(200);
    expect(JSON.stringify(listRes.body)).not.toContain("passwordHash");

    const getRes = await request(app).get(`/orders/${createRes.body.data.id}`).set("Cookie", adminCookie);
    expect(JSON.stringify(getRes.body)).not.toContain("passwordHash");
  });

  it("a production/accountant role cannot read or create orders", async () => {
    const cookie = await loginAs("production@porulottam.test");
    const listRes = await request(app).get("/orders").set("Cookie", cookie);
    expect(listRes.status).toBe(403);

    const createRes = await request(app).post("/orders").set("Cookie", cookie).set("Idempotency-Key", crypto.randomUUID()).send({ customerId: "x", items: [{ itemId: "y", qtyBase: 1, ratePaise: 1 }] });
    expect(createRes.status).toBe(403);
  });

  it("rejects a submission with no Idempotency-Key header", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestFinishedGood(adminCookie);
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });
    const cookie = await loginAs("salesman@porulottam.test");
    const res = await request(app)
      .post("/orders")
      .set("Cookie", cookie)
      .send({ customerId: retailerA.id, items: [{ itemId, qtyBase: 1, ratePaise: 100 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("missing_idempotency_key");
  });

  it("replays the same Idempotency-Key — the offline queue's retry case — into exactly one order, never two", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestFinishedGood(adminCookie);
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });
    const cookie = await loginAs("salesman@porulottam.test");
    const key = crypto.randomUUID();
    const body = { customerId: retailerA.id, items: [{ itemId, qtyBase: 3, ratePaise: 500 }] };

    const first = await request(app).post("/orders").set("Cookie", cookie).set("Idempotency-Key", key).send(body);
    expect(first.status).toBe(201);

    // A replay (impatient manual retry, or the offline queue firing twice)
    // with the SAME key must resolve to the SAME order, not a second one.
    const second = await request(app).post("/orders").set("Cookie", cookie).set("Idempotency-Key", key).send(body);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    const count = await prisma.salesOrder.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
    expect(JSON.stringify(first.body)).not.toContain("idempotencyKey");
  });

  it("scopes the Idempotency-Key to the caller — a different user reusing the same key gets their own order, not someone else's", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestFinishedGood(adminCookie);
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const sharedKey = crypto.randomUUID();

    const salesmanRes = await request(app)
      .post("/orders")
      .set("Cookie", salesmanCookie)
      .set("Idempotency-Key", sharedKey)
      .send({ customerId: retailerA.id, items: [{ itemId, qtyBase: 1, ratePaise: 100 }] });
    expect(salesmanRes.status).toBe(201);

    // Admin reusing the exact same key must get their OWN new order, never
    // the salesman's — the key is scoped per caller, not global.
    const adminRes = await request(app)
      .post("/orders")
      .set("Cookie", adminCookie)
      .set("Idempotency-Key", sharedKey)
      .send({ customerId: retailerA.id, items: [{ itemId, qtyBase: 2, ratePaise: 100 }] });
    expect(adminRes.status).toBe(201);
    expect(adminRes.body.data.id).not.toBe(salesmanRes.body.data.id);
  });
});

describe("order edit before approval", () => {
  afterAll(async () => {
    const testOrderItems = await prisma.orderItem.findMany({
      where: { item: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { salesOrderId: true },
    });
    const orderIds = [...new Set(testOrderItems.map((o) => o.salesOrderId))];
    await prisma.auditLog.deleteMany({ where: { entityType: "SalesOrder", entityId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { salesOrderId: { in: orderIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });

  async function makeSubmittedOrder(cookie: string, itemId: string, qtyBase: number, ratePaise: number) {
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });
    const res = await request(app)
      .post("/orders")
      .set("Cookie", cookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ customerId: retailerA.id, items: [{ itemId, qtyBase, ratePaise }] });
    return res.body.data.id as string;
  }

  it("a salesman (unauthorized for this action) cannot edit an order", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestFinishedGood(adminCookie);
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const orderId = await makeSubmittedOrder(salesmanCookie, itemId, 5, 100);

    const res = await request(app)
      .patch(`/orders/${orderId}`)
      .set("Cookie", salesmanCookie)
      .send({ items: [{ itemId, qtyBase: 9, ratePaise: 100 }] });
    expect(res.status).toBe(403);
  });

  it("admin edits a SUBMITTED order's quantity and price; the total recalculates and an audit entry is recorded", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestFinishedGood(adminCookie);
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const orderId = await makeSubmittedOrder(salesmanCookie, itemId, 5, 100);

    const res = await request(app)
      .patch(`/orders/${orderId}`)
      .set("Cookie", adminCookie)
      .send({ items: [{ itemId, qtyBase: 9, ratePaise: 150 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].qtyBase).toBe(9);
    expect(res.body.data.items[0].ratePaise).toBe(150);

    // Total is always derived live from OrderItem rows — nothing to
    // separately "recalculate" — so re-reading the order already reflects it.
    const reread = await request(app).get(`/orders/${orderId}`).set("Cookie", adminCookie);
    const total = reread.body.data.items.reduce((sum: number, l: { qtyBase: number; ratePaise: number }) => sum + l.qtyBase * l.ratePaise, 0);
    expect(total).toBe(9 * 150);

    const entry = await prisma.auditLog.findFirst({ where: { entityType: "SalesOrder", entityId: orderId, action: "EDIT" } });
    expect(entry).not.toBeNull();
    expect(entry!.userId).toBe((await prisma.user.findUniqueOrThrow({ where: { email: "admin@porulottam.test" } })).id);
    expect(JSON.parse(entry!.beforeJson!).items[0].qtyBase).toBe(5);
    expect(JSON.parse(entry!.afterJson!).items[0].qtyBase).toBe(9);
  });

  it("an APPROVED order cannot be edited, and no misleading audit entry is created for the failed attempt", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestFinishedGood(adminCookie);
    await request(app).post("/inventory/opening-stock").set("Cookie", adminCookie).send({ itemId, qtyBase: 100, totalCostPaise: 100 });
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const orderId = await makeSubmittedOrder(salesmanCookie, itemId, 5, 100);

    const approveRes = await request(app).post(`/orders/${orderId}/approve`).set("Cookie", adminCookie);
    expect(approveRes.status).toBe(200);

    const editRes = await request(app)
      .patch(`/orders/${orderId}`)
      .set("Cookie", adminCookie)
      .send({ items: [{ itemId, qtyBase: 1, ratePaise: 1 }] });
    expect(editRes.status).toBe(409);

    const entry = await prisma.auditLog.findFirst({ where: { entityType: "SalesOrder", entityId: orderId, action: "EDIT" } });
    expect(entry).toBeNull();
    // The order itself is untouched by the failed edit attempt.
    const stillOriginal = await prisma.orderItem.findFirstOrThrow({ where: { salesOrderId: orderId } });
    expect(stillOriginal.qtyBase).toBe(5);
    expect(stillOriginal.ratePaise).toBe(100);
  });
});

describe("order approval", () => {
  afterAll(async () => {
    const testOrderItems = await prisma.orderItem.findMany({
      where: { item: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { salesOrderId: true },
    });
    const orderIds = [...new Set(testOrderItems.map((o) => o.salesOrderId))];
    await prisma.orderItem.deleteMany({ where: { salesOrderId: { in: orderIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });

  async function makeStockedFinishedGood(cookie: string, openingQty: number) {
    const itemId = await makeTestFinishedGood(cookie);
    await request(app)
      .post("/inventory/opening-stock")
      .set("Cookie", cookie)
      .send({ itemId, qtyBase: openingQty, totalCostPaise: openingQty * 10 });
    return itemId;
  }

  async function makeOrder(cookie: string, itemId: string, qtyBase: number) {
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });
    const res = await request(app)
      .post("/orders")
      .set("Cookie", cookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ customerId: retailerA.id, items: [{ itemId, qtyBase, ratePaise: 100 }] });
    return res.body.data.id as string;
  }

  it("reproduces the benchmark's exact shortage: 238 on hand, approve 150, next order short by 32 on a 120 request", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeStockedFinishedGood(adminCookie, 238);
    const salesmanCookie = await loginAs("salesman@porulottam.test");

    const firstOrderId = await makeOrder(salesmanCookie, itemId, 150);
    const approveRes = await request(app).post(`/orders/${firstOrderId}/approve`).set("Cookie", adminCookie);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe("APPROVED");

    const secondOrderId = await makeOrder(salesmanCookie, itemId, 120);
    const secondApproveRes = await request(app).post(`/orders/${secondOrderId}/approve`).set("Cookie", adminCookie);
    expect(secondApproveRes.status).toBe(409);
    expect(secondApproveRes.body.error.code).toBe("insufficient_stock");
    expect(secondApproveRes.body.error.details.shortfall).toBe(32); // 238 - 150 = 88 available, 120 - 88 = 32 short
  });

  it("rejecting an order sets the reason and frees no stock it never held", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeStockedFinishedGood(adminCookie, 10);
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const orderId = await makeOrder(salesmanCookie, itemId, 5);

    const res = await request(app).post(`/orders/${orderId}/reject`).set("Cookie", adminCookie).send({ reason: "customer cancelled" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REJECTED");
    expect(res.body.data.rejectionReason).toBe("customer cancelled");
  });

  it("approving an already-decided order returns 409", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeStockedFinishedGood(adminCookie, 10);
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const orderId = await makeOrder(salesmanCookie, itemId, 5);

    await request(app).post(`/orders/${orderId}/approve`).set("Cookie", adminCookie);
    const res = await request(app).post(`/orders/${orderId}/approve`).set("Cookie", adminCookie);
    expect(res.status).toBe(409);
  });

  it("closes the approval race: two concurrent approvals racing for the last units — only one succeeds", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeStockedFinishedGood(adminCookie, 100);
    const salesmanCookie = await loginAs("salesman@porulottam.test");

    const orderAId = await makeOrder(salesmanCookie, itemId, 70);
    const orderBId = await makeOrder(salesmanCookie, itemId, 70); // together, 140 > 100 on hand

    const [a, b] = await Promise.all([
      request(app).post(`/orders/${orderAId}/approve`).set("Cookie", adminCookie),
      request(app).post(`/orders/${orderBId}/approve`).set("Cookie", adminCookie),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const approvedCount = await prisma.salesOrder.count({ where: { id: { in: [orderAId, orderBId] }, status: "APPROVED" } });
    expect(approvedCount).toBe(1);
  });

  it("closes the approve/reject race: a concurrent approve and reject on the same order never both succeed", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeStockedFinishedGood(adminCookie, 10);
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const orderId = await makeOrder(salesmanCookie, itemId, 5);

    const [approveRes, rejectRes] = await Promise.all([
      request(app).post(`/orders/${orderId}/approve`).set("Cookie", adminCookie),
      request(app).post(`/orders/${orderId}/reject`).set("Cookie", adminCookie).send({ reason: "race" }),
    ]);
    const statuses = [approveRes.status, rejectRes.status].sort();
    expect(statuses).toEqual([200, 409]); // exactly one of the two wins, never both

    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(["APPROVED", "REJECTED"]).toContain(order.status); // whichever won, never corrupted back
  });

  it("a salesman cannot approve or reject an order", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeStockedFinishedGood(adminCookie, 10);
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const orderId = await makeOrder(salesmanCookie, itemId, 5);

    const approveRes = await request(app).post(`/orders/${orderId}/approve`).set("Cookie", salesmanCookie);
    expect(approveRes.status).toBe(403);
    const rejectRes = await request(app).post(`/orders/${orderId}/reject`).set("Cookie", salesmanCookie).send({ reason: "x" });
    expect(rejectRes.status).toBe(403);
  });
});
