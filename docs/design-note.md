# Design note — Porulottam ERP

## The problem, restated

A small food manufacturer runs the same business on paper and in people's memory: a salesman
takes an order, the factory checks whether it can be filled, production turns raw material into
finished goods, the factory ships and bills, and at month-end someone has to be able to answer
"what did we make, what did it cost, and who owes us money" — accurately, after the fact, without
re-asking anyone. The system's job is to make every one of those steps a recorded fact instead of
a conversation, without getting in the way of the people doing the work.

## Architecture, in one paragraph

A standard two-tier app: Express/TypeScript backend, Postgres via Prisma, React/Vite frontend.
The backend is organized as one module per business area
(`orders`, `production`, `invoices`, `dispatch`, `payments`, `reports`, …), each with its own
`router.ts` / `service.ts` / `schema.ts`, so a change to one area never touches another's files.
Every route follows one contract: `{data: ...}` on success, `{error: {code, message, details}}`
on failure, zod validation on every input, role middleware on every route. The frontend mirrors
this one-screen-per-area structure and shares one design-system layer (`components/ui.tsx`,
`AppShell.tsx`) so every screen looks and behaves the same way.

## The decisions that actually mattered

**Stock is a ledger, not a number.** `stock_movements` is append-only: every opening balance,
purchase, production issue, production output, dispatch and damage is its own signed row. On-hand
is never a cached column — it's always `SUM(qtyBase)` for that item, computed live. This is the
single decision the rest of the inventory model follows from: it's the only way "what's on hand"
and "what did we pay for it" can never drift out of sync with the audit trail, because they're the
same query. The cost of that choice is that every on-hand lookup is an aggregate, not a row read —
acceptable at this scale, and indexed on `itemId`.

**Cost is moving weighted-average, computed the same way.** An issue of `q` is valued at
`round(q × SUM(totalCostPaise) / SUM(qtyBase))` over the same ledger: the exact ratio, with only
the final paise rounded. Rounding the per-gram rate first would lose real money (flour at
₹43.125/kg is 4.3125 paise/g; rounded to 4 it would cost the benchmark's 40 kg at ₹1,600 instead
of ₹1,725). A purchase line is booked at its exact total for the same reason. A production run
issues raw material at that value, not a hand-entered one, so a finished packet's cost traces back
to the actual purchase prices that went into it.

**Every "claim a status transition" operation is atomic by construction.** Approving an order,
recording or cancelling a production run, creating an invoice, recording a dispatch — each of these
does `UPDATE ... WHERE status = 'expected' SET status = 'next'` and checks the row count, *before*
posting any side effect (a stock movement, an invoice number). Two concurrent requests racing to
approve-then-reject the same order, or to complete the same production run twice, can't both
succeed: the database's own row-level locking decides, not an application-level read-then-write
that a scheduler can interleave. This pattern was tightened twice during development after an
automated review found exactly this kind of race in the production lifecycle and the order
approve/reject pair — both fixed the same way, by moving the atomic claim earlier.

**Stock reservation across concurrent orders uses an advisory lock, not a row lock.** Checking
whether approving order A would leave enough stock for order B (which doesn't exist as a database
row yet, so there's nothing to row-lock) needs its own serialization point —
`pg_advisory_xact_lock(hashtext(itemId))`, taken in a stable sorted order across items to avoid
deadlocking two orders that both touch the same two items in opposite order.

**Money and quantity are integers everywhere.** Paise, not rupees; base units (grams, millilitres,
pieces), not display units. No floating-point rounding ever enters a financial or inventory
calculation; GST splits (CGST+SGST for same-state, IGST for interstate) are rounded per component
with the remainder absorbed exactly so the three numbers always sum to the total.

**An invoice, once issued, is immutable.** `InvoiceItem` rows are a frozen snapshot of what was
billed at that moment. A correction is a `CreditNote` against the invoice, never a mutation of it
— the invoice a customer received on paper always matches the invoice the system remembers issuing.
Invoice numbering is a single locked `InvoiceSequence` row per financial year, incremented inside
the same transaction as invoice creation, so numbers are gapless and never collide under
concurrent invoicing.

**The ledger and the audit log are append-only, enforced by the database.** Triggers refuse any
UPDATE or DELETE on `StockMovement` and `AuditLog`; only a throwaway test database opts in to
deletes (`app.allow_ledger_cleanup`), so the test suite can clean up. There is also no route that
edits either, and no PATCH or DELETE route on `/invoices` at all. Corrections are always new rows:
reversals for a cancelled run or purchase (put back on the same batch), a credit note for an
invoice.

**A production run is recorded in one transaction.** The floor fills one form: materials used,
damaged packaging, good packets, labour and gas/power. Issuing the materials, the packaging and
the output either all happen or none do, so a shortage found half-way (say, too few pouches)
leaves the run planned and the stock untouched. Runs are planned against a recipe *version*:
editing a recipe saves a new version, so planned and finished runs keep the amounts they were
planned with. A recipe can feed several pack formats (200 g, 500 g), each with its own expected
packets and packaging.

**Orders show the shortage before anyone decides.** A waiting order carries a live stock check
(requested, available, short) and the GST its invoice would carry. Approval re-checks under a
lock and refuses a shortage without setting anything aside; the salesman, owner and admin are
notified. Each later hand-off (approved, invoiced, dispatched, cancelled) notifies the salesman.

**A count correction is a ledger row, not an edit.** The brief's closing-balance formula is
opening + receipts − issues ± *adjustments*; `StockMovement` being append-only means a correction
can never be a silent edit to an earlier row. Admin/Owner records a found surplus or a write-off
with a reason, and it posts as its own `ADJUSTMENT` movement — backed by a `StockAdjustment` row
that carries the reason, who and when — valued at the item's current moving-average rate so the
correction true-ups the quantity without distorting the cost history around it.

**Checked three ways.** 193 backend tests against a real Postgres, the section 5 benchmark
replayed on a brand-new database (15 checks), and browser tests that click through the whole
story as each role. CI runs all three on every push.

## Assumptions made where the problem statement was silent

- **Production overhead**: the run's actual labour and gas/power, entered when it's recorded
  (the benchmark's ₹1,200 + ₹600). If left blank, a flat ₹500 per batch is assumed and the run's
  cost panel says so. Material cost + labour + overhead, divided by good packets, gives the cost
  per packet: ₹5,855 ÷ 188 = ₹31.14 for the benchmark run. Damaged packaging is part of the
  material cost. Once a run completes, its figure is a historical snapshot; a later purchase
  price or recipe edit never changes it.
- **Variance tolerance**: ±3%, applied identically to every material line and to yield.
- **Packaging damage**: recorded per packaging line (pouches vs. cartons can each have their own
  damaged quantity), not as one top-level figure, because the benchmark scenario's own numbers
  only make sense that way.

## What this build deliberately does not do

No multi-warehouse, no multi-currency, no partial GST credit workflows,
no user-management UI (roles are seeded), and dispatch covers single-product invoices only. These are explicitly out of the problem statement's
scope, and the 19-phase build plan treats every one of them as a stretch item to build only after
the mandatory benchmark passes, which it now does end to end on a brand-new database
(`npm run benchmark`, also run by CI on every push).
