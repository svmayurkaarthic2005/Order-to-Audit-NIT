import { z } from "zod";

export const reportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(["json", "csv", "pdf"]).default("json"),
});

export const stockLedgerQuerySchema = reportQuerySchema.extend({
  itemId: z.string().min(1),
});

export const salesTrendQuerySchema = reportQuerySchema.extend({
  granularity: z.enum(["monthly", "yearly"]).default("monthly"),
});

export const stockSummaryQuerySchema = z.object({
  type: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"]).optional(),
});
