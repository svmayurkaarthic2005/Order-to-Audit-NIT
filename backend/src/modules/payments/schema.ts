import { z } from "zod";

export const paymentCreateSchema = z.object({
  invoiceId: z.string().min(1),
  // Capped at the Postgres int4 column's own max (amountPaise is an Int):
  // without this, an oversized amount reaches the DB and crashes as a raw
  // 500 instead of a clean validation error.
  amountPaise: z.coerce.number().int().positive().max(2_147_483_647),
});
