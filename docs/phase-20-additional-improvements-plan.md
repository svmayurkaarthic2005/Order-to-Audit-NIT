# Phase 20+ — Additional Improvements Plan

Continues the Phase 1–19 build (see [design-note.md](./design-note.md) for the architecture those
phases produced). This document is the living plan for the next round of scope: auditability,
batch/expiry traceability, explainable costing, low-stock alerts and a notification centre.

**Stack — unchanged.** React + Vite + TS, Tailwind (+ hand-rolled `components/ui.tsx` primitives —
see note below), TanStack Query, Express + TS, PostgreSQL + Prisma, Zod, existing JWT + RBAC.
No new infra (no Redis/Kafka/WebSockets/queues) for any of this.

> **Correction to the brief's stack table**: the brief lists "shadcn/ui" and "Decimal/Numeric"
> precision. Neither is actually true of this codebase and neither should be introduced now:
> - UI primitives are hand-rolled in `frontend/src/components/ui.tsx` (no shadcn/ui was ever
>   installed). New screens must reuse that file's `Card`, `Table`, `StatusBadge`, `TabBar`, etc.
> - Money and quantity are **integer paise / integer base-units**, not Postgres `Decimal`. This is
>   deliberate (see design-note.md, "Money and quantity are integers everywhere") and must be
>   preserved exactly as-is — every new model below uses `Int`, never `Decimal`.

---

## 1. Existing-vs-missing feature matrix

Verified against `backend/prisma/schema.prisma`, `backend/src/modules/*`, and
`frontend/src/pages/*` as they stand after Phase 19.

| Capability | Status | Where it lives today |
|---|---|---|
| Stock ledger (append-only, SUM-derived on-hand) | ✅ Exists | `StockMovement` model; `inventory/service.ts` |
| Moving weighted-average cost | ✅ Exists | `StockMovement.unitCostPaise`, used in `production/costing.ts` |
| On-the-fly finished-goods reservation (APPROVED/DISPATCHABLE orders) | ✅ Exists | `orders/service.ts` — `getReservedQtyInTx` |
| Persisted reorder-level threshold | ❌ Missing | would be `Item.reorderLevel` |
| Low-stock alert records / lifecycle | ❌ Missing | new model needed |
| Any notification model | ❌ Missing | new model needed |
| Batch / lot tracking (raw material or finished goods) | ❌ Missing | new models needed |
| Expiry dates anywhere | ❌ Missing | — |
| FEFO selection logic | ❌ Missing | — |
| Production costing breakdown (material/packaging/labour/overhead/margin) | ✅ Exists | `production/costing.ts`; surfaced in `production/service.ts` |
| Historical costing snapshot immutability | ✅ Exists by construction | costing reads `StockMovement` rows frozen at issue-time, never recomputed from current prices |
| Production variance (planned vs actual, ±3% tolerance) | ✅ Exists | `production/variance.ts` |
| Reports: sales register, GST summary, purchase register, stock summary, production, payments & collections | ✅ Exists | `reports/service.ts`, `reports/router.ts`, `pages/admin/Reports.tsx` |
| Report drill-down to source transactions | ❌ Missing | reports currently return aggregates only, no link to source rows |
| Audit log (append-only, no update/delete route) | ✅ Exists | `AuditLog` model; `audit/*` |
| Audit **reconciliation** (cross-module consistency checks) | ❌ Missing | new module needed |
| Invoice/CreditNote/Payment models for financial reconciliation | ✅ Exists | `Invoice`, `InvoiceItem`, `CreditNote`, `Payment` |
| Shared BOM for multiple pack sizes | ✅ Already exists | `PackSize` model: one `BomHeader` (base recipe) + N `PackSize` rows (multiplier + label) per finished item — this is exactly "shared base recipe + product-specific packaging configuration." **Phase 27 is verification only, not new schema.** |
| Salesman order entry (customer → product → qty → total → submit) | ✅ Exists | `pages/salesman/OrderEntry.tsx`, `orders/service.ts` |
| Salesman offline queue / sync | ❌ Missing | needs local persistence + sync-on-reconnect |
| Recently-used customers/products on order entry | ❌ Missing | small frontend addition |

---

## 2. Implementation order (unchanged from the brief)

| Phase | Feature | Priority |
|---|---|---|
| 20 | Low-stock alerts | Required |
| 21 | Dashboard notification centre | Required |
| 22 | Batch, shelf-life, expiry & FEFO | High |
| 23 | Audit & reconciliation centre | High |
| 24 | Explainable production costing | High |
| 25 | Evidence-linked reports | High |
| 26 | Salesman UX improvements | Medium |
| 27 | Shared 200g/500g BOM — verification only | Medium |

