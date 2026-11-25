import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { financialYearFor } from "../invoices/service.js";
import { getProductionRunCostBreakdown } from "../production/costing.js";
import { getProductionRunVariance } from "../production/variance.js";

function dateRange(from?: Date, to?: Date) {
  if (!from && !to) return {};
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

// (1) Sales register, customer-wise and product-wise. Reads invoice totals
// and the frozen InvoiceItem snapshot directly — never recomputes GST or
// amounts, so it can never disagree with what Phase 13 actually issued.
export async function salesRegister(from?: Date, to?: Date) {
  const invoices = await prisma.invoice.findMany({
    where: { status: "ISSUED", createdAt: dateRange(from, to) },
    include: { items: true, customer: true },
  });

  const customerWise = new Map<
    string,
    { customerId: string; customerName: string; qtyBase: number; taxableValuePaise: number; totalPaise: number }
  >();
  const productWise = new Map<string, { itemId: string; description: string; qtyBase: number; taxableValuePaise: number }>();

  for (const inv of invoices) {
    const c = customerWise.get(inv.customerId) ?? {
      customerId: inv.customerId,
      customerName: inv.customer.name,
      qtyBase: 0,
      taxableValuePaise: 0,
      totalPaise: 0,
    };
    c.totalPaise += inv.totalPaise;
    for (const item of inv.items) {
      c.qtyBase += item.qtyBase;
      c.taxableValuePaise += item.taxableValuePaise;

      const p = productWise.get(item.itemId) ?? {
        itemId: item.itemId,
        description: item.description,
        qtyBase: 0,
        taxableValuePaise: 0,
      };
      p.qtyBase += item.qtyBase;
      p.taxableValuePaise += item.taxableValuePaise;
      productWise.set(item.itemId, p);
    }
    customerWise.set(inv.customerId, c);
  }

  return { customerWise: [...customerWise.values()], productWise: [...productWise.values()] };
}

// (1b) Sales trend — the Sales Register's own totals, just bucketed by
// calendar month or Indian financial year instead of flattened into one
// range. Reads the exact same ISSUED invoices salesRegister() does, so a
// trend total for a given range always reconciles with that range's Sales
// Register total — never a separate computation.
type SalesTrendBucket = { key: string; label: string; invoiceCount: number; taxableValuePaise: number; totalPaise: number };

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

export async function salesTrend(granularity: "monthly" | "yearly", from?: Date, to?: Date) {
  // "Last 12 months" is only a default for monthly when no range was given
  // — an explicit range is always respected as-is, and yearly has no
  // default window (a factory's whole invoice history is a handful of FYs).
  let effectiveFrom = from;
  let effectiveTo = to;
  if (granularity === "monthly" && !from && !to) {
    const now = new Date();
    effectiveTo = now;
    effectiveFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  }

  const invoices = await prisma.invoice.findMany({
    where: { status: "ISSUED", createdAt: dateRange(effectiveFrom, effectiveTo) },
    select: { createdAt: true, taxableValuePaise: true, totalPaise: true },
  });

  const buckets = new Map<string, SalesTrendBucket>();
  for (const inv of invoices) {
    const key = granularity === "monthly" ? monthKey(inv.createdAt) : financialYearFor(inv.createdAt);
    const label = granularity === "monthly" ? monthLabel(key) : `FY ${key}`;
    const bucket = buckets.get(key) ?? { key, label, invoiceCount: 0, taxableValuePaise: 0, totalPaise: 0 };
    bucket.invoiceCount += 1;
    bucket.taxableValuePaise += inv.taxableValuePaise;
    bucket.totalPaise += inv.totalPaise;
    buckets.set(key, bucket);
  }

  // A default monthly window shows every month in range, zero-filled, so
  // the chart doesn't silently skip a month with no sales.
  if (granularity === "monthly" && effectiveFrom) {
    const cursor = new Date(Date.UTC(effectiveFrom.getUTCFullYear(), effectiveFrom.getUTCMonth(), 1));
    const end = effectiveTo ?? new Date();
    while (cursor <= end) {
      const key = monthKey(cursor);
      if (!buckets.has(key)) {
        buckets.set(key, { key, label: monthLabel(key), invoiceCount: 0, taxableValuePaise: 0, totalPaise: 0 });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

  return { granularity, buckets: [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : 1)) };
}

// (2) GST summary of outward supplies, shaped for GSTR-1/GSTR-3B mapping.
// Totals are summed straight from each Invoice's own stored fields — the
// only numbers Phase 12/13 ever computed — never re-derived here.
export async function gstSummary(from?: Date, to?: Date) {
  const invoices = await prisma.invoice.findMany({
    where: { status: "ISSUED", createdAt: dateRange(from, to) },
    include: { items: true },
  });

  const totals = invoices.reduce(
    (acc, inv) => ({
      taxableValuePaise: acc.taxableValuePaise + inv.taxableValuePaise,
      cgstPaise: acc.cgstPaise + inv.cgstPaise,
      sgstPaise: acc.sgstPaise + inv.sgstPaise,
      igstPaise: acc.igstPaise + inv.igstPaise,
      totalPaise: acc.totalPaise + inv.totalPaise,
    }),
    { taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 },
  );

  // Rate-wise taxable value, grouping already-frozen InvoiceItem rows —
  // not a new tax computation.
  const byRate = new Map<number, number>();
  for (const inv of invoices) {
    for (const item of inv.items) {
      byRate.set(item.taxRatePct, (byRate.get(item.taxRatePct) ?? 0) + item.taxableValuePaise);
    }
  }

  return {
    totals,
    byRate: [...byRate.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([taxRatePct, taxableValuePaise]) => ({ taxRatePct, taxableValuePaise })),
    invoiceCount: invoices.length,
  };
}

// (3) Purchase register.
export async function purchaseRegister(from?: Date, to?: Date) {
  const purchases = await prisma.purchase.findMany({
    where: { createdAt: dateRange(from, to) },
    include: { supplier: true, items: { include: { item: true } } },
    orderBy: { purchaseDate: "desc" },
  });

  return purchases.map((p) => ({
    purchaseId: p.id,
    supplierName: p.supplier.name,
    purchaseDate: p.purchaseDate,
    cancelled: p.cancelledAt !== null,
    totalPaise: p.items.reduce((sum, i) => sum + i.qtyBase * i.rateBasePaise, 0),
    lineCount: p.items.length,
  }));
}

// (4) Stock summary (raw/packaging/finished goods) — on-hand is always this
// live SUM() over stock_movements, exactly like the inventory endpoint.
export async function stockSummary(type?: string) {
  const items = await prisma.item.findMany({ where: { active: true, ...(type ? { type: type as never } : {}) } });

  return Promise.all(
    items.map(async (item) => {
      const agg = await prisma.stockMovement.aggregate({
        where: { itemId: item.id },
        _sum: { qtyBase: true, totalCostPaise: true },
      });
      const qtyBase = agg._sum.qtyBase ?? 0;
      const totalCostPaise = agg._sum.totalCostPaise ?? 0;
      return {
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        type: item.type,
        baseUnit: item.baseUnit,
        qtyBase,
        // Exact value of what's on hand; the per-unit average below is
        // rounded for display, so anything that sums value must use this.
        valuePaise: totalCostPaise,
        movingAverageCostPaise: qtyBase > 0 ? Math.round(totalCostPaise / qtyBase) : null,
      };
    }),
  );
}

export async function stockLedger(itemId: string, from?: Date, to?: Date) {
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new AppError(404, "not_found", "Item not found");
  }
  return prisma.stockMovement.findMany({
    where: { itemId, createdAt: dateRange(from, to) },
    orderBy: { createdAt: "asc" },
  });
}

// (5) Production report: planned vs actual consumption, yield and wastage —
// reads only production_run_materials vs stock_movements-derived actuals
// already on that table, the same source Phase 9's variance endpoint uses.
export async function productionReport(from?: Date, to?: Date) {
  const runs = await prisma.productionRun.findMany({
    where: { createdAt: dateRange(from, to) },
    include: { bomHeader: { include: { finishedItem: true } }, materials: { include: { item: true } } },
  });

  return runs.map((r) => {
    const plannedYield = r.bomHeader.expectedYieldQty * r.batchSize;
    const actualYield = r.actualOutputQty;
    const yieldVariancePct = actualYield !== null && plannedYield > 0 ? (actualYield - plannedYield) / plannedYield : null;

    return {
      runId: r.id,
      finishedGoodSku: r.bomHeader.finishedItem.sku,
      status: r.status,
      batchSize: r.batchSize,
      plannedYield,
      actualYield,
      yieldVariancePct,
      damagedQty: r.damagedQty,
      materials: r.materials
        .filter((m) => m.actualQtyBase !== null)
        .map((m) => ({
          sku: m.item.sku,
          plannedQtyBase: m.plannedQtyBase,
          actualQtyBase: m.actualQtyBase,
          variancePct: m.plannedQtyBase > 0 ? ((m.actualQtyBase as number) - m.plannedQtyBase) / m.plannedQtyBase : null,
        })),
    };
  });
}

// (6) Payments and collections — outstanding (receivables) by customer with
// ageing. Outstanding per invoice is the same live computation Phase 15's
// own GET /invoices/:id/outstanding uses.
type AgeingBucket = "0-30" | "31-60" | "61-90" | "90+";
type CustomerAgeing = {
  customerId: string;
  customerName: string;
  outstandingPaise: number;
  "0-30": number;
  "31-60": number;
  "61-90": number;
  "90+": number;
};

export async function paymentsCollections() {
  const invoices = await prisma.invoice.findMany({
    where: { status: "ISSUED" },
    include: { customer: true, payments: true, creditNotes: true },
  });

  const now = Date.now();
  const byCustomer = new Map<string, CustomerAgeing>();

  for (const inv of invoices) {
    const paid = inv.payments.reduce((sum, p) => sum + p.amountPaise, 0);
    const credited = inv.creditNotes.reduce((sum, c) => sum + c.amountPaise, 0);
    const outstanding = Math.max(0, inv.totalPaise - paid - credited);
    if (outstanding === 0) continue;

    const days = Math.floor((now - inv.createdAt.getTime()) / 86_400_000);
    const bucket: AgeingBucket = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";

    const entry: CustomerAgeing = byCustomer.get(inv.customerId) ?? {
      customerId: inv.customerId,
      customerName: inv.customer.name,
      outstandingPaise: 0,
      "0-30": 0,
      "31-60": 0,
      "61-90": 0,
      "90+": 0,
    };
    entry.outstandingPaise += outstanding;
    entry[bucket] += outstanding;
    byCustomer.set(inv.customerId, entry);
  }

  return [...byCustomer.values()];
}

// ── Drill-downs: the rows behind one aggregate cell in a report above.
// Every number here is summed straight from the same frozen Invoice/Payment/
// CreditNote/StockMovement rows the summary itself reads — never re-derived,
// so a drill-down total always reconciles exactly with the cell it expands.

// (stock-ledger detail is the existing stockLedger(itemId, from, to) above —
// the summary report just didn't link to it yet; see Reports.tsx.)

export async function getInvoicePaymentDetail(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { customer: true, payments: true, creditNotes: true },
  });
  if (!invoice) {
    throw new AppError(404, "not_found", "Invoice not found");
  }
  const paidPaise = invoice.payments.reduce((sum, p) => sum + p.amountPaise, 0);
  const creditedPaise = invoice.creditNotes.reduce((sum, c) => sum + c.amountPaise, 0);
  return {
    invoiceId: invoice.id,
    customerName: invoice.customer.name,
    financialYear: invoice.financialYear,
    invoiceNumber: invoice.invoiceNumber,
    taxableValuePaise: invoice.taxableValuePaise,
    cgstPaise: invoice.cgstPaise,
    sgstPaise: invoice.sgstPaise,
    igstPaise: invoice.igstPaise,
    totalPaise: invoice.totalPaise,
    payments: invoice.payments.map((p) => ({ id: p.id, amountPaise: p.amountPaise, paidAt: p.paidAt })),
    creditNotes: invoice.creditNotes.map((c) => ({ id: c.id, amountPaise: c.amountPaise, reason: c.reason, createdAt: c.createdAt })),
    paidPaise,
    creditedPaise,
    outstandingPaise: Math.max(0, invoice.totalPaise - paidPaise - creditedPaise),
  };
}

