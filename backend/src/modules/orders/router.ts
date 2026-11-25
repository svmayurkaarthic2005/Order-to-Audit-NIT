import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { approveOrder, createOrder, editOrder, getOrder, listOrders, rejectOrder } from "./service.js";
import { orderCreateSchema, orderEditSchema, orderListQuerySchema, orderRejectSchema } from "./schema.js";
import { AppError } from "../../lib/AppError.js";
import { redactOrderCustomerEmail } from "../../lib/customerVisibility.js";

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

const canCreateOrders = requireRole("SALESMAN", "ADMIN", "OWNER");
const canReadOrders = requireRole("SALESMAN", "ADMIN", "OWNER", "ACCOUNTANT");
const canApproveOrders = requireRole("ADMIN", "OWNER");

ordersRouter.get("/", canReadOrders, validate("query", orderListQuerySchema), async (req, res) => {
  const { salesmanId, status, page } = req.validatedQuery as { salesmanId?: string; status?: string; page: number };
  // A salesman can only ever see their own order history — never another
  // salesman's, whatever salesmanId they pass in the query string.
  const effectiveSalesmanId = req.user?.role === "SALESMAN" ? req.user.id : salesmanId;
  const result = await listOrders({ salesmanId: effectiveSalesmanId, status }, page);
  res.json({ data: { ...result, items: result.items.map((o) => redactOrderCustomerEmail(req.user!.role, o)) } });
});

ordersRouter.get("/:id", canReadOrders, async (req, res) => {
  const order = await getOrder(req.params.id as string);
  if (req.user?.role === "SALESMAN" && order.salesmanUserId !== req.user.id) {
    res.status(404).json({ error: { code: "not_found", message: "Order not found" } });
    return;
  }
  res.json({ data: redactOrderCustomerEmail(req.user!.role, order) });
});

ordersRouter.post("/", canCreateOrders, validate("body", orderCreateSchema), async (req, res) => {
  const idempotencyKey = req.get("Idempotency-Key");
  if (!idempotencyKey) {
    throw new AppError(400, "missing_idempotency_key", "An Idempotency-Key header is required");
  }
  // Always the caller's own id — a salesman (or admin) can never submit an
  // order on another salesman's behalf, whatever the request body says.
  const order = await createOrder(req.user!.id, req.body, idempotencyKey);
  res.status(201).json({ data: redactOrderCustomerEmail(req.user!.role, order) });
});

ordersRouter.patch("/:id", canApproveOrders, validate("body", orderEditSchema), async (req, res) => {
  const order = await editOrder(req.params.id as string, req.body.items, req.user!.id);
  res.json({ data: order });
});

ordersRouter.post("/:id/approve", canApproveOrders, async (req, res) => {
  const order = await approveOrder(req.params.id as string, req.user!.id);
  res.json({ data: order });
});

ordersRouter.post("/:id/reject", canApproveOrders, validate("body", orderRejectSchema), async (req, res) => {
  const order = await rejectOrder(req.params.id as string, req.body.reason, req.user!.id);
  res.json({ data: order });
});
