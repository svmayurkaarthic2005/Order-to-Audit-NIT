import { describe, expect, it } from "vitest";
import { toCsv } from "./lib/export.js";
import { formatQty } from "./lib/units.js";

describe("toCsv", () => {
  it("quotes and escapes commas, quotes, and newlines", () => {
    const csv = toCsv([{ name: 'Say "hi", bye\nline2' }]);
    expect(csv).toBe('name\n"Say ""hi"", bye\nline2"');
  });

  it("neutralizes CSV/formula injection by prefixing a literal quote before =, +, -, @, tab, CR", () => {
    const rows = [
      { name: "=1+1" },
      { name: "+cmd" },
      { name: "-2+3" },
      { name: "@SUM(A1)" },
      { name: "\tindented" },
    ];
    const csv = toCsv(rows);
    const lines = csv.split("\n").slice(1); // skip header
    expect(lines[0]).toBe("'=1+1");
    expect(lines[1]).toBe("'+cmd");
    expect(lines[2]).toBe("'-2+3");
    expect(lines[3]).toBe("'@SUM(A1)");
    expect(lines[4]).toBe("'\tindented");
  });

  it("leaves ordinary values untouched, negative numbers included", () => {
    expect(toCsv([{ sku: "RM-FLOUR", qty: 100 }])).toBe("sku,qty\nRM-FLOUR,100");
    expect(toCsv([{ variance: "-6.0" }, { variance: -12 }])).toBe("variance\n-6.0\n-12");
  });

  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });

  it("shows amounts under 1 kg / 1 L in grams / ml, and larger ones in kg / L", () => {
    expect(formatQty(200, "G")).toBe("200 g");
    expect(formatQty(1_200, "G")).toBe("1.2 kg");
    expect(formatQty(500, "ML")).toBe("500 ml");
    expect(formatQty(10_500, "ML")).toBe("10.5 L");
    expect(formatQty(0, "G")).toBe("0 kg");
    expect(formatQty(200, "PIECE")).toBe("200 pieces");
  });
});
