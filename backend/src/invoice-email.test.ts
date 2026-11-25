import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { prisma } from "./lib/prisma.js";

// nodemailer actually dials out to Gmail's SMTP servers — the one real
// external boundary here, so it's the only thing this file mocks. Every
// other layer (auth, RBAC, the invoice PDF, the audit log) runs for real.
const sendMailMock = vi.fn().mockResolvedValue({ messageId: "test" });
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

const { app } = await import("./index.js");

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "EMAIL-TEST-";
const TEST_CUSTOMER_NAME = "Invoice Email Test Customer";

describe("invoice email delivery", () => {
  let customerId = "";
  let invoiceId = "";
  const orderIds: string[] = [];

  afterAll(async () => {
    await prisma.invoiceItem.deleteMany({ where: { invoice: { salesOrderId: { in: orderIds } } } });
    await prisma.invoice.deleteMany({ where: { salesOrderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { salesOrderId: { in: orderIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
    await prisma.customer.deleteMany({ where: { name: TEST_CUSTOMER_NAME } });
  });

  beforeEach(() => {
    sendMailMock.mockClear();
  });

  afterEach(() => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
  });

  it("sets up a customer with an email on file and an issued invoice", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");

    const customer = await prisma.customer.create({
      data: { name: TEST_CUSTOMER_NAME, state: "Tamil Nadu", email: "customer@example.com" },
    });
    customerId = customer.id;

    const sku = `${TEST_SKU_PREFIX}${Date.now()}`;
    const itemRes = await request(app)
      .post("/items")
      .set("Cookie", adminCookie)
      .send({ sku, name: "Email Test Item", type: "FINISHED_GOOD", baseUnit: "PIECE", taxRatePct: 5 });
    const itemId = itemRes.body.data.id as string;

    await request(app)
      .post("/inventory/opening-stock")
      .set("Cookie", adminCookie)
      .send({ itemId, qtyBase: 100, totalCostPaise: 1000 });

    const orderRes = await request(app)
      .post("/orders")
      .set("Cookie", salesmanCookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ customerId, items: [{ itemId, qtyBase: 10, ratePaise: 5_000 }] });
    const orderId = orderRes.body.data.id as string;
    orderIds.push(orderId);

    await request(app).post(`/orders/${orderId}/approve`).set("Cookie", adminCookie);

    const invoiceRes = await request(app).post("/invoices").set("Cookie", adminCookie).send({ orderId });
    expect(invoiceRes.status).toBe(201);
    invoiceId = invoiceRes.body.data.id as string;
  });

  it("returns 503 when SMTP isn't configured", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const res = await request(app).post(`/invoices/${invoiceId}/send-email`).set("Cookie", adminCookie).send({});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("email_not_configured");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends to the customer's email on file, attaches the PDF, and logs an audit entry", async () => {
    process.env.GMAIL_USER = "factory@example.com";
    process.env.GMAIL_APP_PASSWORD = "test-app-password";
    const adminCookie = await loginAs("admin@porulottam.test");

    const res = await request(app).post(`/invoices/${invoiceId}/send-email`).set("Cookie", adminCookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe("customer@example.com");
    expect(call.from).toBe("factory@example.com");
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].content).toBeInstanceOf(Buffer);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Invoice", entityId: invoiceId, action: "EMAIL_SENT" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.parse(audit!.afterJson!)).toEqual({ to: "customer@example.com" });
  });

  it("sends to an explicit override address instead of the one on file", async () => {
    process.env.GMAIL_USER = "factory@example.com";
    process.env.GMAIL_APP_PASSWORD = "test-app-password";
    const adminCookie = await loginAs("admin@porulottam.test");

    const res = await request(app)
      .post(`/invoices/${invoiceId}/send-email`)
      .set("Cookie", adminCookie)
      .send({ email: "override@example.com" });
    expect(res.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0].to).toBe("override@example.com");
  });

  it("400s when the customer has no email on file and none is given", async () => {
    process.env.GMAIL_USER = "factory@example.com";
    process.env.GMAIL_APP_PASSWORD = "test-app-password";
    const adminCookie = await loginAs("admin@porulottam.test");

    await prisma.customer.update({ where: { id: customerId }, data: { email: null } });
    const res = await request(app).post(`/invoices/${invoiceId}/send-email`).set("Cookie", adminCookie).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("missing_email");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("a salesman/production role cannot send invoice emails", async () => {
    const cookie = await loginAs("salesman@porulottam.test");
    const res = await request(app).post(`/invoices/${invoiceId}/send-email`).set("Cookie", cookie).send({});
    expect(res.status).toBe(403);
  });

  it("ACCOUNTANT (read-only) cannot send invoice emails either — this sends real mail and takes a free-form override address", async () => {
    const cookie = await loginAs("accountant@porulottam.test");
    const res = await request(app).post(`/invoices/${invoiceId}/send-email`).set("Cookie", cookie).send({});
    expect(res.status).toBe(403);
  });
});
