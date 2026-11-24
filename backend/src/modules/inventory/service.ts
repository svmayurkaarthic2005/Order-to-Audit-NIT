import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";

export async function getItemOrThrow(itemId: string) {
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item || !item.active) {
    throw new AppError(404, "not_found", "Item not found");
  }
  return item;
}

// On-hand is never a cached column — it is always this live aggregate over
// the ledger: SUM(signed qtyBase) across every physical stock_movements row.
export async function getOnHand(itemId: string) {
  const item = await getItemOrThrow(itemId);
  const agg = await prisma.stockMovement.aggregate({
    where: { itemId },
    _sum: { qtyBase: true },
  });
  return {
    qtyBase: agg._sum.qtyBase ?? 0,
    unit: item.baseUnit,
    asOf: new Date().toISOString(),
  };
}

export async function postOpeningStock(data: { itemId: string; qtyBase: number; totalCostPaise: number }) {
  await getItemOrThrow(data.itemId);

  const existing = await prisma.stockMovement.findFirst({
    where: { itemId: data.itemId, source: "OPENING_STOCK" },
  });
  if (existing) {
    throw new AppError(409, "opening_stock_exists", "Opening stock has already been recorded for this item");
  }

  return prisma.stockMovement.create({
    data: {
      itemId: data.itemId,
      qtyBase: data.qtyBase,
      unitCostPaise: Math.round(data.totalCostPaise / data.qtyBase),
      totalCostPaise: data.totalCostPaise,
      source: "OPENING_STOCK",
    },
  });
}