// The Payments & Collections row is per-customer, not per-invoice — its
// outstandingPaise cell decomposes into this customer's own outstanding
// invoices, each itself expandable via getInvoicePaymentDetail above.
export async function getCustomerOutstandingDetail(customerId: string) {
  const invoiceIds = (
    await prisma.invoice.findMany({
      where: { customerId, status: "ISSUED" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })
  ).map((i) => i.id);
  const details = await Promise.all(invoiceIds.map(getInvoicePaymentDetail));
  return details.filter((d) => d.outstandingPaise > 0);
}

export async function getProductionCostDetail(runId: string) {
  const [variance, cost] = await Promise.all([getProductionRunVariance(runId), getProductionRunCostBreakdown(runId)]);
  return { variance, cost };
}

// The Sales Register's customer-wise row decomposes into that customer's
// own issued invoices in the same date range.
export async function getCustomerSalesDetail(customerId: string, from?: Date, to?: Date) {
  const invoices = await prisma.invoice.findMany({
    where: { customerId, status: "ISSUED", createdAt: dateRange(from, to) },
    orderBy: { createdAt: "asc" },
  });
  return invoices.map((inv) => ({
    invoiceId: inv.id,
    financialYear: inv.financialYear,
    invoiceNumber: inv.invoiceNumber,
    taxableValuePaise: inv.taxableValuePaise,
    totalPaise: inv.totalPaise,
    createdAt: inv.createdAt,
  }));
}

// The GST Summary's per-rate taxable-value cell decomposes into the
// InvoiceItem lines actually taxed at that rate, in the same date range.
export async function getGstRateDetail(taxRatePct: number, from?: Date, to?: Date) {
  const items = await prisma.invoiceItem.findMany({
    where: { taxRatePct, invoice: { status: "ISSUED", createdAt: dateRange(from, to) } },
    include: { invoice: { include: { customer: true } } },
    orderBy: { invoice: { createdAt: "asc" } },
  });
  return items.map((item) => ({
    invoiceId: item.invoiceId,
    invoiceNumber: item.invoice.invoiceNumber,
    customerName: item.invoice.customer.name,
    description: item.description,
    qtyBase: item.qtyBase,
    taxableValuePaise: item.taxableValuePaise,
  }));
}
