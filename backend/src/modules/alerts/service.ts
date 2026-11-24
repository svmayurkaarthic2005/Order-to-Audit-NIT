import { prisma } from "../../lib/prisma.js";
import { getAvailableQty, getItemOrThrow } from "../inventory/service.js";

export async function setReorderLevel(itemId: string, reorderLevel: number) {
  await getItemOrThrow(itemId);
  return prisma.item.update({ where: { id: itemId }, data: { reorderLevel } });
}

// Called after any operation that can move an item's available quantity
// (on-hand via a stock movement, or reserved via an order approval) —
// never on a timer, so no background worker is needed. Dedup is a plain
// find-then-create check; see the LowStockAlert model comment in schema.prisma
// for why that's an acceptable tradeoff here.
export async function syncAlertsForItems(itemIds: string[]) {
  const uniqueIds = [...new Set(itemIds)];
  for (const itemId of uniqueIds) {
    const item = await prisma.item.findUnique({ where: { id: itemId } });
    if (!item || item.reorderLevel == null) continue;

    const available = await getAvailableQty(prisma, itemId);
    const activeAlert = await prisma.lowStockAlert.findFirst({ where: { itemId, status: "ACTIVE" } });

    if (available < item.reorderLevel) {
      if (!activeAlert) {
        await prisma.lowStockAlert.create({
          data: { itemId, thresholdAtAlert: item.reorderLevel, availableQtyAtAlert: available },
        });
      }
    } else if (activeAlert) {
      await prisma.lowStockAlert.update({
        where: { id: activeAlert.id },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
    }
  }
}

export async function listAlerts(status?: "ACTIVE" | "RESOLVED") {
  return prisma.lowStockAlert.findMany({
    where: status ? { status } : {},
    include: { item: true },
    orderBy: { createdAt: "desc" },
  });
}

// The brief's stock-status table: every active item with its current
// available qty, reorder level and Normal/Low status — not just the ones
// that currently have an alert row, so an item that's never crossed its
// threshold still shows up as Normal.
export async function getStockStatus() {
  const items = await prisma.item.findMany({ where: { active: true }, orderBy: { sku: "asc" } });
  return Promise.all(
    items.map(async (item) => {
      const availableQtyBase = await getAvailableQty(prisma, item.id);
      const isLow = item.reorderLevel != null && availableQtyBase < item.reorderLevel;
      return {
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        type: item.type,
        unit: item.baseUnit,
        availableQtyBase,
        reorderLevel: item.reorderLevel,
        status: isLow ? "LOW" : "NORMAL",
      };
    }),
  );
}

