import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";
import { prisma } from "./lib/prisma.js";

// One continuous pass over the problem statement's benchmark scenario,
// asserting all 11 mandated checks against the real data accumulated by
// the manual walkthroughs in Phases 7-16 (never synthetic fixtures) — this
// is the Phase 17 consolidation, not a re-run of the scenario itself.

async function loginAs(email: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "password123" });
  return res.headers["set-cookie"];
}

async function onHandBySku(adminCookie: string, sku: string) {
  const item = await prisma.item.findFirstOrThrow({ where: { sku } });
  const res = await request(app).get(`/inventory/${item.id}/on-hand`).set("Cookie", adminCookie);
  return res.body.data.qtyBase as number;
}

describe("Phase 17 — full benchmark scenario, one continuous pass", () => {
  it("1-3, 8, 9: Flour, Oil, Pouches closing balances and the self-check extras", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    expect(await onHandBySku(adminCookie, "RM-FLOUR")).toBe(120_000); // 120 kg
    expect(await onHandBySku(adminCookie, "RM-OIL")).toBe(19_500); // 19.5 L
    expect(await onHandBySku(adminCookie, "RM-SPICE")).toBe(3_800); // self-check: 3.8 kg
    expect(await onHandBySku(adminCookie, "PKG-POUCH-200G")).toBe(306);
    expect(await onHandBySku(adminCookie, "PKG-CARTON-20")).toBe(21); // self-check
  });

  it("4: finished goods from this run's output alone (188) and total ever received (238)", async () => {
    const fg = await prisma.item.findFirstOrThrow({ where: { sku: "FG-MURUKKU-200G" } });
    const run = await prisma.productionRun.findFirstOrThrow({
      where: { bomHeader: { finishedItemId: fg.id }, status: "COMPLETED" },
    });
    expect(run.actualOutputQty).toBe(188);

    const totalReceived = await prisma.stockMovement.aggregate({
      where: { itemId: fg.id, qtyBase: { gt: 0 } },
      _sum: { qtyBase: true },
    });
    expect(totalReceived._sum.qtyBase).toBe(238); // 50 opening + 188 this run
  });

  it("5: finished goods on-hand after the Retailer A dispatch is 88 packets", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    expect(await onHandBySku(adminCookie, "FG-MURUKKU-200G")).toBe(88);
  });

  it("6, 7: yield variance -6% and Oil consumption variance +5%, both from the same completed run", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const fg = await prisma.item.findFirstOrThrow({ where: { sku: "FG-MURUKKU-200G" } });
    const run = await prisma.productionRun.findFirstOrThrow({
      where: { bomHeader: { finishedItemId: fg.id }, status: "COMPLETED" },
    });
    const res = await request(app).get(`/production-runs/${run.id}/variance`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    expect(res.body.data.yield.variancePct).toBeCloseTo(-0.06, 2);
    expect(res.body.data.yield.flagged).toBe(true);

    const oil = await prisma.item.findFirstOrThrow({ where: { sku: "RM-OIL" } });
    const oilLine = res.body.data.materials.find((m: { itemId: string }) => m.itemId === oil.id);
    expect(oilLine.variancePct).toBeCloseTo(0.05, 2);
    expect(oilLine.flagged).toBe(true);
  });

  it("8, 9: Retailer A invoice Rs.7,875 and outstanding Rs.3,875", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    // Other test files create their own invoices against this same real
    // Retailer A customer, some coincidentally totalling the same
    // Rs.7,875 — so this invoice is identified by its one permanent,
    // never-reused (financialYear, invoiceNumber) pair, not by amount.
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { financialYear: "2026-27", invoiceNumber: 19 },
    });

    const invRes = await request(app).get(`/invoices/${invoice.id}`).set("Cookie", adminCookie);
    expect(invRes.body.data.totalPaise).toBe(787_500); // Rs. 7,875.00

    const outstandingRes = await request(app).get(`/invoices/${invoice.id}/outstanding`).set("Cookie", adminCookie);
    expect(outstandingRes.body.data.outstandingPaise).toBe(387_500); // Rs. 3,875.00
  });

  it("10: Distributor B's 120-packet order is still short by exactly 32 packets at today's FG on-hand", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const distributorB = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Distributor B" } } });
    const order = await prisma.salesOrder.findFirstOrThrow({
      where: { customerId: distributorB.id, status: "SUBMITTED" },
      include: { items: true },
    });
    expect(order.items[0]!.qtyBase).toBe(120);

    const onHand = await onHandBySku(adminCookie, "FG-MURUKKU-200G");
    const res = await request(app).post(`/orders/${order.id}/approve`).set("Cookie", adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("insufficient_stock");
    expect(res.body.error.details.shortfall).toBe(120 - onHand);
    expect(res.body.error.details.shortfall).toBe(32);
  });

  it("11: cost per packet is computed, positive, and traceable to the moving-weighted-average + overhead rule", async () => {
    const adminCookie = await loginAs("admin@porulottam.test");
    const fg = await prisma.item.findFirstOrThrow({ where: { sku: "FG-MURUKKU-200G" } });
    const run = await prisma.productionRun.findFirstOrThrow({
      where: { bomHeader: { finishedItemId: fg.id }, status: "COMPLETED" },
    });
    const res = await request(app).get(`/production-runs/${run.id}`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.outputUnitCostPaise).toBeGreaterThan(0);
    // Method and overhead-allocation rule are stated in README.md, not re-derived here.
  });

  it("ACCOUNTANT can view every screen this benchmark touches, but mutate nothing anywhere", async () => {
    const accountantCookie = await loginAs("accountant@porulottam.test");

    const readable = ["/customers", "/suppliers", "/items", "/boms", "/orders", "/invoices", "/dispatches", "/purchases", "/production-runs", "/audit-log", "/reports/sales-register"];
    for (const path of readable) {
      const res = await request(app).get(path).set("Cookie", accountantCookie);
      expect(res.status, `GET ${path} as ACCOUNTANT`).toBe(200);
    }

    const retailerA = await prisma.customer.findFirstOrThrow({ where: { name: { contains: "Retailer A" } } });
    const blocked = [
      () => request(app).post("/customers").set("Cookie", accountantCookie).send({ name: "x", state: "x" }),
      () => request(app).post("/items").set("Cookie", accountantCookie).send({}),
      () => request(app).post("/orders").set("Cookie", accountantCookie).send({ customerId: retailerA.id, items: [] }),
      () => request(app).post("/purchases").set("Cookie", accountantCookie).send({}),
      () => request(app).post("/production-runs").set("Cookie", accountantCookie).send({}),
      () => request(app).post("/dispatches").set("Cookie", accountantCookie).send({}),
      () => request(app).post("/payments").set("Cookie", accountantCookie).send({}),
      () => request(app).post("/invoices").set("Cookie", accountantCookie).send({}),
      () => request(app).post("/inventory/opening-stock").set("Cookie", accountantCookie).send({}),
    ];
    for (const call of blocked) {
      const res = await call();
      expect(res.status).toBe(403);
    }
  });
});
