import nodemailer from "nodemailer";
import { AppError } from "./AppError.js";

// Read lazily, not cached at module load: lets tests toggle GMAIL_USER/
// GMAIL_APP_PASSWORD at runtime instead of needing them set before this
// module is first imported.
function credentials() {
  return { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD };
}

export function isMailerConfigured(): boolean {
  const { user, pass } = credentials();
  return Boolean(user && pass);
}

// No transporter caching: credentials can change between calls (tests),
// and nodemailer's Gmail transport is cheap to construct.
function getTransporter(user: string, pass: string) {
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

// No-op fallback when GMAIL_USER/GMAIL_APP_PASSWORD aren't set: callers see
// a clear 503, not a silent "success" that never actually reached anyone.
export async function sendMail(params: {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
}): Promise<void> {
  const { user, pass } = credentials();
  if (!user || !pass) {
    throw new AppError(503, "email_not_configured", "Email delivery is not configured on this server");
  }
  await getTransporter(user, pass).sendMail({ from: user, ...params });
}
