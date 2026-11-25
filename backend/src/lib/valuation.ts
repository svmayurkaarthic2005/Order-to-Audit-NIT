import type { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

// Moving weighted-average valuation. An outgoing quantity is valued at the
// ledger's exact ratio (total value on hand / quantity on hand), and only the
// resulting paise amount is rounded. Rounding the per-gram rate first loses
// real money: flour at ₹43.125/kg is 4.3125 paise/g, which would become
// 4 paise/g (₹40/kg) and under-cost every issue.
export type Position = { qtyBase: number; valuePaise: number };

export async function ledgerPosition(tx: TxClient, itemId: string): Promise<Position> {
  const agg = await tx.stockMovement.aggregate({ where: { itemId }, _sum: { qtyBase: true, totalCostPaise: true } });
  return { qtyBase: agg._sum.qtyBase ?? 0, valuePaise: agg._sum.totalCostPaise ?? 0 };
}

export function issueValuePaise(qtyBase: number, position: Position): number {
  if (position.qtyBase <= 0 || position.valuePaise <= 0) return 0;
  return Math.round((qtyBase * position.valuePaise) / position.qtyBase);
}

// StockMovement.unitCostPaise is a rounded per-base-unit rate kept for
// display only; totalCostPaise is the figure every report and cost sums.
export function displayUnitCostPaise(totalPaise: number, qtyBase: number): number {
  return qtyBase !== 0 ? Math.round(Math.abs(totalPaise / qtyBase)) : 0;
}

// Splits one issue's value across the batches it was drawn from so the
// parts add up to exactly the whole (cumulative rounding, never per part).
export function splitValue(totalPaise: number, parts: number[]): number[] {
  const totalQty = parts.reduce((s, q) => s + q, 0);
  let assigned = 0;
  let cumulativeQty = 0;
  return parts.map((q) => {
    cumulativeQty += q;
    const upTo = totalQty > 0 ? Math.round((cumulativeQty * totalPaise) / totalQty) : 0;
    const share = upTo - assigned;
    assigned = upTo;
    return share;
  });
}
