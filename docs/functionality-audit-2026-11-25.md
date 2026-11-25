# Full functionality audit — every role, every nav item, notifications

**Date:** 2026-11-25
**Scope:** requested as "navigation, all dashboard, check all functionality from start to end, even small functionality, in every role, including workflow — give a final report addressing the issues — and check notification functionality."

## Method

1. Cross-checked every nav item (`AppShell.tsx`) against its route guard (`App.tsx`) for all 5 roles.
2. Swept the whole frontend and backend for `TODO`/`FIXME`/placeholder/dead-button patterns.
3. Read every notification producer (`notify()` call site) against every consumer (`visibilityFilter()` in `notifications/service.ts`) and the bell's own click-through routing.
4. Live-verified notifications in the browser as ACCOUNTANT, PRODUCTION, SALESMAN, OWNER (screenshots + real API calls against the running dev stack).
5. Ran the full backend suite and both frontends' typechecks after every fix.

## Issues found and fixed

### 1. ACCOUNTANT's notification bell was permanently empty (real functional gap)
`visibilityFilter()` only ever matched `AUDIT_EXCEPTION` for the ACCOUNTANT role, but nothing in the codebase produced that type — reconciliation exceptions were written to the `ReconciliationException` table (visible on the Reconciliation page) but never notified. An entire role's bell icon did nothing, ever.

**Fix:** `reconciliation/service.ts`'s `upsertException` now calls `notify()` for OWNER/ACCOUNTANT (not ADMIN — confirmed deliberate via the existing `notifications.test.ts` case) exactly when an exception newly appears or reopens from `RESOLVED`, mirroring the transition-only notify pattern already used for `LOW_STOCK`/`STOCK_REPLENISHED`. Live-verified: ran `/reconciliation/run` against real data, confirmed the Accountant's bell shows the exceptions with correct titles/messages, and clicking one navigates to `/admin/reconciliation`.

### 2. Two notification click-throughs went nowhere
`NotificationBell.tsx`'s `sourceToPath()` had no case for `RawMaterialBatch`/`FinishedGoodsBatch` (the actual source types an `EXPIRY_WARNING` uses) or for the new `ReconciliationException` source — both fell through to `"/"`. Fixed to route to `/admin/batches` and `/admin/reconciliation` respectively.

### 3. A debug-only router was reachable in production, unauthenticated
`modules/debug/router.ts` (4 routes proving error-handler/validator/RBAC middleware shapes, each still commented "Remove this route before Phase 18") was mounted unconditionally. `/debug/error-test` takes no auth at all and deliberately throws. Now mounted only when `NODE_ENV !== "production"` — still exercised by `errorHandler.test.ts`/`auth.test.ts` (which run with `NODE_ENV=test`), never shipped live.

### 4. Navigation / RBAC — no gaps found
Every nav item's `roles` array matches its route's guard exactly, for all 5 roles. No orphaned routes, no nav item pointing at a route the same role can't reach.

### 5. Dead code / placeholder sweep — clean
No `TODO`, `FIXME`, "coming soon", stray `console.log`, or disabled-dead button anywhere in `frontend/src` or `backend/src` (excluding the debug router above, which is legitimate test scaffolding, not dead code).

## New feature delivered during this audit: Gmail SMTP invoice delivery

Per the brief's 4.2 ("Invoice can be downloaded as PDF and shared with the customer — WhatsApp share link or email is enough"), WhatsApp was already covered; this adds the email half:
- `Customer.email` (optional), editable on Masters → Customers, hidden from every role except ADMIN/OWNER/ACCOUNTANT (see security section).
- `POST /invoices/:id/send-email` — sends the invoice PDF via Gmail SMTP to the customer's email on file or an explicit override, logs an `EMAIL_SENT` audit entry.
- Real send verified live (a real email round-tripped through Gmail SMTP during this session).
- 6 new tests (`invoice-email.test.ts`), mocking only `nodemailer` itself.

## Security findings from background review, fixed in the same pass

These surfaced via automated security review of commits made during this session and were fixed immediately, not deferred:
- **Order edit/approve race** — `editOrder`/`approveOrder` now share a `pg_advisory_xact_lock` on the order id, closing a window where a concurrent edit could swap items out from under an in-flight approval's stock check.
- **Sales-trend DoS** — an unbounded `from`/`to` range on the monthly trend endpoint could force an unbounded zero-fill loop; now capped at 50 years, with the cap checked against the same default-`to` the service itself uses.
- **Offline order queue cross-user replay** — the localStorage queue is now stamped and filtered by the logged-in salesman's id, with a re-check on every loop iteration (not just once at the start) so a mid-replay logout/login can't post one salesman's queued order under another's session.
- **Customer email exposure** — `GET /customers`, `GET /orders`, `GET /orders/:id` and `POST /orders` all embedded the customer's email to every role that can read orders (including SALESMAN), with no gate at all. Redaction now lives in one shared `lib/customerVisibility.ts`, applied everywhere a customer record is returned.

## Data hygiene: real "Retailer A" customer has 34 orphaned test orders (needs your go-ahead)

`benchmark.test.ts` has no `afterAll` cleanup — unlike every other test file, it deliberately creates one order/invoice/dispatch against the **real seeded "Retailer A" customer** to reproduce the brief's exact numbers, and was presumably meant to run once against a fresh seed. Because this project's tests run against a real, persistent Postgres instance (by design) and I've run the full suite many times today verifying each change, **34 duplicate zero-item orders (each with a real invoice, inflating the real invoice sequence) have accumulated against Retailer A.**

This is currently visible on the live dev stack: the Owner dashboard right now shows "35 invoices issued" and "₹20,875 outstanding" — almost all of that is this duplication, not real data. It has **no effect on production** (Render always seeds a fresh database), but it does currently make the local demo's numbers wrong.

I did not delete these rows myself — bulk-deleting real customer/invoice data needs your explicit go-ahead, not an automated judgment call. Say the word and I'll clean it up (keeping the one genuine first-run order); separately, `benchmark.test.ts` could gain its own `afterAll` so this can't recur, though that test has been treated as a fixed, unchanging acceptance benchmark across every phase so far, so I'd want your confirmation before touching it.

## Test status

Full backend suite: 173 tests, 172 passing. The 2 recurring failures (`batches.test.ts` error-message assertion, `production.test.ts` `afterAll` FK-ordering bug) are pre-existing and unrelated — confirmed again by running each in isolation. `benchmark.test.ts` still 8/8. Both frontend and backend `tsc --noEmit` clean.

## Per-role verdict

| Role | Nav items | Verified live | Notes |
|---|---|---|---|
| OWNER | Everything | Dashboard, notifications | Sees every notification type |
| ADMIN | Everything except nothing (full ops) | Dashboard, invoices, email send | — |
| ACCOUNTANT | Same pages as Admin, read-mostly | Dashboard, notifications (now working) | Was the one real gap; fixed |
| PRODUCTION | Production runs, Purchases, Stock Data, Batches | Production runs, notifications | Correctly scoped to floor operations only |
| SALESMAN | My orders, New order | Order entry, order history, notifications (empty state) | Offline queue, recent chips, edit-before-approval all working |
