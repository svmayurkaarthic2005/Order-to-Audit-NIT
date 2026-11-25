import { z } from "zod";

export const orderCreateSchema = z.object({
  customerId: z.string().min(1),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qtyBase: z.coerce.number().int().positive(),
        ratePaise: z.coerce.number().int().min(0),
      }),
    )
    .min(1),
});

export const orderEditSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qtyBase: z.coerce.number().int().positive(),
        ratePaise: z.coerce.number().int().min(0),
      }),
    )
    .min(1),
});

export const orderRejectSchema = z.object({
  reason: z.string().min(1),
});

export const orderListQuerySchema = z.object({
  salesmanId: z.string().optional(),
  status: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "DISPATCHABLE", "DISPATCHED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
