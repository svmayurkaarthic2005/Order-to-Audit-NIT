import { AppError } from "../../lib/AppError.js";
import { validateGstin } from "../../lib/gstin.js";
import { prisma } from "../../lib/prisma.js";

const PAGE_SIZE = 20;

export async function listSuppliers(search: string | undefined, page: number) {
  const where = {
    active: true,
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.supplier.findMany({ where, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, orderBy: { name: "asc" } }),
    prisma.supplier.count({ where }),
  ]);
  return { items, total };
}

export async function getSupplier(id: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier || !supplier.active) {
    throw new AppError(404, "not_found", "Supplier not found");
  }
  return supplier;
}

function checkGstin(gstin: string | undefined, state: string) {
  if (!gstin) return;
  const error = validateGstin(gstin, state);
  if (error) {
    throw new AppError(400, "invalid_gstin", error);
  }
}

export async function createSupplier(data: { name: string; state: string; gstin?: string }) {
  checkGstin(data.gstin, data.state);
  return prisma.supplier.create({ data });
}

export async function updateSupplier(
  id: string,
  data: { name?: string; state?: string; gstin?: string },
) {
  const existing = await getSupplier(id);
  const state = data.state ?? existing.state;
  checkGstin(data.gstin ?? existing.gstin ?? undefined, state);
  return prisma.supplier.update({ where: { id }, data });
}

export async function deactivateSupplier(id: string) {
  await getSupplier(id);
  await prisma.supplier.update({ where: { id }, data: { active: false } });
}
