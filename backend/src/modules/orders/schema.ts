import { z } from "zod";

// One line per product. Two lines for the same product would each be checked
// against stock on their own (60 + 60 against 100 available both pass), so
// they're refused here; combine them into one line instead.
const orderLines = z
  .array(
    z.object({
      itemId: z.string().min(1),
      qtyBase: z.coerce.number().int().positive(),
      ratePaise: z.coerce.number().int().min(0),
    }),
  )
  .min(1)
  .refine((lines) => new Set(lines.map((l) => l.itemId)).size === lines.length, {
    message: "Each product can appear only once in an order; combine the quantities into one line",
  });

export const orderCreateSchema = z.object({
  customerId: z.string().min(1),
  items: orderLines,
});

export const orderEditSchema = z.object({
  items: orderLines,
});

export const orderRejectSchema = z.object({
  reason: z.string().min(1),
});

export const orderListQuerySchema = z.object({
  salesmanId: z.string().optional(),
  status: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "DISPATCHABLE", "DISPATCHED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
