import type { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

// Append-only — no update/delete route is ever exposed for AuditLog, and
// nothing in this codebase calls update/delete on it.
export async function logAudit(
  tx: TxClient,
  params: { userId: string | null; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown },
) {
  await tx.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      beforeJson: params.before !== undefined ? JSON.stringify(params.before) : null,
      afterJson: params.after !== undefined ? JSON.stringify(params.after) : null,
    },
  });
}
