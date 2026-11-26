import { z } from "zod";

export const openingStockSchema = z.object({
  itemId: z.string().min(1),
  qtyBase: z.coerce.number().int().positive(),
  totalCostPaise: z.coerce.number().int().min(0),
});

export const adjustmentSchema = z.object({
  itemId: z.string().min(1),
  qtyBase: z.coerce.number().int().min(-1_000_000_000).max(1_000_000_000).refine((n) => n !== 0, "Enter a non-zero quantity"),
  reason: z.string().trim().min(3).max(200),
});
