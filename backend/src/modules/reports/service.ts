import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";

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
