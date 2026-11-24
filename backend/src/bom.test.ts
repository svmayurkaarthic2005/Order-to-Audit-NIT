import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "BOM-TEST-";

async function makeTestItem(cookie: string, type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD") {
  const sku = `${TEST_SKU_PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie)
    .send({ sku, name: "BOM Test Item", type, baseUnit: "G" });
  return res.body.data.id as string;
}

describe("BOM management", () => {
  afterAll(async () => {
    // BOM headers aren't deleted by deactivating their finished-good item
    // (listBoms filters on the BOM's own active flag), so they'd otherwise
    // linger in the real BOM list/UI picker across repeated test runs.
    await prisma.bomHeader.updateMany({
      where: { finishedItem: { sku: { startsWith: TEST_SKU_PREFIX } } },
      data: { active: false },
    });
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });

  it("the seeded benchmark BOM has the exact per-batch quantities and an expected yield of 200, not 238", async () => {
    const cookie = await loginAs("owner@porulottam.test");
    const murukku = await prisma.item.findUniqueOrThrow({ where: { sku: "FG-MURUKKU-200G" } });
    const boms = await request(app).get("/boms").set("Cookie", cookie);
    const bom = boms.body.data.find((b: { finishedItemId: string }) => b.finishedItemId === murukku.id);
    expect(bom.expectedYieldQty).toBe(200);

    const lineByRawSku = new Map(bom.lines.map((l: { rawItem: { sku: string }; qtyPerBatch: number }) => [l.rawItem.sku, l.qtyPerBatch]));
    expect(lineByRawSku.get("RM-FLOUR")).toBe(40_000); // 40 kg
    expect(lineByRawSku.get("RM-OIL")).toBe(10_000); // 10 L
    expect(lineByRawSku.get("RM-SPICE")).toBe(1_200); // 1.2 kg
    expect(lineByRawSku.get("PKG-POUCH-200G")).toBe(200);
    expect(lineByRawSku.get("PKG-CARTON-20")).toBe(10);

    expect(bom.packSizes).toHaveLength(1);
    expect(bom.packSizes[0].label).toBe("200g");
  });

  it("creates a BOM with its lines inside one transaction", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const finishedId = await makeTestItem(cookie, "FINISHED_GOOD");
    const rawId = await makeTestItem(cookie, "RAW_MATERIAL");

    const res = await request(app)
      .post("/boms")
      .set("Cookie", cookie)
      .send({ finishedItemId: finishedId, expectedYieldQty: 100, lines: [{ rawItemId: rawId, qtyPerBatch: 500 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.lines).toHaveLength(1);
  });

  it("rejects a BOM whose output item is not a finished good", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const notFinished = await makeTestItem(cookie, "RAW_MATERIAL");
    const rawId = await makeTestItem(cookie, "RAW_MATERIAL");

    const res = await request(app)
      .post("/boms")
      .set("Cookie", cookie)
      .send({ finishedItemId: notFinished, expectedYieldQty: 100, lines: [{ rawItemId: rawId, qtyPerBatch: 500 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_item_type");
  });

  it("rejects a BOM line that consumes another finished good", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const finishedId = await makeTestItem(cookie, "FINISHED_GOOD");
    const anotherFinished = await makeTestItem(cookie, "FINISHED_GOOD");

    const res = await request(app)
      .post("/boms")
      .set("Cookie", cookie)
      .send({ finishedItemId: finishedId, expectedYieldQty: 100, lines: [{ rawItemId: anotherFinished, qtyPerBatch: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_item_type");
  });

  it("rejects a BOM that lists the same raw item twice", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const finishedId = await makeTestItem(cookie, "FINISHED_GOOD");
    const rawId = await makeTestItem(cookie, "RAW_MATERIAL");

    const res = await request(app)
      .post("/boms")
      .set("Cookie", cookie)
      .send({
        finishedItemId: finishedId,
        expectedYieldQty: 100,
        lines: [
          { rawItemId: rawId, qtyPerBatch: 500 },
          { rawItemId: rawId, qtyPerBatch: 200 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("duplicate_line");
  });

  it("creates a pack size off an existing base BOM", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const finishedId = await makeTestItem(cookie, "FINISHED_GOOD");
    const rawId = await makeTestItem(cookie, "RAW_MATERIAL");
    const bomRes = await request(app)
      .post("/boms")
      .set("Cookie", cookie)
      .send({ finishedItemId: finishedId, expectedYieldQty: 100, lines: [{ rawItemId: rawId, qtyPerBatch: 500 }] });

    const res = await request(app)
      .post("/pack-sizes")
      .set("Cookie", cookie)
      .send({ finishedItemId: finishedId, baseBomId: bomRes.body.data.id, multiplier: 2, label: "test-500g" });
    expect(res.status).toBe(201);
    expect(res.body.data.multiplier).toBe(2);
  });

  it("rejects a pack size with no base BOM, with a clear error", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const finishedId = await makeTestItem(cookie, "FINISHED_GOOD");

    const res = await request(app)
      .post("/pack-sizes")
      .set("Cookie", cookie)
      .send({ finishedItemId: finishedId, baseBomId: "00000000-0000-0000-0000-000000000000", multiplier: 1, label: "test-nope" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_base_bom");
  });

  it("a salesman cannot create a BOM but can read none either (no business reason)", async () => {
    const cookie = await loginAs("salesman@porulottam.test");
    const listRes = await request(app).get("/boms").set("Cookie", cookie);
    expect(listRes.status).toBe(403);

    const createRes = await request(app)
      .post("/boms")
      .set("Cookie", cookie)
      .send({ finishedItemId: "x", expectedYieldQty: 1, lines: [{ rawItemId: "y", qtyPerBatch: 1 }] });
    expect(createRes.status).toBe(403);
  });

  it("a production-role user can read BOMs but cannot create one", async () => {
    const cookie = await loginAs("production@porulottam.test");
    const listRes = await request(app).get("/boms").set("Cookie", cookie);
    expect(listRes.status).toBe(200);

    const createRes = await request(app)
      .post("/boms")
      .set("Cookie", cookie)
      .send({ finishedItemId: "x", expectedYieldQty: 1, lines: [{ rawItemId: "y", qtyPerBatch: 1 }] });
    expect(createRes.status).toBe(403);
  });
});
