import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SEED_PASSWORD_HASH = bcrypt.hashSync("password123", 10);

async function upsertUser(email: string, name: string, role: "SALESMAN" | "ADMIN" | "PRODUCTION" | "ACCOUNTANT" | "OWNER") {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role, passwordHash: SEED_PASSWORD_HASH },
  });
}

async function upsertItem(data: {
  sku: string;
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD";
  baseUnit: "G" | "ML" | "PIECE";
  hsnCode?: string;
  taxRatePct?: number;
}) {
  return prisma.item.upsert({
    where: { sku: data.sku },
    update: {},
    create: data,
  });
}

// totalCostPaise is the integer of record; unitCostPaise is derived and rounded
// for display only — unit-level paise can't always divide evenly.
async function postOpeningStock(itemId: string, qtyBase: number, totalCostPaise: number) {
  const existing = await prisma.stockMovement.findFirst({
    where: { itemId, source: "OPENING_STOCK" },
  });
  if (existing) return existing;
  return prisma.stockMovement.create({
    data: {
      itemId,
      qtyBase,
      unitCostPaise: qtyBase > 0 ? Math.round(totalCostPaise / qtyBase) : 0,
      totalCostPaise,
      source: "OPENING_STOCK",
      openingStockItemId: itemId,
    },
  });
}

async function main() {
  // --- users: one per role ---
  await upsertUser("salesman@porulottam.test", "Salesman A", "SALESMAN");
  await upsertUser("admin@porulottam.test", "Factory Admin", "ADMIN");
  await upsertUser("production@porulottam.test", "Production Supervisor", "PRODUCTION");
  await upsertUser("accountant@porulottam.test", "Accountant", "ACCOUNTANT");
  await upsertUser("owner@porulottam.test", "Owner", "OWNER");

  // --- customers (benchmark scenario) ---
  const retailerA = await prisma.customer.upsert({
    where: { id: "retailer-a" },
    update: {},
    create: { id: "retailer-a", name: "Retailer A", state: "Tamil Nadu", gstin: "33AAAAA0000A1Z5" },
  });
  const distributorB = await prisma.customer.upsert({
    where: { id: "distributor-b" },
    update: {},
    create: { id: "distributor-b", name: "Distributor B", state: "Karnataka", gstin: "29BBBBB0000B1Z5" },
  });

  // --- supplier ---
  await prisma.supplier.upsert({
    where: { id: "general-supplier" },
    update: { gstin: "33DDDDD0000D1Z5" },
    create: { id: "general-supplier", name: "General Raw Material Supplier", state: "Tamil Nadu", gstin: "33DDDDD0000D1Z5" },
  });

  // --- items: base unit is the smallest unit so quantities stay integers ---
  const flour = await upsertItem({ sku: "RM-FLOUR", name: "Flour", type: "RAW_MATERIAL", baseUnit: "G" });
  const oil = await upsertItem({ sku: "RM-OIL", name: "Cooking oil", type: "RAW_MATERIAL", baseUnit: "ML" });
  const spiceMix = await upsertItem({ sku: "RM-SPICE", name: "Spice mix", type: "RAW_MATERIAL", baseUnit: "G" });
  const pouches = await upsertItem({ sku: "PKG-POUCH-200G", name: "200 g pouch", type: "PACKAGING", baseUnit: "PIECE" });
  const cartons = await upsertItem({ sku: "PKG-CARTON-20", name: "Carton (holds 20 packets)", type: "PACKAGING", baseUnit: "PIECE" });
  const murukku200g = await upsertItem({
    sku: "FG-MURUKKU-200G",
    name: "Murukku 200 g",
    type: "FINISHED_GOOD",
    baseUnit: "PIECE",
    hsnCode: "19059090",
    taxRatePct: 5,
  });

  // --- unit conversions ---
  // global: kg <-> g, L <-> ml (itemId null, so a plain unique upsert doesn't apply — find-or-create instead)
  const ensureGlobalConversion = async (label: string, factor: number) => {
    const existing = await prisma.unitConversion.findFirst({ where: { itemId: null, label } });
    if (existing) return existing;
    return prisma.unitConversion.create({ data: { itemId: null, label, factor } });
  };
  await ensureGlobalConversion("kg", 1000); // 1 kg = 1000 g
  await ensureGlobalConversion("L", 1000); // 1 L = 1000 ml

  // item-specific: 1 carton = 20 packets of this finished good
  await prisma.unitConversion.upsert({
    where: { itemId_label: { itemId: murukku200g.id, label: "carton" } },
    update: {},
    create: { itemId: murukku200g.id, label: "carton", factor: 20 },
  });

  // --- opening stock (benchmark section 5) ---
  // qty in base units; cost is the TOTAL in paise (exact), unit cost is derived/rounded
  await postOpeningStock(flour.id, 100_000, 100 * 45_00); // 100 kg @ Rs45/kg
  await postOpeningStock(oil.id, 30_000, 30 * 140_00); // 30 L @ Rs140/L
  await postOpeningStock(spiceMix.id, 5_000, 0);
  await postOpeningStock(pouches.id, 500, 500 * 2_50); // Rs 2.50 each
  await postOpeningStock(cartons.id, 30, 30 * 15_00); // Rs 15 each
  await postOpeningStock(murukku200g.id, 50, 0); // opening finished-goods stock

  // --- BOM: Murukku 200 g, one batch = 200 packets expected ---
  const bom = await prisma.bomHeader.upsert({
    where: { id: "bom-murukku-200g" },
    update: {},
    create: { id: "bom-murukku-200g", finishedItemId: murukku200g.id, expectedYieldQty: 200 },
  });
  const bomLines: Array<[string, number]> = [
    [flour.id, 40_000], // 40 kg
    [oil.id, 10_000], // 10 L
    [spiceMix.id, 1_200], // 1.2 kg
    [pouches.id, 200], // 200 pieces
    [cartons.id, 10], // 10 cartons
  ];
  for (const [rawItemId, qtyPerBatch] of bomLines) {
    await prisma.bomLine.upsert({
      where: { bomHeaderId_rawItemId: { bomHeaderId: bom.id, rawItemId } },
      update: { qtyPerBatch },
      create: { bomHeaderId: bom.id, rawItemId, qtyPerBatch },
    });
  }

  await prisma.packSize.upsert({
    where: { finishedItemId_label: { finishedItemId: murukku200g.id, label: "200g" } },
    update: {},
    create: { finishedItemId: murukku200g.id, baseBomId: bom.id, multiplier: 1, label: "200g" },
  });

  console.log("Seed complete.", {
    users: 5,
    customers: [retailerA.name, distributorB.name],
    items: [flour.name, oil.name, spiceMix.name, pouches.name, cartons.name, murukku200g.name],
    bom: bom.id,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
