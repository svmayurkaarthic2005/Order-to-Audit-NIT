# API conventions

Every route in every phase follows this. Re-read this file before writing a new module's router.

## Success envelope

```json
{ "data": ... }
```

List endpoints that paginate use `{ "data": { "items": [...], "total": N } }`.

## Error envelope

```json
{ "error": { "code": "snake_case_code", "message": "human-readable", "details": ... } }
```

- `details` is omitted when there is nothing extra to say.
- The response body never contains a stack trace. Uncaught errors are logged server-side (`console.error`) and returned as a generic `500 internal_error`.

## Throwing errors in a route

Throw `AppError(status, code, message, details?)` (`backend/src/lib/AppError.ts`). Express 5 forwards both sync throws and rejected promises from `async` handlers to `errorHandler` automatically — no extra wrapping needed.

```ts
import { AppError } from "../../lib/AppError.js";

throw new AppError(409, "insufficient_stock", "Not enough finished-goods stock", { shortfall: 32 });
```

## Validation

Validate `query`, `body` or `params` with `validate(source, zodSchema)` (`backend/src/lib/validate.ts`) as route middleware. A failed parse becomes a `400 validation_failed` with Zod's issue list in `details`.

```ts
router.post("/orders", validate("body", createOrderSchema), async (req, res) => { ... });
```

**Reading a validated query:** Express 5's `req.query` is a fresh object on every access (`req.query === req.query` is `false`), so a validated query — with zod defaults applied, e.g. `page` — cannot be written back onto `req.query` and read later; it would silently vanish. `validate("query", schema)` instead sets `req.validatedQuery`. Always read `req.validatedQuery`, never `req.query`, in a route that validates its query:

```ts
router.get("/", validate("query", listQuerySchema), async (req, res) => {
  const { search, page } = req.validatedQuery as { search?: string; page: number };
  ...
});
```

`body` and `params` don't have this problem — they're plain settable properties, so `validate("body"/"params", schema)` reassigns `req.body`/`req.params` directly and that value is what later code sees.

## Module layout

```
backend/src/modules/<domain>/
  router.ts   — routes + validate() middleware, calls service.ts, never touches Prisma directly
  service.ts  — business logic, the only place that talks to Prisma for this domain
  schema.ts   — zod schemas for this domain's request bodies/query params
```

## Debug routes

`backend/src/modules/debug/router.ts` exists only to prove the 400/500 shapes above with tests. Delete the whole `debug` module in Phase 18 before deployment.
