import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

// The benchmark-specific report checks (sales register, GST summary, stock
// ledger, production report) live in benchmark.test.ts, which replays the
// benchmark on a fresh database; these only need whatever data exists.
describe("reports", () => {
  it("purchase register lists real purchases, each with a non-negative total", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const res = await request(app).get("/reports/purchase-register").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const row of res.body.data) {
      expect(row.totalPaise).toBeGreaterThanOrEqual(0);
    }
  });

  it("stock summary's Murukku on-hand matches the inventory endpoint exactly", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const murukku = await prisma.item.findUniqueOrThrow({ where: { sku: "FG-MURUKKU-200G" } });

    const reportRes = await request(app).get("/reports/stock-summary?type=FINISHED_GOOD").set("Cookie", cookie);
    const invRes = await request(app).get(`/inventory/${murukku.id}/on-hand`).set("Cookie", cookie);

    const row = reportRes.body.data.find((r: { itemId: string }) => r.itemId === murukku.id);
    expect(row.qtyBase).toBe(invRes.body.data.qtyBase); // never disagrees with Phase 5's own endpoint
  });

  it("payments & collections' Retailer A outstanding matches a live recomputation from invoices/payments/credit notes", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });

    // Independently recomputed from the ledger, the same way the service
    // does it — robust to other test files' invoices against this same
    // real customer, which the report must legitimately include too. Each
    // side (the recomputation, the report call) is its own read against a
    // live, shared customer, so a concurrent test file's invoice/payment
    // can land between them; re-sample both together until they agree
    // rather than compare two reads taken at different instants.
    let row: { outstandingPaise: number; "0-30": number; "31-60": number; "61-90": number; "90+": number } | undefined;
    let expectedOutstanding = -1;
    for (let attempt = 0; attempt < 5; attempt++) {
      const invoices = await prisma.invoice.findMany({
        where: { customerId: retailerA.id, status: "ISSUED" },
        include: { payments: true, creditNotes: true },
      });
      expectedOutstanding = invoices.reduce((sum, inv) => {
        const paid = inv.payments.reduce((s, p) => s + p.amountPaise, 0);
        const credited = inv.creditNotes.reduce((s, c) => s + c.amountPaise, 0);
        return sum + Math.max(0, inv.totalPaise - paid - credited);
      }, 0);

      const res = await request(app).get("/reports/payments-collections").set("Cookie", cookie);
      expect(res.status).toBe(200);
      row = res.body.data.find((c: { customerId: string }) => c.customerId === retailerA.id);
      if ((row?.outstandingPaise ?? 0) === expectedOutstanding) break;
    }

    // A customer who owes nothing isn't listed (a fresh CI database). The
    // benchmark replay checks the real ₹3,875 on its own database.
    if (expectedOutstanding === 0) {
      expect(row).toBeUndefined();
      return;
    }
    expect(row!.outstandingPaise).toBe(expectedOutstanding);
    expect(row!["0-30"] + row!["31-60"] + row!["61-90"] + row!["90+"]).toBe(row!.outstandingPaise);
  });

  it("a date range that excludes everything returns an empty-but-valid response, not an error", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const res = await request(app).get("/reports/sales-register?from=2000-01-01&to=2000-01-02").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.customerWise).toEqual([]);
    expect(res.body.data.productWise).toEqual([]);
  });

  it("every section 4.6 report exports to CSV and PDF, with amounts in rupees", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const reports = ["sales-register", "gst-summary", "purchase-register", "stock-summary", "production", "payments-collections"];
    for (const report of reports) {
      const csvRes = await request(app).get(`/reports/${report}?format=csv`).set("Cookie", cookie);
      expect(csvRes.status, report).toBe(200);
      expect(csvRes.headers["content-type"]).toContain("text/csv");
      // Columns are in rupees, never raw paise or internal ids.
      const header = csvRes.text.split("\n")[0] ?? "";
      expect(header, report).not.toMatch(/Paise|Id\b/);

      const pdfRes = await request(app).get(`/reports/${report}?format=pdf`).set("Cookie", cookie);
      expect(pdfRes.status, report).toBe(200);
      expect(pdfRes.headers["content-type"]).toContain("application/pdf");
    }
    // The stock ledger needs an item.
    const item = await prisma.item.findFirstOrThrow({ where: { sku: "RM-FLOUR" } });
    const ledgerRes = await request(app).get(`/reports/stock-ledger?itemId=${item.id}&format=csv`).set("Cookie", cookie);
    expect(ledgerRes.headers["content-type"]).toContain("text/csv");
  });

  it("a salesman/production role cannot read any report; an accountant can", async () => {
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const res = await request(app).get("/reports/sales-register").set("Cookie", salesmanCookie);
    expect(res.status).toBe(403);

    const accountantCookie = await loginAs("accountant@porulottam.test");
    const accRes = await request(app).get("/reports/sales-register").set("Cookie", accountantCookie);
    expect(accRes.status).toBe(200);
  });
});

describe("audit log", () => {
  it("records who approved an order, readable by admin/owner/accountant", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const res = await request(app).get("/audit-log").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    const actions = res.body.data.map((e: { action: string }) => e.action);
    expect(actions).toContain("APPROVE"); // from the order approvals already recorded in this run
  });

  it("no update or delete route exists for audit log entries", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const anyEntry = await prisma.auditLog.findFirstOrThrow();
    const patchRes = await request(app).patch(`/audit-log/${anyEntry.id}`).set("Cookie", adminCookie).send({ action: "x" });
    expect(patchRes.status).toBe(404);
    const deleteRes = await request(app).delete(`/audit-log/${anyEntry.id}`).set("Cookie", adminCookie);
    expect(deleteRes.status).toBe(404);
  });

  it("a salesman cannot read the audit log", async () => {
    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const res = await request(app).get("/audit-log").set("Cookie", salesmanCookie);
    expect(res.status).toBe(403);
  });
});
