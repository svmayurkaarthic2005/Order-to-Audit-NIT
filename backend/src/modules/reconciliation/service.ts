import type { ExceptionStatus } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { logAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { getOnHandQty } from "../inventory/service.js";
import { getProductionRunVariance, TOLERANCE_PCT } from "../production/variance.js";
import { getOutstandingPaise } from "../payments/service.js";

type CheckResult = {
  checkType: "STOCK" | "PRODUCTION_VARIANCE" | "PACKAGING" | "INVOICE" | "DISPATCH";
  sourceType: string;
  sourceId: string;
  expectedValue: string;
  actualValue: string;
  differenceValue: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
};

type DateRange = { dateFrom?: Date; dateTo?: Date };

// Every StockMovement.source bucketed into the ledger's four conceptual
// phases. If a mismatch between this breakdown and the plain sum ever
// shows up, a new StockMovementSource was added somewhere without being
// bucketed here — this is a ledger-completeness check, not a business rule.
const RECEIPT_SOURCES = ["OPENING_STOCK", "PURCHASE", "PRODUCTION_OUTPUT", "PRODUCTION_ISSUE_REVERSAL"];
const ISSUE_SOURCES = ["PRODUCTION_ISSUE", "PRODUCTION_PACKAGING", "PRODUCTION_DAMAGE", "PURCHASE_REVERSAL"];
const DISPATCH_SOURCES = ["DISPATCH"];
const ADJUSTMENT_SOURCES = ["ADJUSTMENT"];

export async function checkStockReconciliation(itemId: string): Promise<CheckResult | null> {
  const [receipts, issues, dispatches, adjustments, actual] = await Promise.all([
    sumMovements(itemId, RECEIPT_SOURCES),
    sumMovements(itemId, ISSUE_SOURCES),
    sumMovements(itemId, DISPATCH_SOURCES),
    sumMovements(itemId, ADJUSTMENT_SOURCES),
    getOnHandQty(prisma, itemId),
  ]);
  const expected = receipts + issues + dispatches + adjustments;
  const diff = actual - expected;
  if (diff === 0) return null;
  return {
    checkType: "STOCK",
    sourceType: "Item",
    sourceId: itemId,
    expectedValue: String(expected),
    actualValue: String(actual),
    differenceValue: String(diff),
    severity: "CRITICAL",
  };
}

async function sumMovements(itemId: string, sources: string[]): Promise<number> {
  const agg = await prisma.stockMovement.aggregate({
    where: { itemId, source: { in: sources as never[] } },
    _sum: { qtyBase: true },
  });
  return agg._sum.qtyBase ?? 0;
}

export async function checkProductionVariance(runId: string): Promise<CheckResult[]> {
  const { materials, yield: yieldVariance } = await getProductionRunVariance(runId);
  const results: CheckResult[] = [];

  for (const m of materials) {
    if (!m.flagged) continue;
    results.push({
      checkType: "PRODUCTION_VARIANCE",
      sourceType: "ProductionRunMaterial",
      sourceId: `${runId}:${m.itemId}`,
      expectedValue: String(m.planned),
      actualValue: String(m.actual),
      differenceValue: `${(m.variancePct * 100).toFixed(1)}%`,
      severity: Math.abs(m.variancePct) > TOLERANCE_PCT * 2 ? "CRITICAL" : "WARNING",
    });
  }

  if (yieldVariance?.flagged) {
    results.push({
      checkType: "PRODUCTION_VARIANCE",
      sourceType: "ProductionRun",
      sourceId: runId,
      expectedValue: String(yieldVariance.planned),
      actualValue: String(yieldVariance.actual),
      differenceValue: `${(yieldVariance.variancePct * 100).toFixed(1)}%`,
      severity: Math.abs(yieldVariance.variancePct) > TOLERANCE_PCT * 2 ? "CRITICAL" : "WARNING",
    });
  }

  return results;
}

// Pouches actually consumed/damaged vs. cartons actually consumed × the
// finished item's declared carton capacity (UnitConversion, label "carton").
// A run with no carton line on its BOM has nothing to check against, so
// it's simply not applicable rather than flagged.
export async function checkPackagingReconciliation(runId: string): Promise<CheckResult | null> {
  const run = await prisma.productionRun.findUnique({
    where: { id: runId },
    include: { materials: { include: { item: true } }, bomHeader: true },
  });
  if (!run || run.status !== "COMPLETED") return null;

  const cartonConversion = await prisma.unitConversion.findFirst({
    where: { itemId: run.bomHeader.finishedItemId, label: { contains: "carton", mode: "insensitive" } },
  });
  if (!cartonConversion) return null;

  const packagingMaterials = run.materials.filter((m) => m.item.type === "PACKAGING" && m.actualQtyBase !== null);
  const cartonLine = packagingMaterials.find((m) => m.item.name.toLowerCase().includes("carton"));
  if (!cartonLine) return null;

  const pouchesConsumed = packagingMaterials
    .filter((m) => m.id !== cartonLine.id)
    .reduce((sum, m) => sum + (m.actualQtyBase ?? 0), 0);
  const cartonsConsumed = cartonLine.actualQtyBase ?? 0;
  const capacity = cartonsConsumed * cartonConversion.factor;
  const diff = pouchesConsumed - capacity;
  if (diff === 0) return null;

  return {
    checkType: "PACKAGING",
    sourceType: "ProductionRun",
    sourceId: runId,
    expectedValue: String(capacity),
    actualValue: String(pouchesConsumed),
    differenceValue: String(diff),
    severity: Math.abs(diff) > cartonConversion.factor ? "CRITICAL" : "WARNING",
  };
}

// Confirms the invoice's own GST breakdown still sums to its total — the
// one invariant createInvoice guarantees at write time and never revisits.
export async function checkInvoicePaymentReconciliation(invoiceId: string): Promise<CheckResult | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new AppError(404, "not_found", "Invoice not found");

  const gstSum = invoice.taxableValuePaise + invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise;
  const diff = invoice.totalPaise - gstSum;
  if (diff === 0) return null;

  return {
    checkType: "INVOICE",
    sourceType: "Invoice",
    sourceId: invoiceId,
    expectedValue: String(invoice.totalPaise),
    actualValue: String(gstSum),
    differenceValue: String(diff),
    severity: "CRITICAL",
  };
}

