import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { createBom, createPackSize, editBom, getBom, listBomVersions, listBoms, updatePackSize } from "./service.js";
import { bomCreateSchema, bomEditSchema, packSizeCreateSchema, packSizeUpdateSchema } from "./schema.js";

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

bomRouter.get("/:id/versions", canReadBoms, async (req, res) => {
  res.json({ data: await listBomVersions(req.params.id as string) });
});

bomRouter.post("/", canManageBoms, validate("body", bomCreateSchema), async (req, res) => {
  const bom = await createBom(req.body, req.user!.id);
  res.status(201).json({ data: bom });
});

// Saves a new version; the old one is retired, never changed or deleted.
bomRouter.put("/:id", canManageBoms, validate("body", bomEditSchema), async (req, res) => {
  const bom = await editBom(req.params.id as string, req.body, req.user!.id);
  res.status(201).json({ data: bom });
});

packSizesRouter.post("/", canManageBoms, validate("body", packSizeCreateSchema), async (req, res) => {
  const packSize = await createPackSize(req.body);
  res.status(201).json({ data: packSize });
});

packSizesRouter.put("/:id", canManageBoms, validate("body", packSizeUpdateSchema), async (req, res) => {
  const packSize = await updatePackSize(req.params.id as string, req.body);
  res.json({ data: packSize });
});
