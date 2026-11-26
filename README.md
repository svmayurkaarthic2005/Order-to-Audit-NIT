# Porulottam ERP (பொருளோட்டம்)

An Order-to-Audit system for a small South Indian food manufacturer: field orders, BOM-driven
production, raw-material and finished-goods stock, GST billing, dispatch, payments, costing and
audit reporting, in one role-based application. Built for the NIT Tiruchirappalli internship
shortlisting task.

- **Live demo:** https://porulottam-erp-bay.vercel.app (test logins [below](#test-logins-password-password123-for-all))
- **Run it locally:** five commands, below
- **Re-run the benchmark yourself:** `cd backend && npm run benchmark` (builds a brand-new database
  and replays section 5 end to end; details [below](#the-benchmark-section-5))

## Stack, and why

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind CSS, React Router, TanStack Query |
| Backend | Node.js, Express 5, TypeScript, Prisma 6 |
| Database | PostgreSQL (Docker locally; Supabase when hosted) |
| Auth | JWT in an httpOnly cookie, bcrypt, role checks on every route |
| Invoices | PDFKit; stored in Supabase Storage (private bucket) or local disk |
| Tests | Vitest + Supertest against a real Postgres: 182 tests, plus the 15-check benchmark replay |
| CI | GitHub Actions: migrate, seed, typecheck, tests, benchmark, frontend build |

One web app serves every role: the salesman gets a phone-sized order screen that keeps working
offline, while the office and floor get desktop pages, so there's no separate mobile app to
build or install. PostgreSQL gives real transactions, row locks and constraints, which the stock
and money rules depend on. TypeScript runs end to end, so the API and the screens share the
same shapes, and Prisma keeps the schema and its migrations in one place.

## Roles

| Role | Uses it on | Can do |
|---|---|---|
| Salesman | Phone | Place orders (offline too), see own orders, their status, rejection reasons and customer-wise sales |
| Admin | Desktop | Approve/edit/reject orders, raise GST invoices, dispatch, record payments, credit notes, masters, recipes, purchases |
| Production | Desktop or tablet | Purchases (material receipts), production runs: issue materials, record output and wastage; batches |
| Accountant | Desktop | Read-only: every report and export, invoices, stock, activity log, checks |
| Owner | Any | Everything Admin can, plus the dashboard summary of orders, stock, variance, cost per packet and dues |

## Run it locally

Needs Node.js 22+ and Docker.

```bash
docker compose up -d                 # Postgres on localhost:5433
cp .env.example backend/.env

cd backend
npm install
npx prisma migrate deploy
npm run db:seed                      # section 5 master data
npm run dev                          # API on http://localhost:4000

# second terminal
cd frontend
npm install
npm run dev                          # app on http://localhost:5173
```

The test suite deletes the rows it creates, so a development database has to opt in to that
(production databases never do; see [Audit and integrity](#audit-and-integrity)):

```bash
docker exec -it $(docker compose ps -q postgres) \
  psql -U porulottam -c "ALTER DATABASE porulottam SET app.allow_ledger_cleanup = 'on';"
cd backend && npm test
```

### Test logins (password `password123` for all)

| Role | Email |
|---|---|
| Salesman A | salesman@porulottam.test |
| Salesman B | salesman.b@porulottam.test |
| Admin | admin@porulottam.test |
| Production | production@porulottam.test |
| Accountant | accountant@porulottam.test |
| Owner | owner@porulottam.test |

The login page also has one-click buttons for each.

## The benchmark (section 5)

`npm run benchmark` (in `backend/`) creates a database that has never been used, applies every
migration, loads the seed (exactly the section 5 master data) and then drives all nine steps
through the real HTTP API as the roles the brief names: the production supervisor buys flour
and runs production, Salesman A orders for Retailer A, Admin approves, invoices and dispatches,
Salesman B orders for Distributor B, and Admin records the payment. It then checks every result
below. It never deletes or edits a row, and the append-only triggers stay on for the whole run.
The same command runs in CI on every push.

| # | Check | Expected (brief) | This system |
|---|---|---|---|
| 1 | Flour closing balance | 120 kg | 120 kg |
| 2 | Oil closing balance | 19.5 L | 19.5 L |
| 3 | Pouches closing balance | 306 | 306 (also: spice mix 3.8 kg, cartons 21) |
| 4 | Finished goods after run | 238 packets | 238 |
| 5 | After Retailer A dispatch | 88 packets | 88 |
| 6 | Yield variance | −6%, flagged | −6.0%, flagged (tolerance ±3%) |
| 7 | Oil consumption variance | +5%, flagged | +5.0%, flagged |
| 8 | Retailer A invoice | ₹7,500 + ₹187.50 CGST + ₹187.50 SGST = ₹7,875 | Same, invoice #1 of FY 2026-27 |
| 9 | Retailer A outstanding | ₹3,875 | ₹3,875 |
| 10 | Distributor B | Shortage of 32 flagged; IGST if invoiced | Approval refused, shortfall 32; IGST ₹300 (no CGST/SGST) |
| 11 | Cost per packet | Your figure, with method stated | **₹31.14** |

It also checks the month's reports (GST summary, sales register, Murukku stock ledger,
production report, payments and ageing) against the same figures. There are no differences
from the brief to explain.

### How ₹31.14 is worked out

Valuation is **moving weighted average**: every issue is valued at (value on hand ÷ quantity on
hand) at that moment, and only the final paise amount is rounded. Overheads are the run's
actual labour and gas/power, entered when the run is finished (step 8). If they're left blank
the system assumes ₹500 per batch, and says so on the run.

| Cost | Working | Amount |
|---|---|---|
| Flour | 100 kg at ₹42 + 60 kg at ₹45 = ₹6,900 for 160 kg, so ₹43.125/kg × 40 kg | ₹1,725.00 |
| Cooking oil | ₹140/L × 10.5 L | ₹1,470.00 |
| Spice mix | ₹200/kg × 1.2 kg | ₹240.00 |
| Pouches | ₹2.50 × (188 used + 6 damaged) | ₹485.00 |
| Cartons | ₹15 × 9 | ₹135.00 |
| Labour | entered | ₹1,200.00 |
| Gas/power | entered | ₹600.00 |
| **Total** | | **₹5,855.00** |
| **Per good packet** | ₹5,855 ÷ 188 | **₹31.14** |

Damaged pouches are charged to the good packets: they were paid for and used up making them.
Against the ₹50 selling price, the margin is ₹18.86 a packet (shown on the run's cost
breakdown). Each run's breakdown is saved when it finishes, so later purchases at different
prices never change an earlier run's cost.

## What was built, against section 6

**Must have:** all done.

- Login with five roles (salesman, admin, production, accountant, owner)
- Product, raw-material, packaging, customer and supplier masters; versioned recipes (BOM)
  with independent pack formats. Shared raw-material requirements stay on the recipe; each pack
  format has its own expected packets per batch, finished-good SKU and packaging lines. For
  example, the same 40 kg flour recipe can produce 200 x 200 g packs or 80 x 500 g packs without
  mixing pouch stock or yield calculations. Pack format is selected when planning, and its
  configuration is locked once a run references it. Recipes are versioned: an edit saves the next
  version and retires the old one, which is never changed or deleted. New plans use the latest
  version; a run already planned keeps its version until someone presses "Use latest recipe", and
  started or finished runs never change. The activity log records who changed which amounts.
- Phone-friendly order entry; admin approve, edit or reject. A waiting order shows requested,
  available and short quantities and the GST its invoice would carry (CGST + SGST or IGST)
  before anyone approves it; approval refuses a shortage and sets nothing aside
- GST invoice PDF: GSTIN, HSN, taxable value, CGST+SGST or IGST by place of supply, numbering per
  financial year
- Production runs that move raw-material, pack-specific packaging and finished-goods stock
  automatically, recorded in one form (materials used, damaged packaging, good packets, costs)
  that posts all of it in one transaction or none of it; packaging issues and damage are
  checked against usable stock and FEFO batches
- Planned against actual consumption and pack-specific expected yield, with variance shown and
  flagged beyond ±3%
- Stock summary and per-item stock ledger
- All six section 4.6 reports (sales register by customer and by product, GST summary,
  purchase register, stock summary and ledger, production, payments with ageing), each
  filterable by date and exported to CSV (opens in Excel) and PDF, amounts in rupees. The GST
  summary lists every invoice as B2B or B2C with place of supply, for GSTR-1, and its
  CGST/SGST/IGST totals are the GSTR-3B 3.1(a) figures

**Should have:** all done.

- Purchases and suppliers (a purchase can carry the supplier's lot number and expiry)
- Payments, outstanding per invoice and customer, ageing buckets (0-30, 31-60, 61-90, 90+)
- Cost per packet with overheads, with a per-run breakdown and margin
- GST summary report: totals, by rate, and invoice by invoice (B2B/B2C, place of supply)
- Variance alerts beyond tolerance (yield and each material), as notifications
- Notifications by role for each order hand-off: new order (owner, admin), approved, rejected,
  dispatched, cancelled or short of stock (the salesman who took it)
- Owner dashboard: today's to-do list, sales, dues, stock levels, latest orders

**Stretch goals done:**

- Offline order capture with sync, safe against double-posting (idempotency key per order)
- Batch and expiry tracking, first-expiry-first-out issue and dispatch, batch tracing
- Reorder levels and low-stock alerts

**Also built:** a "Checks" page that cross-checks the ledger against itself (stock, yield,
packaging, invoice totals, dispatch), invoice delivery by email (PDF attached) and by WhatsApp
(a signed link that opens without a login and expires in 30 days), and drill-downs from every
report figure to the rows behind it.

**Not built:** production planning from pending orders, GPS visit logs, Tally export,
e-Invoice/e-Way Bill format, and a Tamil interface for floor staff.

## Audit and integrity

- **Stock is never a stored number.** Every balance is the sum of the stock movement ledger,
  and every movement links back to its source: a purchase, production run, invoice (dispatch) or
  opening stock.
- **The ledger and the activity log are append-only, enforced by the database.** Triggers
  refuse any UPDATE or DELETE on `StockMovement` and `AuditLog`. Corrections are new rows:
  a cancelled run posts reversals, a cancelled purchase reverses its receipts, and a posted
  invoice is cancelled with a credit note. Only throwaway test databases opt in to deletes, so
  the suite can clean up after itself (`app.allow_ledger_cleanup`).
- **Money is integer paise**, never floats. Rates that don't fit a whole paise per gram (₹45/kg
  is 4.5 paise/g) are booked from the exact line total.
- **Every change is logged** with user and time: order edits (before and after), approvals,
  invoices, credit notes, payments, dispatch, and each production run's recording and cancel.
- **Concurrency:** approving orders takes a per-product lock, so two approvals can't sell the
  same packets twice; run recording and cancel claim the status change atomically; a dispatch is
  unique per invoice, and a dispatch and a credit note on the same invoice lock it, so they can't
  interleave; offline orders carry an idempotency key.
- **Cancelling before dispatch frees stock:** a credit note on an invoice that hasn't shipped marks
  its order cancelled, releasing the packets its approval set aside.
- **Batches stay in step with the ledger:** a purchase creates its batch in the same
  transaction as the receipt; cancelling a run puts the material back on the batch it came from.
- **Orders can't dodge the stock check** by splitting one product over two lines: duplicates
  are refused, and approval totals quantities per product anyway.
- **Production inputs must be complete:** recording a run must report every raw material on the
  recipe and every packaging item of its pack exactly once.

## Assumptions

- The factory is in Tamil Nadu (`MANUFACTURER_STATE`); same-state customers get CGST + SGST,
  others IGST. GST is 5% on Murukku, set on the product.
- The brief gives no factory GSTIN, so none is invented: until `MANUFACTURER_GSTIN` is set, the
  invoice PDF is headed "TAX INVOICE (DEMO)" and says the GSTIN is not set.
- Opening finished goods (50 packets) carry no cost, since the brief doesn't give one; this
  doesn't affect the run's cost per packet.
- Stock is held in grams, millilitres and pieces so quantities stay whole numbers; the screens
  show kg, litres and pieces.
- One dispatch per invoice, for the full invoiced quantity or less (partial dispatch and returns
  are optional in the brief and not built).
- A payment can't be more than the invoice still owes: the extra would otherwise vanish from
  "still to collect". Advance payments and customer credit balances are not built.

## Known gaps

- Dispatch handles single-line invoices only (the benchmark's are), so a multi-product order is
  invoiced fine but dispatched as one line.
- Customer-specific prices and schemes aren't modelled; the salesman enters the price per order
  and the admin can edit it before approval.
- No user-management screen: the six logins are seeded.
- The demo video is not recorded yet.
- The hosted demo runs on free tiers (see below), so the first request after a quiet spell can
  be slow, and Supabase pauses a project after a week with no activity.

## Tests

```bash
cd backend
npm test            # 182 tests, real Postgres, about a minute
npm run benchmark   # section 5 on a brand-new database, 15 checks
```

Browser tests click through the same story in a real browser: production records the purchase
and the run, Salesman A orders, the admin approves, invoices and dispatches, Distributor B's
order is refused for 32 packets with Salesman B notified, and the payment leaves ₹3,875 owed.

```bash
cd frontend
npx playwright install chromium   # once (or use the installed Chrome: it's the local default)
npm run e2e                        # starts its own API on :4100 against a fresh <db>_e2e and the site on :5180
```

CI runs all three on every push: backend tests and benchmark, frontend lint and build, browser tests.

The tests cover the full order-to-cash and production flows and the unhappy paths: wrong
password, every role boundary (403s), insufficient stock, duplicate order lines, incomplete
production input, per-pack yield and packaging selection, immutable pack configuration after
planning, insufficient packaging stock at finish, duplicate dispatch, double completion,
concurrent approval and start races, cancellation reversals (including batch quantities), the append-only triggers, exact
moving-average valuation, offline order replay, invoice email and share links, and every report.
CI runs all of it, plus the benchmark, on a fresh database on every push.

## Deployment

**Live at https://porulottam-erp-bay.vercel.app**, on **Vercel** (frontend and API, Mumbai region)
with **Supabase** (Postgres and private PDF storage, Mumbai). The hosted database holds only the
six role logins: the brief's master data (items, recipe, customers, opening stock) is entered
through the app, as the demo walkthrough shows. `npm run db:seed` loads it in one go instead.
Deploys are made from this machine with the Vercel CLI (`vercel deploy --prod` in `backend/`,
then `frontend/`); after each, `/health` on the API and the site's `/api/health` should both
answer `{"data":{"status":"ok"}}`.

- **Frontend:** the `frontend/` folder as its own Vercel project. `frontend/vercel.json`
  forwards `/api/*` to the API project, so the app and the API share one address and the login
  cookie stays first-party. Set `VITE_API_BASE_URL=/api`.
- **API:** the `backend/` folder as its own Vercel project. `backend/vercel.json` builds with
  `npm run vercel-build` (generate client, apply migrations, compile) and serves the Express
  app as one function (`backend/api/index.js`) in `bom1` (Mumbai), next to the database. In the
  US default region each query crossed the world and a stock screen took 5 seconds; in Mumbai
  it takes under one.
- **Database:** Supabase project `porulottam-erp` (Mumbai). The app connects through the
  **transaction pooler** (port 6543): every request can start a new function instance, and the
  session pooler's 15-connection limit ran out as soon as the dashboard loaded its widgets in
  parallel. Migrations need a real session, so the build uses the session pooler instead.

API environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase transaction pooler string (port 6543), plus `?pgbouncer=true&connection_limit=1` |
| `MIGRATE_DATABASE_URL` | Supabase session pooler string (port 5432), used only by the build's `prisma migrate deploy` |
| `JWT_SECRET` | a long random string |
| `FRONTEND_ORIGIN` | the frontend's Vercel URL, exact, no trailing slash |
| `PUBLIC_API_URL` | the frontend URL followed by `/api` (used in WhatsApp invoice links) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | project URL and secret key, for PDF storage |
| `MANUFACTURER_GSTIN` | the factory's real GSTIN, printed on invoices. Without it the PDF is headed "TAX INVOICE (DEMO)" and says the GSTIN is not set |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | optional; a Gmail App Password enables "Email invoice" |

Load the master data into a fresh hosted database once, from your machine:
`DATABASE_URL="<session pooler string>" npm run db:seed`. `.vercelignore` keeps local `.env`
files out of every upload.

Supabase publishes every table through a REST API that the public key can reach; a migration
turns on row-level security for all of them with no policies, which shuts that API off. The app
connects as the table owner and is unaffected.

`render.yaml` is kept as an alternative: it deploys the same API to Render instead.

## Documentation

- `docs/design-note.md`: architecture, data model, how stock and BOM consumption are computed,
  costing and valuation
- `docs/er-diagram.md`: entity-relationship diagram of all 29 tables, generated from the schema by `python docs/gen-er-diagram.py`
- `docs/demo-video-script.md`: the demo, scene by scene
- `docs/phase-20-additional-improvements-plan.md`: the plan the "also built" features came from

## Project structure

```
backend/
  src/modules/<area>/{router,service,schema}.ts   one module per business area
  src/lib/                                        valuation, audit, storage, mailer, auth helpers
  prisma/schema.prisma, prisma/migrations/        data model and its history
  prisma/seed.ts                                  section 5 master data
  scripts/benchmark.ts                            fresh-database benchmark replay
  api/index.js, vercel.json                       Vercel entry and config
frontend/
  src/pages/<area>/                               one file per screen
  src/components/                                 layout, shared UI, notification bell
.github/workflows/ci.yml                          CI
```
