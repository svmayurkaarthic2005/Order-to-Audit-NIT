import { z } from "zod";

export const invoiceCreateSchema = z.object({
  orderId: z.string().min(1),
});

export const creditNoteCreateSchema = z.object({
  reason: z.string().min(1),
});
