import { Router } from "express";
import { z } from "zod";
import { validate } from "../../lib/validate.js";
import { requireAuth, requireRole, requireWriteAccess } from "../../middleware/auth.js";

export const debugRouter = Router();

// Proves the error-handling middleware's 500 shape. Remove this route before Phase 18.
debugRouter.get("/error-test", () => {
  throw new Error("deliberate test error");
});

// Proves the zod validator's 400 shape. Remove this route before Phase 18.
debugRouter.get("/validate-test", validate("query", z.object({ name: z.string().min(1) })), (req, res) => {
  res.json({ data: { name: (req.validatedQuery as { name: string }).name } });
});

// Proves role-based access control. Remove this route before Phase 18.
debugRouter.get("/admin-only", requireAuth, requireRole("ADMIN"), (_req, res) => {
  res.json({ data: { ok: true } });
});

// Proves the accountant/auditor role is enforced read-only at the middleware
// level. Remove this route before Phase 18.
debugRouter.post("/mutate-test", requireAuth, requireWriteAccess, (_req, res) => {
  res.json({ data: { ok: true } });
});
