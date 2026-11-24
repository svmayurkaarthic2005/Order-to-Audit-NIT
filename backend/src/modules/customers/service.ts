import { AppError } from "../../lib/AppError.js";
import { validateGstin } from "../../lib/gstin.js";
import { prisma } from "../../lib/prisma.js";

const PAGE_SIZE = 20;

export async function listCustomers(search: string | undefined, page: number) {
  const where = {
    active: true,
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.customer.findMany({ where, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, orderBy: { name: "asc" } }),
    prisma.customer.count({ where }),
  ]);
  return { items, total };
}

export async function getCustomer(id: string) {
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer || !customer.active) {
    throw new AppError(404, "not_found", "Customer not found");
  }
  return customer;
}

function checkGstin(gstin: string | undefined, state: string) {
  if (!gstin) return;
  const error = validateGstin(gstin, state);
  if (error) {
    throw new AppError(400, "invalid_gstin", error);
  }
}

export async function createCustomer(data: { name: string; state: string; gstin?: string }) {
  checkGstin(data.gstin, data.state);
  return prisma.customer.create({ data });
}

export async function updateCustomer(
  id: string,
  data: { name?: string; state?: string; gstin?: string },
) {
  const existing = await getCustomer(id);
  const state = data.state ?? existing.state;
  checkGstin(data.gstin ?? existing.gstin ?? undefined, state);
  return prisma.customer.update({ where: { id }, data });
}

export async function deactivateCustomer(id: string) {
  await getCustomer(id);
  await prisma.customer.update({ where: { id }, data: { active: false } });
}
