import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { syncAlertsForItems } from "../alerts/service.js";
import { displayUnitCostPaise } from "../../lib/valuation.js";
import { createRawBatchForPurchaseLine, refreshBatchStatuses } from "../batches/service.js";

const PAGE_SIZE = 20;

type PurchaseItemInput = {
  itemId: string;
  qtyBase: number;
  rateBasePaise: number;
  totalCostPaise?: number;
  // Optional batch fields — if provided, a RawMaterialBatch row is created
  supplierBatchNo?: string;
  manufactureDate?: string;
  expiryDate?: string;
  qualityDocRef?: string;
};

export async function listPurchases(supplierId: string | undefined, page: number) {
  const where = supplierId ? { supplierId } : {};
  const [items, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      include: { items: true, supplier: true },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { purchaseDate: "desc" },
    }),
    prisma.purchase.count({ where }),
  ]);
  return { items, total };
}

export async function getPurchase(id: string) {
  const purchase = await prisma.purchase.findUnique({ where: { id }, include: { items: true, supplier: true } });
  if (!purchase) {
    throw new AppError(404, "not_found", "Purchase not found");
  }
  return purchase;
}

// Creates the purchase, its line items, any batches, and one receipt
// stock_movements row per line, all inside a single transaction, so a bad
// line item (unknown item, finished good, inactive supplier) rolls back
// everything, never a partial purchase.
export async function createPurchase(data: { supplierId: string; items: PurchaseItemInput[] }) {
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: data.supplierId } });
    if (!supplier || !supplier.active) {
      throw new AppError(404, "not_found", "Supplier not found");
    }

    const purchase = await tx.purchase.create({ data: { supplierId: data.supplierId } });

    for (const line of data.items) {
      const item = await tx.item.findUnique({ where: { id: line.itemId } });
      if (!item || !item.active) {
        throw new AppError(404, "not_found", `Item ${line.itemId} not found`);
      }
      if (item.type === "FINISHED_GOOD") {
        throw new AppError(400, "invalid_item_type", "Finished goods are produced, not purchased");
      }

      const valuePaise = line.totalCostPaise ?? line.qtyBase * line.rateBasePaise;
      const purchaseItem = await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          itemId: line.itemId,
          qtyBase: line.qtyBase,
          rateBasePaise: line.totalCostPaise !== undefined ? displayUnitCostPaise(valuePaise, line.qtyBase) : line.rateBasePaise,
        },
      });

      const hasBatchDetails = Boolean(line.supplierBatchNo || line.expiryDate || line.manufactureDate || line.qualityDocRef);
      const batch = hasBatchDetails
        ? await createRawBatchForPurchaseLine(
            tx,
            {
              purchaseItemId: purchaseItem.id,
              itemId: line.itemId,
              qtyBase: line.qtyBase,
              supplierId: data.supplierId,
              receiptDate: purchase.purchaseDate,
            },
            {
              supplierBatchNo: line.supplierBatchNo,
              manufactureDate: line.manufactureDate ? new Date(line.manufactureDate) : undefined,
              expiryDate: line.expiryDate ? new Date(line.expiryDate) : undefined,
              qualityDocRef: line.qualityDocRef,
            },
          )
        : null;

      await tx.stockMovement.create({
        data: {
          itemId: line.itemId,
          qtyBase: line.qtyBase,
          unitCostPaise: displayUnitCostPaise(valuePaise, line.qtyBase),
          totalCostPaise: valuePaise,
          source: "PURCHASE",
          sourceId: purchase.id,
          rawMaterialBatchId: batch?.id ?? null,
        },
      });
    }

    return tx.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include: { items: true } });
  }).then(async (result) => {
    await syncAlertsForItems(result.items.map((i) => i.itemId));
    await refreshBatchStatuses();
    return result;
  });
}

// Reverses every line's receipt with an offsetting ledger row — the
// original PURCHASE rows are never touched or deleted.
export async function cancelPurchase(id: string) {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findUnique({ where: { id }, include: { items: true } });
    if (!purchase) {
      throw new AppError(404, "not_found", "Purchase not found");
    }

    // Atomic, conditional on cancelledAt still being null: two concurrent
    // cancel requests both reading cancelledAt:null before either writes
    // would otherwise both pass a plain if-check and both post reversal
    // rows. Only the request whose UPDATE actually flips the row (count 1)
    // may proceed to post reversals; the loser sees count 0 and gets a
    // clean 409, with no reversal row of its own.
    const { count } = await tx.purchase.updateMany({
      where: { id, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
    if (count === 0) {
      throw new AppError(409, "already_cancelled", "Purchase is already cancelled");
    }

    // Reverse each receipt exactly as it was posted (value and batch), and
    // take the quantity back off its batch. If some of a batch has already
    // been used, the purchase can no longer be cancelled as a whole.
    const receipts = await tx.stockMovement.findMany({ where: { source: "PURCHASE", sourceId: purchase.id } });
    for (const receipt of receipts) {
      if (receipt.rawMaterialBatchId) {
        const taken = await tx.rawMaterialBatch.updateMany({
          where: { id: receipt.rawMaterialBatchId, remainingQtyBase: { gte: receipt.qtyBase } },
          data: { remainingQtyBase: { decrement: receipt.qtyBase } },
        });
        if (taken.count === 0) {
          throw new AppError(409, "already_used", "Some of this purchase has already been used in production, so it can't be cancelled");
        }
      }
      await tx.stockMovement.create({
        data: {
          itemId: receipt.itemId,
          qtyBase: -receipt.qtyBase,
          unitCostPaise: receipt.unitCostPaise,
          totalCostPaise: -receipt.totalCostPaise,
          source: "PURCHASE_REVERSAL",
          sourceId: purchase.id,
          rawMaterialBatchId: receipt.rawMaterialBatchId,
        },
      });
    }

    return tx.purchase.findUniqueOrThrow({ where: { id }, include: { items: true } });
  }).then(async (result) => {
    await syncAlertsForItems(result.items.map((i) => i.itemId));
    return result;
  });
}
