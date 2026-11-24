import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { createItem, deactivateItem, getItem, listItems, updateItem } from "./service.js";
import { itemCreateSchema, itemListQuerySchema, itemUpdateSchema } from "./schema.js";

export const itemsRouter = Router();

itemsRouter.use(requireAuth);

itemsRouter.get("/", validate("query", itemListQuerySchema), async (req, res) => {
  const { search, type, page } = req.validatedQuery as { search?: string; type?: string; page: number };
  const result = await listItems(search, type, page);
  res.json({ data: result });
});

itemsRouter.get("/:id", async (req, res) => {
  const item = await getItem((req.params.id as string));
  res.json({ data: item });
});

itemsRouter.post(
  "/",
  requireRole("ADMIN", "OWNER"),
  validate("body", itemCreateSchema),
  async (req, res) => {
    const item = await createItem(req.body);
    res.status(201).json({ data: item });
  },
);

itemsRouter.patch(
  "/:id",
  requireRole("ADMIN", "OWNER"),
  validate("body", itemUpdateSchema),
  async (req, res) => {
    const item = await updateItem((req.params.id as string), req.body);
    res.json({ data: item });
  },
);

itemsRouter.delete("/:id", requireRole("ADMIN", "OWNER"), async (req, res) => {
  await deactivateItem((req.params.id as string));
  res.json({ data: { ok: true } });
});
