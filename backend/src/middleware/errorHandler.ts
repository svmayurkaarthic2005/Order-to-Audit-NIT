import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/AppError.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: { code: "internal_error", message: "Something went wrong", details: undefined },
  });
};
