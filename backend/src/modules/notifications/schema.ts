import { z } from "zod";

export const listQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
});
