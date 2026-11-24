import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import {
  cancelProductionRun,
  completeProductionRun,
  createProductionRun,
  getProductionRun,
  listProductionRuns,
  startProductionRun,
} from "./service.js";
import { productionRunCompleteSchema, productionRunCreateSchema, productionRunStartSchema } from "./schema.js";
import { getProductionRunVariance } from "./variance.js";
import { getProductionRunCostBreakdown } from "./costing.js";
import { AppError } from "../../lib/AppError.js";

export const productionRouter = Router();

productionRouter.use(requireAuth);

// Running production is the supervisor's (and admin/owner's) job; the
// accountant reads runs for costing but never starts/completes/cancels one.
const canManageRuns = requireRole("ADMIN", "OWNER", "PRODUCTION");
const canReadRuns = requireRole("ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT");

productionRouter.get("/", canReadRuns, async (_req, res) => {
  const runs = await listProductionRuns();
  res.json({ data: runs });
});

productionRouter.get("/:id", canReadRuns, async (req, res) => {
  const run = await getProductionRun(req.params.id as string);
  res.json({ data: run });
});

productionRouter.get("/:id/variance", canReadRuns, async (req, res) => {
  const variance = await getProductionRunVariance(req.params.id as string);
  res.json({ data: variance });
});

productionRouter.get("/:id/cost-breakdown", canReadRuns, async (req, res) => {
  const breakdown = await getProductionRunCostBreakdown(req.params.id as string);
  // Selling price/margin come from invoice data — PRODUCTION can see the
  // floor-level cost breakdown but not customer pricing or profitability,
  // same boundary /invoices and /reports draw elsewhere.
  if (breakdown && req.user!.role === "PRODUCTION") {
    res.json({ data: { ...breakdown, sellingPricePaise: null, marginPaise: null } });
    return;
  }
  res.json({ data: breakdown });
});

productionRouter.post("/", canManageRuns, validate("body", productionRunCreateSchema), async (req, res) => {
  const run = await createProductionRun(req.body);
  res.status(201).json({ data: run });
});

productionRouter.post(
  "/:id/start",
  canManageRuns,
  validate("body", productionRunStartSchema),
  async (req, res) => {
    const run = await startProductionRun(req.params.id as string, req.body.actualConsumption);
    res.json({ data: run });
  },
);

productionRouter.post(
  "/:id/complete",
  canManageRuns,
  validate("body", productionRunCompleteSchema),
  async (req, res) => {
    const idempotencyKey = req.get("Idempotency-Key");
    if (!idempotencyKey) {
      throw new AppError(400, "missing_idempotency_key", "An Idempotency-Key header is required");
    }
    const run = await completeProductionRun(req.params.id as string, idempotencyKey, req.body);
    res.json({ data: run });
  },
);

productionRouter.post("/:id/cancel", canManageRuns, async (req, res) => {
  const run = await cancelProductionRun(req.params.id as string);
  res.json({ data: run });
});
