import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { createPayment, listPayments } from "./service.js";
import { paymentCreateSchema } from "./schema.js";

export const paymentsRouter = Router();

paymentsRouter.use(requireAuth);

const canManagePayments = requireRole("ADMIN", "OWNER");
const canReadPayments = requireRole("ADMIN", "OWNER", "ACCOUNTANT");

paymentsRouter.get("/", canReadPayments, async (req, res) => {
  const payments = await listPayments(req.query.invoiceId as string | undefined);
  res.json({ data: payments });
});

paymentsRouter.post("/", canManagePayments, validate("body", paymentCreateSchema), async (req, res) => {
  const result = await createPayment(req.body.invoiceId, req.body.amountPaise, req.user!.id);
  res.status(201).json({ data: result });
});
