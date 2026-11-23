import { Router } from "express";
import { z } from "zod";
import { validate } from "../../lib/validate.js";

export const debugRouter = Router();

// Proves the error-handling middleware's 500 shape. Remove this route before Phase 18.
debugRouter.get("/error-test", () => {
  throw new Error("deliberate test error");
});

// Proves the zod validator's 400 shape. Remove this route before Phase 18.
debugRouter.get("/validate-test", validate("query", z.object({ name: z.string().min(1) })), (req, res) => {
  res.json({ data: { name: (req.query as { name: string }).name } });
});
