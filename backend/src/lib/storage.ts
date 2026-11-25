import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

const SIGNED_URL_TTL_SECONDS = 3600;

// Thrown only when the stored PDF itself is missing, so callers can tell
// "regenerate it" apart from an outage or bad credentials.
export class InvoicePdfNotFoundError extends Error {}

// Served statically from index.ts at /storage/invoices, behind requireAuth
// + the same role check as the rest of the invoices API — these are
// customer billing documents, never a publicly reachable path.
export const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), "storage", "invoices");
const LOCAL_STORAGE_BASE_URL =
  process.env.LOCAL_STORAGE_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}/storage/invoices`;

// Read when called, not at import: nothing guarantees .env has been loaded
// by the time this module is first imported (same as lib/mailer.ts).
const bucket = () => process.env.SUPABASE_STORAGE_BUCKET ?? "invoices";

function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// Writes the PDF under a stable key. Uses real Supabase Storage when
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are set; otherwise falls back to
// local disk. Only the key is meant to be persisted — call
// urlForInvoicePdf to get a URL, never cache one, since the Supabase path
// is a short-lived signed URL, not a permanent public one.
export async function uploadInvoicePdf(key: string, pdfBuffer: Buffer): Promise<void> {
  const client = supabaseClient();
  if (client) {
    const { error } = await client.storage.from(bucket()).upload(key, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
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
    const { data, error } = await client.storage.from(bucket()).createSignedUrl(key, SIGNED_URL_TTL_SECONDS);
    if (error && /not.?found/i.test(error.message)) {
      throw new InvoicePdfNotFoundError(key);
    }
    if (error || !data) {
      throw new Error(`Supabase signed URL failed: ${error?.message}`);
    }
    return data.signedUrl;
  }

  try {
    await fs.access(path.join(LOCAL_STORAGE_DIR, key));
  } catch {
    throw new InvoicePdfNotFoundError(key);
  }
  return `${LOCAL_STORAGE_BASE_URL}/${key}`;
}
