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

ALTER TABLE "PackSizeLine"
ADD CONSTRAINT "PackSizeLine_packSizeId_fkey"
FOREIGN KEY ("packSizeId") REFERENCES "PackSize"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

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
