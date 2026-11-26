import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { logAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { getOnHandQty, getReservedQty } from "../inventory/service.js";
import { syncAlertsForItems } from "../alerts/service.js";
import { notify } from "../notifications/service.js";

// Tells the people who act next that an order moved on: the office when a
// salesman submits one, the salesman when the office decides or ships it.
export async function notifyOrderUpdate(
  orderId: string,
  to: "office" | "salesman",
  title: string,
  message: string,
  stage: string,
  severity: "INFO" | "WARNING" = "INFO",
) {
  const order = await prisma.salesOrder.findUnique({ where: { id: orderId }, select: { salesmanUserId: true } });
  if (!order) return;
  await notify({
    ...(to === "office" ? { recipientRoles: ["OWNER", "ADMIN"] as const } : { recipientUserId: order.salesmanUserId }),
    type: "ORDER_UPDATE",
    title,
    message,
    severity,
    sourceType: "SalesOrder",
    sourceId: orderId,
    dedupeKeySuffix: `:${stage}`,
  });
}

const PAGE_SIZE = 20;

type OrderItemInput = { itemId: string; qtyBase: number; ratePaise: number };
type TxClient = Prisma.TransactionClient;

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
      omit: { idempotencyKey: true },
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
    omit: { idempotencyKey: true },
  });
  if (!order) {
    throw new AppError(404, "not_found", "Order not found");
  }
  return order;
}

// No stock check here — that's Phase 11's job, at approval time. A salesman
// only ever orders finished goods, never raw materials or packaging.
//
// Idempotent on the caller-supplied key: the offline queue (or an impatient
// double-tap while a submission is still in flight) can replay the same
// payload any number of times and only ever get the one order it created.
export async function createOrder(
  salesmanUserId: string,
  data: { customerId: string; items: OrderItemInput[] },
  idempotencyKey: string,
) {
  // Scoped to the caller: the key is only ever looked up alongside their own
  // salesmanUserId, so one salesman can never collide with — or read back —
  // another's order by guessing or replaying their Idempotency-Key.
  const key = { salesmanUserId_idempotencyKey: { salesmanUserId, idempotencyKey } };
  const alreadyApplied = await prisma.salesOrder.findUnique({ where: key });
  if (alreadyApplied) {
    return getOrder(alreadyApplied.id);
  }

  try {
    const order = await createOrderInTransaction(salesmanUserId, data, idempotencyKey);
    await notifyOrderUpdate(
      order.id,
      "office",
      `New order from ${order.customer.name}`,
      `${(await prisma.user.findUnique({ where: { id: salesmanUserId }, select: { name: true } }))?.name ?? "A salesman"} sent an order. Check it and approve or reject it on the Orders page.`,
      "submitted",
    );
    return order;
  } catch (err) {
    // The pre-check above is a friendly fast path; the database's unique
    // constraint on (salesmanUserId, idempotencyKey) is what actually
    // prevents a replayed request from posting its rows twice under
    // concurrency.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.salesOrder.findUniqueOrThrow({ where: key });
      return getOrder(existing.id);
    }
    throw err;
  }
}

async function createOrderInTransaction(
  salesmanUserId: string,
  data: { customerId: string; items: OrderItemInput[] },
  idempotencyKey: string,
) {
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
        idempotencyKey,
        items: { create: data.items },
      },
    });

    return tx.salesOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: { include: { item: true } }, customer: true },
      omit: { idempotencyKey: true },
    });
  });
}

function withOrderInclude(id: string, tx: TxClient) {
  return tx.salesOrder.findUniqueOrThrow({
    where: { id },
    include: { items: { include: { item: true } }, customer: true, salesmanUser: publicUserSelect },
    omit: { idempotencyKey: true },
  });
}

