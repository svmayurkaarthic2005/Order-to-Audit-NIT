import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { toCsv, toPdf } from "../../lib/export.js";
import {
  gstSummary,
  paymentsCollections,
  productionReport,
  purchaseRegister,
  salesRegister,
  stockLedger,
  stockSummary,
} from "./service.js";
import { reportQuerySchema, stockLedgerQuerySchema, stockSummaryQuerySchema } from "./schema.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth, requireRole("ADMIN", "OWNER", "ACCOUNTANT"));

type Query = { from?: Date; to?: Date; format: "json" | "csv" | "pdf" };

// Sends `rows` (the report's primary flat table) as CSV/PDF when asked,
// otherwise sends the full (possibly nested) JSON payload.
async function respond(res: import("express").Response, title: string, format: Query["format"], json: unknown, rows: Record<string, unknown>[]) {
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
  await respond(res, "sales-register", format, data, data.customerWise);
});

reportsRouter.get("/gst-summary", validate("query", reportQuerySchema), async (req, res) => {
  const { from, to, format } = req.validatedQuery as Query;
  const data = await gstSummary(from, to);
  await respond(res, "gst-summary", format, data, data.byRate);
});

reportsRouter.get("/purchase-register", validate("query", reportQuerySchema), async (req, res) => {
  const { from, to, format } = req.validatedQuery as Query;
  const data = await purchaseRegister(from, to);
  await respond(res, "purchase-register", format, data, data);
});

reportsRouter.get("/stock-summary", validate("query", stockSummaryQuerySchema), async (req, res) => {
  const { type } = req.validatedQuery as { type?: string };
  const data = await stockSummary(type);
  res.json({ data });
});

reportsRouter.get("/stock-ledger", validate("query", stockLedgerQuerySchema), async (req, res) => {
  const { itemId, from, to, format } = req.validatedQuery as Query & { itemId: string };
  const data = await stockLedger(itemId, from, to);
  await respond(res, "stock-ledger", format, data, data);
});

reportsRouter.get("/production", validate("query", reportQuerySchema), async (req, res) => {
  const { from, to, format } = req.validatedQuery as Query;
  const data = await productionReport(from, to);
  await respond(res, "production", format, data, data);
});

reportsRouter.get("/payments-collections", async (_req, res) => {
  const data = await paymentsCollections();
  res.json({ data });
});
