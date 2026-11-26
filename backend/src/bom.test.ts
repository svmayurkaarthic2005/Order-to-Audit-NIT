import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "BOM-TEST-";

async function makeTestItem(cookie: string, type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD", name = "BOM Test Item") {
  const sku = `${TEST_SKU_PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie)
    .send({ sku, name, type, baseUnit: "G" });
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
    expect(bom.packSizes[0].expectedOutputQty).toBe(200);
    expect(bom.packSizes[0].packagingLines.map((line: { item: { sku: string }; qtyPerBatch: number }) => [line.item.sku, line.qtyPerBatch]))
      .toEqual([["PKG-POUCH-200G", 200], ["PKG-CARTON-20", 10]]);
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
    const packagingId = await makeTestItem(cookie, "PACKAGING");
    const bomRes = await request(app)
      .post("/boms")
      .set("Cookie", cookie)
      .send({ finishedItemId: finishedId, expectedYieldQty: 100, lines: [{ rawItemId: rawId, qtyPerBatch: 500 }] });

    const res = await request(app)
      .post("/pack-sizes")
      .set("Cookie", cookie)
      .send({
        finishedItemId: finishedId,
        baseBomId: bomRes.body.data.id,
        expectedOutputQty: 40,
        label: "test-500g",
        packagingLines: [{ itemId: packagingId, qtyPerBatch: 40 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.expectedOutputQty).toBe(40);
    expect(res.body.data.packagingLines).toHaveLength(1);
    expect(res.body.data.packagingLines[0].itemId).toBe(packagingId);
  });

  it("rejects a pack size with no base BOM, with a clear error", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const finishedId = await makeTestItem(cookie, "FINISHED_GOOD");

    const res = await request(app)
      .post("/pack-sizes")
      .set("Cookie", cookie)
      .send({ finishedItemId: finishedId, baseBomId: "00000000-0000-0000-0000-000000000000", expectedOutputQty: 100, label: "test-nope", packagingLines: [] });
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

    const editRes = await request(app).put("/boms/x").set("Cookie", cookie).send({ expectedYieldQty: 1, lines: [{ rawItemId: "y", qtyPerBatch: 1 }] });
    expect(editRes.status).toBe(403);
  });

  it("editing a recipe adds a version: the old one is retired, unchanged, and planned runs keep it until moved", async () => {
    const admin = await loginAs("admin@porulottam.test");
    const finishedId = await makeTestItem(admin, "FINISHED_GOOD");
    const flour = await makeTestItem(admin, "RAW_MATERIAL", "Test flour");
    const oil = await makeTestItem(admin, "RAW_MATERIAL", "Test oil");
    const v1 = (
      await request(app).post("/boms").set("Cookie", admin).send({ finishedItemId: finishedId, expectedYieldQty: 200, lines: [{ rawItemId: flour, qtyPerBatch: 40_000 }] })
    ).body.data;
    const plannedOnV1 = (await request(app).post("/production-runs").set("Cookie", admin).send({ bomHeaderId: v1.id, batchSize: 1 })).body.data;

    // Edit: flour 40 kg -> 38 kg, oil added, 190 packets.
    const editRes = await request(app)
      .put(`/boms/${v1.id}`)
      .set("Cookie", admin)
      .send({ expectedYieldQty: 190, lines: [{ rawItemId: flour, qtyPerBatch: 38_000 }, { rawItemId: oil, qtyPerBatch: 10_000 }] });
    expect(editRes.status).toBe(201);
    const v2 = editRes.body.data;
    expect(v2).toMatchObject({ version: 2, familyId: v1.id, active: true, expectedYieldQty: 190 });

    // v1 is retired but kept exactly as it was.
    const v1Now = await prisma.bomHeader.findUniqueOrThrow({ where: { id: v1.id }, include: { lines: true } });
    expect(v1Now.active).toBe(false);
    expect(v1Now.retiredAt).not.toBeNull();
    expect(v1Now.lines.map((l) => l.qtyPerBatch)).toEqual([40_000]);

    // Only the latest version can be picked for a new plan.
    const list = (await request(app).get("/boms").set("Cookie", admin)).body.data as { id: string }[];
    expect(list.map((b) => b.id)).toContain(v2.id);
    expect(list.map((b) => b.id)).not.toContain(v1.id);
    const planOld = await request(app).post("/production-runs").set("Cookie", admin).send({ bomHeaderId: v1.id, batchSize: 1 });
    expect(planOld.status).toBe(409);
    expect(planOld.body.error.code).toBe("recipe_retired");

    // Editing the retired version again is refused (someone else got there first).
    const staleEdit = await request(app).put(`/boms/${v1.id}`).set("Cookie", admin).send({ expectedYieldQty: 1, lines: [{ rawItemId: flour, qtyPerBatch: 1 }] });
    expect(staleEdit.status).toBe(409);

    // History lists both versions, newest first.
    const versions = (await request(app).get(`/boms/${v2.id}/versions`).set("Cookie", admin)).body.data as { version: number }[];
    expect(versions.map((v) => v.version)).toEqual([2, 1]);

    // The activity log says who changed what.
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "RECIPE_EDITED", entityId: v1.id }, include: { user: true } });
    expect(log.user?.email).toBe("admin@porulottam.test");
    expect(JSON.parse(log.afterJson!).changed).toBe("Packets per batch: 200 to 190; Test flour: 40 kg to 38 kg; Test oil: not used to 10 kg");

    // The planned run still uses v1 until someone moves it.
    const stillV1 = await prisma.productionRun.findUniqueOrThrow({ where: { id: plannedOnV1.id } });
    expect(stillV1.bomHeaderId).toBe(v1.id);
    const moved = await request(app).post(`/production-runs/${plannedOnV1.id}/use-latest-recipe`).set("Cookie", admin);
    expect(moved.status).toBe(200);
    expect(moved.body.data.bomHeaderId).toBe(v2.id);
    const again = await request(app).post(`/production-runs/${plannedOnV1.id}/use-latest-recipe`).set("Cookie", admin);
    expect(again.body.error.code).toBe("already_latest");

    await prisma.productionRun.update({ where: { id: plannedOnV1.id }, data: { status: "CANCELLED" } });
  });
});
