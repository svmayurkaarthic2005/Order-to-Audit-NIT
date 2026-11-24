import { Router } from "express";
import { validate } from "../../lib/validate.js";
import { AUTH_COOKIE } from "../../lib/jwt.js";
import { requireAuth } from "../../middleware/auth.js";
import { loginSchema } from "./schema.js";
import { getMe, login } from "./service.js";

export const authRouter = Router();

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 8 * 60 * 60 * 1000,
};

authRouter.post("/login", validate("body", loginSchema), async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const { token, user } = await login(email, password);
  res.cookie(AUTH_COOKIE, token, cookieOptions);
  res.json({ data: { token, user } });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE);
  res.json({ data: { ok: true } });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const me = await getMe(req.user!.sub);
  res.json({ data: me });
});
