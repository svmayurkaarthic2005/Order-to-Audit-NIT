import { AppError } from "../../lib/AppError.js";
import { prisma } from "../../lib/prisma.js";

type BomLineInput = { rawItemId: string; qtyPerBatch: number };

export async function listBoms() {
  return prisma.bomHeader.findMany({
    where: { active: true },
    include: { finishedItem: true, lines: { include: { rawItem: true } }, packSizes: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getBom(id: string) {
  const bom = await prisma.bomHeader.findUnique({
    where: { id },
    include: { finishedItem: true, lines: { include: { rawItem: true } }, packSizes: true },
  });
  if (!bom || !bom.active) {
    throw new AppError(404, "not_found", "BOM not found");
  }
  return bom;
}

// A BOM's lines are the raw materials/packaging consumed per batch — a
// finished good can never be its own ingredient, mirroring the same check
// on purchases (finished goods are produced, not purchased or consumed).
export async function createBom(data: { finishedItemId: string; expectedYieldQty: number; lines: BomLineInput[] }) {
  const rawItemIds = data.lines.map((l) => l.rawItemId);
  if (new Set(rawItemIds).size !== rawItemIds.length) {
    throw new AppError(400, "duplicate_line", "A BOM cannot list the same raw item twice");
  }

  return prisma.$transaction(async (tx) => {
    const finishedItem = await tx.item.findUnique({ where: { id: data.finishedItemId } });
    if (!finishedItem || !finishedItem.active) {
      throw new AppError(404, "not_found", "Finished good item not found");
    }
    if (finishedItem.type !== "FINISHED_GOOD") {
      throw new AppError(400, "invalid_item_type", "A BOM's output item must be a finished good");
    }

    for (const line of data.lines) {
      const rawItem = await tx.item.findUnique({ where: { id: line.rawItemId } });
      if (!rawItem || !rawItem.active) {
        throw new AppError(404, "not_found", `Item ${line.rawItemId} not found`);
      }
      if (rawItem.type === "FINISHED_GOOD") {
        throw new AppError(400, "invalid_item_type", "A BOM line cannot consume another finished good");
      }
    }

    const bom = await tx.bomHeader.create({
      data: {
        finishedItemId: data.finishedItemId,
        expectedYieldQty: data.expectedYieldQty,
        lines: { create: data.lines },
      },
    });

    return tx.bomHeader.findUniqueOrThrow({
      where: { id: bom.id },
      include: { finishedItem: true, lines: { include: { rawItem: true } } },
    });
  });
}

// A pack size can never be created without a base BOM — it is just that
// BOM's output scaled by an integer multiplier (e.g. 500 g = 2x the 250 g
// base BOM), never an independent recipe.
export async function createPackSize(data: {
  finishedItemId: string;
  baseBomId: string;
  multiplier: number;
  label: string;
}) {
  const [finishedItem, baseBom] = await Promise.all([
    prisma.item.findUnique({ where: { id: data.finishedItemId } }),
    prisma.bomHeader.findUnique({ where: { id: data.baseBomId } }),
  ]);
  if (!finishedItem || !finishedItem.active) {
    throw new AppError(404, "not_found", "Finished good item not found");
  }
  if (!baseBom || !baseBom.active) {
    throw new AppError(400, "invalid_base_bom", "baseBomId does not refer to an existing BOM");
  }

  return prisma.packSize.create({ data });
}
