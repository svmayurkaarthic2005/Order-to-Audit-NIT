import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { cancelPurchase, createPurchase, getPurchase, listPurchases } from "./service.js";
import { purchaseCreateSchema, purchaseListQuerySchema } from "./schema.js";

export const purchasesRouter = Router();

purchasesRouter.use(requireAuth);

// Purchases/receipts are recorded by the factory admin or the production
// supervisor (who physically receives raw materials on the floor), per the
// problem statement's role table — not admin/owner alone.
const canRecordPurchases = requireRole("ADMIN", "OWNER", "PRODUCTION");

purchasesRouter.get("/", validate("query", purchaseListQuerySchema), async (req, res) => {
  const { supplierId, page } = req.validatedQuery as { supplierId?: string; page: number };
  const result = await listPurchases(supplierId, page);
  res.json({ data: result });
});

purchasesRouter.get("/:id", async (req, res) => {
  const purchase = await getPurchase(req.params.id as string);
  res.json({ data: purchase });
});

purchasesRouter.post("/", canRecordPurchases, validate("body", purchaseCreateSchema), async (req, res) => {
  const purchase = await createPurchase(req.body);
  res.status(201).json({ data: purchase });
});

purchasesRouter.post("/:id/cancel", canRecordPurchases, async (req, res) => {
  const purchase = await cancelPurchase(req.params.id as string);
  res.json({ data: purchase });
});
