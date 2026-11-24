import { z } from "zod";

// No .default() here — a shared base so the update schema can't silently
// reset an omitted field (zod's .partial() keeps .default(), it only adds
// .optional(), so a create-schema default would re-apply on every PATCH that
// doesn't mention the field).
const itemFields = {
  sku: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"]),
  baseUnit: z.enum(["G", "ML", "PIECE"]),
  hsnCode: z.string().optional(),
  taxRatePct: z.coerce.number().int().min(0).max(100),
};

export const itemCreateSchema = z.object(itemFields).extend({
  taxRatePct: itemFields.taxRatePct.default(0),
});

export const itemUpdateSchema = z.object(itemFields).partial().omit({ sku: true, baseUnit: true });
// sku and baseUnit are immutable once created — a wrong sku/unit is fixed by
// deactivating the item and creating a new one, never by rewriting history.

export const itemListQuerySchema = z.object({
  search: z.string().optional(),
  type: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
