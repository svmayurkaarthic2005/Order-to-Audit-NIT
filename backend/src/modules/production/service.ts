import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { logAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { displayUnitCostPaise, issueValuePaise, ledgerPosition } from "../../lib/valuation.js";
import { computeOutputCostPaise } from "./costing.js";
import { syncAlertsForItems } from "../alerts/service.js";
import { notify } from "../notifications/service.js";
import {
  issueFromRawBatches,
  recordProductionOutput,
  refreshBatchStatuses,
  lockItem,
  selectRawBatchesFEFO,
} from "../batches/service.js";

type TxClient = Prisma.TransactionClient;

// Every BOM line of the given kind must be reported exactly once: a missing
// line would leave real consumption unrecorded (and the variance and cost
// silently wrong), a repeated one would double-issue it.
function requireEachLineOnce(lineItemIds: Set<string>, reportedItemIds: string[], what: string, allRequired = true) {
  const seen = new Set<string>();
  for (const itemId of reportedItemIds) {
    if (!lineItemIds.has(itemId)) {
      throw new AppError(400, "invalid_item", `Item ${itemId} is not a ${what} line on this BOM`);
    }
    if (seen.has(itemId)) {
      throw new AppError(400, "duplicate_line", `Item ${itemId} is listed more than once; report each ${what} once`);
    }
    seen.add(itemId);
  }
  const missing = [...lineItemIds].filter((id) => !seen.has(id));
  if (!allRequired && seen.size === 0 && lineItemIds.size > 0) {
    throw new AppError(400, "missing_line", `Report the ${what} used for this pack size`);
  }
  if (allRequired && missing.length > 0) {
    throw new AppError(400, "missing_line", `Every ${what} on the recipe must be reported; missing ${missing.join(", ")}`);
  }
}

function includeClause() {
  return {
    bomHeader: { include: { finishedItem: true, lines: { include: { rawItem: true } } } },
    packSize: { include: { finishedItem: true, lines: { include: { item: true } } } },
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

export async function createProductionRun(data: { bomHeaderId: string; batchSize: number; packSizeId?: string }) {
  return prisma.$transaction(async (tx) => {
    // Serialize planning against pack-size edits. Either the edit commits
    // first and this run uses the new configuration, or the run commits
    // first and the edit sees that the pack is now in use.
    if (data.packSizeId) {
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PackSize" WHERE "id" = ${data.packSizeId} FOR UPDATE`;
    }

    const bom = await tx.bomHeader.findUnique({ where: { id: data.bomHeaderId } });
    if (!bom) {
      throw new AppError(404, "not_found", "BOM not found");
    }
    // New plans always use the latest version.
    if (!bom.active) {
      throw new AppError(409, "recipe_retired", "This recipe has been changed since. Reload and plan with the latest version.");
    }

    if (data.packSizeId) {
      const packSize = await tx.packSize.findUnique({
        where: { id: data.packSizeId },
        include: { baseBom: true, lines: true },
      });
      if (!packSize || packSize.baseBom.familyId !== bom.familyId) {
        throw new AppError(400, "invalid_pack_size", "packSizeId does not belong to this recipe");
      }
      // Legacy pack sizes are backfilled with a safe placeholder yield but
      // have no trustworthy pack-specific packaging. They must be configured
      // once in Recipes before a production run can select them.
      if (packSize.lines.length === 0) {
        throw new AppError(409, "pack_size_not_configured", "Configure this pack size's expected output and packaging before planning a run");
      }
      if (packSize.baseBomId !== bom.id) {
        throw new AppError(409, "stale_pack_size", "This pack size is attached to a newer recipe version. Reload and plan again.");
      }
    }

    return tx.productionRun.create({
      data: { bomHeaderId: data.bomHeaderId, batchSize: data.batchSize, packSizeId: data.packSizeId ?? null },
      include: includeClause(),
    });
  });
}

// A planned run keeps the recipe version it was planned with. Moving it to
// the latest version is an explicit step, only while it is still planned:
// once started, its materials have left stock at that version's amounts.
export async function useLatestRecipe(id: string, actingUserId: string) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.productionRun.findUnique({ where: { id }, include: { bomHeader: true } });
    if (!run) {
      throw new AppError(404, "not_found", "Production run not found");
    }
    const latest = await tx.bomHeader.findFirst({ where: { familyId: run.bomHeader.familyId, active: true } });
    if (!latest) {
      throw new AppError(409, "recipe_retired", "This recipe has no current version");
    }
    if (latest.id === run.bomHeaderId) {
      throw new AppError(409, "already_latest", "This run already uses the latest recipe");
    }
    const { count } = await tx.productionRun.updateMany({
      where: { id, status: "DRAFT", bomHeaderId: run.bomHeaderId },
      data: { bomHeaderId: latest.id },
    });
    if (count === 0) {
      throw new AppError(409, "invalid_status", "Only a planned run can move to the latest recipe");
    }
    await logAudit(tx, {
      userId: actingUserId,
      action: "PRODUCTION_RUN_RECIPE_UPDATED",
      entityType: "ProductionRun",
      entityId: id,
      before: { recipeVersion: run.bomHeader.version },
      after: { recipeVersion: latest.version },
    });
    return tx.productionRun.findUniqueOrThrow({ where: { id }, include: includeClause() });
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
    const run = await tx.productionRun.findUnique({
      where: { id },
      include: {
        bomHeader: { include: { lines: { include: { rawItem: true } } } },
        packSize: { include: { lines: true } },
      },
    });
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

    // Freeze the material plan for the selected pack format. Raw materials
    // remain shared with the recipe; packaging comes from only the selected
    // PackSize. Legacy runs without a PackSize still use the BOM lines.
    const plannedLines = run.packSize
      ? [
          ...run.bomHeader.lines
            .filter((line) => line.rawItem.type === "RAW_MATERIAL")
            .map((line) => ({ itemId: line.rawItemId, qtyPerBatch: line.qtyPerBatch })),
          ...run.packSize.lines.map((line) => ({ itemId: line.itemId, qtyPerBatch: line.qtyPerBatch })),
        ]
      : run.bomHeader.lines.map((line) => ({ itemId: line.rawItemId, qtyPerBatch: line.qtyPerBatch }));

    for (const line of plannedLines) {
      await tx.productionRunMaterial.create({
        data: {
          productionRunId: id,
          itemId: line.itemId,
          plannedQtyBase: line.qtyPerBatch * run.batchSize,
        },
      });
    }

    const rawMaterialLineIds = new Set(
      run.bomHeader.lines.filter((l) => l.rawItem.type === "RAW_MATERIAL").map((l) => l.rawItemId),
    );

    requireEachLineOnce(rawMaterialLineIds, actualConsumption.map((c) => c.itemId), "raw material");

    for (const itemId of [...new Set(actualConsumption.map((c) => c.itemId))].sort()) {
      await lockItem(tx, itemId);
    }
    for (const consumed of actualConsumption) {
      const valuePaise = issueValuePaise(consumed.qtyBase, await ledgerPosition(tx, consumed.itemId));

      // FEFO selection — select eligible batches in expiry order
      const selections = await selectRawBatchesFEFO(consumed.itemId, consumed.qtyBase, tx);
      await issueFromRawBatches(
        tx,
        selections,
        consumed.itemId,
        id,
        consumed.qtyBase,
        valuePaise,
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
  },
  actingUserId: string,
) {
  // The pack format is fixed at planning time, not chosen after production.
  let outputItemId = "";
  return prisma.$transaction(async (tx) => {
    const run = await tx.productionRun.findUnique({
      where: { id },
      include: {
        bomHeader: { include: { lines: { include: { rawItem: true } } } },
        packSize: { include: { finishedItem: true, lines: { include: { item: true } } } },
      },
    });
    if (!run) {
      throw new AppError(404, "not_found", "Production run not found");
    }

    outputItemId = run.packSize?.finishedItemId ?? run.bomHeader.finishedItemId;

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

    const requiredPackagingLines = run.packSize
      ? run.packSize.lines.map((line) => ({ itemId: line.itemId }))
      : run.bomHeader.lines
          .filter((line) => line.rawItem.type === "PACKAGING")
          .map((line) => ({ itemId: line.rawItemId }));
    const packagingLineIds = new Set(requiredPackagingLines.map((line) => line.itemId));

    // Lock every packaging SKU before reading stock or WAC; sorted order
    // keeps concurrent multi-packaging completions from deadlocking.
    for (const itemId of [...new Set(data.packagingConsumed.map((line) => line.itemId))].sort()) {
      await lockItem(tx, itemId);
    }

    // Check and consume the used and damaged quantities against usable FEFO
    // batches. Both categories are separate ledger rows but together consume
    // the actual number of pouches/cartons taken from stock.
    for (const line of data.packagingConsumed) {
      const position = await ledgerPosition(tx, line.itemId);
      const usedValue = issueValuePaise(line.qtyBase, position);
      const damagedValue = issueValuePaise(line.qtyBase + line.damagedQty, position) - usedValue;

      if (line.qtyBase > 0) {
        const usedSelections = await selectRawBatchesFEFO(line.itemId, line.qtyBase, tx);
        await issueFromRawBatches(
          tx,
          usedSelections,
          line.itemId,
          id,
          line.qtyBase,
          usedValue,
          null,
          undefined,
          "PRODUCTION_PACKAGING",
        );
      }
      if (line.damagedQty > 0) {
        const damagedSelections = await selectRawBatchesFEFO(line.itemId, line.damagedQty, tx);
        await issueFromRawBatches(
          tx,
          damagedSelections,
          line.itemId,
          id,
          line.damagedQty,
          damagedValue,
          null,
          undefined,
          "PRODUCTION_DAMAGE",
        );
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
    const unitCostPaise = displayUnitCostPaise(totalCostPaise, data.actualOutputQty);

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
    const expected = (result.packSize?.expectedYieldQty ?? result.bomHeader.expectedYieldQty) * result.batchSize;
    const actual = data.actualOutputQty;
    if (expected > 0) {
      const pctDiff = (actual - expected) / expected; // signed fraction
      if (Math.abs(pctDiff) > 0.03) {
        const pctDisplay = (pctDiff * 100).toFixed(1);
        await notify({
          recipientRoles: ["OWNER", "PRODUCTION"],
          type: "PRODUCTION_VARIANCE",
          title: `${result.packSize?.finishedItem.name ?? result.bomHeader.finishedItem.name}: ${actual < expected ? "fewer" : "more"} packets than planned`,
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

    // Each issue is reversed against the same batch it came from, and that
    // batch's remaining quantity is put back, so FEFO can issue the returned
    // material again. Without this the ledger said the stock was back while
    // the batch still showed it as used.
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
          rawMaterialBatchId: movement.rawMaterialBatchId,
        },
      });
      if (movement.rawMaterialBatchId) {
        await tx.rawMaterialBatch.update({
          where: { id: movement.rawMaterialBatchId },
          data: { remainingQtyBase: { increment: -movement.qtyBase } },
        });
      }
    }

    return tx.productionRun.findUniqueOrThrow({ where: { id }, include: includeClause() });
  }).then(async (result) => {
    await syncAlertsForItems(reversedItemIds);
    return result;
  });
}
