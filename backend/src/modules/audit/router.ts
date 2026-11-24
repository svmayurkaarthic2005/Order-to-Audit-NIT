import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";

export const auditRouter = Router();

auditRouter.use(requireAuth);

// Read-only everywhere — no update/delete route is ever exposed for
// AuditLog, consistent with it being append-only at the DB layer.
auditRouter.get("/", requireRole("ADMIN", "OWNER", "ACCOUNTANT"), async (_req, res) => {
  const entries = await prisma.auditLog.findMany({
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  res.json({ data: entries });
});
