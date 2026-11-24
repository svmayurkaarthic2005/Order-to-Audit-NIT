import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";

const PAGE_SIZE = 20;

export async function listItems(search: string | undefined, type: string | undefined, page: number) {
  const where = {
    active: true,
    ...(type ? { type: type as never } : {}),
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.item.findMany({ where, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, orderBy: { name: "asc" } }),
    prisma.item.count({ where }),
  ]);
  return { items, total };
}

export async function getItem(id: string) {
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item || !item.active) {
    throw new AppError(404, "not_found", "Item not found");
  }
  return item;
}

export async function createItem(data: {
  sku: string;
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD";
  baseUnit: "G" | "ML" | "PIECE";
  hsnCode?: string;
  taxRatePct?: number;
}) {
  const existing = await prisma.item.findUnique({ where: { sku: data.sku } });
  if (existing) {
    throw new AppError(409, "duplicate_sku", `An item with SKU ${data.sku} already exists`);
  }
  return prisma.item.create({ data });
}

export async function updateItem(
  id: string,
  data: { name?: string; type?: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD"; hsnCode?: string; taxRatePct?: number },
) {
  await getItem(id);
  return prisma.item.update({ where: { id }, data });
}

export async function deactivateItem(id: string) {
  await getItem(id);
  await prisma.item.update({ where: { id }, data: { active: false } });
}
