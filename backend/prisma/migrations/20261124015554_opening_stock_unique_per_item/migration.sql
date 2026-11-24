-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "openingStockItemId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_openingStockItemId_key" ON "StockMovement"("openingStockItemId");

