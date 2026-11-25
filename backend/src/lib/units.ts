// Stock is stored in grams, millilitres and pieces; messages people read
// should say kg, litres and pieces (same rule as the frontend's qty()).
export function formatQty(qtyBase: number, baseUnit: string): string {
  if (baseUnit === "G") return `${(qtyBase / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`;
  if (baseUnit === "ML") return `${(qtyBase / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 })} L`;
  return `${qtyBase.toLocaleString("en-IN")} ${qtyBase === 1 ? "piece" : "pieces"}`;
}
