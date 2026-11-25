import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { csrfOriginCheck } from "./middleware/csrf.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./modules/auth/router.js";
import { alertsRouter } from "./modules/alerts/router.js";
import { auditRouter } from "./modules/audit/router.js";
import { bomRouter, packSizesRouter } from "./modules/bom/router.js";
import { customersRouter } from "./modules/customers/router.js";
import { debugRouter } from "./modules/debug/router.js";
import { LOCAL_STORAGE_DIR } from "./lib/storage.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { dispatchRouter } from "./modules/dispatch/router.js";
import { inventoryRouter } from "./modules/inventory/router.js";
import { invoicesRouter } from "./modules/invoices/router.js";
import { itemsRouter } from "./modules/items/router.js";
import { ordersRouter } from "./modules/orders/router.js";
import { paymentsRouter } from "./modules/payments/router.js";
import { productionRouter } from "./modules/production/router.js";
import { purchasesRouter } from "./modules/purchases/router.js";
import { reconciliationRouter } from "./modules/reconciliation/router.js";
import { batchesRouter } from "./modules/batches/router.js";
import { notificationsRouter } from "./modules/notifications/router.js";
import { reportsRouter } from "./modules/reports/router.js";
import { suppliersRouter } from "./modules/suppliers/router.js";

// Porulottam ERP backend entry point
const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(csrfOriginCheck);

app.get("/health", (_req, res) => {
  res.status(200).json({ data: { status: "ok" } });
});

// Local stand-in for Supabase Storage (see lib/storage.ts) — only used
// when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY aren't configured. These are
// customer billing documents, so this is never a publicly reachable path:
// same auth + role gate as the rest of the invoices API.
app.use(
  "/storage/invoices",
  requireAuth,
  requireRole("ADMIN", "OWNER", "ACCOUNTANT"),
  express.static(LOCAL_STORAGE_DIR),
);

app.use("/auth", authRouter);
app.use("/customers", customersRouter);
app.use("/suppliers", suppliersRouter);
app.use("/items", itemsRouter);
app.use("/inventory", inventoryRouter);
app.use("/alerts", alertsRouter);
app.use("/purchases", purchasesRouter);
app.use("/boms", bomRouter);
app.use("/pack-sizes", packSizesRouter);
app.use("/production-runs", productionRouter);
app.use("/orders", ordersRouter);
app.use("/invoices", invoicesRouter);
app.use("/dispatches", dispatchRouter);
app.use("/payments", paymentsRouter);
app.use("/reports", reportsRouter);
app.use("/audit-log", auditRouter);
app.use("/batches", batchesRouter);
app.use("/reconciliation", reconciliationRouter);
app.use("/notifications", notificationsRouter);

// Exercises the error handler / validator / RBAC middleware shapes
// directly (see errorHandler.test.ts, auth.test.ts) — never mounted in a
// real deployment, since /debug/error-test deliberately throws and takes
// no auth at all.
if (process.env.NODE_ENV !== "production") {
  app.use("/debug", debugRouter);
}

app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Porulottam ERP backend listening on :${PORT}`);
  });
}

export { app };
