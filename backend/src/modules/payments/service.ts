import { AppError } from "../../lib/AppError.js";
import { logAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "@prisma/client";

const formatRupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Outstanding is always this live computation — total minus every payment
// and credit note recorded against the invoice — never a cached balance.
export async function getOutstandingPaise(invoiceId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<number> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) {
    throw new AppError(404, "not_found", "Invoice not found");
  }

  const [paymentsAgg, creditNotesAgg] = await Promise.all([
    db.payment.aggregate({ where: { invoiceId }, _sum: { amountPaise: true } }),
    db.creditNote.aggregate({ where: { invoiceId }, _sum: { amountPaise: true } }),
  ]);
  const paid = paymentsAgg._sum.amountPaise ?? 0;
  const creditedOff = creditNotesAgg._sum.amountPaise ?? 0;

  return Math.max(0, invoice.totalPaise - paid - creditedOff);
}

export async function listPayments(invoiceId?: string) {
  return prisma.payment.findMany({
    where: invoiceId ? { invoiceId } : {},
    include: { invoice: { include: { customer: true } } },
    orderBy: { paidAt: "desc" },
  });
}

// Partial payments are allowed, but never more than the invoice still owes:
// the excess would vanish from "still to collect" without a trace (a typed
// ₹38,700 for ₹3,870). Advances need their own record, which this isn't.
export async function createPayment(invoiceId: string, amountPaise: number, actingUserId: string) {
  const payment = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new AppError(404, "not_found", "Invoice not found");
    }
    if (invoice.status !== "ISSUED") {
      throw new AppError(409, "invalid_status", "Only an ISSUED invoice can receive a payment");
    }
    // Two payments at once would both see the same amount owed.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceId}))`;
    const owed = await getOutstandingPaise(invoiceId, tx);
    if (amountPaise > owed) {
      throw new AppError(
        409,
        "overpayment",
        owed === 0 ? "This invoice is already fully paid." : `This invoice only has ${formatRupees(owed)} left to pay. Enter that amount or less.`,
        { outstandingPaise: owed },
      );
    }
    const created = await tx.payment.create({ data: { invoiceId, amountPaise } });
    await logAudit(tx, { userId: actingUserId, action: "PAYMENT", entityType: "Invoice", entityId: invoiceId, after: { amountPaise } });
    return created;
  });

  const outstandingPaise = await getOutstandingPaise(invoiceId);
  return { payment, outstandingPaise };
}
