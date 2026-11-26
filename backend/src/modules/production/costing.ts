import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";

type TxClient = Prisma.TransactionClient;

// Simple fixed per-batch overhead allocation (labour + gas/power), as the
// problem statement allows for this scope: "no single mandated number, but
// the run must produce a figure with its valuation method and
// overhead-allocation rule stated". Rule: ₹500/batch, moving weighted-average
// for materials — both stated here and in the README.
export const OVERHEAD_PAISE_PER_BATCH = 50_000;

const MATERIAL_COST_SOURCES = ["PRODUCTION_ISSUE", "PRODUCTION_PACKAGING", "PRODUCTION_DAMAGE"] as const;

// Finished-goods unit cost = (raw material + packaging + damaged-packaging
// cost actually incurred by this run, at the moving-average rate prevailing
// when each was issued) + a fixed per-batch overhead, spread over the
// actual output. Reads only stock_movements already posted for this run —
// never a hand-maintained duplicate of the ledger.
export async function computeOutputCostPaise(
  tx: TxClient,
  runId: string,
  batchSize: number,
  overheadPaiseOverride?: number,
  laborCostPaise?: number,
) {
  const agg = await tx.stockMovement.aggregate({
    where: { sourceId: runId, source: { in: [...MATERIAL_COST_SOURCES] } },
    _sum: { totalCostPaise: true },
  });
  const materialCostPaise = Math.abs(agg._sum.totalCostPaise ?? 0);
  const overheadPaise = overheadPaiseOverride ?? OVERHEAD_PAISE_PER_BATCH * batchSize;
  return materialCostPaise + overheadPaise + (laborCostPaise ?? 0);
}

type CostLine = { itemId: string; sku: string; name: string; qtyBase: number; unitCostPaise: number; totalCostPaise: number };

// Every number here comes from StockMovement rows already posted when the
// run completed (each carrying the moving-average cost in effect at that
// moment) or from the run's own laborCostPaise/overheadCostPaise/output
// snapshot — never recomputed against today's BOM or purchase prices. That's
// what makes a completed run's displayed cost permanent.
export async function getProductionRunCostBreakdown(runId: string) {
  const run = await prisma.productionRun.findUnique({
    where: { id: runId },
    include: {
      bomHeader: { include: { lines: { include: { rawItem: true } } } },
      packSize: { include: { lines: true } },
    },
  });
  if (!run) {
    throw new AppError(404, "not_found", "Production run not found");
  }
  if (run.status !== "COMPLETED" || run.actualOutputQty === null) {
    return null;
  }

  const movements = await prisma.stockMovement.findMany({
    where: { sourceId: runId, source: { in: [...MATERIAL_COST_SOURCES, "PRODUCTION_OUTPUT"] } },
    include: { item: true },
  });

  const rawItemIds = new Set(run.bomHeader.lines.filter((l) => l.rawItem.type === "RAW_MATERIAL").map((l) => l.rawItemId));
  const packagingItemIds = new Set(
    run.packSize
      ? run.packSize.lines.map((line) => line.itemId)
      : run.bomHeader.lines.filter((l) => l.rawItem.type === "PACKAGING").map((l) => l.rawItemId),
  );

  function linesFor(itemIds: Set<string>, sources: string[]): CostLine[] {
    const byItem = new Map<string, { qtyBase: number; totalCostPaise: number; item: { id: string; sku: string; name: string } }>();
    for (const m of movements) {
      if (!itemIds.has(m.itemId) || !sources.includes(m.source)) continue;
      const entry = byItem.get(m.itemId) ?? { qtyBase: 0, totalCostPaise: 0, item: m.item };
      entry.qtyBase += Math.abs(m.qtyBase);
      entry.totalCostPaise += Math.abs(m.totalCostPaise);
      byItem.set(m.itemId, entry);
    }
    return [...byItem.values()].map((e) => ({
      itemId: e.item.id,
      sku: e.item.sku,
      name: e.item.name,
      qtyBase: e.qtyBase,
      unitCostPaise: e.qtyBase > 0 ? Math.round(e.totalCostPaise / e.qtyBase) : 0,
      totalCostPaise: e.totalCostPaise,
    }));
  }

  const materialLines = linesFor(rawItemIds, ["PRODUCTION_ISSUE"]);
  // A packaging item's consumed and damaged pouches/cartons both cost real
  // money, so they're one line here — same lumping completeProductionRun
  // already does on ProductionRunMaterial.actualQtyBase.
  const packagingLines = linesFor(packagingItemIds, ["PRODUCTION_PACKAGING", "PRODUCTION_DAMAGE"]);

  const outputMovement = movements.find((m) => m.source === "PRODUCTION_OUTPUT");
  const totalCostPaise = outputMovement?.totalCostPaise ?? 0;
  const costPerGoodUnitPaise = outputMovement?.unitCostPaise ?? 0;

  const latestInvoiceLine = await prisma.invoiceItem.findFirst({
    where: { itemId: run.packSize?.finishedItemId ?? run.bomHeader.finishedItemId },
    orderBy: { invoice: { createdAt: "desc" } },
  });

  return {
    materialLines,
    packagingLines,
    laborCostPaise: run.laborCostPaise ?? 0,
    overheadCostPaise: run.overheadCostPaise ?? OVERHEAD_PAISE_PER_BATCH * run.batchSize,
    totalCostPaise,
    goodOutputQty: run.actualOutputQty,
    costPerGoodUnitPaise,
    sellingPricePaise: latestInvoiceLine?.ratePaise ?? null,
    marginPaise: latestInvoiceLine ? latestInvoiceLine.ratePaise - costPerGoodUnitPaise : null,
  };
}
