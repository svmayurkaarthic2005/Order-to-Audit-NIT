import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";

const PAGE_SIZE = 20;

type OrderItemInput = { itemId: string; qtyBase: number; ratePaise: number };
type TxClient = Prisma.TransactionClient;

// An order holds finished-goods stock once it is approved, right up until
// it is actually dispatched (Phase 15 posts the real stock_movements rows
// then) — so both statuses count as "reserved" against on-hand.
const RESERVED_STATUSES = ["APPROVED", "DISPATCHABLE"] as const;

async function getOnHandInTx(tx: TxClient, itemId: string) {
  const agg = await tx.stockMovement.aggregate({ where: { itemId }, _sum: { qtyBase: true } });
  return agg._sum.qtyBase ?? 0;
}

async function getReservedQtyInTx(tx: TxClient, itemId: string) {
  const agg = await tx.orderItem.aggregate({
    where: { itemId, salesOrder: { status: { in: [...RESERVED_STATUSES] } } },
    _sum: { qtyBase: true },
  });
  return agg._sum.qtyBase ?? 0;
}

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

function withOrderInclude(id: string, tx: TxClient) {
  return tx.salesOrder.findUniqueOrThrow({
    where: { id },
    include: { items: { include: { item: true } }, customer: true, salesmanUser: publicUserSelect },
  });
}

// Checks requestedQty against on-hand minus already-approved-undispatched
// quantity for that item, inside one transaction — this is what makes the
// benchmark's Distributor B shortage (and any other overselling) impossible,
// even under concurrent approval requests racing for the same units.
export async function approveOrder(id: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUnique({ where: { id }, include: { items: true } });
    if (!order) {
      throw new AppError(404, "not_found", "Order not found");
    }

    // Serialize against any other transaction approving an order that
    // touches the same item(s): without this, two concurrent approvals
    // could both read the same on-hand/reserved snapshot and both succeed,
    // oversubscribing finished-goods stock. Lock keys are sorted so two
    // orders sharing items never deadlock against each other.
    const itemIds = [...new Set(order.items.map((i) => i.itemId))].sort();
    for (const itemId of itemIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${itemId}))`;
    }

    // Re-read status now that the lock(s) are held: a concurrent
    // approve/reject of this same order has either already committed (and
    // this read sees it) or is blocked behind us until we finish.
    const fresh = await tx.salesOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
    if (fresh.status !== "SUBMITTED") {
      throw new AppError(409, "invalid_status", "Only a SUBMITTED order can be approved");
    }

    for (const line of fresh.items) {
      const onHand = await getOnHandInTx(tx, line.itemId);
      const reserved = await getReservedQtyInTx(tx, line.itemId);
      const available = onHand - reserved;
      if (line.qtyBase > available) {
        throw new AppError(409, "insufficient_stock", "Not enough stock to approve this order", {
          itemId: line.itemId,
          shortfall: line.qtyBase - available,
        });
      }
    }

    // Conditional on status still being SUBMITTED: a concurrent /reject
    // could otherwise land between our fresh-status read above and this
    // write (it needs no advisory lock, since it never touches on-hand),
    // and an unconditional update here would silently clobber that
    // rejection back to APPROVED.
    const { count } = await tx.salesOrder.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: "APPROVED" } });
    if (count === 0) {
      throw new AppError(409, "invalid_status", "Only a SUBMITTED order can be approved");
    }
    return withOrderInclude(id, tx);
  });
}

export async function rejectOrder(id: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.salesOrder.updateMany({
      where: { id, status: "SUBMITTED" },
      data: { status: "REJECTED", rejectionReason: reason },
    });
    if (count === 0) {
      throw new AppError(409, "invalid_status", "Only a SUBMITTED order can be rejected");
    }
    return withOrderInclude(id, tx);
  });
}
