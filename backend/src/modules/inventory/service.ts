import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { logAudit } from "../../lib/audit.js";
import { displayUnitCostPaise, issueValuePaise, ledgerPosition } from "../../lib/valuation.js";

type DbClient = typeof prisma | Prisma.TransactionClient;

// Shared by orders/service.ts (reservation at approval time) and
// alerts/service.ts (low-stock checks) so both read on-hand/reserved the
// same way instead of keeping two copies of the same aggregate query.
export async function getOnHandQty(db: DbClient, itemId: string): Promise<number> {
  const agg = await db.stockMovement.aggregate({ where: { itemId }, _sum: { qtyBase: true } });
  return agg._sum.qtyBase ?? 0;
}

// An order holds finished-goods stock once it is approved, right up until
// it is actually dispatched — so both statuses count as "reserved" against
// on-hand. Raw materials and packaging are never reserved this way (no
// draft production run holds stock before it's issued), so this is 0 for
// them, which is exactly what availability should be for those types.
const RESERVED_ORDER_STATUSES = ["APPROVED", "DISPATCHABLE"] as const;

export async function getReservedQty(db: DbClient, itemId: string): Promise<number> {
  const agg = await db.orderItem.aggregate({
    where: { itemId, salesOrder: { status: { in: [...RESERVED_ORDER_STATUSES] } } },
    _sum: { qtyBase: true },
  });
  return agg._sum.qtyBase ?? 0;
}

export async function getUnavailableBatchQty(db: DbClient, itemId: string): Promise<number> {
  const [rawAgg, fgAgg] = await Promise.all([
    db.rawMaterialBatch.aggregate({
      where: { itemId, status: { in: ["EXPIRED", "QUARANTINED"] } },
      _sum: { remainingQtyBase: true },
    }),
    db.finishedGoodsBatch.aggregate({
      where: { itemId, status: { in: ["EXPIRED", "QUARANTINED"] } },
      _sum: { remainingQtyBase: true },
    }),
  ]);
  return (rawAgg._sum.remainingQtyBase ?? 0) + (fgAgg._sum.remainingQtyBase ?? 0);
}

export async function getAvailableQty(db: DbClient, itemId: string): Promise<number> {
  const [onHand, reserved, unavailable] = await Promise.all([
    getOnHandQty(db, itemId),
    getReservedQty(db, itemId),
    getUnavailableBatchQty(db, itemId),
  ]);
  return Math.max(0, onHand - reserved - unavailable);
}

export async function getItemOrThrow(itemId: string) {
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item || !item.active) {
    throw new AppError(404, "not_found", "Item not found");
  }
  return item;
}

// On-hand is never a cached column — it is always this live aggregate over
// the ledger: SUM(signed qtyBase) across every physical stock_movements row.
// movingAverageCostPaise is the same idea applied to cost: SUM(totalCostPaise)
// / SUM(qtyBase) across the ledger — with only receipts posted so far
// (opening stock, purchases), this is exactly the moving weighted-average
// unit cost; once Phase 8 starts posting consumption at that prevailing
// average, the ratio stays correct without any extra bookkeeping.
export async function getOnHand(itemId: string) {
  const item = await getItemOrThrow(itemId);
  const agg = await prisma.stockMovement.aggregate({
    where: { itemId },
    _sum: { qtyBase: true, totalCostPaise: true },
  });
  const qtyBase = agg._sum.qtyBase ?? 0;
  const totalCostPaise = agg._sum.totalCostPaise ?? 0;
  return {
    qtyBase,
    unit: item.baseUnit,
    movingAverageCostPaise: qtyBase > 0 ? Math.round(totalCostPaise / qtyBase) : null,
    asOf: new Date().toISOString(),
  };
}

export async function postOpeningStock(data: { itemId: string; qtyBase: number; totalCostPaise: number }) {
  await getItemOrThrow(data.itemId);

  // A friendly pre-check for the common case, but the real guarantee is the
  // database's unique constraint on openingStockItemId below — two
  // concurrent requests can both pass this check before either commits, so
  // the constraint (not this check) is what actually prevents a duplicate.
  const existing = await prisma.stockMovement.findFirst({
    where: { itemId: data.itemId, source: "OPENING_STOCK" },
  });
  if (existing) {
    throw new AppError(409, "opening_stock_exists", "Opening stock has already been recorded for this item");
  }

  try {
    return await prisma.stockMovement.create({
      data: {
        itemId: data.itemId,
        qtyBase: data.qtyBase,
        unitCostPaise: Math.round(data.totalCostPaise / data.qtyBase),
        totalCostPaise: data.totalCostPaise,
        source: "OPENING_STOCK",
        openingStockItemId: data.itemId,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(409, "opening_stock_exists", "Opening stock has already been recorded for this item");
    }
    throw err;
  }
}

// Count correction, found surplus or write-off — the brief's "± adjustments"
// in opening + receipts − issues ± adjustments = closing. Valued at the
// ledger's current moving-average rate either way, so a correction never
// shifts the average cost it's supposed to just true up the quantity for.
export async function recordAdjustment(data: { itemId: string; qtyBase: number; reason: string }, actingUserId: string) {
  await getItemOrThrow(data.itemId);

  return prisma.$transaction(async (tx) => {
    const position = await ledgerPosition(tx, data.itemId);
    const newQty = position.qtyBase + data.qtyBase;
    if (newQty < 0) {
      throw new AppError(409, "insufficient_stock", `Only ${position.qtyBase} in stock; can't write off ${-data.qtyBase}`);
    }

    const totalCostPaise = Math.sign(data.qtyBase) * issueValuePaise(Math.abs(data.qtyBase), position);
    const adjustment = await tx.stockAdjustment.create({
      data: { itemId: data.itemId, qtyBase: data.qtyBase, reason: data.reason, createdByUserId: actingUserId },
    });
    const movement = await tx.stockMovement.create({
      data: {
        itemId: data.itemId,
        qtyBase: data.qtyBase,
        unitCostPaise: displayUnitCostPaise(totalCostPaise, data.qtyBase),
        totalCostPaise,
        source: "ADJUSTMENT",
        sourceId: adjustment.id,
        createdByUserId: actingUserId,
      },
    });
    await logAudit(tx, {
      userId: actingUserId,
      action: "STOCK_ADJUSTMENT",
      entityType: "Item",
      entityId: data.itemId,
      before: { qtyBase: position.qtyBase },
      after: { qtyBase: newQty, change: data.qtyBase, reason: data.reason },
    });
    return movement;
  });
}
