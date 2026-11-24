import { z } from "zod";

export const openingStockSchema = z.object({
  itemId: z.string().min(1),
  qtyBase: z.coerce.number().int().positive(),
  totalCostPaise: z.coerce.number().int().min(0),
});
