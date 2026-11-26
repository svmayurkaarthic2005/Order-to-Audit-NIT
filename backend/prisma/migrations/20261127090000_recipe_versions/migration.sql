-- Recipes are versioned. Editing a recipe never changes it: it adds the next
-- version and retires the old one. All versions of one recipe share a
-- familyId (the first version's id). Runs keep pointing at the version they
-- were planned with, so their planned amounts, cost and variance stay as
-- they were.
ALTER TABLE "BomHeader" ADD COLUMN "familyId" TEXT;
ALTER TABLE "BomHeader" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BomHeader" ADD COLUMN "retiredAt" TIMESTAMP(3);

UPDATE "BomHeader" SET "familyId" = "id";
ALTER TABLE "BomHeader" ALTER COLUMN "familyId" SET NOT NULL;

CREATE UNIQUE INDEX "BomHeader_familyId_version_key" ON "BomHeader"("familyId", "version");
