import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();

describe("database schema + seed", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("has the benchmark BOM with the correct expected yield (200, not 238)", async () => {
    const bom = await prisma.bomHeader.findFirst({
      where: { finishedItem: { sku: "FG-MURUKKU-200G" } },
    });
    expect(bom?.expectedYieldQty).toBe(200);
  });

  it("has the benchmark opening stock for every item", async () => {
    const openingRows = await prisma.stockMovement.findMany({ where: { source: "OPENING_STOCK" } });
    expect(openingRows.length).toBeGreaterThanOrEqual(6);
  });

  it("has no finished_goods_stock table — on-hand always comes from the ledger", async () => {
    expect((prisma as Record<string, unknown>).finishedGoodsStock).toBeUndefined();
  });
});
