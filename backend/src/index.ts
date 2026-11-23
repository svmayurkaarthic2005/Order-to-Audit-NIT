import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { debugRouter } from "./modules/debug/router.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ data: { status: "ok" } });
});

app.use("/debug", debugRouter);

app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Porulottam ERP backend listening on :${PORT}`);
  });
}

export { app };
