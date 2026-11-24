import { z } from "zod";

export const supplierCreateSchema = z.object({
  name: z.string().min(1),
  state: z.string().min(1),
  gstin: z.string().optional(),
});

export const supplierUpdateSchema = supplierCreateSchema.partial();

export const supplierListQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
