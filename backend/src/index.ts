import express from "express";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Porulottam ERP backend listening on :${PORT}`);
  });
}

export { app };
