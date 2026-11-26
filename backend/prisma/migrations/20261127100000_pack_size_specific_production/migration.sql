-- Make the pack format part of the production plan. Existing pack sizes
-- retain the yield they used before this migration (the base recipe yield).
ALTER TABLE "PackSize" ADD COLUMN "expectedYieldQty" INTEGER;

UPDATE "PackSize" AS pack
SET "expectedYieldQty" = bom."expectedYieldQty"
FROM "BomHeader" AS bom
WHERE pack."baseBomId" = bom."id";

ALTER TABLE "PackSize" ALTER COLUMN "expectedYieldQty" SET NOT NULL;

-- A planned run freezes the selected pack size. Its recipe and packaging
-- requirements can then be read without asking the operator again at finish.
ALTER TABLE "ProductionRun" ADD COLUMN "packSizeId" TEXT;

CREATE TABLE "PackSizeLine" (
    "id" TEXT NOT NULL,
    "packSizeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyPerBatch" INTEGER NOT NULL,
    CONSTRAINT "PackSizeLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PackSizeLine_packSizeId_itemId_key"
ON "PackSizeLine"("packSizeId", "itemId");

-- Preserve the historical default pack format: when a PackSize targets the
-- same finished SKU as its BOM, its old packaging lines were that format's
-- packaging. Alternate SKUs cannot be inferred safely and must be configured
-- once in Recipes before they can be planned.
INSERT INTO "PackSizeLine" ("id", "packSizeId", "itemId", "qtyPerBatch")
SELECT
    gen_random_uuid()::text,
    pack."id",
    line."rawItemId",
    line."qtyPerBatch"
FROM "PackSize" AS pack
JOIN "BomHeader" AS bom ON bom."id" = pack."baseBomId"
JOIN "BomLine" AS line ON line."bomHeaderId" = bom."id"
JOIN "Item" AS item ON item."id" = line."rawItemId"
WHERE pack."finishedItemId" = bom."finishedItemId"
  AND item."type" = 'PACKAGING';

ALTER TABLE "PackSizeLine"
ADD CONSTRAINT "PackSizeLine_packSizeId_fkey"
FOREIGN KEY ("packSizeId") REFERENCES "PackSize"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Pack formats are scoped to a recipe version: an edit creates copies
-- for the new BOM version while old runs keep the old format definition.
DROP INDEX "PackSize_finishedItemId_label_key";
CREATE UNIQUE INDEX "PackSize_baseBomId_finishedItemId_label_key"
ON "PackSize"("baseBomId", "finishedItemId", "label");

ALTER TABLE "PackSizeLine"
ADD CONSTRAINT "PackSizeLine_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "Item"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductionRun"
ADD CONSTRAINT "ProductionRun_packSizeId_fkey"
FOREIGN KEY ("packSizeId") REFERENCES "PackSize"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- The RLS migration predates this new table; keep the table private from the Supabase REST API.
ALTER TABLE "PackSizeLine" ENABLE ROW LEVEL SECURITY;
