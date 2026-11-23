import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "./index.js";

describe("error handling shapes", () => {
  it("an uncaught throw returns 500 in the documented shape, with no stack trace in the body", async () => {
    const res = await request(app).get("/debug/error-test");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "internal_error", message: "Something went wrong" },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\(.*:\d+:\d+\)/);
  });

  it("bad input returns 400 in the documented shape with field-level details", async () => {
    const res = await request(app).get("/debug/validate-test");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it("valid input passes through to the route", async () => {
    const res = await request(app).get("/debug/validate-test?name=flour");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { name: "flour" } });
  });
});
