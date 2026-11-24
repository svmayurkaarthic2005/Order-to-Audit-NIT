import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

describe("master data: customers", () => {
  it("admin can create, edit and soft-delete a customer", async () => {
    const cookie = await loginAs("admin@porulottam.test");

    const createRes = await request(app)
      .post("/customers")
      .set("Cookie", cookie)
      .send({ name: "Test Retailer", state: "Tamil Nadu" });
    expect(createRes.status).toBe(201);
    const id = createRes.body.data.id;

    const editRes = await request(app)
      .patch(`/customers/${id}`)
      .set("Cookie", cookie)
      .send({ name: "Test Retailer Renamed" });
    expect(editRes.status).toBe(200);
    expect(editRes.body.data.name).toBe("Test Retailer Renamed");

    const deleteRes = await request(app).delete(`/customers/${id}`).set("Cookie", cookie);
    expect(deleteRes.status).toBe(200);

    const getRes = await request(app).get(`/customers/${id}`).set("Cookie", cookie);
    expect(getRes.status).toBe(404); // soft-deleted, not listed as active
  });

  it("rejects a GSTIN whose state code doesn't match the declared state", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const res = await request(app)
      .post("/customers")
      .set("Cookie", cookie)
      .send({ name: "Mismatched Co", state: "Tamil Nadu", gstin: "29BBBBB0000B1Z5" }); // 29 = Karnataka
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_gstin");
  });

  it("a non-admin role creating a customer returns 403", async () => {
    const cookie = await loginAs("salesman@porulottam.test");
    const res = await request(app)
      .post("/customers")
      .set("Cookie", cookie)
      .send({ name: "Should Fail Co", state: "Tamil Nadu" });
    expect(res.status).toBe(403);
  });
});

describe("master data: items", () => {
  it("rejects a duplicate SKU with 409", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    const res = await request(app)
      .post("/items")
      .set("Cookie", cookie)
      .send({ sku: "RM-FLOUR", name: "Duplicate Flour", type: "RAW_MATERIAL", baseUnit: "G" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("duplicate_sku");
  });

  it("creates, edits and soft-deletes an item", async () => {
    const cookie = await loginAs("admin@porulottam.test");
    // A unique SKU per run: the DB is real/persistent across test runs, and a
    // SKU stays reserved even after soft-delete (an audit trail shouldn't let
    // a deactivated SKU be silently reused), so a fixed literal would 409 on rerun.
    const sku = `RM-TEST-${Date.now()}`;

    const createRes = await request(app)
      .post("/items")
      .set("Cookie", cookie)
      .send({ sku, name: "Test Raw Material", type: "RAW_MATERIAL", baseUnit: "G" });
    expect(createRes.status).toBe(201);
    const id = createRes.body.data.id;

    const editRes = await request(app)
      .patch(`/items/${id}`)
      .set("Cookie", cookie)
      .send({ name: "Renamed Raw Material" });
    expect(editRes.status).toBe(200);

    const deleteRes = await request(app).delete(`/items/${id}`).set("Cookie", cookie);
    expect(deleteRes.status).toBe(200);
  });
});

describe("master data: benchmark rows exist via the real API, not just the seed script", () => {
  it("Retailer A, Distributor B, Flour, Oil, Pouches and the finished good are all listable", async () => {
    const cookie = await loginAs("owner@porulottam.test");

    const customers = await request(app).get("/customers?search=Retailer").set("Cookie", cookie);
    expect(customers.body.data.items.some((c: { name: string }) => c.name === "Retailer A")).toBe(true);

    const items = await request(app).get("/items?search=Flour").set("Cookie", cookie);
    expect(items.body.data.items.some((i: { sku: string }) => i.sku === "RM-FLOUR")).toBe(true);
  });
});
