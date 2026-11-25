import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";
import { financialYearFor } from "./modules/invoices/service.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

describe("sales trend — monthly and yearly, reconciled against Sales Register", () => {
  const customerName = "Sales Trend Test Customer";
  let customerId = "";
  const invoiceIds: string[] = [];

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.salesOrder.deleteMany({ where: { customer: { name: customerName } } });
    await prisma.customer.deleteMany({ where: { name: customerName } });
  });

  it("sets up three ISSUED invoices across two calendar months and two financial years", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@porulottam.test" } });
    const customer = await prisma.customer.create({ data: { name: customerName, state: "Tamil Nadu" } });
    customerId = customer.id;

    async function makeInvoice(createdAt: Date, totalPaise: number) {
      const salesOrder = await prisma.salesOrder.create({ data: { customerId, salesmanUserId: admin.id, status: "DISPATCHED" } });
      const invoice = await prisma.invoice.create({
        data: {
          salesOrderId: salesOrder.id,
          customerId,
          financialYear: financialYearFor(createdAt),
          invoiceNumber: Math.floor(Date.now() % 1_000_000) + invoiceIds.length,
          taxableValuePaise: totalPaise,
          totalPaise,
          createdAt,
        },
      });
      invoiceIds.push(invoice.id);
      return invoice;
    }

    // Two invoices in March 2026 (FY 2025-26), one in April 2026 (FY 2026-27)
    // — one month boundary and one financial-year boundary, in the same set.
    await makeInvoice(new Date("2026-03-05T10:00:00Z"), 10_000);
    await makeInvoice(new Date("2026-03-20T10:00:00Z"), 15_000);
    await makeInvoice(new Date("2026-04-10T10:00:00Z"), 20_000);

    expect(invoiceIds).toHaveLength(3);
  });

  it("monthly buckets split March and April correctly, and totals reconcile with Sales Register for the same range", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const from = "2026-03-01", to = "2026-04-30";

    const trendRes = await request(app).get(`/reports/sales-trend?granularity=monthly&from=${from}&to=${to}`).set("Cookie", cookie);
    expect(trendRes.status).toBe(200);
    const buckets = trendRes.body.data.buckets as { key: string; invoiceCount: number; totalPaise: number }[];

    const march = buckets.find((b) => b.key === "2026-03");
    const april = buckets.find((b) => b.key === "2026-04");
    expect(march?.totalPaise).toBeGreaterThanOrEqual(25_000); // our two March invoices, at least
    expect(april?.totalPaise).toBeGreaterThanOrEqual(20_000);

    // Reconciliation: the sum across every bucket in this range must equal
    // the Sales Register's own total for the identical range — both read
    // the exact same frozen Invoice rows, nothing is recomputed.
    const salesRegisterRes = await request(app).get(`/reports/sales-register?from=${from}&to=${to}`).set("Cookie", cookie);
    const registerTotal = salesRegisterRes.body.data.customerWise.reduce((sum: number, c: { totalPaise: number }) => sum + c.totalPaise, 0);
    const trendTotal = buckets.reduce((sum, b) => sum + b.totalPaise, 0);
    expect(trendTotal).toBe(registerTotal);
  });

  it("yearly buckets group by Indian financial year (April–March), not calendar year", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const from = "2026-03-01", to = "2026-04-30";

    const res = await request(app).get(`/reports/sales-trend?granularity=yearly&from=${from}&to=${to}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    const buckets = res.body.data.buckets as { key: string; label: string; totalPaise: number }[];

    const fy2526 = buckets.find((b) => b.key === "2025-26"); // the two March 2026 invoices
    const fy2627 = buckets.find((b) => b.key === "2026-27"); // the one April 2026 invoice
    expect(fy2526).toBeDefined();
    expect(fy2627).toBeDefined();
    expect(fy2526!.totalPaise).toBeGreaterThanOrEqual(25_000);
    expect(fy2627!.totalPaise).toBeGreaterThanOrEqual(20_000);
    expect(fy2526!.label).toBe("FY 2025-26");
  });

  it("a salesman/production role cannot read the sales trend", async () => {
    const cookie = await loginAs("salesman@porulottam.test");
    const res = await request(app).get("/reports/sales-trend").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("CSV export of the trend returns the right content type", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const res = await request(app).get("/reports/sales-trend?granularity=monthly&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });
});
