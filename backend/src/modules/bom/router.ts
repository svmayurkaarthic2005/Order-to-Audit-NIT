import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { createBom, createPackSize, getBom, listBoms } from "./service.js";
import { bomCreateSchema, packSizeCreateSchema } from "./schema.js";

export const bomRouter = Router();
export const packSizesRouter = Router();

bomRouter.use(requireAuth);
packSizesRouter.use(requireAuth);

// Recipes are factory-admin/owner knowledge; production reads them to run a
// batch, and the accountant reads them for costing — never the salesman.
const canManageBoms = requireRole("ADMIN", "OWNER");
const canReadBoms = requireRole("ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT");

bomRouter.get("/", canReadBoms, async (_req, res) => {
  const boms = await listBoms();
  res.json({ data: boms });
});

bomRouter.get("/:id", canReadBoms, async (req, res) => {
  const bom = await getBom(req.params.id as string);
  res.json({ data: bom });
});

bomRouter.post("/", canManageBoms, validate("body", bomCreateSchema), async (req, res) => {
  const bom = await createBom(req.body);
  res.status(201).json({ data: bom });
});

packSizesRouter.post("/", canManageBoms, validate("body", packSizeCreateSchema), async (req, res) => {
  const packSize = await createPackSize(req.body);
  res.status(201).json({ data: packSize });
});
