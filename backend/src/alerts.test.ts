import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "ALERT-TEST-";

async function makeTestItem(cookie: string, type: "RAW_MATERIAL" | "PACKAGING", baseUnit: "G" | "ML" | "PIECE") {
  const sku = `${TEST_SKU_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app).post("/items").set("Cookie", cookie).send({ sku, name: "Alert Test Item", type, baseUnit });
  return res.body.data.id as string;
}

async function postOpeningStock(cookie: string, itemId: string, qtyBase: number) {
  await request(app).post("/inventory/opening-stock").set("Cookie", cookie).send({ itemId, qtyBase, totalCostPaise: qtyBase * 10 });
}

async function setReorderLevel(cookie: string, itemId: string, reorderLevel: number) {
  return request(app).patch(`/alerts/items/${itemId}/reorder-level`).set("Cookie", cookie).send({ reorderLevel });
}

type StockStatusRow = { itemId: string; status: "LOW" | "NORMAL"; reorderLevel: number | null };

async function getStockStatusRow(cookie: string, itemId: string) {
  const res = await request(app).get("/alerts/stock-status").set("Cookie", cookie);
  return (res.body.data as StockStatusRow[]).find((r) => r.itemId === itemId);
}

describe("low-stock alerts", () => {
  afterAll(async () => {
    // Test items would otherwise linger (with their alerts) on the real
    // Low Stock Alerts page forever — delete the alerts this suite created,
    // then deactivate the test items themselves, same convention as
    // orders.test.ts's cleanup.
    await prisma.lowStockAlert.deleteMany({ where: { item: { sku: { startsWith: TEST_SKU_PREFIX } } } });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });


  it("reproduces the brief's benchmark: 120kg flour/100kg threshold is Normal, 19.5L oil/25L threshold is Low", async () => {
    const cookie = await loginAs("admin@porulottam.test");

    const flourId = await makeTestItem(cookie, "RAW_MATERIAL", "G");
    await postOpeningStock(cookie, flourId, 120_000); // 120 kg in grams
    await setReorderLevel(cookie, flourId, 100_000); // 100 kg threshold
    const flourRow = await getStockStatusRow(cookie, flourId);
    expect(flourRow?.status).toBe("NORMAL");

    const oilId = await makeTestItem(cookie, "RAW_MATERIAL", "ML");
    await postOpeningStock(cookie, oilId, 19_500); // 19.5 L in ml
    await setReorderLevel(cookie, oilId, 25_000); // 25 L threshold
    const oilRow = await getStockStatusRow(cookie, oilId);
    expect(oilRow?.status).toBe("LOW");
  });

  it("creates exactly one active alert, deduplicates on repeat checks, and auto-resolves on replenishment", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestItem(cookie, "PACKAGING", "PIECE");

    await postOpeningStock(cookie, itemId, 50);
    await setReorderLevel(cookie, itemId, 100); // immediately below threshold -> creates an alert

    const afterFirst = await request(app).get("/alerts?status=ACTIVE").set("Cookie", cookie);
    const activeForItem = (afterFirst.body.data as { itemId: string }[]).filter((a) => a.itemId === itemId);
    expect(activeForItem.length).toBe(1);

    // Re-triggering a sync for the same item (another opening-stock post would
    // conflict with the one-per-item constraint, so post a purchase instead,
    // which also exercises the purchases-service sync path) without crossing
    // back above threshold must not create a second active alert.
    await request(app).post("/purchases").set("Cookie", cookie).send({
      supplierId: (await request(app).get("/suppliers").set("Cookie", cookie)).body.data.items[0].id,
      items: [{ itemId, qtyBase: 10, rateBasePaise: 10 }],
    });
    const afterSecond = await request(app).get("/alerts?status=ACTIVE").set("Cookie", cookie);
    expect((afterSecond.body.data as { itemId: string }[]).filter((a) => a.itemId === itemId).length).toBe(1);

    // Replenish well above threshold -> the active alert resolves.
    await request(app).post("/purchases").set("Cookie", cookie).send({
      supplierId: (await request(app).get("/suppliers").set("Cookie", cookie)).body.data.items[0].id,
      items: [{ itemId, qtyBase: 100, rateBasePaise: 10 }],
    });
    const rowAfterReplenish = await getStockStatusRow(cookie, itemId);
    expect(rowAfterReplenish?.status).toBe("NORMAL");
    const activeAfterReplenish = await request(app).get("/alerts?status=ACTIVE").set("Cookie", cookie);
    expect((activeAfterReplenish.body.data as { itemId: string }[]).filter((a) => a.itemId === itemId).length).toBe(0);
    const resolvedAfterReplenish = await request(app).get("/alerts?status=RESOLVED").set("Cookie", cookie);
    expect((resolvedAfterReplenish.body.data as { itemId: string }[]).filter((a) => a.itemId === itemId).length).toBe(1);
  });

  it("an item with no reorder level configured is never flagged Low", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestItem(cookie, "RAW_MATERIAL", "G");
    await postOpeningStock(cookie, itemId, 1);
    const row = await getStockStatusRow(cookie, itemId);
    expect(row?.status).toBe("NORMAL");
    expect(row?.reorderLevel).toBeNull();
  });

  it("a non-ADMIN/OWNER role cannot configure a reorder level", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const itemId = await makeTestItem(adminCookie, "RAW_MATERIAL", "G");
    const productionCookie = await loginAs("production@porulottam.test");
    const res = await request(app)
      .patch(`/alerts/items/${itemId}/reorder-level`)
      .set("Cookie", productionCookie)
      .send({ reorderLevel: 10 });
    expect(res.status).toBe(403);
  });

  it("a salesman cannot view stock status", async () => {
    const cookie = await loginAs("salesman@porulottam.test");
    const res = await request(app).get("/alerts/stock-status").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });
});
