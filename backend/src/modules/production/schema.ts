import { z } from "zod";

export const productionRunCreateSchema = z.object({
  bomHeaderId: z.string().min(1),
  batchSize: z.coerce.number().int().positive().default(1),
  // Lock the chosen pack format into the plan so expected yield and
  // packaging requirements are known before stock is checked or issued.
  packSizeId: z.string().min(1).optional(),
});

export const productionRunStartSchema = z.object({
  actualConsumption: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qtyBase: z.coerce.number().int().positive(),
        overrideReason: z.string().optional(),
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
  expiryDate: z.coerce.date().optional(),
  laborCostPaise: z.coerce.number().int().nonnegative().optional(),
  overheadCostPaise: z.coerce.number().int().nonnegative().optional(),
});

// Start and finish in one go: the raw materials used plus everything finishing asks for.
export const productionRunRecordSchema = productionRunCompleteSchema.extend({
  actualConsumption: productionRunStartSchema.shape.actualConsumption,
});
