import { describe, expect, it } from "vitest";
import { calculate } from "./modules/gst/calculate.js";

describe("gst.calculate", () => {
  it("Retailer A's exact benchmark order (same state) totals exactly ₹7,875 via CGST+SGST", () => {
    const result = calculate(
      [{ qtyBase: 150, ratePaise: 5_000, taxRatePct: 5 }], // 150 packets @ ₹50, 5% GST
      "Tamil Nadu",
      "Tamil Nadu",
    );
    expect(result.taxableValuePaise).toBe(750_000); // ₹7,500
    expect(result.cgstPaise).toBe(18_750); // ₹187.50
    expect(result.sgstPaise).toBe(18_750); // ₹187.50
    expect(result.igstPaise).toBe(0);
    expect(result.totalPaise).toBe(787_500); // ₹7,875 exactly
  });

  it("an interstate (different-state) customer is charged IGST instead, with CGST/SGST both zero", () => {
    const result = calculate([{ qtyBase: 120, ratePaise: 5_500, taxRatePct: 5 }], "Tamil Nadu", "Karnataka");
    expect(result.cgstPaise).toBe(0);
    expect(result.sgstPaise).toBe(0);
    expect(result.igstPaise).toBe(33_000); // 5% of ₹6,600
    expect(result.totalPaise).toBe(result.taxableValuePaise + result.igstPaise);
  });

  it("sums multiple line items, each at its own tax rate, in integer paise only", () => {
    const result = calculate(
      [
        { qtyBase: 10, ratePaise: 1_000, taxRatePct: 5 },
        { qtyBase: 3, ratePaise: 333, taxRatePct: 12 },
      ],
      "Tamil Nadu",
      "Tamil Nadu",
    );
    const expectedTax = Math.round((10 * 1_000 * 5) / 100) + Math.round((3 * 333 * 12) / 100);
    expect(result.cgstPaise + result.sgstPaise).toBe(expectedTax);
    expect(Number.isInteger(result.totalPaise)).toBe(true);
  });

  it("is a pure function: identical inputs always produce identical output, no hidden state", () => {
    const items = [{ qtyBase: 7, ratePaise: 999, taxRatePct: 5 }];
    const a = calculate(items, "Tamil Nadu", "Tamil Nadu");
    const b = calculate(items, "Tamil Nadu", "Tamil Nadu");
    expect(a).toEqual(b);
  });
});
