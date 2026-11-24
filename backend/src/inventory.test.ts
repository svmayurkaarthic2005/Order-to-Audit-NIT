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
  it("on-hand for Flour matches the benchmark's seeded opening stock (100 kg = 100000 g)", async () => {
    const flour = await prisma.item.findUniqueOrThrow({ where: { sku: "RM-FLOUR" } });
    const cookie = await loginAs("owner@porulottam.test");
    const res = await request(app).get(`/inventory/${flour.id}/on-hand`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.qtyBase).toBe(100_000);
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
});
