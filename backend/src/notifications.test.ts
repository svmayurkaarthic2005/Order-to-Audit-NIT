import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

// ── Helpers ────────────────────────────────────────────────────────────────

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"] as string | string[];
}

async function getNotifications(cookie: string | string[], unreadOnly?: boolean) {
  const url = unreadOnly ? "/notifications?unreadOnly=true" : "/notifications";
  return request(app).get(url).set("Cookie", cookie as string);
}

// ── Seed helpers ───────────────────────────────────────────────────────────

const TEST_PREFIX = "NOTIF-TEST-";

/** Directly insert a notification row for deterministic testing. */
async function seedNotification(overrides: {
  type: string;
  recipientRoles?: string[];
  recipientUserId?: string;
  sourceType?: string;
  sourceId?: string;
  severity?: string;
}) {
  const dedupeKey = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.notification.create({
    data: {
      type: overrides.type as never,
      recipientRoles: (overrides.recipientRoles ?? []) as never,
      recipientUserId: overrides.recipientUserId ?? null,
      title: "Test notification",
      message: "This is a test",
      severity: (overrides.severity ?? "INFO") as never,
      sourceType: overrides.sourceType ?? "LowStockAlert",
      sourceId: overrides.sourceId ?? "test-source-id",
      dedupeKey,
    },
  });
}

// ── Teardown ───────────────────────────────────────────────────────────────

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { dedupeKey: { startsWith: TEST_PREFIX } } });
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("notifications — dedup", () => {
  it("upsert with same dedupeKey never creates a second row", async () => {
    const dedupeKey = `${TEST_PREFIX}dedup-${Date.now()}`;

    // Insert same key twice via the service-level notify()
    // We exercise the endpoint indirectly but it's cleaner to call the DB directly
    await prisma.notification.upsert({
      where: { dedupeKey },
      create: {
        type: "LOW_STOCK",
        recipientRoles: ["ADMIN"],
        title: "Dedup test",
        message: "First",
        severity: "INFO",
        sourceType: "LowStockAlert",
        sourceId: "dedup-src",
        dedupeKey,
      },
      update: {},
    });
    await prisma.notification.upsert({
      where: { dedupeKey },
      create: {
        type: "LOW_STOCK",
        recipientRoles: ["ADMIN"],
        title: "Should not be created",
        message: "Second",
        severity: "CRITICAL",
        sourceType: "LowStockAlert",
        sourceId: "dedup-src",
        dedupeKey,
      },
      update: {},
    });

    const rows = await prisma.notification.findMany({ where: { dedupeKey } });
    expect(rows).toHaveLength(1);
    // Second upsert's update:{} means the original message is preserved
    expect(rows[0].message).toBe("First");
  });
});

describe("notifications — role visibility", () => {
  let adminCookie: string | string[];
  let ownerCookie: string | string[];
  let productionCookie: string | string[];
  let accountantCookie: string | string[];

  beforeAll(async () => {
    [adminCookie, ownerCookie, productionCookie, accountantCookie] = await Promise.all([
      loginAs("admin@porulottam.test"),
      loginAs("owner@porulottam.test"),
      loginAs("production@porulottam.test"),
      loginAs("accountant@porulottam.test"),
    ]);

    // Seed a LOW_STOCK broadcast
    await seedNotification({ type: "LOW_STOCK", recipientRoles: ["OWNER", "ADMIN", "PRODUCTION"], sourceType: "LowStockAlert" });
    // Seed an AUDIT_EXCEPTION broadcast
    await seedNotification({ type: "AUDIT_EXCEPTION", recipientRoles: ["ACCOUNTANT"], sourceType: "AuditLog" });
    // Seed a PRODUCTION_VARIANCE
    await seedNotification({ type: "PRODUCTION_VARIANCE", recipientRoles: ["OWNER", "PRODUCTION"], sourceType: "ProductionRun" });
  });

  it("ADMIN sees LOW_STOCK", async () => {
    const res = await getNotifications(adminCookie);
    expect(res.status).toBe(200);
    const types = res.body.data.items.map((n: { type: string }) => n.type);
    expect(types).toContain("LOW_STOCK");
  });

  it("ADMIN does NOT see AUDIT_EXCEPTION", async () => {
    const res = await getNotifications(adminCookie);
    const types = res.body.data.items.map((n: { type: string }) => n.type);
    expect(types).not.toContain("AUDIT_EXCEPTION");
  });

  it("ACCOUNTANT sees AUDIT_EXCEPTION", async () => {
    const res = await getNotifications(accountantCookie);
    expect(res.status).toBe(200);
    const types = res.body.data.items.map((n: { type: string }) => n.type);
    expect(types).toContain("AUDIT_EXCEPTION");
  });

  it("PRODUCTION sees LOW_STOCK and PRODUCTION_VARIANCE", async () => {
    const res = await getNotifications(productionCookie);
    expect(res.status).toBe(200);
    const types = res.body.data.items.map((n: { type: string }) => n.type);
    expect(types).toContain("LOW_STOCK");
    expect(types).toContain("PRODUCTION_VARIANCE");
  });

  it("OWNER sees everything seeded in this suite", async () => {
    const res = await getNotifications(ownerCookie);
    expect(res.status).toBe(200);
    const types = res.body.data.items.map((n: { type: string }) => n.type);
    expect(types).toContain("LOW_STOCK");
    expect(types).toContain("PRODUCTION_VARIANCE");
    // Owner sees all — including AUDIT_EXCEPTION
    expect(types).toContain("AUDIT_EXCEPTION");
  });
});

describe("notifications — read/unread count", () => {
  it("unreadCount decreases after marking one read", async () => {
    const cookie = await loginAs("owner@porulottam.test");

    // Seed 3 unread
    const [n1, n2] = await Promise.all([
      seedNotification({ type: "LOW_STOCK", recipientRoles: ["OWNER"] }),
      seedNotification({ type: "PRODUCTION_VARIANCE", recipientRoles: ["OWNER"] }),
      seedNotification({ type: "EXPIRY_WARNING", recipientRoles: ["OWNER"] }),
    ]);

    const before = await getNotifications(cookie);
    const countBefore = before.body.data.unreadCount as number;
    expect(countBefore).toBeGreaterThanOrEqual(3);

    // Mark one read
    await request(app).patch(`/notifications/${n1.id}/read`).set("Cookie", cookie as string);

    const after = await getNotifications(cookie);
    expect(after.body.data.unreadCount).toBe(countBefore - 1);

    // Mark all read
    await request(app).patch("/notifications/read-all").set("Cookie", cookie as string);
    const final = await getNotifications(cookie);
    expect(final.body.data.unreadCount).toBe(0);

    // Cleanup seeded rows
    await prisma.notification.deleteMany({ where: { id: { in: [n1.id, n2.id] } } });
  });
});
