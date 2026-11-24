import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";

// Outstanding is always this live computation — total minus every payment
// and credit note recorded against the invoice — never a cached balance.
export async function getOutstandingPaise(invoiceId: string): Promise<number> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) {
    throw new AppError(404, "not_found", "Invoice not found");
  }

  const [paymentsAgg, creditNotesAgg] = await Promise.all([
    prisma.payment.aggregate({ where: { invoiceId }, _sum: { amountPaise: true } }),
    prisma.creditNote.aggregate({ where: { invoiceId }, _sum: { amountPaise: true } }),
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

// Partial payments are allowed — this never requires the payment to clear
// the invoice, and never blocks recording more once already paid in full
// (an overpayment is the business's call to resolve, not this route's).
export async function createPayment(invoiceId: string, amountPaise: number) {
  const payment = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new AppError(404, "not_found", "Invoice not found");
    }
    if (invoice.status !== "ISSUED") {
      throw new AppError(409, "invalid_status", "Only an ISSUED invoice can receive a payment");
    }
    return tx.payment.create({ data: { invoiceId, amountPaise } });
  });

  const outstandingPaise = await getOutstandingPaise(invoiceId);
  return { payment, outstandingPaise };
}
