import { z } from "zod";

export const itemCreateSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"]),
  baseUnit: z.enum(["G", "ML", "PIECE"]),
  hsnCode: z.string().optional(),
  taxRatePct: z.coerce.number().int().min(0).max(100).default(0),
});

export const itemUpdateSchema = itemCreateSchema.partial().omit({ sku: true, baseUnit: true });
// sku and baseUnit are immutable once created — a wrong sku/unit is fixed by
// deactivating the item and creating a new one, never by rewriting history.

export const itemListQuerySchema = z.object({
  search: z.string().optional(),
  type: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
