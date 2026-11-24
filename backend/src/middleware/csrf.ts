import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// SameSite=None (required in production, since the Vercel frontend and the
// Render backend are different sites) gives up the CSRF protection
// SameSite=Lax provided locally. A browser always sends the Origin header
// on a cross-site state-changing request, so rejecting any state-changing
// request whose Origin doesn't match the real frontend closes that gap —
// without this, a malicious page could POST to this API using the
// signed-in user's own cookie. Non-browser clients (this test suite, curl,
// server-to-server calls) send no Origin header at all and are unaffected.
export function csrfOriginCheck(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const origin = req.get("origin");
  const allowedOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  if (origin && origin !== allowedOrigin) {
    res.status(403).json({ error: { code: "forbidden_origin", message: "Request origin not allowed" } });
    return;
  }
  next();
}
