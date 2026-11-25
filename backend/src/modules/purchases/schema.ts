import { z } from "zod";

export const purchaseCreateSchema = z.object({
  supplierId: z.string().min(1),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qtyBase: z.coerce.number().int().positive(),
        rateBasePaise: z.coerce.number().int().min(0),
        // The line's exact value. Optional, and preferred: a price like
        // ₹45/kg is 4.5 paise per gram, which a whole-paise per-gram rate
        // can't hold, so the total is what goes on the ledger when given.
        totalCostPaise: z.coerce.number().int().min(0).optional(),
        supplierBatchNo: z.string().optional(),
        manufactureDate: z.string().optional(),
        expiryDate: z.string().optional(),
        qualityDocRef: z.string().optional(),
      }),
    )
    .min(1),
});

export const purchaseListQuerySchema = z.object({
  supplierId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
