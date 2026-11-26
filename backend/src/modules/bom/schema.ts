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
  expectedOutputQty: z.coerce.number().int().positive(),
  label: z.string().trim().min(1),
  packagingLines: z.array(
    z.object({
      itemId: z.string().min(1),
      qtyPerBatch: z.coerce.number().int().positive(),
    }),
  ).default([]),
});


export const packSizeUpdateSchema = z.object({
  expectedOutputQty: z.coerce.number().int().positive(),
  label: z.string().trim().min(1),
  packagingLines: z.array(
    z.object({
      itemId: z.string().min(1),
      qtyPerBatch: z.coerce.number().int().positive(),
    }),
  ).default([]),
});
