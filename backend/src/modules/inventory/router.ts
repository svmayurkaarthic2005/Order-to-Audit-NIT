import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { getOnHand, postOpeningStock } from "./service.js";
import { openingStockSchema } from "./schema.js";

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

inventoryRouter.get("/:itemId/on-hand", async (req, res) => {
  const result = await getOnHand(req.params.itemId as string);
  res.json({ data: result });
});

inventoryRouter.post(
  "/opening-stock",
  requireRole("ADMIN", "OWNER"),
  validate("body", openingStockSchema),
  async (req, res) => {
    const movement = await postOpeningStock(req.body);
    res.status(201).json({ data: movement });
  },
);