Phases 20+21 are built together (alerts need a place to surface). Phase 22 is one connected unit
(batch tracking is useless without expiry + FEFO). Phases 23–25 all read the existing ledger/costing
services, never a new engine.

---

## Phase 20 — Low-stock alerts

**Stack layers:** Prisma schema · Express service/router · Zod schema · React page · TanStack Query

### Schema changes (`backend/prisma/schema.prisma`)
```prisma
model Item {
  // ...existing fields...
  reorderLevel Int?   // base-unit qty; null = no threshold configured
}

model LowStockAlert {
  id              String    @id @default(uuid())
  itemId          String
  item            Item      @relation(fields: [itemId], references: [id])
  thresholdAtAlert Int      // reorderLevel snapshot at creation time
  availableQtyAtAlert Int
  status          AlertStatus @default(ACTIVE) // ACTIVE | RESOLVED
  resolvedAt      DateTime?
  createdAt       DateTime  @default(now())

  // one active alert per item at a time — the dedup/resolve lifecycle lives here
  @@unique([itemId, status], map: "one_active_alert_per_item") // see note below on partial-unique
}

enum AlertStatus {
  ACTIVE
  RESOLVED
}
```
> Prisma can't express a *partial* unique index (`WHERE status = 'ACTIVE'`) directly — add it via a
> `prisma migrate dev --create-only` + hand-edited SQL migration:
> `CREATE UNIQUE INDEX one_active_alert_per_item ON "LowStockAlert" (itemId) WHERE status = 'ACTIVE';`
> Drop the `@@unique([itemId, status])` Prisma-level attempt above once the real partial index is
> in the migration — it's there to document intent only.

### Files to create
- `backend/src/modules/alerts/schema.ts` — Zod: `setReorderLevelSchema { itemId, reorderLevel: int().min(0) }`
- `backend/src/modules/alerts/service.ts` —
  - `computeAvailableQty(itemId)`: reuse `getOnHandInTx`-equivalent (promote the existing
    `orders/service.ts` on-hand/reserved helpers to a shared `inventory/service.ts` export instead
    of duplicating them) minus reserved, minus any quantity on EXPIRED/QUARANTINED batches once
    Phase 22 lands (stub this exclusion now, wire it in Phase 22).
  - `checkAndSyncAlerts()`: for every item with a `reorderLevel`, compute available qty; if
    `available < reorderLevel` and no ACTIVE alert exists, create one; if an ACTIVE alert exists
    and `available >= reorderLevel`, mark it RESOLVED. Call this from the existing stock-mutating
    code paths (end of `inventory`, `purchases`, `production`, `orders`, `dispatch` service
    functions that post a `StockMovement`) rather than a cron/poller — no background worker needed.
  - `listAlerts({ status })`, `setReorderLevel(itemId, level)`.
- `backend/src/modules/alerts/router.ts` — `GET /alerts`, `PATCH /items/:id/reorder-level`
  (ADMIN/OWNER only to configure; everyone with inventory-read can list).
- `backend/src/alerts.test.ts` — the benchmark rows from the brief's example table
  (Flour 120kg/100kg → Normal, Oil 19.5L/25L → Low, Spice 3.8kg/5kg → Low, Pouches 306/350 → Low).
- `frontend/src/pages/admin/LowStockAlerts.tsx` — table (reuse `Table`/`Th`/`Td`/`StatusBadge`)
  with Item, Available, Reorder level, Status columns; inline reorder-level editor for ADMIN/OWNER.

### Files to modify
- `backend/src/index.ts` — mount `alertsRouter` at `/alerts`.
- `backend/src/modules/inventory/service.ts` — export the on-hand/reserved helpers so
  `alerts/service.ts` and `orders/service.ts` share one implementation (currently only in
  `orders/service.ts`).
- Every service that posts a `StockMovement` (`inventory`, `purchases`, `production`, `orders`,
  `dispatch`) — call `checkAndSyncAlerts(itemId)` after the movement commits.
- `frontend/src/components/AppShell.tsx` — new nav item "Low stock" under the existing
  "Inventory" group, roles `["ADMIN","OWNER","ACCOUNTANT","PRODUCTION"]`.
- `frontend/src/App.tsx` — route `/admin/low-stock`.

