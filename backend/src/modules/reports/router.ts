import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { forExport, toCsv, toPdf } from "../../lib/export.js";
import { formatQty } from "../../lib/units.js";
import {
  getCustomerOutstandingDetail,
  getCustomerSalesDetail,
  getGstRateDetail,
  getInvoicePaymentDetail,
  getProductionCostDetail,
  gstSummary,
  paymentsCollections,
  productionReport,
  purchaseRegister,
  salesRegister,
  salesTrend,
  stockLedger,
  stockSummary,
} from "./service.js";
import { reportQuerySchema, salesTrendQuerySchema, stockLedgerQuerySchema, stockSummaryQuerySchema } from "./schema.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth, requireRole("ADMIN", "OWNER", "ACCOUNTANT"));

type Query = { from?: Date; to?: Date; format: "json" | "csv" | "pdf" };

// Sends `rows` (the report's primary flat table) as CSV/PDF when asked,
// otherwise sends the full (possibly nested) JSON payload.
async function respond(res: import("express").Response, title: string, format: Query["format"], json: unknown, rawRows: Record<string, unknown>[]) {
  if (format === "json") {
    res.json({ data: json });
    return;
  }
  const rows = forExport(rawRows);
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${title}.csv"`);
    res.send(toCsv(rows));
    return;
  }
  if (format === "pdf") {
    const buffer = await toPdf(title, rows);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${title}.pdf"`);
    res.send(buffer);
    return;
  }
  res.json({ data: json });
}

reportsRouter.get("/sales-register", validate("query", reportQuerySchema), async (req, res) => {
  const { from, to, format } = req.validatedQuery as Query;
  const data = await salesRegister(from, to);
  // One export holds both views the brief asks for, one after the other.
  await respond(res, "sales-register", format, data, [
    ...data.customerWise.map((c) => ({ view: "By customer", name: c.customerName, quantity: c.qtyBase, taxableValuePaise: c.taxableValuePaise, totalPaise: c.totalPaise })),
    ...data.productWise.map((p) => ({ view: "By product", name: p.description, quantity: p.qtyBase, taxableValuePaise: p.taxableValuePaise, totalPaise: "" })),
  ]);
});

reportsRouter.get("/sales-trend", validate("query", salesTrendQuerySchema), async (req, res) => {
  const { from, to, format, granularity } = req.validatedQuery as Query & { granularity: "monthly" | "yearly" };
  const data = await salesTrend(granularity, from, to);
  await respond(res, `sales-trend-${granularity}`, format, data, data.buckets);
});

reportsRouter.get("/gst-summary", validate("query", reportQuerySchema), async (req, res) => {
  const { from, to, format } = req.validatedQuery as Query;
  const data = await gstSummary(from, to);
  // Invoice-wise rows: what GSTR-1 asks for (B2B per invoice, B2C by
  // place of supply); the CGST/SGST/IGST columns add up to GSTR-3B 3.1(a).
  await respond(res, "gst-summary", format, data, data.invoices);
});

reportsRouter.get("/purchase-register", validate("query", reportQuerySchema), async (req, res) => {
  const { from, to, format } = req.validatedQuery as Query;
  const data = await purchaseRegister(from, to);
  await respond(res, "purchase-register", format, data, data);
});

reportsRouter.get("/stock-summary", validate("query", stockSummaryQuerySchema), async (req, res) => {
  const { type, format } = req.validatedQuery as { type?: string; format: Query["format"] };
  const data = await stockSummary(type);
  await respond(res, "stock-summary", format, data, data.map((s) => ({
    sku: s.sku, name: s.name, type: s.type, onHand: formatQty(s.qtyBase, s.baseUnit), valuePaise: s.valuePaise,
    // Per kg / L / piece, not per gram: flour is Rs 43.13 a kg, not Rs 0.04 a gram.
    averageCostPaise: s.qtyBase > 0 ? Math.round((s.valuePaise / s.qtyBase) * (s.baseUnit === "PIECE" ? 1 : 1000)) : "",
    per: s.baseUnit === "G" ? "kg" : s.baseUnit === "ML" ? "L" : "piece",
  })));
});

reportsRouter.get("/stock-ledger", validate("query", stockLedgerQuerySchema), async (req, res) => {
  const { itemId, from, to, format } = req.validatedQuery as Query & { itemId: string };
  const data = await stockLedger(itemId, from, to);
  await respond(res, "stock-ledger", format, data, data);
});

reportsRouter.get("/production", validate("query", reportQuerySchema), async (req, res) => {
  const { from, to, format } = req.validatedQuery as Query;
  const data = await productionReport(from, to);
  // One row per material per run, with the run's yield and wastage on each.
  await respond(res, "production", format, data, data.flatMap((r) =>
    (r.materials.length > 0 ? r.materials : [null]).map((m) => ({
      run: r.runId.slice(0, 8), product: r.finishedGoodSku, status: r.status, batches: r.batchSize,
      expectedPackets: r.plannedYield, goodPackets: r.actualYield ?? "", yieldVariancePct: r.yieldVariancePct ?? "",
      damagedPackaging: r.damagedQty ?? "", material: m?.sku ?? "", planned: m?.planned ?? "", actual: m?.actual ?? "", usageVariancePct: m?.variancePct ?? "",
    })),
  ));
});

reportsRouter.get("/payments-collections", validate("query", reportQuerySchema), async (req, res) => {
  const { format } = req.validatedQuery as Query;
  const data = await paymentsCollections();
  // Ageing is as of today: outstanding is what's owed now.
  await respond(res, "payments-collections", format, data, data.map((c) => ({
    customer: c.customerName, outstandingPaise: c.outstandingPaise,
    "0-30 daysPaise": c["0-30"], "31-60 daysPaise": c["31-60"], "61-90 daysPaise": c["61-90"], "over 90 daysPaise": c["90+"],
  })));
});

// ── Drill-downs ──────────────────────────────────────────────────────────

reportsRouter.get("/invoices/:invoiceId/detail", async (req, res) => {
  const data = await getInvoicePaymentDetail(req.params.invoiceId as string);
  res.json({ data });
});

reportsRouter.get("/customers/:customerId/outstanding-detail", async (req, res) => {
  const data = await getCustomerOutstandingDetail(req.params.customerId as string);
  res.json({ data });
});

reportsRouter.get("/customers/:customerId/sales-detail", validate("query", reportQuerySchema), async (req, res) => {
  const { from, to } = req.validatedQuery as { from?: Date; to?: Date };
  const data = await getCustomerSalesDetail(req.params.customerId as string, from, to);
  res.json({ data });
});

reportsRouter.get("/gst-summary/:taxRatePct/detail", validate("query", reportQuerySchema), async (req, res) => {
  const { from, to } = req.validatedQuery as { from?: Date; to?: Date };
  const data = await getGstRateDetail(Number(req.params.taxRatePct), from, to);
  res.json({ data });
});

reportsRouter.get("/production/:runId/cost-detail", async (req, res) => {
  const data = await getProductionCostDetail(req.params.runId as string);
  res.json({ data });
});
