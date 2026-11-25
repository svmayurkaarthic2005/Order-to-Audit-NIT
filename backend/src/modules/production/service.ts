import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { logAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { computeOutputCostPaise } from "./costing.js";
import { syncAlertsForItems } from "../alerts/service.js";
import { notify } from "../notifications/service.js";
import {
  issueFromRawBatches,
  recordProductionOutput,
  refreshBatchStatuses,
  selectRawBatchesFEFO,
} from "../batches/service.js";

type TxClient = Prisma.TransactionClient;

async function movingAverageCostPaise(tx: TxClient, itemId: string): Promise<number> {
  const agg = await tx.stockMovement.aggregate({
    where: { itemId },
    _sum: { qtyBase: true, totalCostPaise: true },
  });
  const qty = agg._sum.qtyBase ?? 0;
  const cost = agg._sum.totalCostPaise ?? 0;
  return qty > 0 ? Math.round(cost / qty) : 0;
}

function includeClause() {
  return {
    bomHeader: { include: { finishedItem: true, lines: { include: { rawItem: true } } } },
    materials: { include: { item: true } },
  } as const;
}

export async function getProductionRun(id: string) {
  const run = await prisma.productionRun.findUnique({ where: { id }, include: includeClause() });
  if (!run) {
    throw new AppError(404, "not_found", "Production run not found");
  }
  if (run.status !== "COMPLETED") {
    return { ...run, outputUnitCostPaise: null };
  }
  const output = await prisma.stockMovement.findFirst({ where: { sourceId: id, source: "PRODUCTION_OUTPUT" } });
  return { ...run, outputUnitCostPaise: output?.unitCostPaise ?? null };
}

export async function listProductionRuns() {
  return prisma.productionRun.findMany({ include: includeClause(), orderBy: { createdAt: "desc" } });
}

export async function createProductionRun(data: { bomHeaderId: string; batchSize: number }) {
  const bom = await prisma.bomHeader.findUnique({ where: { id: data.bomHeaderId } });
  if (!bom || !bom.active) {
    throw new AppError(404, "not_found", "BOM not found");
  }
  return prisma.productionRun.create({
    data: { bomHeaderId: data.bomHeaderId, batchSize: data.batchSize },
    include: includeClause(),
  });
}

// Raw materials are physically issued to the floor here, not held back to
// completion — this is where the factory's real stock actually moves.
export async function startProductionRun(
  id: string,
  actualConsumption: { itemId: string; qtyBase: number; overrideReason?: string }[],
  actingUserId: string,
) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.productionRun.findUnique({ where: { id }, include: { bomHeader: { include: { lines: { include: { rawItem: true } } } } } });
    if (!run) {
      throw new AppError(404, "not_found", "Production run not found");
    }

    // Claim the DRAFT -> STARTED transition atomically before posting any
    // movement: two concurrent /start calls (or a /start racing a /cancel)
    // could otherwise both read status "DRAFT" before either writes, and
    // both post a PRODUCTION_ISSUE row — double-issuing raw material, or a
    // /start overwriting a /cancel that landed in between. Only the request
    // whose UPDATE actually flips the row may proceed.
    const { count } = await tx.productionRun.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "STARTED", startedAt: new Date() },
    });
    if (count === 0) {
      throw new AppError(409, "invalid_status", "Only a DRAFT run can be started");
    }
    await logAudit(tx, {
      userId: actingUserId,
      action: "PRODUCTION_RUN_STARTED",
      entityType: "ProductionRun",
      entityId: id,
      before: { status: "DRAFT" },
      after: { status: "STARTED", actualConsumption },
    });

    // Snapshot every BOM line's planned quantity now — the only place
    // planned/expected quantities are ever recorded (never in stock_movements).
    for (const line of run.bomHeader.lines) {
      await tx.productionRunMaterial.create({
        data: {
          productionRunId: id,
          itemId: line.rawItemId,
          plannedQtyBase: line.qtyPerBatch * run.batchSize,
        },
      });
    }

    const rawMaterialLineIds = new Set(
      run.bomHeader.lines.filter((l) => l.rawItem.type === "RAW_MATERIAL").map((l) => l.rawItemId),
    );

    for (const consumed of actualConsumption) {
      if (!rawMaterialLineIds.has(consumed.itemId)) {
        throw new AppError(400, "invalid_item", `Item ${consumed.itemId} is not a raw-material line on this BOM`);
      }
      const unitCostPaise = await movingAverageCostPaise(tx, consumed.itemId);

      // FEFO selection — select eligible batches in expiry order
      const selections = await selectRawBatchesFEFO(consumed.itemId, consumed.qtyBase);
      await issueFromRawBatches(
        tx,
        selections,
        consumed.itemId,
        id,
        consumed.qtyBase,
        unitCostPaise,
        null,
        consumed.overrideReason,
      );

      await tx.productionRunMaterial.updateMany({
        where: { productionRunId: id, itemId: consumed.itemId },
        data: { actualQtyBase: consumed.qtyBase },
      });
    }

    return tx.productionRun.findUniqueOrThrow({ where: { id }, include: includeClause() });
  }).then(async (result) => {
    await syncAlertsForItems(actualConsumption.map((c) => c.itemId));
    return result;
  });
}

