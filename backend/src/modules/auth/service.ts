import bcrypt from "bcryptjs";
import { AppError } from "../../lib/AppError.js";
import { signToken } from "../../lib/jwt.js";
import { prisma } from "../../lib/prisma.js";

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    throw new AppError(401, "invalid_credentials", "Invalid email or password");
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new AppError(401, "invalid_credentials", "Invalid email or password");
  }
  const token = signToken({ sub: user.id, role: user.role });
  return { token, user: { id: user.id, role: user.role, name: user.name } };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) {
    throw new AppError(401, "unauthenticated", "User no longer exists or is inactive");
  }
  return { id: user.id, role: user.role, name: user.name };
}
