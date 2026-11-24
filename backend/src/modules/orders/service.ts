import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";

const PAGE_SIZE = 20;

type OrderItemInput = { itemId: string; qtyBase: number; ratePaise: number };

// Never spread a full User relation into an API response — it carries
// passwordHash. Only these fields are safe to serialize.
const publicUserSelect = { select: { id: true, name: true, email: true, role: true } };

export async function listOrders(filter: { salesmanId?: string; status?: string }, page: number) {
  const where = {
    ...(filter.salesmanId ? { salesmanUserId: filter.salesmanId } : {}),
    ...(filter.status ? { status: filter.status as never } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.salesOrder.findMany({
      where,
      include: { items: { include: { item: true } }, customer: true, salesmanUser: publicUserSelect },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { createdAt: "desc" },
    }),
    prisma.salesOrder.count({ where }),
  ]);
  return { items, total };
}

export async function getOrder(id: string) {
  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: { items: { include: { item: true } }, customer: true, salesmanUser: publicUserSelect },
  });
  if (!order) {
    throw new AppError(404, "not_found", "Order not found");
  }
  return order;
}

// No stock check here — that's Phase 11's job, at approval time. A salesman
// only ever orders finished goods, never raw materials or packaging.
export async function createOrder(salesmanUserId: string, data: { customerId: string; items: OrderItemInput[] }) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
    if (!customer || !customer.active) {
      throw new AppError(404, "not_found", "Customer not found");
    }

    for (const line of data.items) {
      const item = await tx.item.findUnique({ where: { id: line.itemId } });
      if (!item || !item.active) {
        throw new AppError(404, "not_found", `Item ${line.itemId} not found`);
      }
      if (item.type !== "FINISHED_GOOD") {
        throw new AppError(400, "invalid_item_type", "Orders can only contain finished goods");
      }
    }

    const order = await tx.salesOrder.create({
      data: {
        customerId: data.customerId,
        salesmanUserId,
        items: { create: data.items },
      },
    });

    return tx.salesOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: { include: { item: true } }, customer: true },
    });
  });
}
