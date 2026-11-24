import { z } from "zod";

export const setReorderLevelSchema = z.object({
  reorderLevel: z.coerce.number().int().min(0),
});

export const listAlertsQuerySchema = z.object({
  status: z.enum(["ACTIVE", "RESOLVED"]).optional(),
});
