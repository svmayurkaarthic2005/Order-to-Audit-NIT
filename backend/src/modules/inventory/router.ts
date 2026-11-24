import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { getOnHand, postOpeningStock } from "./service.js";
import { openingStockSchema } from "./schema.js";
import { syncAlertsForItems } from "../alerts/service.js";

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

// Cost (movingAverageCostPaise) is supplier/business-sensitive — visible to
// everyone who can see purchases or production, never to the salesman, who
// only needs the qty/unit to understand stock availability.
const COST_VISIBLE_ROLES = ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"];

inventoryRouter.get("/:itemId/on-hand", async (req, res) => {
  const result = await getOnHand(req.params.itemId as string);
  if (!req.user || !COST_VISIBLE_ROLES.includes(req.user.role)) {
    const { movingAverageCostPaise: _omit, ...rest } = result;
    res.json({ data: rest });
    return;
  }
  res.json({ data: result });
});

inventoryRouter.post(
  "/opening-stock",
  requireRole("ADMIN", "OWNER"),
  validate("body", openingStockSchema),
  async (req, res) => {
    const movement = await postOpeningStock(req.body);
    await syncAlertsForItems([movement.itemId]);
    res.status(201).json({ data: movement });
  },
);
