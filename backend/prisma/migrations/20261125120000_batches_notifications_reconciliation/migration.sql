-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('NORMAL', 'EXPIRING', 'EXPIRED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LOW_STOCK', 'STOCK_REPLENISHED', 'PRODUCTION_VARIANCE', 'ORDER_SHORTAGE', 'AUDIT_EXCEPTION', 'EXPIRY_WARNING');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'REVIEWED', 'RESOLVED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "expiryWarningDaysJson" INTEGER[],
ADD COLUMN     "shelfLifeDays" INTEGER;

-- AlterTable
ALTER TABLE "ProductionRun" ADD COLUMN     "laborCostPaise" INTEGER,
ADD COLUMN     "overheadCostPaise" INTEGER;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "finishedGoodsBatchId" TEXT,
ADD COLUMN     "rawMaterialBatchId" TEXT;

-- CreateTable
CREATE TABLE "RawMaterialBatch" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "internalBatchNo" TEXT NOT NULL,
    "supplierBatchNo" TEXT,
    "supplierId" TEXT NOT NULL,
    "purchaseItemId" TEXT,
    "receivedQtyBase" INTEGER NOT NULL,
    "remainingQtyBase" INTEGER NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "manufactureDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "qualityDocRef" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawMaterialBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinishedGoodsBatch" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "internalBatchNo" TEXT NOT NULL,
    "productionRunId" TEXT NOT NULL,
    "manufactureDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "producedQtyBase" INTEGER NOT NULL,
    "remainingQtyBase" INTEGER NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinishedGoodsBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchItemBatch" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "finishedGoodsBatchId" TEXT NOT NULL,
    "qtyBase" INTEGER NOT NULL,

    CONSTRAINT "DispatchItemBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationException" (
    "id" TEXT NOT NULL,
    "checkType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "expectedValue" TEXT NOT NULL,
    "actualValue" TEXT NOT NULL,
    "differenceValue" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "explanation" TEXT,
    "resolutionNote" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "ReconciliationException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "recipientRoles" "Role"[],
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'INFO',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RawMaterialBatch_internalBatchNo_key" ON "RawMaterialBatch"("internalBatchNo");

-- CreateIndex
CREATE UNIQUE INDEX "RawMaterialBatch_purchaseItemId_key" ON "RawMaterialBatch"("purchaseItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FinishedGoodsBatch_internalBatchNo_key" ON "FinishedGoodsBatch"("internalBatchNo");

-- CreateIndex
CREATE UNIQUE INDEX "FinishedGoodsBatch_productionRunId_key" ON "FinishedGoodsBatch"("productionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationException_dedupeKey_key" ON "ReconciliationException"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_readAt_idx" ON "Notification"("recipientUserId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_salesmanUserId_idempotencyKey_key" ON "SalesOrder"("salesmanUserId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_rawMaterialBatchId_fkey" FOREIGN KEY ("rawMaterialBatchId") REFERENCES "RawMaterialBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_finishedGoodsBatchId_fkey" FOREIGN KEY ("finishedGoodsBatchId") REFERENCES "FinishedGoodsBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialBatch" ADD CONSTRAINT "RawMaterialBatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialBatch" ADD CONSTRAINT "RawMaterialBatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialBatch" ADD CONSTRAINT "RawMaterialBatch_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodsBatch" ADD CONSTRAINT "FinishedGoodsBatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodsBatch" ADD CONSTRAINT "FinishedGoodsBatch_productionRunId_fkey" FOREIGN KEY ("productionRunId") REFERENCES "ProductionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchItemBatch" ADD CONSTRAINT "DispatchItemBatch_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchItemBatch" ADD CONSTRAINT "DispatchItemBatch_finishedGoodsBatchId_fkey" FOREIGN KEY ("finishedGoodsBatchId") REFERENCES "FinishedGoodsBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

