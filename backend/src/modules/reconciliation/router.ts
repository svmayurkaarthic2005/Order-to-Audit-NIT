import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { listExceptions, reviewException, runAllChecks } from "./service.js";
import { listExceptionsQuerySchema, reviewExceptionSchema, runChecksBodySchema } from "./schema.js";

export const reconciliationRouter = Router();

reconciliationRouter.use(requireAuth);

const canReconcile = requireRole("ADMIN", "OWNER", "ACCOUNTANT");

reconciliationRouter.post("/run", canReconcile, validate("body", runChecksBodySchema), async (req, res) => {
  const { dateFrom, dateTo } = req.body as { dateFrom?: Date; dateTo?: Date };
  res.json({ data: await runAllChecks({ dateFrom, dateTo }) });
});

reconciliationRouter.get(
  "/exceptions",
  canReconcile,
  validate("query", listExceptionsQuerySchema),
  async (req, res) => {
    const { status, checkType } = req.validatedQuery as { status?: "OPEN" | "RESOLVED"; checkType?: string };
    res.json({ data: await listExceptions({ status, checkType }) });
  },
);

reconciliationRouter.patch(
  "/exceptions/:id",
  canReconcile,
  validate("body", reviewExceptionSchema),
  async (req, res) => {
    const data = req.body as { status: "OPEN" | "RESOLVED"; explanation?: string; resolutionNote?: string };
    res.json({ data: await reviewException(req.params.id as string, data, req.user!.id) });
  },
);
