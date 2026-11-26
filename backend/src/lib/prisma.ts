import { PrismaClient } from "@prisma/client";

// Production start, completion and dispatch each run a dozen-plus queries in
// one transaction; on a hosted database every query is a network round
// trip, so the 5 s default timeout is too tight and a slow moment would
// surface as a 500.
export const prisma = new PrismaClient({ transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
