import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";
import {
  genealogyBackward,
  genealogyForward,
  issueFromFinishedBatches,
  issueFromRawBatches,
  receiveBatch,
  recordProductionOutput,
  refreshBatchStatuses,
  selectFinishedBatchesFEFO,
  selectRawBatchesFEFO,
} from "./modules/batches/service.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"] as string | string[];
}

const TEST_PREFIX = "BATCH-TEST-";

async function makeTestItem(cookie: string | string[], type: "RAW_MATERIAL" | "FINISHED_GOOD", baseUnit: "G" | "PIECE") {
  const sku = `${TEST_PREFIX}${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post("/items")
    .set("Cookie", cookie as string)
    .send({ sku, name: "Batch Test Item", type, baseUnit });
  return res.body.data.id as string;
}

describe("batch & lot tracking — FEFO, expiry, genealogy & ledger reconciliation", () => {
  // The genealogy test below creates a full order→invoice→dispatch chain
  // and its own production run/BOM — none of that is reachable by the
  // TEST_PREFIX item lookups the rest of this cleanup uses, so it's tracked
  // here explicitly instead of (as it previously wasn't at all) leaking a
  // real order/invoice/dispatch onto whatever customer happened to be
  // findFirstOrThrow'd every time this suite ran.
  let genealogyCustomerId = "";
  let genealogyInvoiceId = "";
  let genealogySalesOrderId = "";
  let genealogyRunId = "";
  let genealogyBomHeaderId = "";

  afterAll(async () => {
    // Clean up test batches, dispatches, runs, and items
    await prisma.dispatchItemBatch.deleteMany({
      where: { finishedGoodsBatch: { item: { sku: { startsWith: TEST_PREFIX } } } },
    });
    await prisma.dispatch.deleteMany({ where: { invoiceId: genealogyInvoiceId } });
    await prisma.invoice.deleteMany({ where: { id: genealogyInvoiceId } });
    await prisma.salesOrder.deleteMany({ where: { id: genealogySalesOrderId } });
    await prisma.rawMaterialBatch.deleteMany({
      where: { item: { sku: { startsWith: TEST_PREFIX } } },
    });
    await prisma.finishedGoodsBatch.deleteMany({
      where: { item: { sku: { startsWith: TEST_PREFIX } } },
    });
    await prisma.productionRun.deleteMany({ where: { id: genealogyRunId } });
    await prisma.bomLine.deleteMany({ where: { bomHeaderId: genealogyBomHeaderId } });
    await prisma.bomHeader.deleteMany({ where: { id: genealogyBomHeaderId } });
    await prisma.stockMovement.deleteMany({
      where: { item: { sku: { startsWith: TEST_PREFIX } } },
    });
    await prisma.item.updateMany({
      where: { sku: { startsWith: TEST_PREFIX } },
      data: { active: false },
    });
    await prisma.customer.deleteMany({ where: { id: genealogyCustomerId } });
  });

  it("multi-lot & FEFO selection: picks earliest expiry first, respects remaining quantity", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const rawItemId = await makeTestItem(adminCookie, "RAW_MATERIAL", "G");
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { active: true } });

    // Create 3 batches with different expiry dates:
    // Lot A: expires in 30 days, 100g
    // Lot B: expires in 10 days, 50g  (earliest)
    // Lot C: expires in 60 days, 200g
    const now = Date.now();
    const batchA = await prisma.rawMaterialBatch.create({
      data: {
        itemId: rawItemId,
        internalBatchNo: `RM-A-${Date.now()}`,
        supplierId: supplier.id,
        receivedQtyBase: 100,
        remainingQtyBase: 100,
        receiptDate: new Date(),
        expiryDate: new Date(now + 30 * 86_400_000),
      },
    });
    const batchB = await prisma.rawMaterialBatch.create({
      data: {
        itemId: rawItemId,
        internalBatchNo: `RM-B-${Date.now()}`,
        supplierId: supplier.id,
        receivedQtyBase: 50,
        remainingQtyBase: 50,
        receiptDate: new Date(),
        expiryDate: new Date(now + 10 * 86_400_000), // earliest
      },
    });
    const batchC = await prisma.rawMaterialBatch.create({
      data: {
        itemId: rawItemId,
        internalBatchNo: `RM-C-${Date.now()}`,
        supplierId: supplier.id,
        receivedQtyBase: 200,
        remainingQtyBase: 200,
        receiptDate: new Date(),
        expiryDate: new Date(now + 60 * 86_400_000),
      },
    });

    // Need 120g: should draw 50g from Batch B (earliest), then 70g from Batch A (next earliest)
    const selections = await selectRawBatchesFEFO(rawItemId, 120);
    expect(selections).toHaveLength(2);
    expect(selections[0].batchId).toBe(batchB.id);
    expect(selections[0].qty).toBe(50);
    expect(selections[1].batchId).toBe(batchA.id);
    expect(selections[1].qty).toBe(70);
  });

  it("expired & quarantined stock blocked: rejects when eligible stock is insufficient", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const rawItemId = await makeTestItem(adminCookie, "RAW_MATERIAL", "G");
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { active: true } });

    // Create an expired lot and a quarantined lot
    await prisma.rawMaterialBatch.create({
      data: {
        itemId: rawItemId,
        internalBatchNo: `RM-EXPIRED-${Date.now()}`,
        supplierId: supplier.id,
        receivedQtyBase: 100,
        remainingQtyBase: 100,
        receiptDate: new Date(Date.now() - 40 * 86_400_000),
        expiryDate: new Date(Date.now() - 5 * 86_400_000), // past expiry
        status: "EXPIRED",
      },
    });
    await prisma.rawMaterialBatch.create({
      data: {
        itemId: rawItemId,
        internalBatchNo: `RM-QUARANTINE-${Date.now()}`,
        supplierId: supplier.id,
        receivedQtyBase: 100,
        remainingQtyBase: 100,
        receiptDate: new Date(),
        expiryDate: new Date(Date.now() + 60 * 86_400_000),
        status: "QUARANTINED",
      },
    });

    // FEFO selection should reject because 0 eligible stock exists
    await expect(selectRawBatchesFEFO(rawItemId, 10)).rejects.toThrow(/insufficient_batch_stock/);

    // Same check for finished goods
    const fgItemId = await makeTestItem(adminCookie, "FINISHED_GOOD", "PIECE");
    const bomHeader = await prisma.bomHeader.findFirstOrThrow({ where: { active: true } });
    const run = await prisma.productionRun.create({
      data: { bomHeaderId: bomHeader.id, batchSize: 1, status: "COMPLETED" },
    });
    await prisma.finishedGoodsBatch.create({
      data: {
        itemId: fgItemId,
        internalBatchNo: `FG-EXPIRED-${Date.now()}`,
        productionRunId: run.id,
        manufactureDate: new Date(Date.now() - 40 * 86_400_000),
        expiryDate: new Date(Date.now() - 2 * 86_400_000),
        producedQtyBase: 50,
        remainingQtyBase: 50,
        status: "EXPIRED",
      },
    });

    await expect(selectFinishedBatchesFEFO(fgItemId, 10)).rejects.toThrow(/insufficient_batch_stock/);
  });

  it("ledger reconciliation invariant: remainingQtyBase always equals SUM of movements for that batch", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const rawItemId = await makeTestItem(adminCookie, "RAW_MATERIAL", "G");
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { active: true } });

    // Step 1: Simulate purchase receipt of 500g
    const purchase = await prisma.purchase.create({ data: { supplierId: supplier.id } });
    const purchaseItem = await prisma.purchaseItem.create({
      data: { purchaseId: purchase.id, itemId: rawItemId, qtyBase: 500, rateBasePaise: 10 },
    });
    await prisma.stockMovement.create({
      data: {
        itemId: rawItemId,
        qtyBase: 500,
        unitCostPaise: 10,
        totalCostPaise: 5000,
        source: "PURCHASE",
        sourceId: purchase.id,
      },
    });
    const batch = await receiveBatch(purchaseItem.id, {
      supplierBatchNo: "SUPP-LOT-999",
      expiryDate: new Date(Date.now() + 90 * 86_400_000),
    });

    // Initial check: remainingQtyBase should be 500, and SUM of movements with rawMaterialBatchId = 500
    const initialAgg = await prisma.stockMovement.aggregate({
      where: { rawMaterialBatchId: batch.id },
      _sum: { qtyBase: true },
    });
    expect(batch.remainingQtyBase).toBe(500);
    expect(initialAgg._sum.qtyBase).toBe(500);

    // Step 2: Issue 150g from this batch
    const bomHeader = await prisma.bomHeader.findFirstOrThrow({ where: { active: true } });
    const run = await prisma.productionRun.create({
      data: { bomHeaderId: bomHeader.id, batchSize: 1, status: "STARTED" },
    });

    await prisma.$transaction(async (tx) => {
      await issueFromRawBatches(
        tx,
        [{ batchId: batch.id, qty: 150, batchType: "raw" }],
        rawItemId,
        run.id,
        150,
        10,
      );
    });

    // Recheck invariant
    const freshBatch = await prisma.rawMaterialBatch.findUniqueOrThrow({ where: { id: batch.id } });
    const postIssueAgg = await prisma.stockMovement.aggregate({
      where: { rawMaterialBatchId: batch.id },
      _sum: { qtyBase: true },
    });
    expect(freshBatch.remainingQtyBase).toBe(350);
    expect(postIssueAgg._sum.qtyBase).toBe(350);
    expect(freshBatch.remainingQtyBase).toBe(postIssueAgg._sum.qtyBase);
  });

  it("genealogy forward & backward: joins StockMovement → ProductionRun → FinishedGoodsBatch → DispatchItemBatch", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const rawItemId = await makeTestItem(adminCookie, "RAW_MATERIAL", "G");
    const fgItemId = await makeTestItem(adminCookie, "FINISHED_GOOD", "PIECE");
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { active: true } });
    const customer = await prisma.customer.create({ data: { name: "Batch Genealogy Test Customer", state: "Tamil Nadu" } });
    genealogyCustomerId = customer.id;

    // 1. Raw batch received
    const rawBatch = await prisma.rawMaterialBatch.create({
      data: {
        itemId: rawItemId,
        internalBatchNo: `RM-GEN-${Date.now()}`,
        supplierId: supplier.id,
        receivedQtyBase: 1000,
        remainingQtyBase: 1000,
        receiptDate: new Date(),
        expiryDate: new Date(Date.now() + 180 * 86_400_000),
      },
    });

    // 2. Production run consumes raw batch and produces finished goods batch
    const bomHeader = await prisma.bomHeader.create({
      data: {
        finishedItemId: fgItemId,
        expectedYieldQty: 100,
        lines: { create: [{ rawItemId, qtyPerBatch: 500 }] },
      },
    });
    const run = await prisma.productionRun.create({
      data: { bomHeaderId: bomHeader.id, batchSize: 1, status: "COMPLETED", actualOutputQty: 100 },
    });
    genealogyBomHeaderId = bomHeader.id;
    genealogyRunId = run.id;

    // Record consumption movement
    await prisma.stockMovement.create({
      data: {
        itemId: rawItemId,
        qtyBase: -500,
        unitCostPaise: 20,
        totalCostPaise: -10000,
        source: "PRODUCTION_ISSUE",
        sourceId: run.id,
        rawMaterialBatchId: rawBatch.id,
      },
    });

    // Record production output batch & movement
    const fgBatch = await prisma.$transaction(async (tx) => {
      const b = await recordProductionOutput(tx, run.id, fgItemId, 100, new Date(Date.now() + 90 * 86_400_000));
      await tx.stockMovement.create({
        data: {
          itemId: fgItemId,
          qtyBase: 100,
          unitCostPaise: 100,
          totalCostPaise: 10000,
          source: "PRODUCTION_OUTPUT",
          sourceId: run.id,
          finishedGoodsBatchId: b.id,
        },
      });
      return b;
    });

    // 3. Dispatch draws from finished goods batch
    const salesman = await prisma.user.findFirstOrThrow({ where: { role: "SALESMAN" } });
    const salesOrder = await prisma.salesOrder.create({
      data: { customerId: customer.id, salesmanUserId: salesman.id, status: "DISPATCHED" },
    });
    genealogySalesOrderId = salesOrder.id;
    const invoice = await prisma.invoice.create({
      data: {
        salesOrderId: salesOrder.id,
        customerId: customer.id,
        financialYear: "2026-27",
        invoiceNumber: Math.floor(Math.random() * 100000),
        taxableValuePaise: 50000,
        totalPaise: 50000,
        status: "ISSUED",
      },
    });
    genealogyInvoiceId = invoice.id;
    const dispatch = await prisma.dispatch.create({
      data: { invoiceId: invoice.id, qtyBase: 40 },
    });
    await prisma.dispatchItemBatch.create({
      data: { dispatchId: dispatch.id, finishedGoodsBatchId: fgBatch.id, qtyBase: 40 },
    });
    await prisma.stockMovement.create({
      data: {
        itemId: fgItemId,
        qtyBase: -40,
        unitCostPaise: 100,
        totalCostPaise: -4000,
        source: "DISPATCH",
        sourceId: invoice.id,
        finishedGoodsBatchId: fgBatch.id,
      },
    });

    // Test Forward Genealogy from raw batch
    const forward = await genealogyForward(rawBatch.id);
    expect(forward.rawMaterialBatch.id).toBe(rawBatch.id);
    expect(forward.productionRuns).toHaveLength(1);
    expect(forward.productionRuns[0].id).toBe(run.id);
    expect(forward.productionRuns[0].finishedGoodsBatch?.id).toBe(fgBatch.id);
    expect(forward.productionRuns[0].finishedGoodsBatch?.dispatchBatches).toHaveLength(1);
    expect(forward.productionRuns[0].finishedGoodsBatch?.dispatchBatches[0].qtyBase).toBe(40);

    // Test Backward Genealogy from dispatch
    const backward = await genealogyBackward(dispatch.id);
    expect(backward.id).toBe(dispatch.id);
    expect(backward.itemBatches).toHaveLength(1);
    expect(backward.itemBatches[0].finishedGoodsBatch.id).toBe(fgBatch.id);
    expect(backward.itemBatches[0].rawMaterialInputs).toHaveLength(1);
    expect(backward.itemBatches[0].rawMaterialInputs[0].rawMaterialBatch?.id).toBe(rawBatch.id);
  });

  it("refreshBatchStatuses: transitions to EXPIRING/EXPIRED and triggers notifications", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const rawItemId = await makeTestItem(adminCookie, "RAW_MATERIAL", "G");
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { active: true } });

    // Create a batch expiring in 5 days (<= 7 days threshold -> EXPIRING)
    const expiringBatch = await prisma.rawMaterialBatch.create({
      data: {
        itemId: rawItemId,
        internalBatchNo: `RM-EXPIRING-${Date.now()}`,
        supplierId: supplier.id,
        receivedQtyBase: 50,
        remainingQtyBase: 50,
        receiptDate: new Date(),
        expiryDate: new Date(Date.now() + 5 * 86_400_000),
        status: "NORMAL",
      },
    });

    await refreshBatchStatuses();

    const refreshed = await prisma.rawMaterialBatch.findUniqueOrThrow({ where: { id: expiringBatch.id } });
    expect(refreshed.status).toBe("EXPIRING");

    // Check that an EXPIRY_WARNING notification was created
    const notif = await prisma.notification.findFirst({
      where: {
        type: "EXPIRY_WARNING",
        sourceId: expiringBatch.id,
      },
    });
    expect(notif).not.toBeNull();
    expect(notif?.severity).toBe("WARNING");
  });
});
