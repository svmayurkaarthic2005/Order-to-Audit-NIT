import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";

// Universal factors relative to that unit's own base family — these never
// vary by item (1 kg is always 1000 g, everywhere).
const GLOBAL_FACTORS: Record<string, number> = {
  kg: 1000,
  g: 1,
  l: 1000,
  litre: 1000,
  litres: 1000,
  ml: 1,
  piece: 1,
  pieces: 1,
  packet: 1,
  packets: 1,
};

function normalize(unit: string): string {
  return unit.trim().toLowerCase();
}

async function itemFactor(unit: string, itemId: string): Promise<number> {
  const row = await prisma.unitConversion.findFirst({ where: { itemId, label: { equals: unit, mode: "insensitive" } } });
  if (!row) {
    throw new AppError(400, "unknown_unit", `No conversion is defined for unit "${unit}" on this item`);
  }
  return row.factor;
}

// How many base units one `unit` equals, for this item (e.g. "carton" -> 20
// for a finished good whose base unit is PIECE and whose carton holds 20).
async function factorToBase(unit: string, itemId?: string): Promise<number> {
  const key = normalize(unit);
  if (key in GLOBAL_FACTORS) return GLOBAL_FACTORS[key];
  if (!itemId) {
    throw new AppError(400, "unknown_unit", `Unit "${unit}" is item-specific; an itemId is required`);
  }
  return itemFactor(key, itemId);
}

export async function toBaseQty(qty: number, unit: string, itemId?: string): Promise<number> {
  const factor = await factorToBase(unit, itemId);
  return qty * factor;
}

export async function fromBaseQty(qtyBase: number, unit: string, itemId?: string): Promise<number> {
  const factor = await factorToBase(unit, itemId);
  return qtyBase / factor;
}

// Pure (aside from the item-specific lookup) qty/fromUnit/toUnit conversion,
// pivoting through the item's base unit.
export async function convert(qty: number, fromUnit: string, toUnit: string, itemId?: string): Promise<number> {
  const base = await toBaseQty(qty, fromUnit, itemId);
  return fromBaseQty(base, toUnit, itemId);
}
