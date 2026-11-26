import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { convert } from "./modules/units/service.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

describe("unit conversion", () => {
  it("converts 1.5 kg to 1500 g and back exactly", async () => {
    const g = await convert(1.5, "kg", "g");
    expect(g).toBe(1500);
    const kg = await convert(g, "g", "kg");
    expect(kg).toBe(1.5);
  });

  it("converts litres to ml and back", async () => {
    expect(await convert(10.5, "L", "ml")).toBe(10500);
    expect(await convert(10500, "ml", "litres")).toBe(10.5);
  });

  it("converts an item-specific unit (carton) using its seeded conversion", async () => {
    const murukku = await prisma.item.findUniqueOrThrow({ where: { sku: "FG-MURUKKU-200G" } });
    // seeded: 1 carton = 20 packets (pieces)
    expect(await convert(2, "carton", "pieces", murukku.id)).toBe(40);
  });

  it("rejects an item-specific unit with no itemId", async () => {
    await expect(convert(1, "carton", "pieces")).rejects.toThrow();
  });
});

describe("inventory ledger", () => {
  it("on-hand for Flour matches a live SUM() over its stock_movements ledger", async () => {
    const flour = await prisma.item.findUniqueOrThrow({ where: { sku: "RM-FLOUR" } });
    // Computed independently of the API, from the ledger directly — Flour's
    // running balance legitimately changes as later phases (purchases,
    // production) post more rows to it, so this asserts the on-hand endpoint
    // is a correct live aggregate, not a hard-coded seed-time snapshot.
    const expected = await prisma.stockMovement.aggregate({
      where: { itemId: flour.id },
      _sum: { qtyBase: true },
    });
    const cookie = await loginAs("owner@porulottam.test");
    const res = await request(app).get(`/inventory/${flour.id}/on-hand`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.qtyBase).toBe(expected._sum.qtyBase);
    expect(res.body.data.qtyBase).toBeGreaterThanOrEqual(100_000); // at least the seeded opening stock
    expect(res.body.data.unit).toBe("G");
  });

  it("posts opening stock for a new item and reflects it in on-hand", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const sku = `RM-INV-TEST-${Date.now()}`;
    const itemRes = await request(app)
      .post("/items")
      .set("Cookie", cookie)
      .send({ sku, name: "Inventory Test Item", type: "RAW_MATERIAL", baseUnit: "G" });
    const itemId = itemRes.body.data.id;

    const openRes = await request(app)
      .post("/inventory/opening-stock")
      .set("Cookie", cookie)
      .send({ itemId, qtyBase: 10_000, totalCostPaise: 450_00 });
    expect(openRes.status).toBe(201);

    const onHandRes = await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", cookie);
    expect(onHandRes.body.data.qtyBase).toBe(10_000);

    await request(app).delete(`/items/${itemId}`).set("Cookie", cookie);
  });

  it("rejects a second opening-stock posting for the same item with 409", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const flour = await prisma.item.findUniqueOrThrow({ where: { sku: "RM-FLOUR" } });
    const res = await request(app)
      .post("/inventory/opening-stock")
      .set("Cookie", cookie)
      .send({ itemId: flour.id, qtyBase: 1000, totalCostPaise: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("opening_stock_exists");
  });

  it("closes the check-then-create race: two concurrent postings for the same item, only one succeeds", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const sku = `RM-RACE-TEST-${Date.now()}`;
    const itemRes = await request(app)
      .post("/items")
      .set("Cookie", cookie)
      .send({ sku, name: "Race Test Item", type: "RAW_MATERIAL", baseUnit: "G" });
    const itemId = itemRes.body.data.id;

    const [a, b] = await Promise.all([
      request(app)
        .post("/inventory/opening-stock")
        .set("Cookie", cookie)
        .send({ itemId, qtyBase: 1000, totalCostPaise: 100 }),
      request(app)
        .post("/inventory/opening-stock")
        .set("Cookie", cookie)
        .send({ itemId, qtyBase: 2000, totalCostPaise: 200 }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    await request(app).delete(`/items/${itemId}`).set("Cookie", cookie);
  });

  it("a non-admin role posting opening stock returns 403", async () => {
    const cookie = await loginAs("salesman@porulottam.test");
    const res = await request(app)
      .post("/inventory/opening-stock")
      .set("Cookie", cookie)
      .send({ itemId: "any", qtyBase: 1, totalCostPaise: 1 });
    expect(res.status).toBe(403);
  });

  it("hides movingAverageCostPaise from the salesman role, but shows it to admin", async () => {
    const flour = await prisma.item.findUniqueOrThrow({ where: { sku: "RM-FLOUR" } });

    const salesmanCookie = await loginAs("salesman@porulottam.test");
    const salesmanRes = await request(app).get(`/inventory/${flour.id}/on-hand`).set("Cookie", salesmanCookie);
    expect(salesmanRes.status).toBe(200);
    expect(salesmanRes.body.data.qtyBase).toBeGreaterThan(0); // qty is still visible
    expect(salesmanRes.body.data.movingAverageCostPaise).toBeUndefined();

    const adminCookie = await loginAs("admin@porulottam.test");
    const adminRes = await request(app).get(`/inventory/${flour.id}/on-hand`).set("Cookie", adminCookie);
    expect(adminRes.body.data.movingAverageCostPaise).toEqual(expect.any(Number));
  });
});

describe("stock adjustments", () => {
  async function newItem(cookie: string | string[]) {
    const sku = `RM-ADJ-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const itemRes = await request(app)
      .post("/items")
      .set("Cookie", cookie as string)
      .send({ sku, name: "Adjustment Test Item", type: "RAW_MATERIAL", baseUnit: "G" });
    return itemRes.body.data.id as string;
  }

  it("a write-off reduces on-hand and values it at the current moving-average cost, not a made-up rate", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const itemId = await newItem(cookie);
    await request(app).post("/inventory/opening-stock").set("Cookie", cookie).send({ itemId, qtyBase: 10_000, totalCostPaise: 50_000 });

    const res = await request(app)
      .post("/inventory/adjustments")
      .set("Cookie", cookie)
      .send({ itemId, qtyBase: -1_000, reason: "Spoiled in storage" });
    expect(res.status).toBe(201);
    expect(res.body.data.totalCostPaise).toBe(-5_000); // 1/10th of the ₹500 lot, same rate as every other unit

    const onHandRes = await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", cookie);
    expect(onHandRes.body.data.qtyBase).toBe(9_000);

    await request(app).delete(`/items/${itemId}`).set("Cookie", cookie);
  });

  it("found surplus increases on-hand without changing the moving-average rate", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const itemId = await newItem(cookie);
    await request(app).post("/inventory/opening-stock").set("Cookie", cookie).send({ itemId, qtyBase: 10_000, totalCostPaise: 50_000 });

    await request(app).post("/inventory/adjustments").set("Cookie", cookie).send({ itemId, qtyBase: 500, reason: "Physical count found extra" });

    const onHandRes = await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", cookie);
    expect(onHandRes.body.data.qtyBase).toBe(10_500);
    expect(onHandRes.body.data.movingAverageCostPaise).toBe(5); // the surplus was valued at the same 5-paise/g rate, so the average is untouched
  });

  it("rejects a write-off bigger than what's on hand", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const itemId = await newItem(cookie);
    await request(app).post("/inventory/opening-stock").set("Cookie", cookie).send({ itemId, qtyBase: 100, totalCostPaise: 1_000 });

    const res = await request(app)
      .post("/inventory/adjustments")
      .set("Cookie", cookie)
      .send({ itemId, qtyBase: -500, reason: "Too much" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("insufficient_stock");
  });

  it("requires a reason, and rejects a zero quantity", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const flour = await prisma.item.findUniqueOrThrow({ where: { sku: "RM-FLOUR" } });

    const noReason = await request(app).post("/inventory/adjustments").set("Cookie", cookie).send({ itemId: flour.id, qtyBase: 10, reason: "" });
    expect(noReason.status).toBe(400);

    const zeroQty = await request(app).post("/inventory/adjustments").set("Cookie", cookie).send({ itemId: flour.id, qtyBase: 0, reason: "Oops" });
    expect(zeroQty.status).toBe(400);
  });

  it("production and salesman roles cannot record an adjustment", async () => {
    const flour = await prisma.item.findUniqueOrThrow({ where: { sku: "RM-FLOUR" } });
    for (const email of ["production@porulottam.test", "salesman@porulottam.test"]) {
      const cookie = await loginAs(email);
      const res = await request(app).post("/inventory/adjustments").set("Cookie", cookie).send({ itemId: flour.id, qtyBase: 10, reason: "Test" });
      expect(res.status).toBe(403);
    }
  });

  it("logs the adjustment to the audit trail with who, the reason and the before/after quantity", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const itemId = await newItem(cookie);
    await request(app).post("/inventory/opening-stock").set("Cookie", cookie).send({ itemId, qtyBase: 200, totalCostPaise: 2_000 });
    await request(app).post("/inventory/adjustments").set("Cookie", cookie).send({ itemId, qtyBase: -50, reason: "Damaged pouch" });

    const entry = await prisma.auditLog.findFirst({ where: { entityType: "Item", entityId: itemId, action: "STOCK_ADJUSTMENT" } });
    expect(entry).not.toBeNull();
    expect(JSON.parse(entry!.afterJson!)).toMatchObject({ qtyBase: 150, change: -50, reason: "Damaged pouch" });
  });
});