// Posts finished-goods output and packaging actually consumed/damaged.
// Idempotent on the caller-supplied key: a replay with the same key is a
// no-op that just returns the run as it already stands.
export async function completeProductionRun(
  id: string,
  idempotencyKey: string,
  data: {
    actualOutputQty: number;
    packagingConsumed: { itemId: string; qtyBase: number; damagedQty: number }[];
    expiryDate?: Date;
    laborCostPaise?: number;
    overheadCostPaise?: number;
    packSizeId?: string;
  },
  actingUserId: string,
) {
  const alreadyApplied = await prisma.stockMovement.findUnique({ where: { idempotencyKey } });
  if (alreadyApplied) {
    return getProductionRun(id);
  }

  try {
    return await completeProductionRunInTransaction(id, idempotencyKey, data, actingUserId);
  } catch (err) {
    // The pre-check above is a friendly fast path; the database's unique
    // constraint on idempotencyKey is what actually prevents a replayed
    // request from posting its rows twice under concurrency.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return getProductionRun(id);
    }
    throw err;
  }
}

async function completeProductionRunInTransaction(
  id: string,
  idempotencyKey: string,
  data: {
    actualOutputQty: number;
    packagingConsumed: { itemId: string; qtyBase: number; damagedQty: number }[];
    expiryDate?: Date;
    laborCostPaise?: number;
    overheadCostPaise?: number;
    packSizeId?: string;
  },
  actingUserId: string,
) {
  // Which item actually receives the output/stock movement — the BOM's own
  // finished item, unless this run packed one of its registered PackSize
  // variants instead (same shared raw-material recipe, a different
  // product-specific packaging configuration and output SKU).
  let outputItemId = "";
  return prisma.$transaction(async (tx) => {
    const run = await tx.productionRun.findUnique({ where: { id }, include: { bomHeader: { include: { lines: { include: { rawItem: true } } } } } });
    if (!run) {
      throw new AppError(404, "not_found", "Production run not found");
    }

    outputItemId = run.bomHeader.finishedItemId;
    if (data.packSizeId) {
      const packSize = await tx.packSize.findUnique({ where: { id: data.packSizeId } });
      if (!packSize || packSize.baseBomId !== run.bomHeaderId) {
        throw new AppError(400, "invalid_pack_size", "packSizeId does not belong to this run's BOM");
      }
      outputItemId = packSize.finishedItemId;
    }

    // Same atomic-claim pattern as start: compute totalDamaged from the
    // request body (no DB read needed) so the transition can be claimed
    // before any movement is posted, closing the same double-posting race.
    const totalDamagedQty = data.packagingConsumed.reduce((sum, l) => sum + l.damagedQty, 0);
    const { count } = await tx.productionRun.updateMany({
      where: { id, status: "STARTED" },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        actualOutputQty: data.actualOutputQty,
        damagedQty: totalDamagedQty,
        laborCostPaise: data.laborCostPaise ?? null,
        overheadCostPaise: data.overheadCostPaise ?? null,
      },
    });
    if (count === 0) {
      throw new AppError(409, "invalid_status", "Only a STARTED run can be completed");
    }
    await logAudit(tx, {
      userId: actingUserId,
      action: "PRODUCTION_RUN_COMPLETED",
      entityType: "ProductionRun",
      entityId: id,
      before: { status: "STARTED" },
      after: { status: "COMPLETED", actualOutputQty: data.actualOutputQty, damagedQty: totalDamagedQty, outputItemId },
    });

    const packagingLineIds = new Set(
      run.bomHeader.lines.filter((l) => l.rawItem.type === "PACKAGING").map((l) => l.rawItemId),
    );

    for (const line of data.packagingConsumed) {
      if (!packagingLineIds.has(line.itemId)) {
        throw new AppError(400, "invalid_item", `Item ${line.itemId} is not a packaging line on this BOM`);
      }
      const unitCostPaise = await movingAverageCostPaise(tx, line.itemId);

      if (line.qtyBase > 0) {
        await tx.stockMovement.create({
          data: {
            itemId: line.itemId,
            qtyBase: -line.qtyBase,
            unitCostPaise,
            totalCostPaise: -(line.qtyBase * unitCostPaise),
            source: "PRODUCTION_PACKAGING",
            sourceId: id,
          },
        });
      }
      if (line.damagedQty > 0) {
        await tx.stockMovement.create({
          data: {
            itemId: line.itemId,
            qtyBase: -line.damagedQty,
            unitCostPaise,
            totalCostPaise: -(line.damagedQty * unitCostPaise),
            source: "PRODUCTION_DAMAGE",
            sourceId: id,
          },
        });
      }
      await tx.productionRunMaterial.updateMany({
        where: { productionRunId: id, itemId: line.itemId },
        data: { actualQtyBase: line.qtyBase + line.damagedQty },
      });
    }

    // Moving-weighted-average costing: the exact total (material cost this
    // run actually incurred + fixed overhead) is what the ledger's SUM()
    // needs to stay correct; unitCostPaise is that total spread over actual
    // output, rounded only for display.
    const totalCostPaise = await computeOutputCostPaise(
      tx,
      id,
      run.batchSize,
      data.overheadCostPaise,
      data.laborCostPaise,
    );
    const unitCostPaise = Math.round(totalCostPaise / data.actualOutputQty);

    // Create the finished-goods batch row for FEFO dispatch tracking
    const fgBatch = await recordProductionOutput(tx, id, outputItemId, data.actualOutputQty, data.expiryDate);

    // The idempotency guard: the finished-goods output row carries the
    // caller's key, so a replay is caught before any row is posted twice.
    await tx.stockMovement.create({
      data: {
        itemId: outputItemId,
        qtyBase: data.actualOutputQty,
        unitCostPaise,
        totalCostPaise,
        source: "PRODUCTION_OUTPUT",
        sourceId: id,
        idempotencyKey,
        finishedGoodsBatchId: fgBatch.id,
      },
    });

    return tx.productionRun.findUniqueOrThrow({ where: { id }, include: includeClause() });
  }).then(async (result) => {
    await syncAlertsForItems([...data.packagingConsumed.map((l) => l.itemId), outputItemId]);
    await refreshBatchStatuses();

    // Notify on significant yield variance (>3% tolerance)
    const expected = result.bomHeader.expectedYieldQty * result.batchSize;
    const actual = data.actualOutputQty;
    if (expected > 0) {
      const pctDiff = (actual - expected) / expected; // signed fraction
      if (Math.abs(pctDiff) > 0.03) {
        const pctDisplay = (pctDiff * 100).toFixed(1);
        await notify({
          recipientRoles: ["OWNER", "PRODUCTION"],
          type: "PRODUCTION_VARIANCE",
          title: `${result.bomHeader.finishedItem.name}: ${actual < expected ? "fewer" : "more"} packets than planned`,
          message: `Expected ${expected} packets, got ${actual} (${pctDiff > 0 ? "+" : ""}${pctDisplay}%). More than 3% off, so it's worth checking what happened.`,
          severity: Math.abs(pctDiff) > 0.1 ? "CRITICAL" : "WARNING",
          sourceType: "ProductionRun",
          sourceId: result.id,
        });
      }
    }

    return result;
  });
}

