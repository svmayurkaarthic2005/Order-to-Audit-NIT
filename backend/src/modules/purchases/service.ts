import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";

const PAGE_SIZE = 20;

type PurchaseItemInput = { itemId: string; qtyBase: number; rateBasePaise: number };

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

// Creates the purchase, its line items, and one receipt stock_movements row
// per line — all inside a single transaction, so a bad line item (unknown
// item, finished good, inactive supplier) rolls back everything, never a
// partial purchase.
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

      await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          itemId: line.itemId,
          qtyBase: line.qtyBase,
          rateBasePaise: line.rateBasePaise,
        },
      });

      await tx.stockMovement.create({
        data: {
          itemId: line.itemId,
          qtyBase: line.qtyBase,
          unitCostPaise: line.rateBasePaise,
          totalCostPaise: line.qtyBase * line.rateBasePaise,
          source: "PURCHASE",
          sourceId: purchase.id,
        },
      });
    }

    return tx.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include: { items: true } });
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

    for (const line of purchase.items) {
      await tx.stockMovement.create({
        data: {
          itemId: line.itemId,
          qtyBase: -line.qtyBase,
          unitCostPaise: line.rateBasePaise,
          totalCostPaise: -(line.qtyBase * line.rateBasePaise),
          source: "PURCHASE_REVERSAL",
          sourceId: purchase.id,
        },
      });
    }

    return tx.purchase.findUniqueOrThrow({ where: { id }, include: { items: true } });
  });
}