### Acceptance
Configurable thresholds persist; available qty = on-hand − reserved; the brief's 4-row example
reproduces exactly; re-running checks after no change creates no duplicate alert; stock rising back
above threshold auto-resolves the existing alert; a later drop creates a *new* alert row (never
reopens the resolved one).

---

## Phase 21 — Dashboard notification centre

**Stack layers:** Prisma schema · Express service/router · React component · TanStack Query (poll, not socket)

### Schema changes
```prisma
model Notification {
  id             String    @id @default(uuid())
  recipientUserId String?  // null = broadcast to recipientRoles
  recipientRoles Role[]    // used when recipientUserId is null
  type           NotificationType
  title          String
  message        String
  severity       AlertSeverity @default(INFO) // INFO | WARNING | CRITICAL
  sourceType     String    // "LowStockAlert" | "ProductionRun" | "AuditException" | ...
  sourceId       String
  dedupeKey      String    @unique // e.g. `${type}:${sourceType}:${sourceId}` — prevents re-firing
  readAt         DateTime?
  createdAt      DateTime  @default(now())

  @@index([recipientUserId, readAt])
}

enum NotificationType {
  LOW_STOCK
  STOCK_REPLENISHED
  PRODUCTION_VARIANCE
  ORDER_SHORTAGE
  AUDIT_EXCEPTION
  EXPIRY_WARNING
}
enum AlertSeverity { INFO WARNING CRITICAL }
```

### Files to create
- `backend/src/modules/notifications/schema.ts` — `listQuerySchema { unreadOnly?: boolean }`
- `backend/src/modules/notifications/service.ts` —
  `notify({ recipientRoles | recipientUserId, type, title, message, severity, sourceType, sourceId })`
  — upserts on `dedupeKey` (`ON CONFLICT (dedupeKey) DO NOTHING`, Prisma: `upsert` with a no-op
  update) so Phase 20's `checkAndSyncAlerts` and Phase 22/23's checks can call this freely without
  worrying about duplicates themselves; `listForUser(user)`, `markRead(id, user)`, `markAllRead(user)`.
- `backend/src/modules/notifications/router.ts` — `GET /notifications`,
  `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`.
- `backend/src/notifications.test.ts` — dedup test, role-visibility test (table in §Role-based
  visibility below), read/unread count test.
- `frontend/src/components/NotificationBell.tsx` — bell icon in `AppShell`'s top bar, unread badge,
  dropdown list (severity dot, relative timestamp, click → navigate to `sourceType`/`sourceId`'s
  page), "mark all read".

### Files to modify
- `backend/src/index.ts` — mount `notificationsRouter`.
- `backend/src/modules/alerts/service.ts` — call `notify(...)` on alert create/resolve
  (`LOW_STOCK` / `STOCK_REPLENISHED`), recipients = roles from the table below.
- `backend/src/modules/production/service.ts` — call `notify(...)` when a completed run's variance
  exceeds tolerance (`PRODUCTION_VARIANCE`).
- `backend/src/modules/orders/service.ts` — call `notify(...)` on `insufficient_stock` rejection
  (`ORDER_SHORTAGE`), recipient = the order's own salesman + ADMIN/OWNER.
- `frontend/src/components/AppShell.tsx` — mount `<NotificationBell/>` in the existing desktop
  top-bar (next to the user chip) and in the mobile header.

### Role-based visibility (filter in `listForUser`, not in the UI)
| Role | Sees |
|---|---|
| OWNER | everything |
| ADMIN | LOW_STOCK, STOCK_REPLENISHED, ORDER_SHORTAGE, EXPIRY_WARNING |
| PRODUCTION | LOW_STOCK (raw material only), PRODUCTION_VARIANCE, EXPIRY_WARNING |
| ACCOUNTANT | AUDIT_EXCEPTION only (plus anything financial once Phase 23 lands) |
| SALESMAN | ORDER_SHORTAGE for their own orders only (`recipientUserId` match) |

### Acceptance
Persists across sessions (plain Postgres row, no socket); unread count correct per role; identical
`dedupeKey` never creates a second row; clicking a notification opens the real source record;
`GET /notifications` enforces the same role filter server-side (not just hidden in the UI).

---

## Phase 22 — Batch, shelf-life, expiry & FEFO

**Stack layers:** Prisma schema (the big one this phase) · Express service/router · React pages

This is the largest schema change. It extends the ledger rather than replacing it — every
`StockMovement` row gets an optional `batchId`, and two new tables carry batch identity.

