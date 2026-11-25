import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import {
  createCreditNote,
  createInvoice,
  getInvoice,
  getInvoiceShareLink,
  getOrGenerateInvoicePdfUrl,
  listInvoices,
  renderSharedInvoicePdf,
  sendInvoiceEmail,
} from "./service.js";
import { creditNoteCreateSchema, invoiceCreateSchema, invoiceSendEmailSchema } from "./schema.js";
import { getOutstandingPaise } from "../payments/service.js";

export const invoicesRouter = Router();

invoicesRouter.use(requireAuth);

const canManageInvoices = requireRole("ADMIN", "OWNER");
const canReadInvoices = requireRole("ADMIN", "OWNER", "ACCOUNTANT");

invoicesRouter.get("/", canReadInvoices, async (_req, res) => {
  const invoices = await listInvoices();
  res.json({ data: invoices });
});

invoicesRouter.get("/:id", canReadInvoices, async (req, res) => {
  const invoice = await getInvoice(req.params.id as string);
  res.json({ data: invoice });
});

invoicesRouter.get("/:id/pdf", canReadInvoices, async (req, res) => {
  const url = await getOrGenerateInvoicePdfUrl(req.params.id as string);
  res.json({ data: { url } });
});

// Sharing goes outside the business, so it's an Admin/Owner action like email.
invoicesRouter.get("/:id/share-link", canManageInvoices, async (req, res) => {
  const baseUrl = process.env.PUBLIC_API_URL ?? `${req.protocol}://${req.get("host")}`;
  res.json({ data: await getInvoiceShareLink(req.params.id as string, baseUrl) });
});

invoicesRouter.get("/:id/outstanding", canReadInvoices, async (req, res) => {
  const outstandingPaise = await getOutstandingPaise(req.params.id as string);
  res.json({ data: { outstandingPaise } });
});

invoicesRouter.post(
  "/:id/send-email",
  canManageInvoices,
  validate("body", invoiceSendEmailSchema),
  async (req, res) => {
    await sendInvoiceEmail(req.params.id as string, req.user!.id, req.body.email);
    res.json({ data: { sent: true } });
  },
);

invoicesRouter.post("/", canManageInvoices, validate("body", invoiceCreateSchema), async (req, res) => {
  const invoice = await createInvoice(req.body.orderId, req.user!.id);
  res.status(201).json({ data: invoice });
});

invoicesRouter.post(
  "/:id/credit-note",
  canManageInvoices,
  validate("body", creditNoteCreateSchema),
  async (req, res) => {
    const invoice = await createCreditNote(req.params.id as string, req.body.reason, req.user!.id);
    res.status(201).json({ data: invoice });
  },
);

// Public, no login: the customer opens this from WhatsApp. Access is the
// signed, expiring token in the query string (see share.ts).
export const invoiceShareRouter = Router();

invoiceShareRouter.get("/:id", async (req, res) => {
  const result = await renderSharedInvoicePdf(req.params.id as string, Number(req.query.e), String(req.query.s ?? ""));
  if (!result) {
    res.status(404).type("text/plain").send("This invoice link is invalid or has expired. Please ask for a new one.");
    return;
  }
  const { invoice, pdf } = result;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="invoice-${invoice.financialYear}-${invoice.invoiceNumber}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.send(pdf);
});
