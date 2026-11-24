import { z } from "zod";

export const purchaseCreateSchema = z.object({
  supplierId: z.string().min(1),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qtyBase: z.coerce.number().int().positive(),
        rateBasePaise: z.coerce.number().int().min(0),
      }),
    )
    .min(1),
});

export const purchaseListQuerySchema = z.object({
  supplierId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
