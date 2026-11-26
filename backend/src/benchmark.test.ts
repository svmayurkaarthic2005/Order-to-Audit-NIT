import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";
import { calculate } from "./modules/gst/calculate.js";

// The brief's section 5 benchmark, replayed end to end through the real API
// on a brand-new database that holds only the seed (section 5 master data).
// Run it with `npm run benchmark`: that script creates a fresh database,
// migrates and seeds it, then runs this file against it alone, so nothing
// left behind by other tests or manual use can affect the numbers.
//
// It never deletes or edits a row: the database is thrown away afterwards,
// and it runs with ledger cleanup switched off, so the append-only triggers
// are live for the whole replay.

if (!process.env.BENCHMARK_DATABASE) {
  throw new Error("Run the benchmark with `npm run benchmark`; it needs its own fresh database.");
}

const login = async (email: string) =>
  (await request(app).post("/auth/login").send({ email, password: "password123" })).headers["set-cookie"] as unknown as string;

const itemId = async (sku: string) => (await prisma.item.findUniqueOrThrow({ where: { sku } })).id;

async function onHand(cookie: string, sku: string) {
  const res = await request(app).get(`/inventory/${await itemId(sku)}/on-hand`).set("Cookie", cookie);
  return res.body.data.qtyBase as number;
}

