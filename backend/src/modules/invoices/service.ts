import { AppError } from "../../lib/AppError.js";
import { logAudit } from "../../lib/audit.js";
import { sendMail } from "../../lib/mailer.js";
import { prisma } from "../../lib/prisma.js";
import { InvoicePdfNotFoundError, uploadInvoicePdf, urlForInvoicePdf } from "../../lib/storage.js";
import { calculate } from "../gst/calculate.js";
import { getOutstandingPaise } from "../payments/service.js";
import { MANUFACTURER_NAME, renderInvoicePdf } from "./pdf.js";
import { createShareToken, verifyShareToken } from "./share.js";

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The factory's own state for CGST+SGST vs IGST determination — never
// configured per-invoice, so a dev fallback is fine here (same pattern as
// JWT_SECRET's dev fallback).
const MANUFACTURER_STATE = process.env.MANUFACTURER_STATE ?? "Tamil Nadu";

// Indian financial year runs April 1 – March 31, e.g. "2026-27" for any
// date from 2026-04-01 through 2027-03-31.
export function financialYearFor(date: Date): string {
  const year = date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

const includeClause = {
  items: { include: { item: true } },
  customer: true,
  creditNotes: true,
  payments: true,
} as const;

export async function listInvoices() {
  return prisma.invoice.findMany({ include: includeClause, orderBy: { createdAt: "desc" } });
}

export async function getInvoice(id: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: includeClause });
  if (!invoice) {
    throw new AppError(404, "not_found", "Invoice not found");
  }
  return invoice;
}

// Locks the invoice_sequences row for the current FY (via an atomic
// UPDATE ... SET lastNumber = lastNumber + 1, which Postgres serializes at
// the row level) so two concurrent invoice creations in the same FY can
// never collide or skip a number. Invoice items are a frozen snapshot —
// nothing in this module ever updates an InvoiceItem after creation.
export async function createInvoice(orderId: string, actingUserId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUnique({
      where: { id: orderId },
      include: { items: { include: { item: true } }, customer: true },
    });
    if (!order) {
      throw new AppError(404, "not_found", "Order not found");
    }

    const { count } = await tx.salesOrder.updateMany({
      where: { id: orderId, status: "APPROVED" },
      data: { status: "DISPATCHABLE" },
    });
    if (count === 0) {
      throw new AppError(409, "invalid_status", "Only an APPROVED order can be invoiced");
    }

    const financialYear = financialYearFor(new Date());
    const sequence = await tx.invoiceSequence.upsert({
      where: { financialYear },
      create: { financialYear, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });

    const gstLineItems = order.items.map((line) => ({
      qtyBase: line.qtyBase,
      ratePaise: line.ratePaise,
      taxRatePct: line.item.taxRatePct,
    }));
    const gst = calculate(gstLineItems, MANUFACTURER_STATE, order.customer.state);

    const invoice = await tx.invoice.create({
      data: {
        salesOrderId: orderId,
        customerId: order.customerId,
        financialYear,
        invoiceNumber: sequence.lastNumber,
        taxableValuePaise: gst.taxableValuePaise,
        cgstPaise: gst.cgstPaise,
        sgstPaise: gst.sgstPaise,
        igstPaise: gst.igstPaise,
        totalPaise: gst.totalPaise,
        items: {
          create: order.items.map((line) => ({
            itemId: line.itemId,
            description: line.item.name,
            qtyBase: line.qtyBase,
            ratePaise: line.ratePaise,
            taxableValuePaise: line.qtyBase * line.ratePaise,
            hsnCode: line.item.hsnCode,
            taxRatePct: line.item.taxRatePct,
          })),
        },
      },
    });

    await logAudit(tx, {
      userId: actingUserId,
      action: "CREATE",
      entityType: "Invoice",
      entityId: invoice.id,
      after: { financialYear, invoiceNumber: sequence.lastNumber, totalPaise: gst.totalPaise },
    });

    return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: includeClause });
  });
}

