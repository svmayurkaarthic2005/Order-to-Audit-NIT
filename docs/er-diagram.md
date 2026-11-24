# ER diagram — Porulottam ERP

Generated from `backend/prisma/schema.prisma`. Render with any Mermaid-compatible viewer (GitHub
renders this natively; VS Code's Markdown preview with a Mermaid extension works too).

```mermaid
erDiagram
    USER ||--o{ SALES_ORDER : "places (salesmanUserId)"
    USER ||--o{ STOCK_MOVEMENT : "recorded by"
    USER ||--o{ AUDIT_LOG : "acted"

    CUSTOMER ||--o{ SALES_ORDER : places
    CUSTOMER ||--o{ INVOICE : "billed to"

    SUPPLIER ||--o{ PURCHASE : "supplies"

    ITEM ||--o{ UNIT_CONVERSION : has
    ITEM ||--o{ STOCK_MOVEMENT : "ledger of"
    ITEM ||--o{ PURCHASE_ITEM : "purchased as"
    ITEM ||--o{ BOM_HEADER : "finished good of"
    ITEM ||--o{ BOM_LINE : "raw material in"
    ITEM ||--o{ PACK_SIZE : "pack size of"
    ITEM ||--o{ PRODUCTION_RUN_MATERIAL : "consumed in"
    ITEM ||--o{ ORDER_ITEM : "ordered as"
    ITEM ||--o{ INVOICE_ITEM : "invoiced as"

    BOM_HEADER ||--o{ BOM_LINE : "recipe lines"
    BOM_HEADER ||--o{ PACK_SIZE : "pack sizes"
    BOM_HEADER ||--o{ PRODUCTION_RUN : "runs against"

    PURCHASE ||--o{ PURCHASE_ITEM : lines

    PRODUCTION_RUN ||--o{ PRODUCTION_RUN_MATERIAL : "planned/actual"

    SALES_ORDER ||--o{ ORDER_ITEM : lines
    SALES_ORDER ||--o| INVOICE : "invoiced as"

    INVOICE ||--o{ INVOICE_ITEM : "frozen line items"
    INVOICE ||--o| DISPATCH : "dispatched as"
    INVOICE ||--o{ PAYMENT : "paid by"
    INVOICE ||--o{ CREDIT_NOTE : "corrected by"

    USER {
        string id PK
        string email UK
        string role
        boolean active
    }
    CUSTOMER {
        string id PK
        string name
        string state
        string gstin
    }
    SUPPLIER {
        string id PK
        string name
        string state
        string gstin
    }
    ITEM {
        string id PK
        string sku UK
        string type
        string baseUnit
        int taxRatePct
    }
    UNIT_CONVERSION {
        string id PK
        string itemId FK
        string label
        int factor
    }
    BOM_HEADER {
        string id PK
        string finishedItemId FK
        int expectedYieldQty
    }
    BOM_LINE {
        string id PK
        string bomHeaderId FK
        string rawItemId FK
        int qtyPerBatch
    }
    PACK_SIZE {
        string id PK
        string finishedItemId FK
        string baseBomId FK
        int multiplier
        string label
    }
    PURCHASE {
        string id PK
        string supplierId FK
        datetime purchaseDate
        datetime cancelledAt
    }
    PURCHASE_ITEM {
        string id PK
        string purchaseId FK
        string itemId FK
        int qtyBase
        int rateBasePaise
    }
    STOCK_MOVEMENT {
        string id PK
        string itemId FK
        int qtyBase "signed"
        int unitCostPaise
        int totalCostPaise
        string source
        string sourceId
        string idempotencyKey UK
        string openingStockItemId UK
    }
    PRODUCTION_RUN {
        string id PK
        string bomHeaderId FK
        int batchSize
        string status
        int actualOutputQty
        int damagedQty
    }
    PRODUCTION_RUN_MATERIAL {
        string id PK
        string productionRunId FK
        string itemId FK
        int plannedQtyBase
        int actualQtyBase
    }
    SALES_ORDER {
        string id PK
        string customerId FK
        string salesmanUserId FK
        string status
        string rejectionReason
    }
    ORDER_ITEM {
        string id PK
        string salesOrderId FK
        string itemId FK
        int qtyBase
        int ratePaise
    }
    INVOICE_SEQUENCE {
        string financialYear PK
        int lastNumber
    }
    INVOICE {
        string id PK
        string salesOrderId FK
        string customerId FK
        string financialYear
        int invoiceNumber
        int totalPaise
        string status
        string pdfStoragePath
    }
    INVOICE_ITEM {
        string id PK
        string invoiceId FK
        string itemId FK
        string description
        int qtyBase
        int ratePaise
    }
    CREDIT_NOTE {
        string id PK
        string invoiceId FK
        string reason
        int amountPaise
    }
    DISPATCH {
        string id PK
        string invoiceId FK,UK
        int qtyBase
        datetime dispatchedAt
    }
    PAYMENT {
        string id PK
        string invoiceId FK
        int amountPaise
        datetime paidAt
    }
    AUDIT_LOG {
        string id PK
        string userId FK
        string action
        string entityType
        string entityId
    }
```

## Reading notes

- **`INVOICE_SEQUENCE`** has no foreign keys to anything — it's a single locked counter row per
  financial year (`"2026-27"`), not part of the entity graph; it exists purely so invoice
  numbering is atomic.
- **`STOCK_MOVEMENT`** is the one ledger every physical inventory fact flows through
  (`OPENING_STOCK`, `PURCHASE`, `PRODUCTION_ISSUE`, `PRODUCTION_OUTPUT`, `PRODUCTION_DAMAGE`,
  `PRODUCTION_PACKAGING`, `DISPATCH`, and their reversals) — on-hand and moving-average cost are
  both always computed live from this table, never cached elsewhere.
- **`PRODUCTION_RUN_MATERIAL`** is the only table holding *planned* quantities; actual
  consumption is snapshotted onto the same row once a run starts, so planned-vs-actual variance
  is one join, not a reconciliation across tables.
- **`ITEM`** is a single master for raw materials, packaging and finished goods — the BOM's
  `finishedItemId` and `rawItemId` both point at it, which is why `BOM_LINE`'s raw item and
  `BOM_HEADER`'s finished item are two separate relations to the same table.
