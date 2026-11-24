import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/AppError.js";
import { AUTH_COOKIE, type JwtPayload, verifyToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: JwtPayload["role"] };
    }
  }
}

// Verifies the token, then re-checks the user against the database on every
// request — role and active/inactive status are read fresh here, never
// trusted from the (possibly stale, up to 8h old) token payload. This closes
// the gap where a deactivated user or a changed role would otherwise keep
// working until the token naturally expired.
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) {
    next(new AppError(401, "unauthenticated", "No session token"));
    return;
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    next(new AppError(401, "unauthenticated", "Invalid or expired session"));
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.active) {
    next(new AppError(401, "unauthenticated", "User no longer exists or is inactive"));
    return;
  }

  req.user = { id: user.id, role: user.role };
  next();
}

export function requireRole(...roles: JwtPayload["role"][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new AppError(403, "forbidden", "Not allowed for this role"));
      return;
    }
    next();
  };
}

// The problem statement's accountant/auditor role is desktop, read-only:
// enforced here at the middleware level, never only hidden in the UI.
export function requireWriteAccess(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role === "ACCOUNTANT") {
    next(new AppError(403, "forbidden", "Accountant role is read-only"));
    return;
  }
  next();
}
