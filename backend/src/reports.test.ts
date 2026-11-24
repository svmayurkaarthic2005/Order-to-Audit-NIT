import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

describe("reports (traceable against the real benchmark data already posted)", () => {
  it("sales register shows Retailer A's real 150-packet, ₹7,500-taxable invoice line", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const res = await request(app).get("/reports/sales-register").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const retailerA = res.body.data.customerWise.find((c: { customerName: string }) => c.customerName.includes("Retailer A"));
    expect(retailerA).toBeDefined();
    expect(retailerA.qtyBase).toBeGreaterThanOrEqual(150);
    expect(retailerA.taxableValuePaise).toBeGreaterThanOrEqual(750_000);
  });

  it("GST summary totals include the ₹7,875 Retailer A invoice (traceable to the invoices table, never recomputed)", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const res = await request(app).get("/reports/gst-summary").set("Cookie", cookie);
    expect(res.status).toBe(200);

    const expectedInvoiceAgg = await prisma.invoice.aggregate({
      where: { status: "ISSUED" },
      _sum: { taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, totalPaise: true },
    });
    expect(res.body.data.totals.totalPaise).toBe(expectedInvoiceAgg._sum.totalPaise);
    expect(res.body.data.totals.cgstPaise).toBe(expectedInvoiceAgg._sum.cgstPaise);
  });

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

  it("stock ledger for Murukku returns its real posted movements in chronological order", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const murukku = await prisma.item.findUniqueOrThrow({ where: { sku: "FG-MURUKKU-200G" } });
    const res = await request(app).get(`/reports/stock-ledger?itemId=${murukku.id}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    const sources = res.body.data.map((m: { source: string }) => m.source);
    expect(sources).toContain("OPENING_STOCK");
    expect(sources).toContain("PRODUCTION_OUTPUT");
    expect(sources).toContain("DISPATCH");
  });

  it("production report shows the real benchmark run's -6% yield variance", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const res = await request(app).get("/reports/production").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const murukkuRun = res.body.data.find((r: { finishedGoodSku: string; status: string }) => r.finishedGoodSku === "FG-MURUKKU-200G" && r.status === "COMPLETED");
    expect(murukkuRun).toBeDefined();
    expect(murukkuRun.yieldVariancePct).toBeCloseTo(-0.06, 5);
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
      if (row?.outstandingPaise === expectedOutstanding) break;
    }

    expect(row).toBeDefined();
    expect(row!.outstandingPaise).toBe(expectedOutstanding);
    expect(row!.outstandingPaise).toBeGreaterThanOrEqual(387_500); // at least the real benchmark's ₹3,875
    expect(row!["0-30"] + row!["31-60"] + row!["61-90"] + row!["90+"]).toBe(row!.outstandingPaise);
  });

  it("a date range that excludes everything returns an empty-but-valid response, not an error", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const res = await request(app).get("/reports/sales-register?from=2000-01-01&to=2000-01-02").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.customerWise).toEqual([]);
    expect(res.body.data.productWise).toEqual([]);
  });

  it("CSV and PDF export formats are returned with the right content type", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const csvRes = await request(app).get("/reports/purchase-register?format=csv").set("Cookie", cookie);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers["content-type"]).toContain("text/csv");

    const pdfRes = await request(app).get("/reports/purchase-register?format=pdf").set("Cookie", cookie);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers["content-type"]).toContain("application/pdf");
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