// Confirms a dispatch's quantity matches its (single-line) invoice and
// that the order it fulfills actually made it to DISPATCHED.
export async function checkDispatchReconciliation(dispatchId: string): Promise<CheckResult | null> {
  const dispatch = await prisma.dispatch.findUnique({
    where: { id: dispatchId },
    include: { invoice: { include: { items: true, salesOrder: true } } },
  });
  if (!dispatch) throw new AppError(404, "not_found", "Dispatch not found");

  const invoicedQty = dispatch.invoice.items.reduce((sum, i) => sum + i.qtyBase, 0);
  const orderStatus = dispatch.invoice.salesOrder.status;
  if (dispatch.qtyBase === invoicedQty && orderStatus === "DISPATCHED") return null;

  return {
    checkType: "DISPATCH",
    sourceType: "Dispatch",
    sourceId: dispatchId,
    expectedValue: `qty=${invoicedQty}, order=DISPATCHED`,
    actualValue: `qty=${dispatch.qtyBase}, order=${orderStatus}`,
    differenceValue: String(dispatch.qtyBase - invoicedQty),
    severity: "WARNING",
  };
}

// A RESOLVED exception that recurs needs attention again; one still OPEN
// or under REVIEW keeps its status (re-running never bumps a human's
// review back to square one).
async function upsertException(result: CheckResult) {
  const dedupeKey = `${result.checkType}:${result.sourceId}`;
  const existing = await prisma.reconciliationException.findUnique({ where: { dedupeKey } });
  const status: ExceptionStatus = existing?.status === "RESOLVED" || !existing ? "OPEN" : existing.status;
  await prisma.reconciliationException.upsert({
    where: { dedupeKey },
    update: {
      expectedValue: result.expectedValue,
      actualValue: result.actualValue,
      differenceValue: result.differenceValue,
      severity: result.severity,
      status,
    },
    create: {
      dedupeKey,
      checkType: result.checkType,
      sourceType: result.sourceType,
      sourceId: result.sourceId,
      expectedValue: result.expectedValue,
      actualValue: result.actualValue,
      differenceValue: result.differenceValue,
      severity: result.severity,
    },
  });
}

export async function runAllChecks(range: DateRange = {}) {
  const createdAtFilter = range.dateFrom || range.dateTo ? { gte: range.dateFrom, lte: range.dateTo } : undefined;

  const [items, runs, invoices, dispatches] = await Promise.all([
    prisma.item.findMany({ where: { active: true } }),
    prisma.productionRun.findMany({
      where: { status: "COMPLETED", ...(createdAtFilter ? { completedAt: createdAtFilter } : {}) },
    }),
    prisma.invoice.findMany({ where: createdAtFilter ? { createdAt: createdAtFilter } : {} }),
    prisma.dispatch.findMany({ where: createdAtFilter ? { dispatchedAt: createdAtFilter } : {} }),
  ]);

  const results: CheckResult[] = [];
  for (const item of items) {
    const r = await checkStockReconciliation(item.id);
    if (r) results.push(r);
  }
  for (const run of runs) {
    results.push(...(await checkProductionVariance(run.id)));
    const packaging = await checkPackagingReconciliation(run.id);
    if (packaging) results.push(packaging);
  }
  for (const invoice of invoices) {
    const r = await checkInvoicePaymentReconciliation(invoice.id);
    if (r) results.push(r);
  }
  for (const dispatch of dispatches) {
    const r = await checkDispatchReconciliation(dispatch.id);
    if (r) results.push(r);
  }

  for (const result of results) {
    await upsertException(result);
  }

  const totalChecked = items.length + runs.length * 2 + invoices.length + dispatches.length;
  return {
    total: totalChecked,
    passed: totalChecked - results.length,
    warnings: results.filter((r) => r.severity === "WARNING").length,
    critical: results.filter((r) => r.severity === "CRITICAL").length,
  };
}

export async function listExceptions(filters: { status?: ExceptionStatus; checkType?: string }) {
  return prisma.reconciliationException.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.checkType ? { checkType: filters.checkType } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

// Never touches the source transaction it was raised against — only this
// row. That's the whole point of keeping reconciliation read-only.
export async function reviewException(
  id: string,
  data: { status: ExceptionStatus; explanation?: string; resolutionNote?: string },
  actingUserId: string,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.reconciliationException.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "Exception not found");

    const updated = await tx.reconciliationException.update({
      where: { id },
      data: {
        status: data.status,
        explanation: data.explanation ?? existing.explanation,
        resolutionNote: data.resolutionNote ?? existing.resolutionNote,
        reviewedByUserId: actingUserId,
        reviewedAt: new Date(),
      },
    });
    await logAudit(tx, {
      userId: actingUserId,
      action: "UPDATE",
      entityType: "ReconciliationException",
      entityId: id,
      before: { status: existing.status },
      after: { status: updated.status, explanation: updated.explanation, resolutionNote: updated.resolutionNote },
    });
    return updated;
  });
}
