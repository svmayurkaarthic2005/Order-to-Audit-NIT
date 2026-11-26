import { z } from "zod";

const recipeBody = {
  expectedYieldQty: z.coerce.number().int().positive(),
  lines: z
    .array(
      z.object({
        rawItemId: z.string().min(1),
        qtyPerBatch: z.coerce.number().int().positive(),
      }),
    )
    .min(1),
};

export const bomCreateSchema = z.object({ finishedItemId: z.string().min(1), ...recipeBody });
export const bomEditSchema = z.object(recipeBody);

export const packSizeCreateSchema = z.object({
  finishedItemId: z.string().min(1),
  baseBomId: z.string().min(1),
  multiplier: z.coerce.number().int().positive().default(1),
  label: z.string().min(1),
  // Good finished packs expected from one batch of the shared recipe.
  expectedYieldQty: z.coerce.number().int().positive(),
  // Pack-specific packaging, expressed as base units needed per recipe batch.
  lines: z.array(z.object({
    itemId: z.string().min(1),
    qtyPerBatch: z.coerce.number().int().positive(),
  })).min(1),
});
