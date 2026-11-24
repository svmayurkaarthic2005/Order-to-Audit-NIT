import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";

const TOLERANCE_PCT = 0.03;

function variancePct(planned: number, actual: number): number {
  return planned === 0 ? 0 : (actual - planned) / planned;
}

// Reads only production_run_materials (planned) vs stock_movements-derived
// actuals already snapshotted onto that same table (actualQtyBase) — never
// a hand-maintained duplicate of the ledger.
export async function getProductionRunVariance(id: string) {
  const run = await prisma.productionRun.findUnique({
    where: { id },
    include: { bomHeader: true, materials: { include: { item: true } } },
  });
  if (!run) {
    throw new AppError(404, "not_found", "Production run not found");
  }

  const materials = run.materials
    .filter((m) => m.actualQtyBase !== null)
    .map((m) => {
      const planned = m.plannedQtyBase;
      const actual = m.actualQtyBase as number;
      const pct = variancePct(planned, actual);
      return { itemId: m.itemId, planned, actual, variancePct: pct, flagged: Math.abs(pct) > TOLERANCE_PCT };
    });

  let yieldVariance = null;
  if (run.actualOutputQty !== null) {
    const planned = run.bomHeader.expectedYieldQty * run.batchSize;
    const actual = run.actualOutputQty;
    const pct = variancePct(planned, actual);
    yieldVariance = { planned, actual, variancePct: pct, flagged: Math.abs(pct) > TOLERANCE_PCT };
  }

  return { materials, yield: yieldVariance };
}
