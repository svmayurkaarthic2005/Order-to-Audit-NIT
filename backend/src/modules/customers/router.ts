import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../lib/validate.js";
import {
  createCustomer,
  deactivateCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "./service.js";
import { customerCreateSchema, customerListQuerySchema, customerUpdateSchema } from "./schema.js";

export const customersRouter = Router();

customersRouter.use(requireAuth);

customersRouter.get("/", validate("query", customerListQuerySchema), async (req, res) => {
  const { search, page } = req.validatedQuery as { search?: string; page: number };
  const result = await listCustomers(search, page);
  res.json({ data: result });
});

customersRouter.get("/:id", async (req, res) => {
  const customer = await getCustomer((req.params.id as string));
  res.json({ data: customer });
});

customersRouter.post(
  "/",
  requireRole("ADMIN", "OWNER"),
  validate("body", customerCreateSchema),
  async (req, res) => {
    const customer = await createCustomer(req.body);
    res.status(201).json({ data: customer });
  },
);

customersRouter.patch(
  "/:id",
  requireRole("ADMIN", "OWNER"),
  validate("body", customerUpdateSchema),
  async (req, res) => {
    const customer = await updateCustomer((req.params.id as string), req.body);
    res.json({ data: customer });
  },
);

customersRouter.delete("/:id", requireRole("ADMIN", "OWNER"), async (req, res) => {
  await deactivateCustomer((req.params.id as string));
  res.json({ data: { ok: true } });
});
