import type { Prisma } from "@prisma/client";

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
export async function computeOutputCostPaise(tx: TxClient, runId: string, batchSize: number) {
  const agg = await tx.stockMovement.aggregate({
    where: { sourceId: runId, source: { in: [...MATERIAL_COST_SOURCES] } },
    _sum: { totalCostPaise: true },
  });
  const materialCostPaise = Math.abs(agg._sum.totalCostPaise ?? 0);
  const overheadPaise = OVERHEAD_PAISE_PER_BATCH * batchSize;
  return materialCostPaise + overheadPaise;
}
