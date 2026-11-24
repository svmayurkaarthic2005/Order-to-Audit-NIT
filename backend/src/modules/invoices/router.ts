import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { createCreditNote, createInvoice, getInvoice, listInvoices } from "./service.js";
import { creditNoteCreateSchema, invoiceCreateSchema } from "./schema.js";

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

invoicesRouter.post("/", canManageInvoices, validate("body", invoiceCreateSchema), async (req, res) => {
  const invoice = await createInvoice(req.body.orderId);
  res.status(201).json({ data: invoice });
});

invoicesRouter.post(
  "/:id/credit-note",
  canManageInvoices,
  validate("body", creditNoteCreateSchema),
  async (req, res) => {
    const invoice = await createCreditNote(req.params.id as string, req.body.reason);
    res.status(201).json({ data: invoice });
  },
);
