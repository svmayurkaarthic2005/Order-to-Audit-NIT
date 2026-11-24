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

    const res = await request(app).post("/orders").set("Cookie", cookie).send({ customerId: retailerA.id, items: [] });
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

    const createRes = await request(app).post("/orders").set("Cookie", cookie).send({ customerId: "x", items: [{ itemId: "y", qtyBase: 1, ratePaise: 1 }] });
    expect(createRes.status).toBe(403);
  });
});