describe("benchmark scenario (section 5), replayed on a fresh database", () => {
  let admin = "";
  let owner = "";
  let runId = "";
  let fgAfterRun = 0;
  let retailerInvoiceId = "";
  let distributorApproval: request.Response;

  beforeAll(async () => {
    admin = await login("admin@porulottam.test");
    owner = await login("owner@porulottam.test");
    const salesmanA = await login("salesman@porulottam.test");
    const salesmanB = await login("salesman.b@porulottam.test");
    const production = await login("production@porulottam.test");
    const flour = await itemId("RM-FLOUR");
    const oil = await itemId("RM-OIL");
    const spice = await itemId("RM-SPICE");
    const pouch = await itemId("PKG-POUCH-200G");
    const carton = await itemId("PKG-CARTON-20");
    const murukku = await itemId("FG-MURUKKU-200G");

    // 1. Purchase 60 kg flour at ₹45/kg.
    const purchase = await request(app)
      .post("/purchases")
      .set("Cookie", production)
      .send({ supplierId: "general-supplier", items: [{ itemId: flour, qtyBase: 60_000, rateBasePaise: 5, totalCostPaise: 270_000 }] });
    expect(purchase.status).toBe(201);

    // 2. One production run: 40 kg flour, 10.5 L oil, 1.2 kg spice mix.
    const run = await request(app).post("/production-runs").set("Cookie", production).send({ bomHeaderId: "bom-murukku-200g", batchSize: 1 });
    runId = run.body.data.id;
    const started = await request(app)
      .post(`/production-runs/${runId}/start`)
      .set("Cookie", production)
      .send({
        actualConsumption: [
          { itemId: flour, qtyBase: 40_000 },
          { itemId: oil, qtyBase: 10_500 },
          { itemId: spice, qtyBase: 1_200 },
        ],
      });
    expect(started.status).toBe(200);

    // 3 + 8. 188 good packets, 6 pouches damaged, 9 cartons; labour ₹1,200
    // and gas/power ₹600 entered when the run is finished.
    const completed = await request(app)
      .post(`/production-runs/${runId}/complete`)
      .set("Cookie", production)
      .set("Idempotency-Key", `benchmark-${runId}`)
      .send({
        actualOutputQty: 188,
        packagingConsumed: [
          { itemId: pouch, qtyBase: 188, damagedQty: 6 },
          { itemId: carton, qtyBase: 9, damagedQty: 0 },
        ],
        laborCostPaise: 120_000,
        overheadCostPaise: 60_000,
      });
    expect(completed.status).toBe(200);
    fgAfterRun = await onHand(admin, "FG-MURUKKU-200G");

    // 4. Salesman A: Retailer A, 150 packets at ₹50.
    const retailerOrder = await request(app)
      .post("/orders")
      .set("Cookie", salesmanA)
      .set("Idempotency-Key", "benchmark-retailer-a")
      .send({ customerId: "retailer-a", items: [{ itemId: murukku, qtyBase: 150, ratePaise: 5_000 }] });
    expect(retailerOrder.status).toBe(201);

    // 5. Admin approves, invoices (CGST + SGST) and dispatches.
    expect((await request(app).post(`/orders/${retailerOrder.body.data.id}/approve`).set("Cookie", admin).send({})).status).toBe(200);
    const invoice = await request(app).post("/invoices").set("Cookie", admin).send({ orderId: retailerOrder.body.data.id });
    expect(invoice.status).toBe(201);
    retailerInvoiceId = invoice.body.data.id;
    expect((await request(app).post("/dispatches").set("Cookie", admin).send({ invoiceId: retailerInvoiceId, qty: 150 })).status).toBe(201);

    // 6. Salesman B: Distributor B, 120 packets.
    const distributorOrder = await request(app)
      .post("/orders")
      .set("Cookie", salesmanB)
      .set("Idempotency-Key", "benchmark-distributor-b")
      .send({ customerId: "distributor-b", items: [{ itemId: murukku, qtyBase: 120, ratePaise: 5_000 }] });
    expect(distributorOrder.status).toBe(201);
    distributorApproval = await request(app).post(`/orders/${distributorOrder.body.data.id}/approve`).set("Cookie", admin).send({});

    // 7. ₹4,000 from Retailer A.
    expect((await request(app).post("/payments").set("Cookie", admin).send({ invoiceId: retailerInvoiceId, amountPaise: 400_000 })).status).toBe(201);
  });

  it("flour closing balance is 120 kg (100 + 60 - 40)", async () => {
    expect(await onHand(admin, "RM-FLOUR")).toBe(120_000);
  });

  it("oil closing balance is 19.5 L", async () => {
    expect(await onHand(admin, "RM-OIL")).toBe(19_500);
  });

  it("pouches closing balance is 306 (188 used + 6 damaged)", async () => {
    expect(await onHand(admin, "PKG-POUCH-200G")).toBe(306);
    // Not on the brief's list, but follows from it: 3.8 kg spice, 21 cartons.
    expect(await onHand(admin, "RM-SPICE")).toBe(3_800);
    expect(await onHand(admin, "PKG-CARTON-20")).toBe(21);
  });

  it("finished goods after the run are 238 packets (50 + 188)", () => {
    expect(fgAfterRun).toBe(238);
  });

  it("finished goods after the Retailer A dispatch are 88 packets", async () => {
    expect(await onHand(admin, "FG-MURUKKU-200G")).toBe(88);
  });

  it("yield variance is -6% and oil variance +5%, both flagged", async () => {
    const res = await request(app).get(`/production-runs/${runId}/variance`).set("Cookie", admin);
    expect(res.body.data.yield.variancePct).toBeCloseTo(-0.06, 10);
    expect(res.body.data.yield.flagged).toBe(true);
    const oilId = await itemId("RM-OIL");
    const oilVariance = res.body.data.materials.find((m: { itemId: string }) => m.itemId === oilId);
    expect(oilVariance.variancePct).toBeCloseTo(0.05, 10);
    expect(oilVariance.flagged).toBe(true);
  });

  it("Retailer A invoice is ₹7,500 taxable + ₹187.50 CGST + ₹187.50 SGST = ₹7,875", async () => {
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: retailerInvoiceId } });
    expect(inv.taxableValuePaise).toBe(750_000);
    expect(inv.cgstPaise).toBe(18_750);
    expect(inv.sgstPaise).toBe(18_750);
    expect(inv.igstPaise).toBe(0);
    expect(inv.totalPaise).toBe(787_500);
  });

  it("Retailer A outstanding is ₹3,875", async () => {
    const res = await request(app).get(`/invoices/${retailerInvoiceId}/outstanding`).set("Cookie", admin);
    expect(res.body.data.outstandingPaise).toBe(387_500);
  });

  it("Distributor B is refused for a shortage of 32 packets; IGST would apply if invoiced", () => {
    expect(distributorApproval.status).toBe(409);
    expect(distributorApproval.body.error.code).toBe("insufficient_stock");
    expect(distributorApproval.body.error.details.shortfall).toBe(32);
    // Karnataka customer, Tamil Nadu factory: interstate, so IGST only.
    const gst = calculate([{ qtyBase: 120, ratePaise: 5_000, taxRatePct: 5 }], "Tamil Nadu", "Karnataka");
    expect(gst).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 30_000, totalPaise: 630_000 });
  });

  it("cost per packet is ₹31.14: ₹5,855 total (moving-average materials + ₹1,200 labour + ₹600 gas/power) / 188", async () => {
    const res = await request(app).get(`/production-runs/${runId}/cost-breakdown`).set("Cookie", owner);
    expect(res.body.data.totalCostPaise).toBe(585_500);
    expect(res.body.data.costPerGoodUnitPaise).toBe(3_114);
  });

  // 9. The month's reports (section 4.6), each traced back to the replay.
  it("GST summary: one invoice, ₹7,500 taxable, ₹187.50 CGST, ₹187.50 SGST, ₹7,875", async () => {
    const res = await request(app).get("/reports/gst-summary").set("Cookie", admin);
    expect(res.status).toBe(200);
    expect(res.body.data.invoiceCount).toBe(1);
    expect(res.body.data.totals).toMatchObject({ taxableValuePaise: 750_000, cgstPaise: 18_750, sgstPaise: 18_750, igstPaise: 0, totalPaise: 787_500 });
  });

  it("sales register: Retailer A, 150 packets, ₹7,500 taxable", async () => {
    const res = await request(app).get("/reports/sales-register").set("Cookie", admin);
    const retailerA = res.body.data.customerWise.find((c: { customerName: string }) => c.customerName === "Retailer A");
    expect(retailerA).toMatchObject({ qtyBase: 150, taxableValuePaise: 750_000 });
  });

  it("stock ledger for Murukku: 50 opening + 188 made - 150 dispatched (opening packets go out first)", async () => {
    const res = await request(app).get(`/reports/stock-ledger?itemId=${await itemId("FG-MURUKKU-200G")}`).set("Cookie", admin);
    const rows = res.body.data as { source: string; qtyBase: number }[];
    const total = (source: string) => rows.filter((m) => m.source === source).reduce((s, m) => s + m.qtyBase, 0);
    expect(total("OPENING_STOCK")).toBe(50);
    expect(total("PRODUCTION_OUTPUT")).toBe(188);
    expect(total("DISPATCH")).toBe(-150);
    // The unbatched opening 50 went first, then 100 from the run's batch.
    expect(rows.filter((m) => m.source === "DISPATCH").map((m) => m.qtyBase)).toEqual([-50, -100]);
    const batch = await prisma.finishedGoodsBatch.findFirstOrThrow({ where: { productionRunId: runId } });
    expect(batch.remainingQtyBase).toBe(88);
  });

  it("production report: the run's -6% yield variance", async () => {
    const res = await request(app).get("/reports/production").set("Cookie", admin);
    const row = res.body.data.find((r: { finishedGoodSku: string }) => r.finishedGoodSku === "FG-MURUKKU-200G");
    expect(row.yieldVariancePct).toBeCloseTo(-0.06, 10);
  });

  it("payments & collections: Retailer A owes ₹3,875, all within 30 days", async () => {
    const res = await request(app).get("/reports/payments-collections").set("Cookie", admin);
    const retailerA = res.body.data.find((r: { customerName: string }) => r.customerName === "Retailer A");
    expect(retailerA).toMatchObject({ outstandingPaise: 387_500, "0-30": 387_500 });
  });
});
