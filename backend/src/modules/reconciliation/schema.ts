import { z } from "zod";

export const runChecksBodySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

export const listExceptionsQuerySchema = z.object({
  status: z.enum(["OPEN", "REVIEWED", "RESOLVED"]).optional(),
  checkType: z.enum(["STOCK", "PRODUCTION_VARIANCE", "PACKAGING", "INVOICE", "DISPATCH"]).optional(),
});

export const reviewExceptionSchema = z.object({
  status: z.enum(["OPEN", "REVIEWED", "RESOLVED"]),
  explanation: z.string().trim().min(1).optional(),
  resolutionNote: z.string().trim().min(1).optional(),
});
