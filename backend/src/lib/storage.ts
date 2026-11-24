import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "invoices";

// Served statically from index.ts at /storage/invoices — see there.
export const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), "storage", "invoices");
const LOCAL_STORAGE_BASE_URL =
  process.env.LOCAL_STORAGE_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}/storage/invoices`;

function supabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// Uploads a PDF under a stable key and returns its public URL. Uses real
// Supabase Storage when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are set;
// otherwise falls back to local disk, served statically — same interface
// either way, so the caller never needs to know which backend is active.
// This project has no real Supabase project configured, so local disk is
// what's actually exercised; swapping in real credentials needs no code
// change.
export async function uploadInvoicePdf(key: string, pdfBuffer: Buffer): Promise<string> {
  const client = supabaseClient();
  if (client) {
    const { error } = await client.storage.from(SUPABASE_BUCKET).upload(key, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }
    return client.storage.from(SUPABASE_BUCKET).getPublicUrl(key).data.publicUrl;
  }

  await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_STORAGE_DIR, key), pdfBuffer);
  return `${LOCAL_STORAGE_BASE_URL}/${key}`;
}
