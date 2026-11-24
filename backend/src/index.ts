import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./modules/auth/router.js";
import { bomRouter, packSizesRouter } from "./modules/bom/router.js";
import { customersRouter } from "./modules/customers/router.js";
import { debugRouter } from "./modules/debug/router.js";
import { inventoryRouter } from "./modules/inventory/router.js";
import { itemsRouter } from "./modules/items/router.js";
import { ordersRouter } from "./modules/orders/router.js";
import { productionRouter } from "./modules/production/router.js";
import { purchasesRouter } from "./modules/purchases/router.js";
import { suppliersRouter } from "./modules/suppliers/router.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.status(200).json({ data: { status: "ok" } });
});

app.use("/auth", authRouter);
app.use("/customers", customersRouter);
app.use("/suppliers", suppliersRouter);
app.use("/items", itemsRouter);
app.use("/inventory", inventoryRouter);
app.use("/purchases", purchasesRouter);
app.use("/boms", bomRouter);
app.use("/pack-sizes", packSizesRouter);
app.use("/production-runs", productionRouter);
app.use("/orders", ordersRouter);
app.use("/debug", debugRouter);

app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Porulottam ERP backend listening on :${PORT}`);
  });
}

export { app };
