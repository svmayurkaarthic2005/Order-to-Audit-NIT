import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { createDispatch, listDispatches } from "./service.js";
import { dispatchCreateSchema } from "./schema.js";

export const dispatchRouter = Router();

dispatchRouter.use(requireAuth);

const canManageDispatch = requireRole("ADMIN", "OWNER");
const canReadDispatch = requireRole("ADMIN", "OWNER", "ACCOUNTANT");

dispatchRouter.get("/", canReadDispatch, async (_req, res) => {
  const dispatches = await listDispatches();
  res.json({ data: dispatches });
});

dispatchRouter.post("/", canManageDispatch, validate("body", dispatchCreateSchema), async (req, res) => {
  const dispatch = await createDispatch(req.body.invoiceId, req.body.qty);
  res.status(201).json({ data: dispatch });
});
