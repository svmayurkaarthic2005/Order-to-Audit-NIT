// The factory's state: CGST + SGST for customers in it, IGST for the rest.
export const FACTORY_STATE = process.env.MANUFACTURER_STATE ?? "Tamil Nadu";

export type GstLineItem = {
  qtyBase: number;
  ratePaise: number;
  taxRatePct: number; // each item's own GST rate, set on the item (Phase 4) — no HSN registry lookup needed here
};

export type GstResult = {
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
};

// Pure function: no DB access, no side effects — everything in integer
// paise, never floating-point money. CGST+SGST (split evenly) when the
// customer is in the same state as the supplier; IGST (the full tax, once)
// when they're in different states.
export function calculate(items: GstLineItem[], supplierState: string, customerState: string): GstResult {
  const taxableValuePaise = items.reduce((sum, item) => sum + item.qtyBase * item.ratePaise, 0);
  const totalTaxPaise = items.reduce(
    (sum, item) => sum + Math.round((item.qtyBase * item.ratePaise * item.taxRatePct) / 100),
    0,
  );

  // Compared loosely so "tamil nadu " and "Tamil Nadu" count as the same state.
  const isInterstate = supplierState.trim().toLowerCase() !== customerState.trim().toLowerCase();
  const cgstPaise = isInterstate ? 0 : Math.round(totalTaxPaise / 2);
  const sgstPaise = isInterstate ? 0 : totalTaxPaise - cgstPaise; // exact remainder, so CGST+SGST always sums to totalTaxPaise
  const igstPaise = isInterstate ? totalTaxPaise : 0;

  return {
    taxableValuePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    totalPaise: taxableValuePaise + totalTaxPaise,
  };
}
