import crypto from "node:crypto";
import { JWT_SECRET } from "../../lib/jwt.js";

// A link the customer can open without logging in, for the WhatsApp share.
// It carries an expiry and an HMAC over (invoice id, expiry), so it can't
// be guessed, altered to point at another invoice, or used after it lapses.
const SHARE_TTL_DAYS = 30;

function sign(invoiceId: string, expires: number): string {
  // Prefixed so this signature can never be confused with any other use of the secret.
  return crypto.createHmac("sha256", JWT_SECRET).update(`invoice-share:${invoiceId}:${expires}`).digest("base64url");
}

export function createShareToken(invoiceId: string, now = Date.now()) {
  const expires = Math.floor(now / 1000) + SHARE_TTL_DAYS * 24 * 60 * 60;
  return { expires, signature: sign(invoiceId, expires) };
}

export function verifyShareToken(invoiceId: string, expires: number, signature: string, now = Date.now()): boolean {
  if (!Number.isInteger(expires) || expires * 1000 < now) return false;
  const expected = Buffer.from(sign(invoiceId, expires));
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
