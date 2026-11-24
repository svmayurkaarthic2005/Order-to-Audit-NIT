import { z } from "zod";

export const productionRunCreateSchema = z.object({
  bomHeaderId: z.string().min(1),
  batchSize: z.coerce.number().int().positive().default(1),
});

export const productionRunStartSchema = z.object({
  actualConsumption: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qtyBase: z.coerce.number().int().positive(),
      }),
    )
    .min(1),
});

export const productionRunCompleteSchema = z.object({
  actualOutputQty: z.coerce.number().int().positive(),
  packagingConsumed: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qtyBase: z.coerce.number().int().nonnegative(),
        damagedQty: z.coerce.number().int().nonnegative().default(0),
      }),
    )
    .default([]),
});
