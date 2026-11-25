import { Router } from "express";
import { z } from "zod";
import { validate } from "../../lib/validate.js";
import { requireAuth, requireRole, requireWriteAccess } from "../../middleware/auth.js";

// Mounted only outside production (see index.ts) — exists purely so
// errorHandler.test.ts and auth.test.ts can exercise these middleware
// shapes directly, without a real route's business logic in the way.
export const debugRouter = Router();

// Proves the error-handling middleware's 500 shape.
debugRouter.get("/error-test", () => {
  throw new Error("deliberate test error");
});

// Proves the zod validator's 400 shape.
debugRouter.get("/validate-test", validate("query", z.object({ name: z.string().min(1) })), (req, res) => {
  res.json({ data: { name: (req.validatedQuery as { name: string }).name } });
});

// Proves role-based access control.
debugRouter.get("/admin-only", requireAuth, requireRole("ADMIN"), (_req, res) => {
  res.json({ data: { ok: true } });
});

// Proves the accountant/auditor role is enforced read-only at the middleware
// level.
debugRouter.post("/mutate-test", requireAuth, requireWriteAccess, (_req, res) => {
  res.json({ data: { ok: true } });
});