### Schema changes
```prisma
model RawMaterialBatch {
  id                String    @id @default(uuid())
  itemId            String
  item              Item      @relation(fields: [itemId], references: [id])
  internalBatchNo   String    @unique
  supplierBatchNo   String?
  supplierId        String
  supplier          Supplier  @relation(fields: [supplierId], references: [id])
  purchaseItemId    String?   // links back to the receipt that created it
  purchaseItem      PurchaseItem? @relation(fields: [purchaseItemId], references: [id])
  receivedQtyBase   Int
  remainingQtyBase  Int       // decremented as this lot is issued; never recomputed, see note
  receiptDate       DateTime
  manufactureDate   DateTime?
  expiryDate        DateTime?
  qualityDocRef     String?
  status            BatchStatus @default(NORMAL) // NORMAL | EXPIRING | EXPIRED | QUARANTINED
  createdAt         DateTime  @default(now())

  movements         StockMovement[]
}

model FinishedGoodsBatch {
  id                String    @id @default(uuid())
  itemId            String
  item              Item      @relation(fields: [itemId], references: [id])
  internalBatchNo   String    @unique
  productionRunId   String
  productionRun     ProductionRun @relation(fields: [productionRunId], references: [id])
  manufactureDate   DateTime
  expiryDate        DateTime?
  producedQtyBase   Int
  remainingQtyBase  Int
  status            BatchStatus @default(NORMAL)
  createdAt         DateTime  @default(now())

  movements         StockMovement[]
}

enum BatchStatus { NORMAL EXPIRING EXPIRED QUARANTINED }

model StockMovement {
  // ...existing fields...
  rawMaterialBatchId   String?
  rawMaterialBatch     RawMaterialBatch?   @relation(fields: [rawMaterialBatchId], references: [id])
  finishedGoodsBatchId String?
  finishedGoodsBatch   FinishedGoodsBatch? @relation(fields: [finishedGoodsBatchId], references: [id])
}

model DispatchItemBatch {
  // links one dispatch line to the exact finished-goods batch(es) it drew from —
  // a dispatch line can span >1 batch if one lot runs out mid-line
  id                    String   @id @default(uuid())
  dispatchItemId        String
  finishedGoodsBatchId  String
  finishedGoodsBatch    FinishedGoodsBatch @relation(fields: [finishedGoodsBatchId], references: [id])
  qtyBase               Int
}

model Item {
  // ...existing fields...
  shelfLifeDays Int?   // configurable per product; null = no expiry tracking for this item
}
```

> **Why `remainingQtyBase` is stored, not derived**: unlike the main ledger (deliberately SUM-only,
> per design-note.md), per-batch remaining quantity is maintained as a running counter *in addition
> to* being reconcilable against `SUM(StockMovement.qtyBase WHERE batchId = X)`. Reasoning: FEFO
> selection needs a fast "how much is left in this lot" read under lock, many times per
> transaction; recomputing a SUM per candidate batch on every production-issue or dispatch would be
> correct but needlessly expensive. **Add a test that asserts the two numbers always agree**
> (`remainingQtyBase === SUM of that batch's movements`) — this is the ledger-reconciliation
> invariant the brief's "do not create a disconnected batch-stock counter" rule is really asking for.

### Files to create
- `backend/src/modules/batches/schema.ts` — receipt-batch input, FEFO override reason schema.
- `backend/src/modules/batches/service.ts` —
  - `receiveBatch(purchaseItemId, batchDetails)` — called from `purchases/service.ts` at receipt time.
  - `selectBatchesFEFO(itemId, qtyNeeded)` — returns ordered list of `{batchId, qty}` excluding
    EXPIRED/QUARANTINED, earliest `expiryDate` first, respecting `remainingQtyBase`; throws if
    insufficient eligible stock.
  - `issueFromBatches(selections, overrideReason?)` — posts the ledger rows with `batchId` set,
    decrements `remainingQtyBase`, records `overrideReason` on an audit-log entry if the caller
    picked different batches than `selectBatchesFEFO` returned.
  - `recordProductionOutput(productionRunId, qty, expiryDate)` — creates the `FinishedGoodsBatch`.
  - `refreshBatchStatuses()` — called from the same service calls as Phase 20's
    `checkAndSyncAlerts` (no cron): flips NORMAL→EXPIRING at `shelfLifeDays` thresholds
    (30/15/7 days out, configurable per item via a `expiryWarningDaysJson Int[]` default
    `[30,15,7,0]` — add this array field to `Item` alongside `shelfLifeDays`), EXPIRING→EXPIRED past
    `expiryDate`; fires `notify(..., type: "EXPIRY_WARNING", dedupeKey: "expiry:${batchId}:${thresholdDay}")`
    for each threshold crossed exactly once.
  - `genealogyForward(rawMaterialBatchId)` / `genealogyBackward(dispatchId)` — joins
    `StockMovement` → `ProductionRun` → `FinishedGoodsBatch` → `DispatchItemBatch` both ways.
