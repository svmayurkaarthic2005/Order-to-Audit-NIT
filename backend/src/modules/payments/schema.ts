import { z } from "zod";

export const paymentCreateSchema = z.object({
  invoiceId: z.string().min(1),
  amountPaise: z.coerce.number().int().positive(),
});
