import jwt from "jsonwebtoken";

const DEV_FALLBACK_SECRET = "dev-only-insecure-secret";

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production — refusing to start with a fallback secret.");
}

export const JWT_SECRET = process.env.JWT_SECRET ?? DEV_FALLBACK_SECRET;
const ALGORITHM = "HS256" as const;

export const AUTH_COOKIE = "porulottam_token";

export type JwtPayload = {
  sub: string; // user id
  role: "SALESMAN" | "ADMIN" | "PRODUCTION" | "ACCOUNTANT" | "OWNER";
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h", algorithm: ALGORITHM });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: [ALGORITHM] }) as JwtPayload;
}