- `backend/src/modules/batches/router.ts` — `GET /batches/raw-material`, `GET /batches/finished-goods`,
  `GET /batches/:id/genealogy`, `PATCH /batches/:id/quarantine`.
- `backend/src/batches.test.ts` — multi-lot test, FEFO-selection test, expired-stock-blocked test
  (production issue + dispatch both reject an all-expired-eligible-stock scenario), genealogy
  forward+backward test, remaining-qty-reconciles-with-ledger test.
- `frontend/src/pages/admin/Batches.tsx` — two tabs (Raw material / Finished goods), each a table
  with expiry-status `StatusBadge`, click-through to a genealogy view.
- `frontend/src/pages/admin/BatchGenealogy.tsx` — the forward/backward trace view for one batch.

### Files to modify
- `backend/prisma/schema.prisma`, new migration.
- `backend/src/modules/purchases/service.ts` — accept batch fields on receipt, call `receiveBatch`.
- `backend/src/modules/production/service.ts` — on issue, call `selectBatchesFEFO` +
  `issueFromBatches` instead of a plain ledger debit; on completion, call `recordProductionOutput`.
- `backend/src/modules/dispatch/service.ts` — same FEFO pattern for finished goods; populate
  `DispatchItemBatch`.
- `backend/src/modules/alerts/service.ts` — `computeAvailableQty` now excludes EXPIRED/QUARANTINED
  batch quantity (the stub left in Phase 20).
- `frontend/src/components/AppShell.tsx` / `App.tsx` — nav + routes for Batches.

### Acceptance
Per the brief's §8 acceptance line verbatim: multiple lots, expiry alerts, blocked expired stock,
FEFO selection, accurate remaining quantities and full batch genealogy all work against real
Postgres data, verified by `batches.test.ts`.

---

## Phase 23 — Audit & reconciliation centre

**Stack layers:** Express service/router (read-only) · React page · TanStack Query

No new ledger-mutating logic — this phase only *reads* `StockMovement`, `Invoice`, `Payment`,
`ProductionRun`, `Dispatch`, `SalesOrder` and reports discrepancies.

### Schema changes
```prisma
model ReconciliationException {
  id            String    @id @default(uuid())
  checkType     String    // "STOCK" | "PRODUCTION_VARIANCE" | "PACKAGING" | "INVOICE" | "DISPATCH"
  sourceType    String
  sourceId      String
  expectedValue String    // stringified — these checks compare heterogeneous units (qty, paise, %)
  actualValue   String
  differenceValue String
  severity      AlertSeverity
  status        ExceptionStatus @default(OPEN) // OPEN | REVIEWED | RESOLVED
  explanation   String?
  resolutionNote String?
  reviewedByUserId String?
  reviewedAt    DateTime?
  createdAt     DateTime  @default(now())
  dedupeKey     String    @unique // one open exception per (checkType, sourceId) run window
}
enum ExceptionStatus { OPEN REVIEWED RESOLVED }
```

### Files to create
- `backend/src/modules/reconciliation/schema.ts`
- `backend/src/modules/reconciliation/service.ts` — one function per check, each pure/read-only:
  - `checkStockReconciliation(itemId, dateRange)` — opening + receipts − issues − dispatches +
    returns ± adjustments vs. computed closing; reuses `inventory/service.ts`'s on-hand helper.
  - `checkProductionVariance(runId)` — thin wrapper over the existing `production/variance.ts`,
    persisted as an exception when |variance| > tolerance (reuses the ±3% constant already defined
    there — do not redefine it).
  - `checkPackagingReconciliation(runId)` — good output + damaged vs. pouches consumed vs.
    cartons × capacity; reproduces the brief's 8-packet benchmark exactly.
  - `checkInvoicePaymentReconciliation(invoiceId)` — total vs. GST components vs. payments vs.
    credit notes vs. outstanding, reusing `invoices/service.ts` and `payments/service.ts` totals.
  - `checkDispatchReconciliation(dispatchId)` — dispatch ties to an APPROVED/DISPATCHABLE order and
    doesn't exceed available (non-reserved) finished-goods stock at dispatch time.
  - `runAllChecks(dateRange)` — orchestrates the five above, upserts `ReconciliationException` rows
    (dedupe on `dedupeKey = ${checkType}:${sourceId}`), returns a summary
    `{total, passed, warnings, critical}`.
  - `reviewException(id, { explanation? , resolutionNote?, status })` — **never touches the
    source transaction**; only writes to `ReconciliationException` itself, exactly as the brief's
    "never silently modify historical transactions" rule requires.
