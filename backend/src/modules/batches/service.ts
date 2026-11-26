import { type Prisma } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { logAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { displayUnitCostPaise, splitValue } from "../../lib/valuation.js";
import { getOnHandQty } from "../inventory/service.js";
import { formatQty } from "../../lib/units.js";
import { notify } from "../notifications/service.js";

type TxClient = Prisma.TransactionClient;

// ── Internal batch-number generator ──────────────────────────────────────

export function genBatchNo(prefix: "RM" | "FG"): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

// ── Raw material batch receipt ────────────────────────────────────────────

// Creates the batch for a purchase line inside the purchase's own
// transaction, before its receipt movement is posted, so the movement can
// carry rawMaterialBatchId from the start. The ledger is append-only: a
// posted movement is never edited to attach a batch afterwards.
export async function createRawBatchForPurchaseLine(
  tx: TxClient,
  line: { purchaseItemId: string; itemId: string; qtyBase: number; supplierId: string; receiptDate: Date },
  batchDetails: {
    supplierBatchNo?: string;
    manufactureDate?: Date;
    expiryDate?: Date;
    qualityDocRef?: string;
  },
) {
  return tx.rawMaterialBatch.create({
    data: {
      itemId: line.itemId,
      internalBatchNo: genBatchNo("RM"),
      supplierBatchNo: batchDetails.supplierBatchNo ?? null,
      supplierId: line.supplierId,
      purchaseItemId: line.purchaseItemId,
      receivedQtyBase: line.qtyBase,
      remainingQtyBase: line.qtyBase,
      receiptDate: line.receiptDate,
      manufactureDate: batchDetails.manufactureDate ?? null,
      expiryDate: batchDetails.expiryDate ?? null,
      qualityDocRef: batchDetails.qualityDocRef ?? null,
    },
  });
}

// ── FEFO selection ────────────────────────────────────────────────────────

// batchId null is the "unbatched" part of on-hand: stock that has no batch
// record, such as opening stock or a purchase entered without lot details.
export type BatchSelection = { batchId: string | null; qty: number; batchType: "raw" | "finished" };

type DbClient = Prisma.TransactionClient | typeof prisma;
type BatchRow = { id: string; remainingQtyBase: number; status: string; expiryDate: Date | null; createdAt: Date };

// Chooses where an issue comes from, and refuses if the ledger doesn't hold
// enough. Unbatched stock goes first (it's the oldest: it predates batch
// tracking), then batches by earliest expiry, skipping expired and on-hold
// ones. The ledger's on-hand is the limit in every case, so an item with no
// batches at all can't be driven negative, and an item with a mix of both
// can use all of its usable stock.
async function selectFEFO(
  db: DbClient,
  itemId: string,
  qtyNeeded: number,
  batchType: "raw" | "finished",
  batches: BatchRow[],
): Promise<BatchSelection[]> {
  // Two issues of the same item at once could both read the same on-hand
  // and take the unbatched stock twice. This lock queues them per item
  // until the transaction ends.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${itemId}))`;
  const onHand = await getOnHandQty(db, itemId);
  const batchedTotal = batches.reduce((sum, b) => sum + b.remainingQtyBase, 0);
  const unbatched = Math.max(0, onHand - batchedTotal);

  const selections: BatchSelection[] = [];
  let remaining = qtyNeeded;
  if (unbatched > 0 && remaining > 0) {
    const take = Math.min(unbatched, remaining);
    selections.push({ batchId: null, qty: take, batchType });
    remaining -= take;
  }

  const usable = batches
    .filter((b) => b.status !== "EXPIRED" && b.status !== "QUARANTINED" && b.remainingQtyBase > 0)
    .sort(
      (x, y) =>
        (x.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (y.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
        x.createdAt.getTime() - y.createdAt.getTime(),
    );
  for (const batch of usable) {
    if (remaining <= 0) break;
    const take = Math.min(batch.remainingQtyBase, remaining);
    selections.push({ batchId: batch.id, qty: take, batchType });
    remaining -= take;
  }

  if (remaining > 0) {
    const item = await db.item.findUnique({ where: { id: itemId } });
    throw new AppError(
      409,
      "insufficient_batch_stock",
      `Not enough ${item?.name ?? "stock"}: ${formatQty(qtyNeeded - remaining, item?.baseUnit ?? "PIECE")} usable, ${formatQty(qtyNeeded, item?.baseUnit ?? "PIECE")} needed. Buy more, or lower the amount. (Expired or on-hold batches don't count.)`,
      { itemId, available: qtyNeeded - remaining, needed: qtyNeeded },
    );
  }
  return selections;
}

export async function selectRawBatchesFEFO(itemId: string, qtyNeeded: number, db: DbClient = prisma): Promise<BatchSelection[]> {
  const batches = await db.rawMaterialBatch.findMany({ where: { itemId } });
  return selectFEFO(db, itemId, qtyNeeded, "raw", batches);
}

export async function selectFinishedBatchesFEFO(itemId: string, qtyNeeded: number, db: DbClient = prisma): Promise<BatchSelection[]> {
  const batches = await db.finishedGoodsBatch.findMany({ where: { itemId } });
  return selectFEFO(db, itemId, qtyNeeded, "finished", batches);
}

export async function selectBatchesFEFO(
  itemId: string,
  qtyNeeded: number,
  batchType: "raw" | "finished" = "raw",
): Promise<BatchSelection[]> {
  if (batchType === "raw") {
    return selectRawBatchesFEFO(itemId, qtyNeeded);
  }
  return selectFinishedBatchesFEFO(itemId, qtyNeeded);
}

// ── Issue from raw-material batches ──────────────────────────────────────

export async function issueFromRawBatches(
  tx: TxClient,
  selections: BatchSelection[],
  itemId: string,
  productionRunId: string,
  qtyNeeded: number,
  issueValuePaise: number,
  actingUserId: string | null = null,
  overrideReason?: string,
) {
  const unitCostPaise = displayUnitCostPaise(issueValuePaise, qtyNeeded);
  if (selections.length === 0) {
    await tx.stockMovement.create({
      data: {
        itemId,
        qtyBase: -qtyNeeded,
        unitCostPaise,
        totalCostPaise: -issueValuePaise,
        source: "PRODUCTION_ISSUE",
        sourceId: productionRunId,
      },
    });
    return;
  }

  const values = splitValue(issueValuePaise, selections.map((sel) => sel.qty));
  for (const [i, sel] of selections.entries()) {
    if (sel.batchId === null) {
      await tx.stockMovement.create({
        data: {
          itemId,
          qtyBase: -sel.qty,
          unitCostPaise,
          totalCostPaise: -values[i]!,
          source: "PRODUCTION_ISSUE",
          sourceId: productionRunId,
        },
      });
      continue;
    }
    // Decrement remainingQtyBase atomically
    const updated = await tx.rawMaterialBatch.updateMany({
      where: { id: sel.batchId, remainingQtyBase: { gte: sel.qty } },
      data: { remainingQtyBase: { decrement: sel.qty } },
    });
    if (updated.count === 0) {
      throw new AppError(409, "batch_qty_changed", `Batch ${sel.batchId} no longer has enough remaining quantity`);
    }

    await tx.stockMovement.create({
      data: {
        itemId,
        qtyBase: -sel.qty,
        unitCostPaise,
        totalCostPaise: -values[i]!,
        source: "PRODUCTION_ISSUE",
        sourceId: productionRunId,
        rawMaterialBatchId: sel.batchId,
      },
    });
  }

  if (overrideReason) {
    await logAudit(tx, {
      userId: actingUserId,
      action: "FEFO_OVERRIDE",
      entityType: "ProductionRun",
      entityId: productionRunId,
      after: { overrideReason, selections },
    });
  }
}

// ── Dispatch from finished-goods batches ──────────────────────────────────

export async function issueFromFinishedBatches(
  tx: TxClient,
  dispatchId: string,
  invoiceId: string,
  selections: BatchSelection[],
  itemId: string,
  qtyNeeded: number,
  issueValuePaise: number,
  actingUserId: string | null = null,
  overrideReason?: string,
) {
  const unitCostPaise = displayUnitCostPaise(issueValuePaise, qtyNeeded);
  if (selections.length === 0) {
    await tx.stockMovement.create({
      data: {
        itemId,
        qtyBase: -qtyNeeded,
        unitCostPaise,
        totalCostPaise: -issueValuePaise,
        source: "DISPATCH",
        sourceId: invoiceId,
      },
    });
    return;
  }

  const values = splitValue(issueValuePaise, selections.map((sel) => sel.qty));
  for (const [i, sel] of selections.entries()) {
    if (sel.batchId === null) {
      await tx.stockMovement.create({
        data: {
          itemId,
          qtyBase: -sel.qty,
          unitCostPaise,
          totalCostPaise: -values[i]!,
          source: "DISPATCH",
          sourceId: invoiceId,
        },
      });
      continue;
    }
    const updated = await tx.finishedGoodsBatch.updateMany({
      where: { id: sel.batchId, remainingQtyBase: { gte: sel.qty } },
      data: { remainingQtyBase: { decrement: sel.qty } },
    });
    if (updated.count === 0) {
      throw new AppError(409, "batch_qty_changed", `Finished-goods batch ${sel.batchId} no longer has enough remaining quantity`);
    }

    await tx.stockMovement.create({
      data: {
        itemId,
        qtyBase: -sel.qty,
        unitCostPaise,
        totalCostPaise: -values[i]!,
        source: "DISPATCH",
        sourceId: invoiceId,
        finishedGoodsBatchId: sel.batchId,
      },
    });

    await tx.dispatchItemBatch.create({
      data: {
        dispatchId,
        finishedGoodsBatchId: sel.batchId,
        qtyBase: sel.qty,
      },
    });
  }

  if (overrideReason) {
    await logAudit(tx, {
      userId: actingUserId,
      action: "FEFO_OVERRIDE",
      entityType: "Dispatch",
      entityId: dispatchId,
      after: { overrideReason, selections },
    });
  }
}

/** Unified issueFromBatches */
export async function issueFromBatches(
  tx: TxClient,
  selections: BatchSelection[],
  itemId: string,
  targetId: string,
  qtyNeeded: number,
  issueValuePaise: number,
  actingUserId: string | null = null,
  overrideReason?: string,
) {
  if (selections.length > 0 && selections[0].batchType === "finished") {
    return issueFromFinishedBatches(tx, targetId, targetId, selections, itemId, qtyNeeded, issueValuePaise, actingUserId, overrideReason);
  }
  return issueFromRawBatches(tx, selections, itemId, targetId, qtyNeeded, issueValuePaise, actingUserId, overrideReason);
}

// ── Record finished-goods production output ───────────────────────────────

export async function recordProductionOutput(
  tx: TxClient,
  productionRunId: string,
  itemId: string,
  producedQtyBase: number,
  expiryDate?: Date,
) {
  return tx.finishedGoodsBatch.create({
    data: {
      itemId,
      internalBatchNo: genBatchNo("FG"),
      productionRunId,
      manufactureDate: new Date(),
      expiryDate: expiryDate ?? null,
      producedQtyBase,
      remainingQtyBase: producedQtyBase,
    },
  });
}

// ── Batch status refresh (FEFO expiry alerts) ─────────────────────────────

const DEFAULT_WARNING_THRESHOLDS = [30, 15, 7, 0];

export async function refreshBatchStatuses() {
  const now = new Date();

  // ── Raw material batches ──
  const rawBatches = await prisma.rawMaterialBatch.findMany({
    where: { status: { notIn: ["QUARANTINED"] } },
    include: { item: true },
  });

  for (const batch of rawBatches) {
    if (!batch.expiryDate) continue;
    const daysLeft = Math.ceil((batch.expiryDate.getTime() - now.getTime()) / 86_400_000);

    let newStatus: "NORMAL" | "EXPIRING" | "EXPIRED" = batch.status as "NORMAL" | "EXPIRING" | "EXPIRED";
    if (daysLeft <= 0) {
      newStatus = "EXPIRED";
    } else if (daysLeft <= 30) {
      newStatus = "EXPIRING";
    }

    if (newStatus !== batch.status) {
      await prisma.rawMaterialBatch.update({ where: { id: batch.id }, data: { status: newStatus } });
    }

    // Fire notify per threshold crossed
    const thresholds: number[] = (batch.item.expiryWarningDaysJson?.length
      ? batch.item.expiryWarningDaysJson
      : DEFAULT_WARNING_THRESHOLDS);

    for (const threshold of thresholds) {
      if (daysLeft <= threshold) {
        await notify({
          recipientRoles: ["OWNER", "ADMIN", "PRODUCTION"],
          type: "EXPIRY_WARNING",
          title: `Batch expiring: ${batch.item.name}`,
          message: `Raw material batch ${batch.internalBatchNo} (${batch.item.name}) expires ${daysLeft <= 0 ? "today or is already expired" : `in ${daysLeft} day(s)`}`,
          severity: daysLeft <= 0 ? "CRITICAL" : daysLeft <= 7 ? "WARNING" : "INFO",
          sourceType: "RawMaterialBatch",
          sourceId: batch.id,
          dedupeKeySuffix: `:expiry:${batch.id}:${threshold}`,
        });
      }
    }
  }

  // ── Finished-goods batches ──
  const fgBatches = await prisma.finishedGoodsBatch.findMany({
    where: { status: { notIn: ["QUARANTINED"] } },
    include: { item: true },
  });

  for (const batch of fgBatches) {
    if (!batch.expiryDate) continue;
    const daysLeft = Math.ceil((batch.expiryDate.getTime() - now.getTime()) / 86_400_000);

    let newStatus: "NORMAL" | "EXPIRING" | "EXPIRED" = batch.status as "NORMAL" | "EXPIRING" | "EXPIRED";
    if (daysLeft <= 0) {
      newStatus = "EXPIRED";
    } else if (daysLeft <= 30) {
      newStatus = "EXPIRING";
    }

    if (newStatus !== batch.status) {
      await prisma.finishedGoodsBatch.update({ where: { id: batch.id }, data: { status: newStatus } });
    }

    const thresholds: number[] = (batch.item.expiryWarningDaysJson?.length
      ? batch.item.expiryWarningDaysJson
      : DEFAULT_WARNING_THRESHOLDS);

    for (const threshold of thresholds) {
      if (daysLeft <= threshold) {
        await notify({
          recipientRoles: ["OWNER", "ADMIN"],
          type: "EXPIRY_WARNING",
          title: `Batch expiring: ${batch.item.name}`,
          message: `Finished-goods batch ${batch.internalBatchNo} (${batch.item.name}) expires ${daysLeft <= 0 ? "today or is already expired" : `in ${daysLeft} day(s)`}`,
          severity: daysLeft <= 0 ? "CRITICAL" : daysLeft <= 7 ? "WARNING" : "INFO",
          sourceType: "FinishedGoodsBatch",
          sourceId: batch.id,
          dedupeKeySuffix: `:expiry:${batch.id}:${threshold}`,
        });
      }
    }
  }
}

// ── Genealogy ─────────────────────────────────────────────────────────────

/** Forward: raw material batch → production runs it was used in → finished batches → dispatches */
export async function genealogyForward(rawMaterialBatchId: string) {
  const batch = await prisma.rawMaterialBatch.findUnique({
    where: { id: rawMaterialBatchId },
    include: { item: true },
  });
  if (!batch) throw new AppError(404, "not_found", "Raw material batch not found");

  // Movements from this batch → production runs
  const movements = await prisma.stockMovement.findMany({
    where: { rawMaterialBatchId, source: "PRODUCTION_ISSUE" },
    distinct: ["sourceId"],
  });

  const productionRunIds = [...new Set(movements.map((m) => m.sourceId).filter(Boolean) as string[])];

  const runs = await prisma.productionRun.findMany({
    where: { id: { in: productionRunIds } },
    include: {
      finishedGoodsBatch: {
        include: {
          dispatchBatches: {
            include: { dispatch: { include: { invoice: { include: { customer: true } } } } },
          },
        },
      },
      bomHeader: { include: { finishedItem: true } },
    },
  });

  return { rawMaterialBatch: batch, productionRuns: runs };
}

/** Backward: dispatch → finished-goods batches → production runs → raw material batches */
export async function genealogyBackward(dispatchId: string) {
  const dispatch = await prisma.dispatch.findUnique({
    where: { id: dispatchId },
    include: {
      invoice: { include: { customer: true, items: { include: { item: true } } } },
      itemBatches: {
        include: {
          finishedGoodsBatch: {
            include: {
              item: true,
              productionRun: {
                include: {
                  bomHeader: { include: { lines: { include: { rawItem: true } } } },
                  materials: { include: { item: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!dispatch) throw new AppError(404, "not_found", "Dispatch not found");

  const runIds = [
    ...new Set(
      dispatch.itemBatches
        .map((ib) => ib.finishedGoodsBatch.productionRunId)
        .filter(Boolean),
    ),
  ];

  const rawMovements = await prisma.stockMovement.findMany({
    where: {
      sourceId: { in: runIds },
      source: "PRODUCTION_ISSUE",
      rawMaterialBatchId: { not: null },
    },
    include: {
      rawMaterialBatch: { include: { item: true, supplier: true } },
    },
  });

  const rawBatchesByRunId: Record<string, typeof rawMovements> = {};
  for (const rm of rawMovements) {
    if (rm.sourceId) {
      if (!rawBatchesByRunId[rm.sourceId]) rawBatchesByRunId[rm.sourceId] = [];
      rawBatchesByRunId[rm.sourceId].push(rm);
    }
  }

  const enrichedBatches = dispatch.itemBatches.map((ib) => {
    const runId = ib.finishedGoodsBatch.productionRunId;
    return {
      ...ib,
      rawMaterialInputs: rawBatchesByRunId[runId] ?? [],
    };
  });

  return {
    ...dispatch,
    itemBatches: enrichedBatches,
  };
}

// ── List helpers ──────────────────────────────────────────────────────────

export async function listRawBatches(itemId?: string, status?: string) {
  return prisma.rawMaterialBatch.findMany({
    where: {
      ...(itemId ? { itemId } : {}),
      ...(status ? { status: status as never } : {}),
    },
    include: { item: true, supplier: true },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
  });
}

export async function listFinishedBatches(itemId?: string, status?: string) {
  return prisma.finishedGoodsBatch.findMany({
    where: {
      ...(itemId ? { itemId } : {}),
      ...(status ? { status: status as never } : {}),
    },
    include: { item: true, productionRun: { include: { bomHeader: { include: { finishedItem: true } } } } },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
  });
}

export async function quarantineBatch(id: string, batchType: "raw" | "finished", reason: string, actingUserId: string) {
  if (batchType === "raw") {
    const batch = await prisma.rawMaterialBatch.findUnique({ where: { id } });
    if (!batch) throw new AppError(404, "not_found", "Raw material batch not found");
    await prisma.rawMaterialBatch.update({ where: { id }, data: { status: "QUARANTINED" } });
  } else {
    const batch = await prisma.finishedGoodsBatch.findUnique({ where: { id } });
    if (!batch) throw new AppError(404, "not_found", "Finished-goods batch not found");
    await prisma.finishedGoodsBatch.update({ where: { id }, data: { status: "QUARANTINED" } });
  }

  // Log quarantine action
  await prisma.auditLog.create({
    data: {
      userId: actingUserId,
      action: "QUARANTINE",
      entityType: batchType === "raw" ? "RawMaterialBatch" : "FinishedGoodsBatch",
      entityId: id,
      afterJson: JSON.stringify({ reason }),
    },
  });
}
