import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "./AppError.js";

type Source = "body" | "query" | "params";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Express 5's req.query getter returns a fresh object on every access
      // (confirmed: req.query === req.query is false), so a validated query
      // with defaults applied cannot be written back onto req.query itself —
      // it goes here instead. body/params remain plain, settable properties.
      validatedQuery?: unknown;
    }
  }
}

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
      req.validatedQuery = result.data;
    } else {
      req[source] = result.data as never;
    }
    next();
  };
}
