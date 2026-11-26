// Stock is stored in grams, millilitres and pieces; messages people read
// should say kg, litres and pieces (same rule as the frontend's qty()).
export function formatQty(qtyBase: number, baseUnit: string): string {
  // Under 1 kg / 1 L reads better as grams / ml: "200 g", not "0.2 kg".
  if ((baseUnit === "G" || baseUnit === "ML") && Math.abs(qtyBase) < 1000 && qtyBase !== 0) {
    return `${qtyBase.toLocaleString("en-IN")} ${baseUnit === "G" ? "g" : "ml"}`;
  }
  if (baseUnit === "G") return `${(qtyBase / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`;
  if (baseUnit === "ML") return `${(qtyBase / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 })} L`;
  return `${qtyBase.toLocaleString("en-IN")} ${qtyBase === 1 ? "piece" : "pieces"}`;
}
