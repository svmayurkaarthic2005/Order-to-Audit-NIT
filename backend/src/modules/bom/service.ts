import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/AppError.js";
import { logAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { formatQty } from "../../lib/units.js";

type BomLineInput = { rawItemId: string; qtyPerBatch: number };

export async function listBoms() {
  return prisma.bomHeader.findMany({
    where: { active: true },
    include: { finishedItem: true, lines: { include: { rawItem: true } }, packSizes: { include: { finishedItem: true, lines: { include: { item: true } } } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getBom(id: string) {
  const bom = await prisma.bomHeader.findUnique({
    where: { id },
    include: { finishedItem: true, lines: { include: { rawItem: true } }, packSizes: { include: { finishedItem: true, lines: { include: { item: true } } } } },
  });
  if (!bom || !bom.active) {
    throw new AppError(404, "not_found", "BOM not found");
  }
  return bom;
}

// A BOM's lines are the raw materials/packaging consumed per batch — a
// finished good can never be its own ingredient, mirroring the same check
// on purchases (finished goods are produced, not purchased or consumed).
async function checkLines(tx: Prisma.TransactionClient, lines: BomLineInput[]) {
  const rawItemIds = lines.map((l) => l.rawItemId);
  if (new Set(rawItemIds).size !== rawItemIds.length) {
    throw new AppError(400, "duplicate_line", "A BOM cannot list the same raw item twice");
  }
  for (const line of lines) {
    const rawItem = await tx.item.findUnique({ where: { id: line.rawItemId } });
    if (!rawItem || !rawItem.active) {
      throw new AppError(404, "not_found", `Item ${line.rawItemId} not found`);
    }
    if (rawItem.type === "FINISHED_GOOD") {
      throw new AppError(400, "invalid_item_type", "A BOM line cannot consume another finished good");
    }
  }
}

export async function createBom(
  data: { finishedItemId: string; expectedYieldQty: number; lines: BomLineInput[] },
  actingUserId: string | null = null,
) {
  return prisma.$transaction(async (tx) => {
    const finishedItem = await tx.item.findUnique({ where: { id: data.finishedItemId } });
    if (!finishedItem || !finishedItem.active) {
      throw new AppError(404, "not_found", "Finished good item not found");
    }
    if (finishedItem.type !== "FINISHED_GOOD") {
      throw new AppError(400, "invalid_item_type", "A BOM's output item must be a finished good");
    }
    await checkLines(tx, data.lines);

    // Version 1 starts its own family.
    const id = randomUUID();
    await tx.bomHeader.create({
      data: { id, familyId: id, finishedItemId: data.finishedItemId, expectedYieldQty: data.expectedYieldQty, lines: { create: data.lines } },
    });
    const bom = await tx.bomHeader.findUniqueOrThrow({ where: { id }, include: { finishedItem: true, lines: { include: { rawItem: true } } } });
    await logAudit(tx, { userId: actingUserId, action: "RECIPE_CREATED", entityType: "BomHeader", entityId: id, after: readable(bom) });
    return bom;
  });
}

type RecipeForLog = { version: number; expectedYieldQty: number; lines: { qtyPerBatch: number; rawItem: { name: string; baseUnit: string } }[] };

// What the activity log shows: one line per ingredient, in kg / L / pieces.
function readable(bom: RecipeForLog): Record<string, string | number> {
  return {
    version: bom.version,
    "Packets per batch": bom.expectedYieldQty,
    ...Object.fromEntries(bom.lines.map((l) => [l.rawItem.name, formatQty(l.qtyPerBatch, l.rawItem.baseUnit)])),
  };
}

// Editing never changes a recipe: it adds the next version with the new
// amounts and retires the current one. Runs keep the version they were
// planned with; only new plans use the new one.
export async function editBom(id: string, data: { expectedYieldQty: number; lines: BomLineInput[] }, actingUserId: string) {
  return prisma.$transaction(async (tx) => {
    await checkLines(tx, data.lines);
    // Claiming the retirement first means two edits of the same version
    // can't both succeed: the second finds it already retired.
    const { count } = await tx.bomHeader.updateMany({ where: { id, active: true }, data: { active: false, retiredAt: new Date() } });
    if (count === 0) {
      const exists = await tx.bomHeader.findUnique({ where: { id } });
      if (!exists) throw new AppError(404, "not_found", "BOM not found");
      throw new AppError(409, "recipe_changed", "This recipe has already been changed. Reload to see the latest version.");
    }
    const current = await tx.bomHeader.findUniqueOrThrow({ where: { id }, include: { lines: { include: { rawItem: true } } } });

    const next = await tx.bomHeader.create({
      data: {
        familyId: current.familyId,
        version: current.version + 1,
        finishedItemId: current.finishedItemId,
        expectedYieldQty: data.expectedYieldQty,
        lines: { create: data.lines },
      },
      include: { finishedItem: true, lines: { include: { rawItem: true } } },
    });
    // Pack sizes belong to the recipe, not to one version.
    await tx.packSize.updateMany({ where: { baseBomId: id }, data: { baseBomId: next.id } });

    const before = readable(current);
    const after = readable(next);
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => k !== "version" && before[k] !== after[k])
      .map((k) => `${k}: ${before[k] ?? "not used"} to ${after[k] ?? "removed"}`);
    await logAudit(tx, {
      userId: actingUserId,
      action: "RECIPE_EDITED",
      entityType: "BomHeader",
      entityId: current.familyId,
      before,
      after: { ...after, changed: changed.join("; ") || "nothing" },
    });

    return tx.bomHeader.findUniqueOrThrow({
      where: { id: next.id },
      include: { finishedItem: true, lines: { include: { rawItem: true } }, packSizes: { include: { finishedItem: true, lines: { include: { item: true } } } } },
    });
  });
}

// Every version of one recipe, newest first.
export async function listBomVersions(id: string) {
  const bom = await prisma.bomHeader.findUnique({ where: { id } });
  if (!bom) throw new AppError(404, "not_found", "BOM not found");
  return prisma.bomHeader.findMany({
    where: { familyId: bom.familyId },
    include: { lines: { include: { rawItem: true } } },
    orderBy: { version: "desc" },
  });
}

// A pack size can never be created without a base BOM — it is just that
// BOM's output scaled by an integer multiplier (e.g. 500 g = 2x the 250 g
// base BOM), never an independent recipe.
export async function createPackSize(
  data: {
    finishedItemId: string;
    baseBomId: string;
    multiplier: number;
    label: string;
    expectedYieldQty: number;
    lines: { itemId: string; qtyPerBatch: number }[];
  },
  actingUserId: string | null = null,
) {
  return prisma.$transaction(async (tx) => {
    const [finishedItem, baseBom] = await Promise.all([
      tx.item.findUnique({ where: { id: data.finishedItemId } }),
      tx.bomHeader.findUnique({ where: { id: data.baseBomId } }),
    ]);
    if (!finishedItem || !finishedItem.active || finishedItem.type !== "FINISHED_GOOD") {
      throw new AppError(404, "not_found", "Active finished good item not found");
    }
    if (!baseBom || !baseBom.active) {
      throw new AppError(400, "invalid_base_bom", "baseBomId must refer to the current version of a recipe");
    }

    const itemIds = data.lines.map((line) => line.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new AppError(400, "duplicate_line", "A pack size cannot list the same packaging item twice");
    }
    const packagingItems = await tx.item.findMany({ where: { id: { in: itemIds }, active: true } });
    if (packagingItems.length !== itemIds.length) {
      throw new AppError(404, "not_found", "One or more packaging items were not found or are inactive");
    }
    const invalidItem = packagingItems.find((item) => item.type !== "PACKAGING");
    if (invalidItem) {
      throw new AppError(400, "invalid_packaging_item", `${invalidItem.name} is not a packaging item`);
    }

    const packSize = await tx.packSize.create({
      data: {
        finishedItemId: data.finishedItemId,
        baseBomId: data.baseBomId,
        multiplier: data.multiplier,
        label: data.label,
        expectedYieldQty: data.expectedYieldQty,
        lines: { create: data.lines },
      },
      include: { finishedItem: true, lines: { include: { item: true } } },
    });
    await logAudit(tx, {
      userId: actingUserId,
      action: "PACK_SIZE_CREATED",
      entityType: "PackSize",
      entityId: packSize.id,
      after: {
        label: packSize.label,
        finishedItem: packSize.finishedItem.name,
        expectedPacketsPerBatch: packSize.expectedYieldQty,
        packaging: packSize.lines.map((line) => ({
          item: line.item.name,
          qtyPerBatch: line.qtyPerBatch,
        })),
      },
    });
    return packSize;
  });
}


// Existing pack-size records (including those upgraded by the migration)
// can be configured until the first production run is planned against them.
// Once referenced by a run, the pack definition is immutable.
export async function editPackSize(
  id: string,
  data: { expectedYieldQty: number; lines: { itemId: string; qtyPerBatch: number }[] },
  actingUserId: string,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.packSize.findUnique({
      where: { id },
      include: { baseBom: true, finishedItem: true, lines: { include: { item: true } } },
    });
    if (!current) {
      throw new AppError(404, "not_found", "Pack size not found");
    }
    if (!current.baseBom.active) {
      throw new AppError(409, "recipe_retired", "Edit the pack size from the current recipe version");
    }

    const plannedRuns = await tx.productionRun.count({ where: { packSizeId: id } });
    if (plannedRuns > 0) {
      throw new AppError(409, "pack_size_in_use", "This pack size is already used by a planned or completed run. Create a new pack size configuration instead.");
    }

    const itemIds = data.lines.map((line) => line.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new AppError(400, "duplicate_line", "A pack size cannot list the same packaging item twice");
    }
    const packagingItems = await tx.item.findMany({ where: { id: { in: itemIds }, active: true } });
    if (packagingItems.length !== itemIds.length) {
      throw new AppError(404, "not_found", "One or more packaging items were not found or are inactive");
    }
    const invalidItem = packagingItems.find((item) => item.type !== "PACKAGING");
    if (invalidItem) {
      throw new AppError(400, "invalid_packaging_item", `${invalidItem.name} is not a packaging item`);
    }

    await tx.packSizeLine.deleteMany({ where: { packSizeId: id } });
    const updated = await tx.packSize.update({
      where: { id },
      data: {
        expectedYieldQty: data.expectedYieldQty,
        lines: { create: data.lines },
      },
      include: { finishedItem: true, lines: { include: { item: true } } },
    });

    await logAudit(tx, {
      userId: actingUserId,
      action: "PACK_SIZE_EDITED",
      entityType: "PackSize",
      entityId: id,
      before: {
        label: current.label,
        finishedItem: current.finishedItem.name,
        expectedPacketsPerBatch: current.expectedYieldQty,
        packaging: current.lines.map((line) => ({ item: line.item.name, qtyPerBatch: line.qtyPerBatch })),
      },
      after: {
        label: updated.label,
        finishedItem: updated.finishedItem.name,
        expectedPacketsPerBatch: updated.expectedYieldQty,
        packaging: updated.lines.map((line) => ({ item: line.item.name, qtyPerBatch: line.qtyPerBatch })),
      },
    });
    return updated;
  });
}
