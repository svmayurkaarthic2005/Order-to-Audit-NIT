import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { logAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { syncAlertsForItems } from "../alerts/service.js";

type TxClient = Prisma.TransactionClient;

async function movingAverageCostPaise(tx: TxClient, itemId: string): Promise<number> {
  const agg = await tx.stockMovement.aggregate({ where: { itemId }, _sum: { qtyBase: true, totalCostPaise: true } });
  const qty = agg._sum.qtyBase ?? 0;
  const cost = agg._sum.totalCostPaise ?? 0;
  return qty > 0 ? Math.round(cost / qty) : 0;
}

export async function listDispatches() {
  return prisma.dispatch.findMany({ include: { invoice: { include: { customer: true } } }, orderBy: { dispatchedAt: "desc" } });
}

// Dispatch.invoiceId is @unique, so the database itself guarantees at most
// one dispatch per invoice even under concurrent requests — the real
// protection against double-dispatch, not the pre-check below.
export async function createDispatch(invoiceId: string, qty: number, actingUserId: string) {
  let dispatchedItemId: string | undefined;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { items: true } });
      if (!invoice) {
        throw new AppError(404, "not_found", "Invoice not found");
      }
      if (invoice.status !== "ISSUED") {
        throw new AppError(409, "invalid_status", "Only an ISSUED invoice can be dispatched");
      }
      if (invoice.items.length !== 1) {
        throw new AppError(400, "unsupported_invoice", "Dispatch only supports a single-line invoice");
      }

      const dispatch = await tx.dispatch.create({ data: { invoiceId, qtyBase: qty } });

      const itemId = invoice.items[0]!.itemId;
      dispatchedItemId = itemId;
      const unitCostPaise = await movingAverageCostPaise(tx, itemId);
      await tx.stockMovement.create({
        data: {
          itemId,
          qtyBase: -qty,
          unitCostPaise,
          totalCostPaise: -(qty * unitCostPaise),
          source: "DISPATCH",
          sourceId: invoiceId,
        },
      });

      await tx.salesOrder.update({ where: { id: invoice.salesOrderId }, data: { status: "DISPATCHED" } });

      await logAudit(tx, {
        userId: actingUserId,
        action: "DISPATCH",
        entityType: "Invoice",
        entityId: invoiceId,
        after: { qty },
      });

      return tx.dispatch.findUniqueOrThrow({ where: { id: dispatch.id }, include: { invoice: { include: { customer: true } } } });
    });
    if (dispatchedItemId) {
      await syncAlertsForItems([dispatchedItemId]);
    }
    return result;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(409, "already_dispatched", "This invoice has already been dispatched");
    }
    throw err;
  }
}
