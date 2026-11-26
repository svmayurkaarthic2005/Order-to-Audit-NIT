-- A pack size defines its own per-batch good output and packaging.
-- Existing pack sizes are backfilled to the recipe yield; the canonical pack's
-- existing BOM packaging lines are copied into its pack-size configuration.
ALTER TABLE "PackSize" ADD COLUMN "expectedOutputQty" INTEGER NOT NULL DEFAULT 1;

UPDATE "PackSize" AS p
SET "expectedOutputQty" = b."expectedYieldQty"
FROM "BomHeader" AS b
WHERE b."id" = p."baseBomId";

ALTER TABLE "PackSize" DROP COLUMN "multiplier";

CREATE TABLE "PackSizePackaging" (
    "id" TEXT NOT NULL,
    "packSizeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyPerBatch" INTEGER NOT NULL,
    CONSTRAINT "PackSizePackaging_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PackSizePackaging_packSizeId_itemId_key"
ON "PackSizePackaging"("packSizeId", "itemId");

CREATE INDEX "PackSizePackaging_itemId_idx"
ON "PackSizePackaging"("itemId");

ALTER TABLE "PackSizePackaging"
ADD CONSTRAINT "PackSizePackaging_packSizeId_fkey"
FOREIGN KEY ("packSizeId") REFERENCES "PackSize"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PackSizePackaging"
ADD CONSTRAINT "PackSizePackaging_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "Item"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve the current canonical pack's packaging while making future
-- variants independent. Other legacy variants need their packaging configured
-- explicitly because the old schema could not associate BOM lines to variants.
INSERT INTO "PackSizePackaging" ("id", "packSizeId", "itemId", "qtyPerBatch")
SELECT gen_random_uuid()::text, p."id", l."rawItemId", l."qtyPerBatch"
FROM "PackSize" AS p
JOIN "BomHeader" AS b ON b."id" = p."baseBomId"
JOIN "BomLine" AS l ON l."bomHeaderId" = b."id"
JOIN "Item" AS i ON i."id" = l."rawItemId"
WHERE p."finishedItemId" = b."finishedItemId"
  AND i."type" = 'PACKAGING';

ALTER TABLE "ProductionRun" ADD COLUMN "packSizeId" TEXT;
ALTER TABLE "ProductionRun" ADD COLUMN "expectedOutputQty" INTEGER;

ALTER TABLE "ProductionRun"
ADD CONSTRAINT "ProductionRun_packSizeId_fkey"
FOREIGN KEY ("packSizeId") REFERENCES "PackSize"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProductionRun_packSizeId_idx" ON "ProductionRun"("packSizeId");
