import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

describe("auth + RBAC", () => {
  it("logs in with correct credentials", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@porulottam.test", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe("ADMIN");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects a wrong password with 401", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@porulottam.test", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_credentials");
  });

  it("a salesman token hitting an admin-only route returns 403", async () => {
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "salesman@porulottam.test", password: "password123" });
    const cookie = loginRes.headers["set-cookie"];

    const res = await request(app).get("/debug/admin-only").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("an accountant token hitting a mutating demo route returns 403", async () => {
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "accountant@porulottam.test", password: "password123" });
    const cookie = loginRes.headers["set-cookie"];

    const res = await request(app).post("/debug/mutate-test").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("GET /auth/me returns 401 with no token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /auth/me returns the user when authenticated", async () => {
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "owner@porulottam.test", password: "password123" });
    const cookie = loginRes.headers["set-cookie"];

    const res = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("OWNER");
  });

  it("a still-valid token for a user deactivated after login is rejected (no stale authorization)", async () => {
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: "production@porulottam.test", password: "password123" });
    const cookie = loginRes.headers["set-cookie"];

    await prisma.user.update({
      where: { email: "production@porulottam.test" },
      data: { active: false },
    });

    try {
      const res = await request(app).get("/auth/me").set("Cookie", cookie);
      expect(res.status).toBe(401);
    } finally {
      await prisma.user.update({
        where: { email: "production@porulottam.test" },
        data: { active: true },
      });
    }
  });
});
