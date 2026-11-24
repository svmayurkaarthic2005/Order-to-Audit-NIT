import { type Prisma } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { logAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { notify } from "../notifications/service.js";

type TxClient = Prisma.TransactionClient;

// ── Internal batch-number generator ──────────────────────────────────────

export function genBatchNo(prefix: "RM" | "FG"): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

// ── Raw material batch receipt ────────────────────────────────────────────

export async function receiveBatch(
  purchaseItemId: string,
  batchDetails: {
    supplierBatchNo?: string;
    manufactureDate?: Date;
    expiryDate?: Date;
    qualityDocRef?: string;
  },
) {
  const pi = await prisma.purchaseItem.findUnique({
    where: { id: purchaseItemId },
    include: { item: true, purchase: true },
  });
  if (!pi) throw new AppError(404, "not_found", "Purchase item not found");

  // Idempotent — a PurchaseItem can only have one batch (relation is @unique)
  const existing = await prisma.rawMaterialBatch.findUnique({ where: { purchaseItemId } });
  if (existing) return existing;

  const batch = await prisma.rawMaterialBatch.create({
    data: {
      itemId: pi.itemId,
      internalBatchNo: genBatchNo("RM"),
      supplierBatchNo: batchDetails.supplierBatchNo ?? null,
      supplierId: pi.purchase.supplierId,
      purchaseItemId,
      receivedQtyBase: pi.qtyBase,
      remainingQtyBase: pi.qtyBase,
      receiptDate: pi.purchase.purchaseDate,
      manufactureDate: batchDetails.manufactureDate ?? null,
      expiryDate: batchDetails.expiryDate ?? null,
      qualityDocRef: batchDetails.qualityDocRef ?? null,
    },
  });

  // Link the receipt stock movement so SUM(StockMovement WHERE rawMaterialBatchId = X) matches remainingQtyBase
  await prisma.stockMovement.updateMany({
    where: {
      source: "PURCHASE",
      sourceId: pi.purchaseId,
      itemId: pi.itemId,
      rawMaterialBatchId: null,
    },
    data: { rawMaterialBatchId: batch.id },
  });

  return batch;
}

// ── FEFO selection ────────────────────────────────────────────────────────

export type BatchSelection = { batchId: string; qty: number; batchType: "raw" | "finished" };

/** Returns FEFO-ordered selections of raw-material batches for `qtyNeeded`.
 *  Excludes EXPIRED and QUARANTINED lots. If tracked batches exist but eligible
 *  stock is insufficient, throws 409. If no batches exist for this item (legacy unbatched stock),
 *  returns [] to allow unbatched issuance. */
export async function selectRawBatchesFEFO(
  itemId: string,
  qtyNeeded: number,
): Promise<BatchSelection[]> {
  const totalBatches = await prisma.rawMaterialBatch.count({ where: { itemId } });
  if (totalBatches === 0) {
    return [];
  }

  const batches = await prisma.rawMaterialBatch.findMany({
    where: {
      itemId,
      status: { notIn: ["EXPIRED", "QUARANTINED"] },
      remainingQtyBase: { gt: 0 },
    },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
  });

  return allocateFromBatches(batches, qtyNeeded, "raw");
}

/** Returns FEFO-ordered selections of finished-goods batches for `qtyNeeded`. */
export async function selectFinishedBatchesFEFO(
  itemId: string,
  qtyNeeded: number,
): Promise<BatchSelection[]> {
  const totalBatches = await prisma.finishedGoodsBatch.count({ where: { itemId } });
  if (totalBatches === 0) {
    return [];
  }

  const batches = await prisma.finishedGoodsBatch.findMany({
    where: {
      itemId,
      status: { notIn: ["EXPIRED", "QUARANTINED"] },
      remainingQtyBase: { gt: 0 },
    },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
  });

  return allocateFromBatches(batches, qtyNeeded, "finished");
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

function allocateFromBatches(
  batches: { id: string; remainingQtyBase: number }[],
  qtyNeeded: number,
  batchType: "raw" | "finished",
): BatchSelection[] {
  const selections: BatchSelection[] = [];
  let remaining = qtyNeeded;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.remainingQtyBase, remaining);
    selections.push({ batchId: batch.id, qty: take, batchType });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new AppError(
      409,
      "insufficient_batch_stock",
      `Only ${qtyNeeded - remaining} units available across eligible batches; need ${qtyNeeded}`,
    );
  }

  return selections;
}

// ── Issue from raw-material batches ──────────────────────────────────────

export async function issueFromRawBatches(
  tx: TxClient,
  selections: BatchSelection[],
  itemId: string,
  productionRunId: string,
  qtyNeeded: number,
  unitCostPaise: number,
  actingUserId: string | null = null,
  overrideReason?: string,
) {
  if (selections.length === 0) {
    await tx.stockMovement.create({
      data: {
        itemId,
        qtyBase: -qtyNeeded,
        unitCostPaise,
        totalCostPaise: -(qtyNeeded * unitCostPaise),
        source: "PRODUCTION_ISSUE",
        sourceId: productionRunId,
      },
    });
    return;
  }

  for (const sel of selections) {
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
        totalCostPaise: -(sel.qty * unitCostPaise),
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
  unitCostPaise: number,
  actingUserId: string | null = null,
  overrideReason?: string,
) {
  if (selections.length === 0) {
    await tx.stockMovement.create({
      data: {
        itemId,
        qtyBase: -qtyNeeded,
        unitCostPaise,
        totalCostPaise: -(qtyNeeded * unitCostPaise),
        source: "DISPATCH",
        sourceId: invoiceId,
      },
    });
    return;
  }

  for (const sel of selections) {
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
        totalCostPaise: -(sel.qty * unitCostPaise),
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
  unitCostPaise: number,
  actingUserId: string | null = null,
  overrideReason?: string,
) {
  if (selections.length > 0 && selections[0].batchType === "finished") {
    return issueFromFinishedBatches(tx, targetId, targetId, selections, itemId, qtyNeeded, unitCostPaise, actingUserId, overrideReason);
  }
  return issueFromRawBatches(tx, selections, itemId, targetId, qtyNeeded, unitCostPaise, actingUserId, overrideReason);
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
