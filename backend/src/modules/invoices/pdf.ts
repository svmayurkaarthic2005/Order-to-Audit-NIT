import PDFDocument from "pdfkit";

const MANUFACTURER_GSTIN = process.env.MANUFACTURER_GSTIN || "33AAAAA0000A1Z5";
const MANUFACTURER_NAME = "Porulottam Foods";

type InvoiceForPdf = {
  financialYear: string;
  invoiceNumber: number;
  createdAt: Date;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  customer: { name: string; state: string; gstin: string | null };
  items: { description: string; hsnCode: string | null; qtyBase: number; ratePaise: number; taxableValuePaise: number; taxRatePct: number }[];
};

function formatRupees(paise: number): string {
  return `Rs. ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PAGE_MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4 in points
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

// Column layout for the line-items table: [x-offset from content left, width].
// Numeric columns are right-aligned within their own width, so they line up
// under their header regardless of digit count.
const COLS = {
  desc: { x: 0, width: 175 },
  hsn: { x: 175, width: 55 },
  qty: { x: 230, width: 45 },
  rate: { x: 275, width: 75 },
  taxable: { x: 350, width: 85 },
  rate_pct: { x: 435, width: 60 },
};

// Renders straight from the invoice's own frozen fields (taxableValuePaise,
// cgst/sgst/igstPaise, invoice_items) — it never recomputes GST, it only
// displays what Phase 12/13 already calculated and stored.
export function renderInvoicePdf(invoice: InvoiceForPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;

    // ── Header ──────────────────────────────────────────────────────────
    doc.fontSize(20).font("Helvetica-Bold").text(MANUFACTURER_NAME, left, doc.y);
    doc.fontSize(9).font("Helvetica").fillColor("#555").text(`GSTIN: ${MANUFACTURER_GSTIN}`);
    doc.fillColor("#000");

    doc.fontSize(18).font("Helvetica-Bold").text("TAX INVOICE", left, 50, { width: CONTENT_WIDTH, align: "right" });
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`${invoice.financialYear}/${invoice.invoiceNumber}`, left, doc.y, { width: CONTENT_WIDTH, align: "right" });
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(invoice.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), left, doc.y, {
        width: CONTENT_WIDTH,
        align: "right",
      });
    doc.fillColor("#000");

    doc.moveDown(1.5);
    doc
      .moveTo(left, doc.y)
      .lineTo(right, doc.y)
      .strokeColor("#ccc")
      .stroke();
    doc.moveDown(1);

    // ── Billed to ───────────────────────────────────────────────────────
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#555").text("BILLED TO");
    doc.fillColor("#000").fontSize(11).font("Helvetica-Bold").text(invoice.customer.name);
    doc.fontSize(10).font("Helvetica").text(invoice.customer.state);
    if (invoice.customer.gstin) {
      doc.text(`GSTIN: ${invoice.customer.gstin}`);
    }
    doc.moveDown(1.5);

    // ── Line items table ────────────────────────────────────────────────
    const tableTop = doc.y;
    const colX = (col: keyof typeof COLS) => left + COLS[col].x;

    function drawRow(
      y: number,
      cells: { desc: string; hsn: string; qty: string; rate: string; taxable: string; rate_pct: string },
      opts: { bold?: boolean; color?: string } = {},
    ) {
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(opts.color ?? "#000");
      doc.text(cells.desc, colX("desc"), y, { width: COLS.desc.width });
      doc.text(cells.hsn, colX("hsn"), y, { width: COLS.hsn.width, align: "right" });
      doc.text(cells.qty, colX("qty"), y, { width: COLS.qty.width, align: "right" });
      doc.text(cells.rate, colX("rate"), y, { width: COLS.rate.width, align: "right" });
      doc.text(cells.taxable, colX("taxable"), y, { width: COLS.taxable.width, align: "right" });
      doc.text(cells.rate_pct, colX("rate_pct"), y, { width: COLS.rate_pct.width, align: "right" });
    }

    // Header row (shaded background)
    doc.rect(left, tableTop - 4, CONTENT_WIDTH, 20).fill("#f2f2f2");
    drawRow(
      tableTop,
      { desc: "Description", hsn: "HSN", qty: "Qty", rate: "Rate", taxable: "Taxable", rate_pct: "GST %" },
      { bold: true, color: "#333" },
    );

    let rowY = tableTop + 22;
    for (const item of invoice.items) {
      drawRow(rowY, {
        desc: item.description,
        hsn: item.hsnCode ?? "-",
        qty: String(item.qtyBase),
        rate: formatRupees(item.ratePaise),
        taxable: formatRupees(item.taxableValuePaise),
        rate_pct: `${item.taxRatePct}%`,
      });
      rowY += 20;
    }

    doc
      .moveTo(left, rowY)
      .lineTo(right, rowY)
      .strokeColor("#ccc")
      .stroke();
    doc.y = rowY + 12;

    // ── Totals box ──────────────────────────────────────────────────────
    const totalsWidth = 220;
    const totalsX = right - totalsWidth;
    function totalsLine(label: string, value: string, opts: { bold?: boolean } = {}) {
      const y = doc.y;
      doc
        .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(opts.bold ? 12 : 10)
        .fillColor("#000")
        .text(label, totalsX, y, { width: totalsWidth - 90 });
      doc.text(value, totalsX + totalsWidth - 90, y, { width: 90, align: "right" });
      doc.moveDown(0.5);
    }

    totalsLine("Taxable Value", formatRupees(invoice.taxableValuePaise));
    if (invoice.igstPaise > 0) {
      totalsLine("IGST", formatRupees(invoice.igstPaise));
    } else {
      totalsLine("CGST", formatRupees(invoice.cgstPaise));
      totalsLine("SGST", formatRupees(invoice.sgstPaise));
    }
    doc
      .moveTo(totalsX, doc.y)
      .lineTo(right, doc.y)
      .strokeColor("#ccc")
      .stroke();
    doc.moveDown(0.5);
    totalsLine("Total", formatRupees(invoice.totalPaise), { bold: true });

    // ── Footer ──────────────────────────────────────────────────────────
    doc
      .fontSize(8)
      .fillColor("#888")
      .font("Helvetica")
      .text("This is a system-generated tax invoice.", left, doc.page.height - doc.page.margins.bottom - 20, {
        width: CONTENT_WIDTH,
        align: "center",
      });

    doc.end();
  });
}
