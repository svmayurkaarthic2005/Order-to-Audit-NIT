import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "./AppError.js";

type Source = "body" | "query" | "params";

export function validate<T>(source: Source, schema: ZodType<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(
        new AppError(400, "validation_failed", "Request validation failed", result.error.issues),
      );
      return;
    }
    if (source === "query") {
      // Express 5's req.query is getter-only; mutate it in place instead of reassigning.
      Object.assign(req.query, result.data);
    } else {
      req[source] = result.data as never;
    }
    next();
  };
}
