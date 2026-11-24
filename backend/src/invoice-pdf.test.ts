import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";
import { LOCAL_STORAGE_DIR } from "./lib/storage.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "INVPDF-TEST-";

async function makeInvoice(adminCookie: string, salesmanCookie: string) {
  const sku = `${TEST_SKU_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const itemRes = await request(app)
    .post("/items")
    .set("Cookie", adminCookie)
    .send({ sku, name: "Invoice PDF Test Item", type: "FINISHED_GOOD", baseUnit: "PIECE", taxRatePct: 5 });
  const itemId = itemRes.body.data.id as string;

  await request(app)
    .post("/inventory/opening-stock")
    .set("Cookie", adminCookie)
    .send({ itemId, qtyBase: 1_000, totalCostPaise: 10_000 });

  const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });
  const orderRes = await request(app)
    .post("/orders")
    .set("Cookie", salesmanCookie)
    .send({ customerId: retailerA.id, items: [{ itemId, qtyBase: 150, ratePaise: 5_000 }] });
  const orderId = orderRes.body.data.id as string;

  await request(app).post(`/orders/${orderId}/approve`).set("Cookie", adminCookie);
  const invoiceRes = await request(app).post("/invoices").set("Cookie", adminCookie).send({ orderId });
  return invoiceRes.body.data.id as string;
}

describe("invoice PDF generation", () => {
  afterAll(async () => {
    const testOrderItems = await prisma.orderItem.findMany({
      where: { item: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { salesOrderId: true },
    });
    const orderIds = [...new Set(testOrderItems.map((o) => o.salesOrderId))];
    const testInvoices = await prisma.invoice.findMany({
      where: { salesOrderId: { in: orderIds } },
      select: { pdfStoragePath: true },
    });
    await Promise.all(
      testInvoices
        .filter((inv) => inv.pdfStoragePath)
        .map((inv) => rm(path.join(LOCAL_STORAGE_DIR, inv.pdfStoragePath!), { force: true })),
    );
    await prisma.invoiceItem.deleteMany({ where: { invoice: { salesOrderId: { in: orderIds } } } });
    await prisma.invoice.deleteMany({ where: { salesOrderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { salesOrderId: { in: orderIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });

  it("generates the benchmark Retailer A invoice's PDF with a rendered total of exactly ₹7,875", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const invoiceId = await makeInvoice(adminCookie, salesmanCookie);

    const res = await request(app).get(`/invoices/${invoiceId}/pdf`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/\.pdf$/);

    const fileName = path.basename(new URL(res.body.data.url).pathname);
    const pdfBuffer = await readFile(path.join(LOCAL_STORAGE_DIR, fileName));
    expect(pdfBuffer.subarray(0, 5).toString()).toBe("%PDF-");

    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: pdfBuffer });
    const parsed = await parser.getText();
    await parser.destroy();
    expect(parsed.text).toContain("7875.00");
  });

  it("requesting the same invoice's PDF twice returns the same URL — only one Storage object is created", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const invoiceId = await makeInvoice(adminCookie, salesmanCookie);

    const first = await request(app).get(`/invoices/${invoiceId}/pdf`).set("Cookie", adminCookie);
    const second = await request(app).get(`/invoices/${invoiceId}/pdf`).set("Cookie", adminCookie);
    expect(first.body.data.url).toBe(second.body.data.url); // same object key → same local URL

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.pdfStoragePath).not.toBeNull();
    expect(first.body.data.url).toContain(invoice.pdfStoragePath);

    const filesForInvoice = await prisma.invoice.count({ where: { id: invoiceId, pdfStoragePath: { not: null } } });
    expect(filesForInvoice).toBe(1); // only one row, one key — no duplicate object was ever created
  });

  it("a salesman cannot fetch an invoice PDF", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const invoiceId = await makeInvoice(adminCookie, salesmanCookie);

    const res = await request(app).get(`/invoices/${invoiceId}/pdf`).set("Cookie", salesmanCookie);
    expect(res.status).toBe(403);
  });

  it("the stored PDF file itself is never reachable without auth or by a disallowed role", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const invoiceId = await makeInvoice(adminCookie, salesmanCookie);
    const pdfRes = await request(app).get(`/invoices/${invoiceId}/pdf`).set("Cookie", adminCookie);
    const fileName = path.basename(new URL(pdfRes.body.data.url).pathname);

    const noAuthRes = await request(app).get(`/storage/invoices/${fileName}`);
    expect(noAuthRes.status).toBe(401);

    const salesmanRes = await request(app).get(`/storage/invoices/${fileName}`).set("Cookie", salesmanCookie);
    expect(salesmanRes.status).toBe(403);

    const adminRes = await request(app).get(`/storage/invoices/${fileName}`).set("Cookie", adminCookie);
    expect(adminRes.status).toBe(200);
  });
});
