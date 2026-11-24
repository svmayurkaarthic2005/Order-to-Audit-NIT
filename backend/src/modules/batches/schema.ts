import { z } from "zod";

export const receiveBatchSchema = z.object({
  supplierBatchNo: z.string().optional(),
  manufactureDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  qualityDocRef: z.string().optional(),
});

export const fefoOverrideSchema = z.object({
  overrideReason: z.string().min(1),
  selections: z.array(
    z.object({
      batchId: z.string().uuid(),
      qty: z.number().int().positive(),
    }),
  ),
});

export const quarantineSchema = z.object({
  reason: z.string().min(1),
});
