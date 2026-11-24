import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import {
  createSupplier,
  deactivateSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
} from "./service.js";
import { supplierCreateSchema, supplierListQuerySchema, supplierUpdateSchema } from "./schema.js";

export const suppliersRouter = Router();

suppliersRouter.use(requireAuth);

suppliersRouter.get("/", validate("query", supplierListQuerySchema), async (req, res) => {
  const { search, page } = req.validatedQuery as { search?: string; page: number };
  const result = await listSuppliers(search, page);
  res.json({ data: result });
});

suppliersRouter.get("/:id", async (req, res) => {
  const supplier = await getSupplier((req.params.id as string));
  res.json({ data: supplier });
});

suppliersRouter.post(
  "/",
  requireRole("ADMIN", "OWNER"),
  validate("body", supplierCreateSchema),
  async (req, res) => {
    const supplier = await createSupplier(req.body);
    res.status(201).json({ data: supplier });
  },
);

suppliersRouter.patch(
  "/:id",
  requireRole("ADMIN", "OWNER"),
  validate("body", supplierUpdateSchema),
  async (req, res) => {
    const supplier = await updateSupplier((req.params.id as string), req.body);
    res.json({ data: supplier });
  },
);

suppliersRouter.delete("/:id", requireRole("ADMIN", "OWNER"), async (req, res) => {
  await deactivateSupplier((req.params.id as string));
  res.json({ data: { ok: true } });
});
