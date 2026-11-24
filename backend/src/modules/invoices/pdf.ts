import PDFDocument from "pdfkit";

const MANUFACTURER_GSTIN = process.env.MANUFACTURER_GSTIN || "33AAAAA0000A1Z5";

type InvoiceForPdf = {
  financialYear: string;
  invoiceNumber: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  customer: { name: string; state: string; gstin: string | null };
  items: { description: string; hsnCode: string | null; qtyBase: number; ratePaise: number; taxableValuePaise: number; taxRatePct: number }[];
};

function formatRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

// Renders straight from the invoice's own frozen fields (taxableValuePaise,
// cgst/sgst/igstPaise, invoice_items) — it never recomputes GST, it only
// displays what Phase 12/13 already calculated and stored.
export function renderInvoicePdf(invoice: InvoiceForPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("TAX INVOICE", { align: "center" });
    doc.moveDown();
    doc.fontSize(10);
    doc.text(`GSTIN: ${MANUFACTURER_GSTIN}`);
    doc.text(`Invoice No: ${invoice.financialYear}/${invoice.invoiceNumber}`);
    doc.text(`Customer: ${invoice.customer.name} (${invoice.customer.state})`);
    if (invoice.customer.gstin) {
      doc.text(`Customer GSTIN: ${invoice.customer.gstin}`);
    }
    doc.moveDown();

    for (const item of invoice.items) {
      doc.text(
        `${item.description} (HSN ${item.hsnCode ?? "-"})  Qty ${item.qtyBase}  Rate Rs. ${formatRupees(item.ratePaise)}  ` +
          `Taxable Rs. ${formatRupees(item.taxableValuePaise)} @ ${item.taxRatePct}%`,
      );
    }
    doc.moveDown();

    doc.text(`Taxable Value: Rs. ${formatRupees(invoice.taxableValuePaise)}`);
    if (invoice.igstPaise > 0) {
      doc.text(`IGST: Rs. ${formatRupees(invoice.igstPaise)}`);
    } else {
      doc.text(`CGST: Rs. ${formatRupees(invoice.cgstPaise)}`);
      doc.text(`SGST: Rs. ${formatRupees(invoice.sgstPaise)}`);
    }
    doc.moveDown();
    doc.fontSize(14).text(`Total: Rs. ${formatRupees(invoice.totalPaise)}`, { underline: true });

    doc.end();
  });
}
