// npm run benchmark
//
// Replays the brief's section 5 benchmark on a brand-new database:
//   1. drops and recreates a database named <your database>_benchmark on the
//      same server as DATABASE_URL,
//   2. applies every migration and loads the seed (the section 5 master data),
//   3. runs src/benchmark.test.ts against it, and nothing else.
// Nothing from development, other tests or manual use can reach the numbers.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const base = process.env.DATABASE_URL;
if (!base) throw new Error("Set DATABASE_URL (the benchmark database is created next to it).");

const url = new URL(base);
const benchName = `${url.pathname.slice(1) || "postgres"}_benchmark`;
const benchUrl = new URL(base);
benchUrl.pathname = `/${benchName}`;

const admin = new PrismaClient({ datasources: { db: { url: base } } });
await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${benchName}" WITH (FORCE)`);
await admin.$executeRawUnsafe(`CREATE DATABASE "${benchName}"`);
await admin.$disconnect();
console.log(`Fresh database ${benchName} created.`);

const env = { ...process.env, DATABASE_URL: benchUrl.toString(), BENCHMARK_DATABASE: benchName };
const run = (cmd: string) => execSync(cmd, { stdio: "inherit", env });
run("npx prisma migrate deploy");
run("npx tsx prisma/seed.ts");
run("npx vitest run --config vitest.benchmark.config.ts");
