// npm run e2e:server  (started by the frontend's Playwright config)
//
// Gives the browser tests a world of their own: drops and recreates
// <your database>_e2e next to DATABASE_URL, applies every migration, loads the
// seed (the brief's master data), then serves the API on E2E_API_PORT against
// it. Development data, the unit tests and the live site are never touched.
import { execSync, spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const base = process.env.DATABASE_URL;
if (!base) throw new Error("Set DATABASE_URL (the e2e database is created next to it).");

const url = new URL(base);
const name = `${url.pathname.slice(1) || "postgres"}_e2e`;
const e2eUrl = new URL(base);
e2eUrl.pathname = `/${name}`;

const admin = new PrismaClient({ datasources: { db: { url: base } } });
await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
await admin.$disconnect();

const env = {
  ...process.env,
  DATABASE_URL: e2eUrl.toString(),
  PORT: process.env.E2E_API_PORT ?? "4100",
  FRONTEND_ORIGIN: process.env.E2E_FRONTEND_ORIGIN ?? "http://localhost:5180",
  // Empty, not unset: keeps .env from filling them in, so PDFs go to local
  // disk and no email is ever sent from a test.
  SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  GMAIL_USER: "",
  GMAIL_APP_PASSWORD: "",
};
execSync("npx prisma migrate deploy", { stdio: "inherit", env });
execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });

const server = spawn("npx", ["tsx", "src/index.ts"], { stdio: "inherit", env, shell: true });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