- `backend/src/modules/reconciliation/router.ts` — `POST /reconciliation/run`,
  `GET /reconciliation/exceptions`, `PATCH /reconciliation/exceptions/:id`.
- `backend/src/reconciliation.test.ts` — the brief's benchmark numbers as fixtures: Oil
  10L planned/10.5L actual (+5%), production 200 expected/188 good (−6%), and the 8-packet
  packaging gap (188 good + 6 damaged = 194 pouches consumed; 9 cartons × 20 = 180 capacity →
  194 − 180 = 14... **recompute this against the brief's own arithmetic during implementation**:
  the brief states "8 packets require reconciliation" but 194 consumed − 180 carton capacity = 14,
  not 8 — flag this discrepancy to the stakeholder before hard-coding either number into a test;
  do not silently pick one.
- `frontend/src/pages/admin/Reconciliation.tsx` — dashboard (counts), exception list with
  severity/explanation/resolve actions, filtered by date range and check type.

### Files to modify
- `backend/src/index.ts` — mount router.
- `frontend/src/components/AppShell.tsx` / `App.tsx` — nav under "Analytics & Logs", roles
  `["ADMIN","OWNER","ACCOUNTANT"]`.

### Acceptance
Runs against real Postgres data; every exception links to its real source record; reconciliation
never writes to `StockMovement`/`Invoice`/`Payment`/etc., only to `ReconciliationException`;
re-running `runAllChecks` doesn't duplicate an already-OPEN exception for the same source.

---

## Phase 24 — Explainable production costing

**Stack layers:** Express service (extend existing) · React page (extend existing)

**No new costing engine.** This phase adds a breakdown view and an explanation panel on top of the
number `production/costing.ts` already computes.

### Schema changes
```prisma
model ProductionRun {
  // ...existing fields...
  laborCostPaise  Int?  // manual entry at completion time — "actual expense" per the brief
  overheadCostPaise Int? // replaces/clarifies the current flat ₹500 assumption noted in design-note.md
}
```
Keep the existing flat-overhead default as the fallback when this field is left unset, so Phase 1–19
benchmark runs (which never set it) still compute the same ₹500/batch they always did.

### Files to modify
- `backend/src/modules/production/costing.ts` — extend the return shape to a structured breakdown:
  `{ materialLines: [{itemId, sku, qtyBase, unitCostPaise, totalCostPaise}], packagingLines: [...],
  laborCostPaise, overheadCostPaise, totalCostPaise, goodOutputQty, costPerGoodUnitPaise }` instead
  of (or alongside) the current single total, so the frontend can render every line the brief's
  ₹5,855 table shows.
- `backend/src/modules/production/service.ts` — accept `laborCostPaise`/`overheadCostPaise` on the
  "complete run" endpoint; persist them on `ProductionRun` at completion (this *is* the historical
  snapshot — once `completedAt` is set, these fields and the costing calc that reads only
  already-posted `StockMovement` rows never change even if the BOM or purchase prices change later).
- `frontend/src/pages/production/ProductionRuns.tsx` (or a new `ProductionRunDetail.tsx` if runs
  currently only have a list view — verify which during implementation) — add the full breakdown
  table + a "How was this cost calculated?" collapsible section narrating: WAC formula per raw
  material line, packaging cost incl. damaged-unit pouches/cartons, labour/overhead, division by
  **good** output only, and the resulting margin vs. the item's selling price (reuse `PackSize`/
  `Item` pricing if stored, else the most recent invoice rate for that SKU).

### Files to create
- `backend/src/production-costing-breakdown.test.ts` — the brief's exact benchmark: flour WAC
  ₹43.125/kg, oil ₹1,470, spice ₹240, pouches ₹485, cartons ₹135, labour ₹1,200, power/gas ₹600,
  total ₹5,855, cost/good-packet ₹31.14, margin ₹18.86 at a ₹50 selling price.