// Corrections never touch the original invoice or its items — only a new
// CreditNote row, referencing it. The invoice's own status flips to
// CANCELLED so it's visibly superseded, but invoice_items is never mutated.
export async function createCreditNote(invoiceId: string, reason: string, actingUserId: string) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new AppError(404, "not_found", "Invoice not found");
    }

    const { count } = await tx.invoice.updateMany({
      where: { id: invoiceId, status: "ISSUED" },
      data: { status: "CANCELLED" },
    });
    if (count === 0) {
      throw new AppError(409, "invalid_status", "Only an ISSUED invoice can be credit-noted");
    }

    await tx.creditNote.create({
      data: { invoiceId, reason, amountPaise: invoice.totalPaise },
    });

    await logAudit(tx, {
      userId: actingUserId,
      action: "CREDIT_NOTE",
      entityType: "Invoice",
      entityId: invoiceId,
      before: { status: invoice.status },
      after: { status: "CANCELLED", reason, amountPaise: invoice.totalPaise },
    });

    return tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: includeClause });
  });
}

// pdfStoragePath holds the object KEY, never a URL — a Supabase URL is a
// short-lived signed one and would go stale if cached. Idempotent on the
// upload itself: an invoice that already has a key just gets a fresh URL
// minted for that same object instead of generating/uploading a duplicate.
// The PDF is rendered only from the invoice's own frozen fields — never a
// GST recomputation.
export async function getOrGenerateInvoicePdfUrl(invoiceId: string): Promise<string> {
  const invoice = await getInvoice(invoiceId);

  if (invoice.pdfStoragePath) {
    try {
      return await urlForInvoicePdf(invoice.pdfStoragePath);
    } catch (err) {
      // Only a missing file is recovered (e.g. it was saved to local disk
      // before Supabase storage was switched on); anything else propagates.
      if (!(err instanceof InvoicePdfNotFoundError)) throw err;
    }
  }

  const key = `${invoice.financialYear}-${invoice.invoiceNumber}-${invoice.id}.pdf`;
  await uploadInvoicePdf(key, await renderInvoicePdf(invoice));
  if (invoice.pdfStoragePath !== key) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { pdfStoragePath: key } });
  }
  return urlForInvoicePdf(key);
}

// Renders the PDF fresh from the invoice's own frozen fields (same as
// getOrGenerateInvoicePdfUrl) rather than fetching the stored copy, so
// this never depends on storage being configured.
export async function sendInvoiceEmail(invoiceId: string, actingUserId: string, overrideEmail?: string) {
  const invoice = await getInvoice(invoiceId);
  const to = overrideEmail ?? invoice.customer.email;
  if (!to) {
    throw new AppError(400, "missing_email", "This customer has no email on file; pass one explicitly to send to it once");
  }

  const pdfBuffer = await renderInvoicePdf(invoice);
  const number = `${invoice.financialYear}/${invoice.invoiceNumber}`;
  const outstandingPaise = await getOutstandingPaise(invoiceId);
  await sendMail({
    to,
    subject: `Invoice ${number} from ${MANUFACTURER_NAME}`,
    text: [
      `Dear ${invoice.customer.name},`,
      "",
      `Please find attached GST invoice ${number} for ${rupees(invoice.totalPaise)}.`,
      outstandingPaise > 0 ? `Amount due: ${rupees(outstandingPaise)}.` : "This invoice is fully paid. Thank you.",
      "",
      "Regards,",
      MANUFACTURER_NAME,
    ].join("\n"),
    attachments: [{ filename: `invoice-${invoice.financialYear}-${invoice.invoiceNumber}.pdf`, content: pdfBuffer }],
  });

  await prisma.$transaction((tx) =>
    logAudit(tx, { userId: actingUserId, action: "EMAIL_SENT", entityType: "Invoice", entityId: invoiceId, after: { to } }),
  );
}

// For the WhatsApp share: a link the customer can open without an account,
// plus a ready-to-send message. baseUrl is the API's public address.
export async function getInvoiceShareLink(invoiceId: string, baseUrl: string) {
  const invoice = await getInvoice(invoiceId);
  const { expires, signature } = createShareToken(invoice.id);
  const url = `${baseUrl}/share/invoices/${invoice.id}?e=${expires}&s=${signature}`;
  const number = `${invoice.financialYear}/${invoice.invoiceNumber}`;
  const message = `Invoice ${number} from ${MANUFACTURER_NAME} for ${rupees(invoice.totalPaise)}. View or download it here: ${url}`;
  return { url, message, expiresAt: new Date(expires * 1000) };
}

// Returns null for a bad or expired link so the caller can answer 404
// without revealing whether the invoice exists.
export async function renderSharedInvoicePdf(invoiceId: string, expires: number, signature: string) {
  if (!verifyShareToken(invoiceId, expires, signature)) return null;
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: includeClause });
  if (!invoice) return null;
  return { invoice, pdf: await renderInvoicePdf(invoice) };
}
