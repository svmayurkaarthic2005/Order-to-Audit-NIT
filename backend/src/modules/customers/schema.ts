import { z } from "zod";

export const customerCreateSchema = z.object({
  name: z.string().min(1),
  state: z.string().min(1),
  gstin: z.string().optional(),
});

export const customerUpdateSchema = customerCreateSchema.partial();

export const customerListQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
