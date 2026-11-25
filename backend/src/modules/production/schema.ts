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
  // Which PackSize this run actually packed, when the BOM's raw-material
  // recipe is shared across more than one — e.g. the same batch run as a
  // 200g or a 500g pack. Omitted, output goes to the BOM's own finished item
  // exactly as before.
  packSizeId: z.string().min(1).optional(),
});
