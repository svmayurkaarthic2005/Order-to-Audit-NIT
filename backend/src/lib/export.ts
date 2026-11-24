import PDFDocument from "pdfkit";

// A well-formed CSV opens correctly in Excel, so this one format covers
// both "Excel" and "CSV" from the spec without a binary .xlsx dependency.
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return "";
  }
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    // Formula injection: a cell opened in Excel/Sheets that starts with
    // one of these characters can be interpreted as a formula. Names in
    // this data (supplier, customer, item) are user-entered, so prefix a
    // literal quote to force text interpretation, per CSV-injection
    // mitigation guidance (OWASP).
    if (/^[=+\-@\t\r]/.test(s)) {
      s = `'${s}`;
    }
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))];
  return lines.join("\n");
}

// A simple tabular PDF — one row per line, columns space-aligned. Good
// enough for a printable report; not a styled document.
export function toPdf(title: string, rows: Record<string, unknown>[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(title);
    doc.moveDown();
    doc.fontSize(9);

    if (rows.length === 0) {
      doc.text("No data for the selected filters.");
    } else {
      const headers = Object.keys(rows[0]!);
      doc.text(headers.join(" | "));
      doc.moveDown(0.5);
      for (const row of rows) {
        doc.text(headers.map((h) => String(row[h] ?? "")).join(" | "));
      }
    }

    doc.end();
  });
}
