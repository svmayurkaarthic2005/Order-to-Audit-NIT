import { z } from "zod";

export const dispatchCreateSchema = z.object({
  invoiceId: z.string().min(1),
  qty: z.coerce.number().int().positive(),
  overrideReason: z.string().optional(),
});
