import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import { createOrder, getOrder, listOrders } from "./service.js";
import { orderCreateSchema, orderListQuerySchema } from "./schema.js";

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

const canCreateOrders = requireRole("SALESMAN", "ADMIN", "OWNER");
const canReadOrders = requireRole("SALESMAN", "ADMIN", "OWNER");

ordersRouter.get("/", canReadOrders, validate("query", orderListQuerySchema), async (req, res) => {
  const { salesmanId, status, page } = req.validatedQuery as { salesmanId?: string; status?: string; page: number };
  // A salesman can only ever see their own order history — never another
  // salesman's, whatever salesmanId they pass in the query string.
  const effectiveSalesmanId = req.user?.role === "SALESMAN" ? req.user.id : salesmanId;
  const result = await listOrders({ salesmanId: effectiveSalesmanId, status }, page);
  res.json({ data: result });
});

ordersRouter.get("/:id", canReadOrders, async (req, res) => {
  const order = await getOrder(req.params.id as string);
  if (req.user?.role === "SALESMAN" && order.salesmanUserId !== req.user.id) {
    res.status(404).json({ error: { code: "not_found", message: "Order not found" } });
    return;
  }
  res.json({ data: order });
});

ordersRouter.post("/", canCreateOrders, validate("body", orderCreateSchema), async (req, res) => {
  // Always the caller's own id — a salesman (or admin) can never submit an
  // order on another salesman's behalf, whatever the request body says.
  const order = await createOrder(req.user!.id, req.body);
  res.status(201).json({ data: order });
});
