import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { getStockStatus, listAlerts, setReorderLevel, syncAlertsForItems } from "./service.js";
import { listAlertsQuerySchema, setReorderLevelSchema } from "./schema.js";

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

// Same visibility as inventory on-hand: everyone who needs to know what's
// in stock, never the salesman.
const canReadStock = requireRole("ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT");
const canConfigureThresholds = requireRole("ADMIN", "OWNER");

alertsRouter.get("/", canReadStock, validate("query", listAlertsQuerySchema), async (req, res) => {
  const { status } = req.validatedQuery as { status?: "ACTIVE" | "RESOLVED" };
  res.json({ data: await listAlerts(status) });
});

alertsRouter.get("/stock-status", canReadStock, async (_req, res) => {
  res.json({ data: await getStockStatus() });
});

alertsRouter.patch(
  "/items/:id/reorder-level",
  canConfigureThresholds,
  validate("body", setReorderLevelSchema),
  async (req, res) => {
    const { reorderLevel } = req.body as { reorderLevel: number };
    const item = await setReorderLevel(req.params.id as string, reorderLevel);
    // A newly-configured (or changed) threshold can itself push the item
    // into or out of Low status against its *current* stock — this doesn't
    // wait for the next stock-mutating event.
    await syncAlertsForItems([item.id]);
    res.json({ data: item });
  },
);
