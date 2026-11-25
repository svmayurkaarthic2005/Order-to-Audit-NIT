import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { createCreditNote, createInvoice, getInvoice, getOrGenerateInvoicePdfUrl, listInvoices, sendInvoiceEmail } from "./service.js";
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

invoicesRouter.get("/:id/outstanding", canReadInvoices, async (req, res) => {
  const outstandingPaise = await getOutstandingPaise(req.params.id as string);
  res.json({ data: { outstandingPaise } });
});

invoicesRouter.post(
  "/:id/send-email",
  canReadInvoices,
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
