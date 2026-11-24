import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "RM-PURCH-TEST-";

async function makeTestItem(cookie: string) {
  const sku = `${TEST_SKU_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie)
    .send({ sku, name: "Purchase Test Item", type: "RAW_MATERIAL", baseUnit: "G" });
  return res.body.data.id as string;
}

describe("purchases", () => {
  // Several tests here create real items to avoid colliding with each other
  // or with seeded data; clean them up so the dev DB (and the item pickers
  // in the UI) don't accumulate dozens of "Purchase Test Item" rows.
  afterAll(async () => {
    await prisma.item.updateMany({
      where: { sku: { startsWith: TEST_SKU_PREFIX } },
      data: { active: false },
    });
  });

  it("records a purchase inside one transaction and posts a stock_movements receipt per line", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: "general-supplier" } });
    const itemId = await makeTestItem(cookie);

    const res = await request(app)
      .post("/purchases")
      .set("Cookie", cookie)
      .send({ supplierId: supplier.id, items: [{ itemId, qtyBase: 60_000, rateBasePaise: 45 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.items).toHaveLength(1);

    const onHand = await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", cookie);
    expect(onHand.body.data.qtyBase).toBe(60_000);
  });

  it("computes the correct moving-average cost across two purchases at different rates", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: "general-supplier" } });
    const itemId = await makeTestItem(cookie);

    // 40,000 g @ 45 paise/g, then 20,000 g @ 60 paise/g
    await request(app)
      .post("/purchases")
      .set("Cookie", cookie)
      .send({ supplierId: supplier.id, items: [{ itemId, qtyBase: 40_000, rateBasePaise: 45 }] });
    await request(app)
      .post("/purchases")
      .set("Cookie", cookie)
      .send({ supplierId: supplier.id, items: [{ itemId, qtyBase: 20_000, rateBasePaise: 60 }] });

    const expectedAvg = Math.round((40_000 * 45 + 20_000 * 60) / 60_000);
    const onHand = await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", cookie);
    expect(onHand.body.data.qtyBase).toBe(60_000);
    expect(onHand.body.data.movingAverageCostPaise).toBe(expectedAvg);
  });

  it("rejects purchasing a finished good (produced, not purchased)", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: "general-supplier" } });
    const murukku = await prisma.item.findUniqueOrThrow({ where: { sku: "FG-MURUKKU-200G" } });

    const res = await request(app)
      .post("/purchases")
      .set("Cookie", cookie)
      .send({ supplierId: supplier.id, items: [{ itemId: murukku.id, qtyBase: 1, rateBasePaise: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_item_type");
  });

  it("a transaction with one bad line rolls back entirely — no partial purchase, no stray stock_movements", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: "general-supplier" } });
    const goodItemId = await makeTestItem(cookie);

    const res = await request(app)
      .post("/purchases")
      .set("Cookie", cookie)
      .send({
        supplierId: supplier.id,
        items: [
          { itemId: goodItemId, qtyBase: 100, rateBasePaise: 10 },
          { itemId: "00000000-0000-0000-0000-000000000000", qtyBase: 100, rateBasePaise: 10 },
        ],
      });
    expect(res.status).toBe(404);

    const onHand = await request(app).get(`/inventory/${goodItemId}/on-hand`).set("Cookie", cookie);
    expect(onHand.body.data.qtyBase).toBe(0); // nothing posted despite the valid first line
  });

  it("cancelling a purchase posts an offsetting reversal and never deletes the original rows", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: "general-supplier" } });
    const itemId = await makeTestItem(cookie);

    const createRes = await request(app)
      .post("/purchases")
      .set("Cookie", cookie)
      .send({ supplierId: supplier.id, items: [{ itemId, qtyBase: 5000, rateBasePaise: 20 }] });
    const purchaseId = createRes.body.data.id;

    const beforeOnHand = await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", cookie);
    expect(beforeOnHand.body.data.qtyBase).toBe(5000);

    const cancelRes = await request(app).post(`/purchases/${purchaseId}/cancel`).set("Cookie", cookie);
    expect(cancelRes.status).toBe(200);

    const afterOnHand = await request(app).get(`/inventory/${itemId}/on-hand`).set("Cookie", cookie);
    expect(afterOnHand.body.data.qtyBase).toBe(0); // back to pre-purchase value, via an offsetting row

    const movements = await prisma.stockMovement.findMany({ where: { itemId } });
    expect(movements).toHaveLength(2); // original PURCHASE row still present, plus the reversal
    expect(movements.map((m) => m.source).sort()).toEqual(["PURCHASE", "PURCHASE_REVERSAL"]);
  });

  it("cancelling an already-cancelled purchase returns 409", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: "general-supplier" } });
    const itemId = await makeTestItem(cookie);

    const createRes = await request(app)
      .post("/purchases")
      .set("Cookie", cookie)
      .send({ supplierId: supplier.id, items: [{ itemId, qtyBase: 100, rateBasePaise: 10 }] });
    const purchaseId = createRes.body.data.id;

    await request(app).post(`/purchases/${purchaseId}/cancel`).set("Cookie", cookie);
    const res = await request(app).post(`/purchases/${purchaseId}/cancel`).set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("already_cancelled");
  });

  it("closes the cancel race: two concurrent cancel requests, only one posts a reversal", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: "general-supplier" } });
    const itemId = await makeTestItem(cookie);

    const createRes = await request(app)
      .post("/purchases")
      .set("Cookie", cookie)
      .send({ supplierId: supplier.id, items: [{ itemId, qtyBase: 100, rateBasePaise: 10 }] });
    const purchaseId = createRes.body.data.id;

    const [a, b] = await Promise.all([
      request(app).post(`/purchases/${purchaseId}/cancel`).set("Cookie", cookie),
      request(app).post(`/purchases/${purchaseId}/cancel`).set("Cookie", cookie),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const reversals = await prisma.stockMovement.findMany({
      where: { itemId, source: "PURCHASE_REVERSAL" },
    });
    expect(reversals).toHaveLength(1); // not two, despite two concurrent cancel requests
  });

  it("a non-recording role (salesman) creating a purchase returns 403", async () => {
    const cookie = await loginAs("salesman@porulottam.test");
    const res = await request(app)
      .post("/purchases")
      .set("Cookie", cookie)
      .send({ supplierId: "general-supplier", items: [{ itemId: "x", qtyBase: 1, rateBasePaise: 1 }] });
    expect(res.status).toBe(403);
  });

  it("a production-role user CAN record a purchase, per the problem statement's role table", async () => {
    const cookie = await loginAs("production@porulottam.test");
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: "general-supplier" } });
    const itemId = await makeTestItem(await loginAs("admin@porulottam.test"));

    const res = await request(app)
      .post("/purchases")
      .set("Cookie", cookie)
      .send({ supplierId: supplier.id, items: [{ itemId, qtyBase: 10, rateBasePaise: 10 }] });
    expect(res.status).toBe(201);
  });

  it("a salesman cannot read purchases (no business reason to see supplier costs)", async () => {
    const cookie = await loginAs("salesman@porulottam.test");
    const listRes = await request(app).get("/purchases").set("Cookie", cookie);
    expect(listRes.status).toBe(403);
  });

  it("an accountant CAN read purchases (purchase register report) but cannot create one", async () => {
    const cookie = await loginAs("accountant@porulottam.test");
    const listRes = await request(app).get("/purchases").set("Cookie", cookie);
    expect(listRes.status).toBe(200);

    const createRes = await request(app)
      .post("/purchases")
      .set("Cookie", cookie)
      .send({ supplierId: "general-supplier", items: [{ itemId: "x", qtyBase: 1, rateBasePaise: 1 }] });
    expect(createRes.status).toBe(403);
  });
});
