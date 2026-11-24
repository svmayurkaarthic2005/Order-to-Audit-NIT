import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/AppError.js";
import { AUTH_COOKIE, type JwtPayload, verifyToken } from "../lib/jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) {
    next(new AppError(401, "unauthenticated", "No session token"));
    return;
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(new AppError(401, "unauthenticated", "Invalid or expired session"));
  }
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
