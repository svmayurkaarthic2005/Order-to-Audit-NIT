-- Stock adjustments: count corrections, found surplus or write-offs. Kept as
-- their own source document (reason, who, when) that an ADJUSTMENT
-- StockMovement.sourceId points at, matching how a Purchase backs a
-- PURCHASE movement.
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyBase" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
