import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import {
  genealogyBackward,
  genealogyForward,
  listFinishedBatches,
  listRawBatches,
  quarantineBatch,
} from "./service.js";

export const batchesRouter = Router();

// Same visibility as stock itself (alerts/inventory) — never the salesman.
const canReadBatches = requireRole("ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT");

/** GET /batches/raw-material?itemId=&status= */
batchesRouter.get("/raw-material", requireAuth, canReadBatches, async (req, res, next) => {
  try {
    const { itemId, status } = req.query as { itemId?: string; status?: string };
    const data = await listRawBatches(itemId, status);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/** GET /batches/finished-goods?itemId=&status= */
batchesRouter.get("/finished-goods", requireAuth, canReadBatches, async (req, res, next) => {
  try {
    const { itemId, status } = req.query as { itemId?: string; status?: string };
    const data = await listFinishedBatches(itemId, status);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/** GET /batches/raw-material/:id/genealogy */
batchesRouter.get("/raw-material/:id/genealogy", requireAuth, canReadBatches, async (req, res, next) => {
  try {
    const data = await genealogyForward(req.params.id as string);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/** GET /batches/dispatch/:id/genealogy */
batchesRouter.get("/dispatch/:id/genealogy", requireAuth, canReadBatches, async (req, res, next) => {
  try {
    const data = await genealogyBackward(req.params.id as string);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/** PATCH /batches/:id/quarantine  — body: { batchType: "raw"|"finished", reason } */
batchesRouter.patch(
  "/:id/quarantine",
  requireAuth,
  requireRole("ADMIN", "OWNER", "PRODUCTION"),
  async (req, res, next) => {
    try {
      const { batchType, reason } = req.body as { batchType: "raw" | "finished"; reason: string };
      await quarantineBatch(req.params.id as string, batchType, reason, req.user!.id);
      res.json({ data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },
);
