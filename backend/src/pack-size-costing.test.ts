import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

// Verifies the brief's claim that PackSize already models "shared base
// recipe + product-specific packaging configuration" — and that a
// ProductionRun can actually be completed *as* one of a BOM's registered
// pack sizes, not just the BOM's own canonical finished item.

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

const TEST_SKU_PREFIX = "PACKSIZE-TEST-";

async function makeItem(cookie: string, type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD", name = `Pack Size Test ${type}`) {
  const sku = `${TEST_SKU_PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app).post("/items").set("Cookie", cookie).send({ sku, name, type, baseUnit: "G" });
  return res.body.data.id as string;
}

async function openingStock(cookie: string, itemId: string, qtyBase: number, totalCostPaise: number) {
  await request(app).post("/inventory/opening-stock").set("Cookie", cookie).send({ itemId, qtyBase, totalCostPaise });
}

describe("pack-size costing — shared recipe, per-pack packaging and output", () => {
  afterAll(async () => {
    const boms = await prisma.bomHeader.findMany({
      where: { finishedItem: { sku: { startsWith: TEST_SKU_PREFIX } } },
      select: { id: true },
    });
    for (const bom of boms) {
      const runs = await prisma.productionRun.findMany({ where: { bomHeaderId: bom.id }, select: { id: true } });
      const runIds = runs.map((r) => r.id);
      await prisma.finishedGoodsBatch.deleteMany({ where: { productionRunId: { in: runIds } } });
      await prisma.productionRunMaterial.deleteMany({ where: { productionRunId: { in: runIds } } });
      await prisma.stockMovement.deleteMany({ where: { sourceId: { in: runIds } } });
      await prisma.productionRun.deleteMany({ where: { bomHeaderId: bom.id } });
      await prisma.packSize.deleteMany({ where: { baseBomId: bom.id } });
      await prisma.bomLine.deleteMany({ where: { bomHeaderId: bom.id } });
      await prisma.bomHeader.delete({ where: { id: bom.id } });
    }
    await prisma.item.updateMany({ where: { sku: { startsWith: TEST_SKU_PREFIX } }, data: { active: false } });
  });

  it("runs production for a 200g and a 500g pack size off the same BOM, each under its own SKU with its own packaging cost", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");

    const flourId = await makeItem(adminCookie, "RAW_MATERIAL");
    const pouch200Id = await makeItem(adminCookie, "PACKAGING", "200g pouch (test)");
    const pouch500Id = await makeItem(adminCookie, "PACKAGING", "500g pouch (test)");
    const finished200Id = await makeItem(adminCookie, "FINISHED_GOOD", "Test Snack 200g");
    const finished500Id = await makeItem(adminCookie, "FINISHED_GOOD", "Test Snack 500g");

    // Clean integer paise/gram rates so consumption costs are exact, not rounded.
    await openingStock(adminCookie, flourId, 1_000_000, 1_000_000 * 10); // 10 paise/g
    await openingStock(adminCookie, pouch200Id, 10_000, 10_000 * 5); // 5 paise/piece
    await openingStock(adminCookie, pouch500Id, 10_000, 10_000 * 9); // 9 paise/piece

    // One shared BOM holds only the common raw-material recipe. Each pack
    // size owns its own output yield and packaging list.
    const bomRes = await request(app).post("/boms").set("Cookie", adminCookie).send({
      finishedItemId: finished200Id,
      expectedYieldQty: 100,
      lines: [{ rawItemId: flourId, qtyPerBatch: 10_000 }],
    });
    const bomId = bomRes.body.data.id as string;

    const packSize200 = await request(app).post("/pack-sizes").set("Cookie", adminCookie).send({
      finishedItemId: finished200Id,
      baseBomId: bomId,
      expectedOutputQty: 100,
      label: "200g",
      packagingLines: [{ itemId: pouch200Id, qtyPerBatch: 100 }],
    });
    const packSize500 = await request(app).post("/pack-sizes").set("Cookie", adminCookie).send({
      finishedItemId: finished500Id,
      baseBomId: bomId,
      expectedOutputQty: 40,
      label: "500g",
      packagingLines: [{ itemId: pouch500Id, qtyPerBatch: 40 }],
    });
    expect(packSize200.status).toBe(201);
    expect(packSize500.status).toBe(201);

    // ── Run 1: packed as the 200g pack size ──
    const run200 = await request(app).post("/production-runs").set("Cookie", adminCookie).send({ bomHeaderId: bomId, packSizeId: packSize200.body.data.id });
    const start200 = await request(app).post(`/production-runs/${run200.body.data.id}/start`).set("Cookie", adminCookie)
      .send({ actualConsumption: [{ itemId: flourId, qtyBase: 10_000 }] });
    expect(start200.status).toBe(200);
    expect(start200.body.data.materials.map((m: { itemId: string }) => m.itemId).sort()).toEqual([flourId, pouch200Id].sort());
    await request(app)
      .post(`/production-runs/${run200.body.data.id}/complete`)
      .set("Cookie", adminCookie)
      .set("Idempotency-Key", `packsize-200-${run200.body.data.id}`)
      .send({
        actualOutputQty: 100,
        packagingConsumed: [{ itemId: pouch200Id, qtyBase: 100, damagedQty: 0 }],
      });

    // ── Run 2: same BOM, packed as the 500g pack size instead ──
    const run500 = await request(app).post("/production-runs").set("Cookie", adminCookie).send({ bomHeaderId: bomId, packSizeId: packSize500.body.data.id });
    const start500 = await request(app).post(`/production-runs/${run500.body.data.id}/start`).set("Cookie", adminCookie)
      .send({ actualConsumption: [{ itemId: flourId, qtyBase: 10_000 }] });
    expect(start500.status).toBe(200);
    expect(start500.body.data.expectedOutputQty).toBe(40);
    expect(start500.body.data.materials.map((m: { itemId: string }) => m.itemId).sort()).toEqual([flourId, pouch500Id].sort());
    expect(start500.body.data.materials.some((m: { itemId: string }) => m.itemId === pouch200Id)).toBe(false);
    await request(app)
      .post(`/production-runs/${run500.body.data.id}/complete`)
      .set("Cookie", adminCookie)
      .set("Idempotency-Key", `packsize-500-${run500.body.data.id}`)
      .send({
        actualOutputQty: 40,
        packagingConsumed: [{ itemId: pouch500Id, qtyBase: 40, damagedQty: 0 }],
      });

    // Each run's output landed under its OWN finished-good SKU, not the
    // BOM's shared canonical one.
    const movement200 = await prisma.stockMovement.findFirst({ where: { sourceId: run200.body.data.id, source: "PRODUCTION_OUTPUT" } });
    const movement500 = await prisma.stockMovement.findFirst({ where: { sourceId: run500.body.data.id, source: "PRODUCTION_OUTPUT" } });
    expect(movement200?.itemId).toBe(finished200Id);
    expect(movement500?.itemId).toBe(finished500Id);
    expect(run500.body.data.expectedOutputQty).toBe(40);

    // Each produced its own FinishedGoodsBatch, under its own item.
    const batch200 = await prisma.finishedGoodsBatch.findFirst({ where: { productionRunId: run200.body.data.id } });
    const batch500 = await prisma.finishedGoodsBatch.findFirst({ where: { productionRunId: run500.body.data.id } });
    expect(batch200?.itemId).toBe(finished200Id);
    expect(batch500?.itemId).toBe(finished500Id);

    // Per-unit cost reflects each pack's OWN packaging line cost (100 paise
    // vs 360 paise) while sharing the identical raw-material WAC (flour, the
    // only movement before either run, so its moving average is exact).
    const breakdown200 = await request(app).get(`/production-runs/${run200.body.data.id}/cost-breakdown`).set("Cookie", adminCookie);
    const breakdown500 = await request(app).get(`/production-runs/${run500.body.data.id}/cost-breakdown`).set("Cookie", adminCookie);

    const flourLine200 = breakdown200.body.data.materialLines.find((l: { itemId: string }) => l.itemId === flourId);
    const flourLine500 = breakdown500.body.data.materialLines.find((l: { itemId: string }) => l.itemId === flourId);
    expect(flourLine200.unitCostPaise).toBe(flourLine500.unitCostPaise); // same shared WAC
    expect(flourLine200.totalCostPaise).toBe(100_000); // 10,000 g * 10 paise/g

    expect(breakdown200.body.data.packagingLines).toHaveLength(1);
    expect(breakdown200.body.data.packagingLines[0].itemId).toBe(pouch200Id);
    expect(breakdown200.body.data.packagingLines[0].totalCostPaise).toBe(500); // 100 * 5 paise

    expect(breakdown500.body.data.packagingLines).toHaveLength(1);
    expect(breakdown500.body.data.packagingLines[0].itemId).toBe(pouch500Id);
    expect(breakdown500.body.data.packagingLines[0].totalCostPaise).toBe(360); // 40 * 9 paise

    expect(breakdown200.body.data.costPerGoodUnitPaise).not.toBe(breakdown500.body.data.costPerGoodUnitPaise);

    const variance500 = await request(app).get(`/production-runs/${run500.body.data.id}/variance`).set("Cookie", adminCookie);
    expect(variance500.body.data.yield).toMatchObject({ planned: 40, actual: 40, variancePct: 0, flagged: false });
  });

  it("rejects planning a run with a pack size from a different recipe family", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const flourId = await makeItem(adminCookie, "RAW_MATERIAL");
    const finishedAId = await makeItem(adminCookie, "FINISHED_GOOD");
    const finishedBId = await makeItem(adminCookie, "FINISHED_GOOD");
    await openingStock(adminCookie, flourId, 100_000, 100_000 * 10);

    const bomA = await request(app).post("/boms").set("Cookie", adminCookie).send({
      finishedItemId: finishedAId,
      expectedYieldQty: 10,
      lines: [{ rawItemId: flourId, qtyPerBatch: 1_000 }],
    });
    const bomB = await request(app).post("/boms").set("Cookie", adminCookie).send({
      finishedItemId: finishedBId,
      expectedYieldQty: 10,
      lines: [{ rawItemId: flourId, qtyPerBatch: 1_000 }],
    });
    const foreignPackSize = await request(app).post("/pack-sizes").set("Cookie", adminCookie).send({
      finishedItemId: finishedBId,
      baseBomId: bomB.body.data.id,
      expectedOutputQty: 10,
      label: "foreign",
      packagingLines: [],
    });

    const res = await request(app).post("/production-runs").set("Cookie", adminCookie).send({
      bomHeaderId: bomA.body.data.id,
      packSizeId: foreignPackSize.body.data.id,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_pack_size");
  });
});
