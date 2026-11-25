import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_CUSTOMER_NAME = "Customer Email Visibility Test";

describe("customer email visibility", () => {
  let customerId = "";

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { name: TEST_CUSTOMER_NAME } });
  });

  it("creates a customer with an email on file", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const res = await request(app)
      .post("/customers")
      .set("Cookie", adminCookie)
      .send({ name: TEST_CUSTOMER_NAME, state: "Tamil Nadu", email: "visible-to-admin@example.com" });
    expect(res.status).toBe(201);
    customerId = res.body.data.id as string;
    expect(res.body.data.email).toBe("visible-to-admin@example.com");
  });

  it("ADMIN/OWNER/ACCOUNTANT see the email on both list and detail", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const listRes = await request(app).get("/customers").set("Cookie", adminCookie);
    const inList = listRes.body.data.items.find((c: { id: string }) => c.id === customerId);
    expect(inList.email).toBe("visible-to-admin@example.com");

    const detailRes = await request(app).get(`/customers/${customerId}`).set("Cookie", adminCookie);
    expect(detailRes.body.data.email).toBe("visible-to-admin@example.com");
  });

  it("SALESMAN and PRODUCTION never see the email, on list or detail", async () => {
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const listRes = await request(app).get("/customers").set("Cookie", salesmanCookie);
    const inList = listRes.body.data.items.find((c: { id: string }) => c.id === customerId);
    expect(inList.name).toBe(TEST_CUSTOMER_NAME); // still usable for the order picker
    expect(inList.email).toBeUndefined();

    const detailRes = await request(app).get(`/customers/${customerId}`).set("Cookie", salesmanCookie);
    expect(detailRes.body.data.email).toBeUndefined();

    const productionCookie = await loginAs("production@porulottam.test");
    const prodDetailRes = await request(app).get(`/customers/${customerId}`).set("Cookie", productionCookie);
    expect(prodDetailRes.body.data.email).toBeUndefined();
  });

  it("the customer's email is also redacted everywhere an order embeds it (list, detail, create)", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");

    const sku = `ORD-EMAIL-TEST-${Date.now()}`;
    const itemRes = await request(app)
      .post("/items")
      .set("Cookie", adminCookie)
      .send({ sku, name: "Order Email Redaction Test Item", type: "FINISHED_GOOD", baseUnit: "PIECE", taxRatePct: 5 });
    const itemId = itemRes.body.data.id as string;

    const createRes = await request(app)
      .post("/orders")
      .set("Cookie", salesmanCookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ customerId, items: [{ itemId, qtyBase: 1, ratePaise: 100 }] });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.customer.email).toBeUndefined();
    const orderId = createRes.body.data.id as string;

    const detailRes = await request(app).get(`/orders/${orderId}`).set("Cookie", salesmanCookie);
    expect(detailRes.body.data.customer.email).toBeUndefined();

    const listRes = await request(app).get("/orders").set("Cookie", salesmanCookie);
    const inList = listRes.body.data.items.find((o: { id: string }) => o.id === orderId);
    expect(inList.customer.email).toBeUndefined();

    // ADMIN still sees it on the same order.
    const adminDetailRes = await request(app).get(`/orders/${orderId}`).set("Cookie", adminCookie);
    expect(adminDetailRes.body.data.customer.email).toBe("visible-to-admin@example.com");

    await prisma.orderItem.deleteMany({ where: { salesOrderId: orderId } });
    await prisma.salesOrder.delete({ where: { id: orderId } });
    await prisma.item.update({ where: { id: itemId }, data: { active: false } });
  });
});
