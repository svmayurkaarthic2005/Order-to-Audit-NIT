import { describe, expect, it } from "vitest";
import { prisma } from "./lib/prisma.js";

describe("database schema + seed", () => {
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
});
