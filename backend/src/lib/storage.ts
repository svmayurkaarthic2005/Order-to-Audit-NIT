import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "invoices";
const SIGNED_URL_TTL_SECONDS = 3600;

// Served statically from index.ts at /storage/invoices, behind requireAuth
// + the same role check as the rest of the invoices API — these are
// customer billing documents, never a publicly reachable path.
export const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), "storage", "invoices");
const LOCAL_STORAGE_BASE_URL =
  process.env.LOCAL_STORAGE_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}/storage/invoices`;

function supabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// Writes the PDF under a stable key. Uses real Supabase Storage when
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are set; otherwise falls back to
// local disk. This project has no real Supabase project configured, so
// local disk is what's actually exercised; swapping in real credentials
// needs no code change. Only the key is meant to be persisted — call
// urlForInvoicePdf to get a URL, never cache one, since the Supabase path
// is a short-lived signed URL, not a permanent public one.
export async function uploadInvoicePdf(key: string, pdfBuffer: Buffer): Promise<void> {
  const client = supabaseClient();
  if (client) {
    const { error } = await client.storage.from(SUPABASE_BUCKET).upload(key, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }
    return;
  }

  await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_STORAGE_DIR, key), pdfBuffer);
}

// Always mints a fresh URL for the given key — a short-lived signed URL
// from Supabase (the bucket is private; a public URL would let anyone with
// the link read a customer's invoice forever), or the local auth-gated
// static path. Never persist what this returns; persist the key instead.
export async function urlForInvoicePdf(key: string): Promise<string> {
  const client = supabaseClient();
  if (client) {
    const { data, error } = await client.storage.from(SUPABASE_BUCKET).createSignedUrl(key, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      throw new Error(`Supabase signed URL failed: ${error?.message}`);
    }
    return data.signedUrl;
  }

  return `${LOCAL_STORAGE_BASE_URL}/${key}`;
}