### Acceptance
₹31.14 reproduces from real ledger data; changing a BOM or a later purchase price after a run is
`completedAt` does not change that run's already-displayed cost; existing `benchmark.test.ts`
(Phase 17's consolidated test) still passes unchanged.

---

## Phase 25 — Evidence-linked reports

**Stack layers:** Express service (extend existing) · React (extend existing pages)

No new report types — every report in `reports/service.ts` gains a drill-down endpoint.

### Files to modify
- `backend/src/modules/reports/service.ts` — add, per report, a `*Detail` function returning the
  underlying rows for one aggregate cell:
  - `getStockLedgerDetail(itemId, dateRange)` — the existing `/reports/stock-ledger` endpoint
    (confirm it already returns raw movements — if so, Phase 25 is just wiring the UI to call it;
    if the summary report doesn't currently link to it, add the link).
  - `getInvoicePaymentDetail(invoiceId)` — invoice total, GST split, each payment, each credit note.
  - `getProductionCostDetail(runId)` — delegates to Phase 24's extended `costing.ts` breakdown.
- `backend/src/modules/reports/router.ts` — ensure each detail function has a `GET` route (several
  likely already exist per-item; audit and fill gaps only).
- `frontend/src/pages/admin/Reports.tsx` — make the relevant numeric `Td` cells clickable
  (reuse existing `Table`/`Td`; add an `onClick` + hover affordance, not a new table component),
  opening a drill-down panel/modal that calls the new detail endpoint.
- `frontend/src/components/ui.tsx` — if no modal/drawer primitive exists yet, add a minimal
  `Drawer`/`Modal` component here (check first — `TabBar`/`Loading`/`DateRangeFilter` were added
  ad hoc before, a dialog primitive may already exist under a different name).

### Files to create
- `backend/src/reports-drilldown.test.ts` — the brief's two worked examples: flour closing stock
  120kg traces to opening 100 + purchase 60 − production issue 40; Retailer A outstanding ₹3,875
  traces to invoice ₹7,875 − payment ₹4,000.

### Acceptance
Every drill-down total reconciles exactly with the summary figure it expands; existing CSV/Excel/PDF
exports, date filters and RBAC on `/reports/*` are untouched.

---

## Phase 26 — Salesman UX improvements

**Stack layers:** React only (frontend), one small backend addition for offline-safe submission

### Files to modify
- `frontend/src/pages/salesman/OrderEntry.tsx` — add: a "Recent" chip row (last N customers/products
  from `localStorage`, populated client-side from successful submissions — no new backend query
  needed for this part), a quantity stepper (+/− buttons around the existing qty `Input`), a
  running total that updates live, a post-submit confirmation toast/panel.
- `frontend/src/pages/salesman/OrderHistory.tsx` — already shows status; add a customer-wise filter
  if not present (check first).
- `frontend/src/lib/api.ts` — add an offline queue: on `POST /orders` network failure, persist the
  payload + a client-generated `idempotencyKey` (UUID) to `localStorage`; on reconnect (a `online`
  event listener, no polling library needed), replay queued payloads in order, each carrying its
  original `idempotencyKey`.

### Files to modify (backend)
- `backend/src/modules/orders/service.ts` — confirm `createOrder` already accepts/honors an
  `Idempotency-Key` header the way `production/service.ts`'s complete-run endpoint does (per the
  memory of this codebase's patterns); if not, add the same `idempotencyKey` column/unique-constraint
  pattern already used elsewhere (check `StockMovement.idempotencyKey` as the existing precedent)
  so a replayed offline order can never double-post.

### Acceptance
A fresh order (known customer+product) completes in well under a minute in manual testing; offline
submission queues locally and replays exactly once on reconnect even if the user is impatient and
retries manually; existing approval/stock-verification flow in `orders/service.ts` is untouched.

---

## Phase 27 — Shared 200g/500g BOM — verification only

**No schema or service change is expected.** `PackSize` already models "shared base recipe +
product-specific packaging configuration" exactly as the brief asks for.

### What to actually do
1. Write `backend/src/pack-size-costing.test.ts`: create a 200g and 500g `PackSize` off the same
   `BomHeader`, run production for each, assert each produces its own `FinishedGoodsBatch`/stock
   line under its own `Item.sku`, and that per-unit cost correctly reflects each pack's own
   packaging line cost while sharing the same raw-material WAC.
2. If (and only if) that test reveals a real gap — e.g. packaging cost currently isn't
   pack-size-specific in `costing.ts` — fix the specific gap found, not the whole module.
3. Document the result in this file's changelog section (below) either way: "verified, no changes
   needed" or "fixed: <specific gap>".

---

## 3. Testing checklist (maps 1:1 to the brief's §13)

Track execution here as phases land — update ✅/❌ as each file is actually run, not when planned:

- [ ] Stock reconciliation (raw material + finished goods)
- [ ] Invoice/payment reconciliation
- [ ] Packaging discrepancy benchmark (verify exact expected number first — see Phase 23 note)
- [ ] Production variance reconciliation
- [ ] Exception review is read-only (no source-table writes)
- [ ] ₹31.14 costing benchmark
- [ ] Historical costing stability (BOM/price change after completion doesn't alter old runs)
- [ ] Report drill-down consistency (both worked examples)
- [ ] Low/out-of-stock detection (brief's 4-row table)
- [ ] Reservation-aware availability
- [ ] Alert dedup + auto-resolution
- [ ] Notification unread counts + read/unread ops
- [ ] Notification role filtering enforced server-side
- [ ] Multiple supplier lots per item
- [ ] Finished-batch creation on run completion
- [ ] Batch remaining-qty reconciles with ledger SUM
- [ ] Expiry warning thresholds (30/15/7/0/after)
- [ ] Expired/quarantined stock blocked from issue, dispatch, reservation
- [ ] FEFO selection + documented override reason
- [ ] Forward genealogy (supplier lot → dispatch)
- [ ] Backward genealogy (dispatch → supplier lot)
- [x] Shared 200g/500g recipe costing
- [ ] Full existing benchmark regression (`backend/src/benchmark.test.ts` still green)

## 4. Explicitly out of scope (unchanged)

Blockchain/AI forecasting, IoT, microservices, Redis/Kafka, separate analytics DB, multi-factory,
new accounting/costing/reporting engines, native mobile apps, WebSockets, email/SMS/WhatsApp,
HACCP modules. Everything above stays inside the existing modular monolith.

## Changelog

- *(fill in as each phase ships: date, phase, commit hash, actual test results)*
- **2026-11-25 — Phase 27 (Shared 200g/500g BOM):** fixed, not just verified. The opening
  assumption was wrong: `PackSize` only ever recorded the finishedItem/baseBom/multiplier
  relationship — nothing read it. `completeProductionRun` always posted output to
  `bomHeader.finishedItemId`, so a BOM's registered pack sizes were never actually reachable from
  production; there was no way to complete a run *as* its 500g variant. Fix: `productionRunCompleteSchema`
  gained an optional `packSizeId`; when present, `completeProductionRunInTransaction` validates it
  belongs to the run's own BOM (`packSize.baseBomId === run.bomHeaderId`, else 400
  `invalid_pack_size`) and directs the `FinishedGoodsBatch` + `PRODUCTION_OUTPUT` stock movement +
  alert sync to `packSize.finishedItemId` instead. No schema change beyond that one optional field,
  and no change to `costing.ts` — its cost breakdown already reads real `StockMovement` rows per
  run regardless of which item they target, so it worked correctly as soon as the output itemId
  did. `backend/src/pack-size-costing.test.ts` (2 tests, passing): a 200g and a 500g run off the
  same shared BOM each land under their own SKU with their own packaging cost (₹5.00 vs ₹3.60)
  while sharing one exact raw-material WAC; a `packSizeId` from a different BOM is rejected.
  Full suite: 153 tests, 151 passing (the 2 failures are the same pre-existing, unrelated bugs
  already tracked — a `production.test.ts` cleanup ordering bug and a `batches.test.ts`
  error-message assertion), `benchmark.test.ts` still green (8/8).
- **2026-11-25 — Invoice email delivery:** the brief's 4.2 only asks for "a WhatsApp share link
  or email," and WhatsApp was already covered by the `wa.me` click-to-chat link — this adds the
  email half via Gmail SMTP (`GMAIL_USER`/`GMAIL_APP_PASSWORD`, a Gmail App Password). The
  out-of-scope note above refers to building generic notification infrastructure, not this
  specific per-invoice delivery path. New `Customer.email` field (optional), a `POST
  /invoices/:id/send-email` route (same read-role gate as the existing PDF/outstanding routes,
  since it shares already-visible data rather than mutating anything), and an audit log entry per
  send. The PDF is rendered fresh from the invoice's own frozen fields for the attachment, not
  fetched from storage, so it works even without Supabase configured. With no SMTP credentials
  set, the route returns a clear 503 rather than a silent no-op. `backend/src/invoice-email.test.ts`
  (6 tests, passing): mocks only `nodemailer` (the one real external boundary) — covers the 503
  when unconfigured, the customer's email-on-file, an explicit override address, the 400 when
  neither is present, the audit entry, and RBAC.