// Checks requestedQty against on-hand minus already-approved-undispatched
// quantity for that item, inside one transaction — this is what makes the
// benchmark's Distributor B shortage (and any other overselling) impossible,
// even under concurrent approval requests racing for the same units.
export async function approveOrder(id: string, actingUserId: string) {
  return prisma.$transaction(async (tx) => {
    // Serialize against a concurrent editOrder on this same order: without
    // this, editOrder could swap in a different item/quantity between our
    // read below and the item-level locks we take from it, so the stock
    // check a few lines down would end up guarding the wrong items.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;

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

    // Checked per product, totalling every line for it, so an order that
    // reached the database with a product split over two lines (older data,
    // or a direct insert) still can't slip past the stock check.
    const requestedByItem = new Map<string, number>();
    for (const line of fresh.items) {
      requestedByItem.set(line.itemId, (requestedByItem.get(line.itemId) ?? 0) + line.qtyBase);
    }
    for (const [itemId, requested] of requestedByItem) {
      const onHand = await getOnHandQty(tx, itemId);
      const reserved = await getReservedQty(tx, itemId);
      const available = onHand - reserved;
      if (requested > available) {
        throw new AppError(409, "insufficient_stock", "Not enough stock to approve this order", {
          itemId,
          shortfall: requested - available,
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
    await logAudit(tx, { userId: actingUserId, action: "APPROVE", entityType: "SalesOrder", entityId: id });
    return withOrderInclude(id, tx);
  }).then(async (result) => {
    // Reserving stock against this order can push a finished good below its
    // reorder level, same as physically consuming it — approval changes
    // availability, not on-hand, but low-stock alerts are defined on
    // availability.
    await syncAlertsForItems(result.items.map((i) => i.itemId));
    await notifyOrderUpdate(id, "salesman", `Order for ${result.customer.name} approved`, "The stock is set aside. It will be invoiced and sent next.", "approved");
    return result;
  }).catch(async (err) => {
    // A refused approval is a shortage the salesman and the owner should hear
    // about, not just a message on the approver's screen (the brief's
    // Distributor B case: 120 asked, 88 free, 32 short).
    if (err instanceof AppError && err.code === "insufficient_stock") {
      const order = await prisma.salesOrder.findUnique({ where: { id }, include: { customer: true } });
      const shortfall = (err.details as { shortfall?: number } | undefined)?.shortfall;
      if (order) {
        const message = `Not enough packets in stock: ${shortfall} short. Make more, or edit the order down.`;
        await notify({ recipientUserId: order.salesmanUserId, type: "ORDER_SHORTAGE", title: `Order for ${order.customer.name} can't be filled yet`, message, severity: "WARNING", sourceType: "SalesOrder", sourceId: id, dedupeKeySuffix: `:short:${shortfall}` });
        await notify({ recipientRoles: ["OWNER", "ADMIN"], type: "ORDER_SHORTAGE", title: `Order for ${order.customer.name}: ${shortfall} packets short`, message, severity: "WARNING", sourceType: "SalesOrder", sourceId: id, dedupeKeySuffix: `:short:${shortfall}` });
      }
    }
    throw err;
  });
}

// Admin-side correction before verification completes: quantities or prices
// typed in over the phone/WhatsApp often need a fix before approval. Once an
// order leaves SUBMITTED (approved, rejected, or further) it's either
// already reserved stock or a closed decision — never editable again.
export async function editOrder(id: string, items: OrderItemInput[], actingUserId: string) {
  return prisma.$transaction(async (tx) => {
    // Same order-level lock as approveOrder, so the two can never interleave:
    // whichever acquires it first finishes (commit or 409) before the other proceeds.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;

    const before = await tx.salesOrder.findUnique({ where: { id }, include: { items: { include: { item: true } } } });
    if (!before) {
      throw new AppError(404, "not_found", "Order not found");
    }

    for (const line of items) {
      const item = await tx.item.findUnique({ where: { id: line.itemId } });
      if (!item || !item.active) {
        throw new AppError(404, "not_found", `Item ${line.itemId} not found`);
      }
      if (item.type !== "FINISHED_GOOD") {
        throw new AppError(400, "invalid_item_type", "Orders can only contain finished goods");
      }
    }

    // Same atomic-claim pattern as approve/reject: conditioning the write on
    // status still being SUBMITTED closes the race against a concurrent
    // approve/reject landing between our read above and this write.
    const { count } = await tx.salesOrder.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: "SUBMITTED" } });
    if (count === 0) {
      throw new AppError(409, "invalid_status", "Only a SUBMITTED order can be edited");
    }

    await tx.orderItem.deleteMany({ where: { salesOrderId: id } });
    await tx.orderItem.createMany({ data: items.map((line) => ({ ...line, salesOrderId: id })) });

    await logAudit(tx, {
      userId: actingUserId,
      action: "EDIT",
      entityType: "SalesOrder",
      entityId: id,
      before: { items: before.items.map((i) => ({ itemId: i.itemId, sku: i.item.sku, qtyBase: i.qtyBase, ratePaise: i.ratePaise })) },
      after: { items },
    });

    return withOrderInclude(id, tx);
  });
}

export async function rejectOrder(id: string, reason: string, actingUserId: string) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.salesOrder.updateMany({
      where: { id, status: "SUBMITTED" },
      data: { status: "REJECTED", rejectionReason: reason },
    });
    if (count === 0) {
      throw new AppError(409, "invalid_status", "Only a SUBMITTED order can be rejected");
    }
    await logAudit(tx, { userId: actingUserId, action: "REJECT", entityType: "SalesOrder", entityId: id, after: { reason } });
    return withOrderInclude(id, tx);
  }).then(async (result) => {
    // Fire ORDER_SHORTAGE notifications only when the rejection reason is stock-related
    if (reason === "insufficient_stock") {
      const salesman = result.salesmanUser as { id: string; name: string };
      const customer = result.customer;

      // Notify the salesman directly (user-specific)
      await notify({
        recipientUserId: salesman.id,
        type: "ORDER_SHORTAGE",
        title: `Order for ${customer.name} rejected`,
        message: "There weren't enough packets in stock to fill it. Check with the factory before taking it again.",
        severity: "WARNING",
        sourceType: "SalesOrder",
        sourceId: id,
      });

      // Notify ADMIN/OWNER by role (role-broadcast)
      await notify({
        recipientRoles: ["OWNER", "ADMIN"],
        type: "ORDER_SHORTAGE",
        title: `Order for ${customer.name} rejected: not enough stock`,
        message: `${salesman.name}'s order couldn't be filled from current stock. A production run would cover it.`,
        severity: "WARNING",
        sourceType: "SalesOrder",
        sourceId: id,
      });
    } else {
      await notifyOrderUpdate(id, "salesman", `Order for ${result.customer.name} rejected`, `Reason: ${reason}`, "rejected", "WARNING");
    }
    return result;
  });
  // No alert sync needed: reservation only starts at APPROVED, so rejecting
  // a SUBMITTED order never changed availability.
}
