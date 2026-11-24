import { type AlertSeverity, type NotificationType, type Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

type NotifyInput = {
  recipientRoles?: Role[];
  recipientUserId?: string;
  type: NotificationType;
  title: string;
  message: string;
  severity?: AlertSeverity;
  sourceType: string;
  sourceId: string;
  /** Optional suffix appended to the dedupeKey for per-threshold dedup (e.g. expiry warnings). */
  dedupeKeySuffix?: string;
};

/** Fire-and-forget notification. Dedup via dedupeKey — identical events never
 *  create a second row. The dedupeKey includes the recipient so that a
 *  user-specific ORDER_SHORTAGE and a role-broadcast ORDER_SHORTAGE for the
 *  same order are stored as separate rows (different recipients). */
export async function notify(input: NotifyInput) {
  const recipientSuffix = input.recipientUserId
    ? `:user:${input.recipientUserId}`
    : `:roles:${(input.recipientRoles ?? []).sort().join(",")}`;
  const dedupeKey = `${input.type}:${input.sourceType}:${input.sourceId}${recipientSuffix}${input.dedupeKeySuffix ?? ""}`;

  await prisma.notification.upsert({
    where: { dedupeKey },
    create: {
      recipientUserId: input.recipientUserId ?? null,
      recipientRoles: input.recipientRoles ?? [],
      type: input.type,
      title: input.title,
      message: input.message,
      severity: input.severity ?? "INFO",
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      dedupeKey,
    },
    // No-op update — the whole point is "if already exists, leave it alone".
    update: {},
  });
}

type AuthUser = { id: string; role: Role };

/** Build the Prisma `where` filter that enforces role-based visibility. */
function visibilityFilter(user: AuthUser) {
  const { id, role } = user;

  if (role === "OWNER") {
    // Sees everything
    return {};
  }

  if (role === "ADMIN") {
    return {
      OR: [
        {
          type: { in: ["LOW_STOCK", "STOCK_REPLENISHED", "ORDER_SHORTAGE", "EXPIRY_WARNING"] as NotificationType[] },
          recipientUserId: null,
        },
        {
          type: { in: ["LOW_STOCK", "STOCK_REPLENISHED", "ORDER_SHORTAGE", "EXPIRY_WARNING"] as NotificationType[] },
          recipientUserId: id,
        },
      ],
    };
  }

  if (role === "PRODUCTION") {
    return {
      OR: [
        {
          type: { in: ["PRODUCTION_VARIANCE", "EXPIRY_WARNING"] as NotificationType[] },
          recipientUserId: null,
        },
        {
          // LOW_STOCK for raw materials only — sourceType = "LowStockAlert"
          type: "LOW_STOCK" as NotificationType,
          sourceType: "LowStockAlert",
          recipientUserId: null,
        },
      ],
    };
  }

  if (role === "ACCOUNTANT") {
    return {
      type: "AUDIT_EXCEPTION" as NotificationType,
    };
  }

  if (role === "SALESMAN") {
    // Only ORDER_SHORTAGE addressed directly to them
    return {
      type: "ORDER_SHORTAGE" as NotificationType,
      recipientUserId: id,
    };
  }

  // Fallback: nothing
  return { id: "__none__" };
}

export async function listForUser(
  user: AuthUser,
  opts: { unreadOnly?: boolean } = {},
) {
  const filter = visibilityFilter(user);
  const where = {
    ...filter,
    ...(opts.unreadOnly ? { readAt: null } : {}),
  };

  return prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getUnreadCount(user: AuthUser) {
  const filter = visibilityFilter(user);
  return prisma.notification.count({
    where: { ...filter, readAt: null },
  });
}

export async function markRead(id: string, user: AuthUser) {
  // First verify the notification is visible to this user
  const filter = visibilityFilter(user);
  const notification = await prisma.notification.findFirst({
    where: { id, ...filter },
  });
  if (!notification) return null;

  return prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(user: AuthUser) {
  const filter = visibilityFilter(user);
  return prisma.notification.updateMany({
    where: { ...filter, readAt: null },
    data: { readAt: new Date() },
  });
}
