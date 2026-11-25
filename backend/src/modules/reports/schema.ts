import { z } from "zod";

export const reportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(["json", "csv", "pdf"]).default("json"),
});

export const stockLedgerQuerySchema = reportQuerySchema.extend({
  itemId: z.string().min(1),
});

export const salesTrendQuerySchema = reportQuerySchema
  .extend({
    granularity: z.enum(["monthly", "yearly"]).default("monthly"),
  })
  // Monthly zero-fills every month in the range, so an unbounded span (e.g. from=0001-01-01)
  // would otherwise iterate and allocate one bucket per month with no limit.
  .refine(
    (q) => q.granularity !== "monthly" || !q.from || !q.to || q.to.getTime() - q.from.getTime() <= 1000 * 60 * 60 * 24 * 366 * 50,
    { message: "Monthly sales trend range cannot exceed 50 years", path: ["to"] },
  );

export const stockSummaryQuerySchema = z.object({
  type: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"]).optional(),
});
