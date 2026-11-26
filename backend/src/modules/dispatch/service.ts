import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { logAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { issueValuePaise, ledgerPosition } from "../../lib/valuation.js";
import { syncAlertsForItems } from "../alerts/service.js";
import { notifyOrderUpdate } from "../orders/service.js";
import {
  issueFromFinishedBatches,
  lockItem,
  refreshBatchStatuses,
  selectFinishedBatchesFEFO,
} from "../batches/service.js";


export async function listDispatches() {
  return prisma.dispatch.findMany({ include: { invoice: { include: { customer: true } } }, orderBy: { dispatchedAt: "desc" } });
}

// Dispatch.invoiceId is @unique, so the database itself guarantees at most
// one dispatch per invoice even under concurrent requests — the real
// protection against double-dispatch, not the pre-check below.
export async function createDispatch(invoiceId: string, qty: number, actingUserId: string, overrideReason?: string) {
  let dispatchedItemId: string | undefined;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the invoice row first: a credit note on the same invoice takes
      // the same lock, so dispatch sees its final status, never a stale one.
      await tx.$executeRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
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
      await lockItem(tx, itemId);
      const valuePaise = issueValuePaise(qty, await ledgerPosition(tx, itemId));

      const selections = await selectFinishedBatchesFEFO(itemId, qty, tx);
      await issueFromFinishedBatches(
        tx,
        dispatch.id,
        invoiceId,
        selections,
        itemId,
        qty,
        valuePaise,
        actingUserId,
        overrideReason,
      );

      const { count: shipped } = await tx.salesOrder.updateMany({
        where: { id: invoice.salesOrderId, status: "DISPATCHABLE" },
        data: { status: "DISPATCHED" },
      });
      if (shipped === 0) {
        throw new AppError(409, "invalid_status", "This order is no longer ready to dispatch");
      }

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
      await refreshBatchStatuses();
    }
    await notifyOrderUpdate(result.invoice.salesOrderId, "salesman", `Order for ${result.invoice.customer.name} dispatched`, `Invoice #${result.invoice.invoiceNumber} has left the factory.`, "dispatched");
    return result;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(409, "already_dispatched", "This invoice has already been dispatched");
    }
    throw err;
  }
}