// Reverses whatever raw material was actually issued at STARTED — there is
// always something to reverse now, since STARTED (not COMPLETED) is where
// physical issuance happens. Never a delete.
export async function cancelProductionRun(id: string, actingUserId: string) {
  let reversedItemIds: string[] = [];
  return prisma.$transaction(async (tx) => {
    const run = await tx.productionRun.findUnique({ where: { id } });
    if (!run) {
      throw new AppError(404, "not_found", "Production run not found");
    }

    const { count } = await tx.productionRun.updateMany({
      where: { id, status: { in: ["DRAFT", "STARTED"] } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (count === 0) {
      throw new AppError(409, "invalid_status", "Only a DRAFT or STARTED run can be cancelled");
    }
    await logAudit(tx, {
      userId: actingUserId,
      action: "PRODUCTION_RUN_CANCELLED",
      entityType: "ProductionRun",
      entityId: id,
      before: { status: run.status },
      after: { status: "CANCELLED" },
    });

    const issued = await tx.stockMovement.findMany({ where: { sourceId: id, source: "PRODUCTION_ISSUE" } });
    reversedItemIds = issued.map((m) => m.itemId);
    for (const movement of issued) {
      await tx.stockMovement.create({
        data: {
          itemId: movement.itemId,
          qtyBase: -movement.qtyBase,
          unitCostPaise: movement.unitCostPaise,
          totalCostPaise: -movement.totalCostPaise,
          source: "PRODUCTION_ISSUE_REVERSAL",
          sourceId: id,
        },
      });
    }

    return tx.productionRun.findUniqueOrThrow({ where: { id }, include: includeClause() });
  }).then(async (result) => {
    await syncAlertsForItems(reversedItemIds);
    return result;
  });
}
