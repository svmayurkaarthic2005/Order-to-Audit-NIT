import { expect, test, type Page } from "@playwright/test";

// The section 5 demo video, in one continuous take, starting from a database
// that holds only the logins: the brief's master data is typed into the real
// screens first, then steps 1–9 run in order. Salesman scenes are at phone
// width, everything else at desktop width, with a caption bar naming each step.
//
// Against the live site (DEMO_BASE_URL set) the script never types a password:
// it waits on the login page for the person recording to sign in as the role
// the caption names, and checks it's the right account before going on.

const LIVE = !!process.env.DEMO_BASE_URL;
const API = LIVE ? "/api" : "http://localhost:4100";
const LOCAL_PASSWORD = "password123"; // throwaway local rehearsal database only
const PHONE = { width: 390, height: 720 };
const DESKTOP = { width: 1280, height: 720 };

const USERS = {
  owner: { email: "owner@porulottam.test", name: "Owner", label: "Owner" },
  production: { email: "production@porulottam.test", name: "Production Supervisor", label: "Production supervisor" },
  salesmanA: { email: "salesman@porulottam.test", name: "Salesman A", label: "Salesman A" },
  salesmanB: { email: "salesman.b@porulottam.test", name: "Salesman B", label: "Salesman B (salesman.b@porulottam.test)" },
  admin: { email: "admin@porulottam.test", name: "Factory Admin", label: "Factory admin" },
  accountant: { email: "accountant@porulottam.test", name: "Accountant", label: "Accountant" },
} as const;
type User = (typeof USERS)[keyof typeof USERS];

// The brief's master data, by the brief's own names.
const FLOUR = "Flour";
const OIL = "Cooking oil";
const SPICE = "Salt and spice mix";
const POUCH = "200 g pouch";
const CARTON = "Carton (holds 20 packets)";
const MURUKKU = "Murukku 200 g";
const SUPPLIER = "Flour supplier";

async function caption(page: Page, step: string, title: string, detail = "") {
  await page.evaluate(
    ([s, t, d]) => {
      sessionStorage.setItem("demoCaption", JSON.stringify([s, t, d]));
      (window as unknown as { renderDemoCaption?: () => void }).renderDemoCaption?.();
    },
    [step, title, detail],
  );
}

// Every pause runs 30% longer than written, for a comfortable reading pace.
const pause = (page: Page, ms: number) => page.waitForTimeout(ms * (process.env.DEMO_DRY ? 0.1 : 1.3));

async function say(page: Page, step: string, title: string, detail: string, ms = 3500) {
  await caption(page, step, title, detail);
  await pause(page, ms);
}

async function whoAmI(page: Page): Promise<string | undefined> {
  return page.evaluate(async (api) => {
    const res = await fetch(`${api}/auth/me`, { credentials: "include" });
    return res.ok ? ((await res.json()).data?.name as string) : undefined;
  }, API);
}

async function signIn(page: Page, user: User) {
  await page.goto("/login");
  if (!LIVE) {
    await caption(page, "", `Signing in as ${user.label}`);
    await page.getByLabel("Email address").fill(user.email);
    await page.locator('input[type="password"]').fill(LOCAL_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    return;
  }
  for (;;) {
    await caption(page, "", `Signing in as ${user.label}`);
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 10 * 60_000 });
    if ((await whoAmI(page)) === user.name) return;
    await signOut(page); // wrong account: back to the login page and wait again
  }
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function addItem(page: Page, name: string, type: string, unit: string, hsn?: string) {
  const form = page.locator("form").filter({ has: page.getByPlaceholder("e.g. Murukku 200 g, Groundnut Oil") });
  await form.getByPlaceholder("e.g. Murukku 200 g, Groundnut Oil").fill(name);
  await form.locator("select").nth(0).selectOption({ label: type });
  if (hsn) {
    await form.getByPlaceholder("e.g. 19059090").fill(hsn);
    await form.locator("select").nth(2).selectOption("5");
  } else {
    await form.locator("select").nth(1).selectOption({ label: unit });
  }
  await pause(page, 500);
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("cell", { name, exact: true }).first()).toBeVisible();
}

async function addParty(page: Page, kind: "customer" | "supplier", name: string, state: string) {
  const form = page.locator("form").filter({ has: page.getByPlaceholder(kind === "customer" ? "Customer name" : "Supplier name") });
  await form.getByPlaceholder(kind === "customer" ? "Customer name" : "Supplier name").fill(name);
  await form.locator("select").first().selectOption({ label: state });
  await pause(page, 400);
  await form.getByRole("button", { name: kind === "customer" ? "Add customer" : "Add supplier" }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}

async function openingStock(page: Page, item: string, qty: string, totalRupees: string) {
  await page.getByRole("button", { name: "Record opening stock" }).click();
  await page.getByLabel(/^Item/).selectOption({ label: item });
  await page.getByLabel(/^Quantity/).fill(qty);
  await page.getByLabel("What it cost in total (₹)").fill(totalRupees);
  await pause(page, 400);
  await page.getByRole("button", { name: "Save opening stock" }).click();
  await expect(page.getByRole("button", { name: "Record opening stock" })).toBeVisible();
}

async function placeOrder(page: Page, customer: string, packets: string) {
  await page.getByLabel("Customer").selectOption({ label: customer });
  await page.getByRole("combobox").nth(1).selectOption({ label: MURUKKU });
  await page.getByLabel("Quantity", { exact: true }).fill(packets);
  await page.getByLabel("Price per packet").fill("50");
  await pause(page, 1500);
  await page.getByRole("button", { name: "Send order" }).click();
  await expect(page.getByText("Order submitted")).toBeVisible();
}

test("section 5 benchmark, end to end", async ({ page }) => {
  test.setTimeout(LIVE ? 45 * 60_000 : 12 * 60_000);

  // Caption bar, redrawn after every full page load from sessionStorage.
  await page.addInitScript(() => {
    const render = () => {
      const raw = sessionStorage.getItem("demoCaption");
      let bar = document.getElementById("demo-caption");
      if (!raw) return bar?.remove();
      const [step, title, detail] = JSON.parse(raw) as string[];
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "demo-caption";
        bar.setAttribute(
          "style",
          "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;pointer-events:none;" +
            "background:rgba(17,24,39,.92);color:#fff;border-radius:10px;padding:10px 16px;" +
            "font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)",
        );
        document.documentElement.appendChild(bar);
      }
      const head = document.createElement("div");
      head.setAttribute("style", "font-weight:700;font-size:15px");
      if (step) {
        const tag = document.createElement("span");
        tag.setAttribute("style", "color:#a5b4fc;margin-right:8px");
        tag.textContent = step;
        head.appendChild(tag);
      }
      head.appendChild(document.createTextNode(title));
      const sub = document.createElement("div");
      sub.setAttribute("style", "opacity:.85;margin-top:2px");
      sub.textContent = detail;
      bar.replaceChildren(head, ...(detail ? [sub] : []));
    };
    (window as unknown as { renderDemoCaption: () => void }).renderDemoCaption = render;
    document.addEventListener("DOMContentLoaded", render);
  });

  // ── Master data, typed into the real screens ──────────────────────────
  await page.goto("/login");
  await say(page, "", "Porulottam ERP: the section 5 benchmark", "Starting from an empty database: only the six role logins exist.", 3500);
  await signIn(page, USERS.owner);

  await page.goto("/admin/items");
  await caption(page, "Master data", "Products & materials", "Raw materials, packaging, and the product we sell (HSN 19059090, GST 5%).");
  await addItem(page, FLOUR, "Raw material", "Weight (kg)");
  await addItem(page, OIL, "Raw material", "Volume (litres)");
  await addItem(page, SPICE, "Raw material", "Weight (kg)");
  await addItem(page, POUCH, "Packaging", "Count (pieces)");
  await addItem(page, CARTON, "Packaging", "Count (pieces)");
  await addItem(page, MURUKKU, "Product we sell", "Count (pieces)", "19059090");
  await pause(page, 2500);

  await page.goto("/admin/customers");
  await caption(page, "Master data", "Customers and supplier", "Retailer A in Tamil Nadu (same state as the factory), Distributor B in Karnataka.");
  await addParty(page, "customer", "Retailer A", "Tamil Nadu");
  await addParty(page, "customer", "Distributor B", "Karnataka");
  await page.goto("/admin/customers?type=supplier");
  await addParty(page, "supplier", SUPPLIER, "Tamil Nadu");
  await pause(page, 2000);

  await page.goto("/admin/bom");
  await caption(page, "Master data", "Recipe (BOM) for Murukku 200 g: one batch = 200 packets", "40 kg flour, 10 L oil, 1.2 kg spice mix, 200 pouches, 10 cartons.");
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel(/^Product/).selectOption({ label: MURUKKU });
  await page.getByLabel("Packets one batch makes").fill("200");
  const lines: [string, string][] = [[FLOUR, "40"], [OIL, "10"], [SPICE, "1.2"], [POUCH, "200"], [CARTON, "10"]];
  const lineItem = (i: number) =>
    page.locator("select").filter({ has: page.locator("option", { hasText: "Choose an item" }) }).nth(i);
  for (const [i, [item, amount]] of lines.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Add another item" }).click();
    await lineItem(i).selectOption({ label: item });
    await page.getByPlaceholder(/^Amount \(/).nth(i).fill(amount);
  }
  await pause(page, 1500);
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByText(/makes 200 packets per batch/).first()).toBeVisible();
  await pause(page, 3000);

  await page.goto("/admin/stock-data");
  await caption(page, "Master data", "Opening stock, at the brief's rates", "Flour 100 kg @ ₹42 · oil 30 L @ ₹140 · spice 5 kg @ ₹200 · 500 pouches @ ₹2.50 · 30 cartons @ ₹15 · 50 packets.");
  await openingStock(page, FLOUR, "100", "4200");
  await openingStock(page, OIL, "30", "4200");
  await openingStock(page, SPICE, "5", "1000");
  await openingStock(page, POUCH, "500", "1250");
  await openingStock(page, CARTON, "30", "450");
  await openingStock(page, MURUKKU, "50", "0");
  for (const [item, unit, level] of [[FLOUR, "kg", "100"], [OIL, "L", "25"]] as const) {
    const input = page.getByLabel(`Warn me below this many ${unit} of ${item}`);
    await input.fill(level);
    await input.press("Tab");
  }
  await say(page, "Master data", "Ready: stock worth ₹11,100 at cost", "Warning levels set: flour below 100 kg, oil below 25 L.", 4500);
  await signOut(page);

  // ── Step 1: purchase ──────────────────────────────────────────────────
  await signIn(page, USERS.production);
  await page.goto("/admin/purchases");
  await say(page, "Step 1", "Record a purchase of 60 kg flour at ₹45/kg", "Production supervisor.", 2500);
  await page.getByRole("combobox", { name: /^Supplier/ }).selectOption({ label: SUPPLIER });
  await page.getByRole("combobox", { name: "Item", exact: true }).first().selectOption({ label: FLOUR });
  await page.getByLabel(/Quantity in/).first().fill("60");
  await page.getByLabel(/Price per .* in rupees/).first().fill("45");
  await pause(page, 1500);
  await page.getByRole("button", { name: "Save purchase" }).click();
  await expect(page.getByText("Received", { exact: true })).toBeVisible();
  await say(page, "Step 1", "Purchase saved: stock goes up on save", "Flour's average cost: (100 × ₹42 + 60 × ₹45) ÷ 160 = ₹43.125/kg (moving weighted average).", 5000);

  // ── Steps 2–3 (+ step 8's costs): the production run ──────────────────
  await page.goto("/production/runs");
  await say(page, "Step 2", "Start one production run of Murukku 200 g", "Plan one batch against the recipe.", 2500);
  await page.getByLabel("What are you making").selectOption({ label: `${MURUKKU} (200 packets per batch)` });
  await page.getByRole("button", { name: "Plan run" }).click();
  await page.getByRole("button", { name: "Record run" }).first().click();
  const form = page.locator("form").filter({ hasText: "Type what was really used" });
  await say(page, "Step 2", "Issue 40 kg flour, 10.5 L oil (0.5 L over standard), 1.2 kg spice mix", "Planned amounts come from the recipe; type what was really used.", 3000);
  await form.getByLabel(`${FLOUR} actually used (kg)`).fill("40");
  await form.getByLabel(`${OIL} actually used (L)`).fill("10.5");
  await form.getByLabel(`${SPICE} actually used (kg)`).fill("1.2");
  await pause(page, 1500);
  await say(page, "Step 3", "Actual output: 188 good packets, 6 pouches damaged, 9 cartons used", "194 pouches used in all, 6 of them damaged.", 3000);
  await form.getByLabel(`${POUCH} actually used (pcs)`).fill("194");
  await form.getByLabel(`${POUCH} damaged`).fill("6");
  await form.getByLabel(`${CARTON} actually used (pcs)`).fill("9");
  await form.getByLabel(/Good packets/).fill("188");
  await pause(page, 1500);
  await say(page, "Step 8 (entered with the run)", "Labour ₹1,200 and gas/power ₹600 for this run", "Overhead rule: each run carries its own actual labour and gas/power.", 3000);
  await form.getByLabel("Labour").fill("1200");
  await form.getByLabel("Gas, power, other").fill("600");
  await pause(page, 1500);
  await form.getByRole("button", { name: "Record run" }).click();
  await expect(page.getByText("Made 188 packets").first()).toBeVisible();
  await say(page, "Steps 2–3", "Saved in one transaction", "Materials issued, packaging and damage posted, 188 packets added. If anything were short, nothing would move.", 4500);

  await page.getByRole("button", { name: "How did it go?" }).first().click();
  await expect(page.getByText(/expected 200, got 188/)).toBeVisible();
  await say(page, "Steps 2–3", "Planned vs actual: oil +5% flagged, yield −6% flagged (188 vs 200)", "Flour and spice mix are within the ±3% tolerance; cartons 9 vs 10 is also flagged.", 7000);

  await page.goto("/admin/stock-data");
  await say(page, "Steps 2–3", "Closing balances, worked out from the stock ledger", "Flour 120 kg (100 + 60 − 40) · Oil 19.5 L · Pouches 306 · Murukku 238 packets (50 + 188).", 7000);
  await signOut(page);

  // ── Step 4: Salesman A, on a phone ────────────────────────────────────
  await page.setViewportSize(PHONE);
  await signIn(page, USERS.salesmanA);
  await page.goto("/salesman/orders/new");
  await say(page, "Step 4", "Salesman A, on mobile", "Order for Retailer A (Tamil Nadu): 150 packets at ₹50.", 3000);
  await placeOrder(page, "Retailer A", "150");
  await say(page, "Step 4", "Order sent straight to the factory", "No phone call or WhatsApp; the office is notified at once.", 4000);
  await signOut(page);

  // ── Step 5: admin approves, invoices, dispatches ──────────────────────
  await page.setViewportSize(DESKTOP);
  await signIn(page, USERS.admin);
  await page.goto("/admin/orders");
  await say(page, "Step 5", "Factory admin: approve the order", "The card shows stock covers it, and the tax it will carry: CGST + SGST (same state).", 5000);
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(page.getByText("No orders are waiting for approval.")).toBeVisible();
  await page.getByRole("button", { name: "To invoice" }).click();
  await pause(page, 1500);
  await page.getByRole("button", { name: "Create invoice" }).first().click();
  await expect(page.getByText("Every approved order has an invoice.")).toBeVisible();
  await page.goto("/admin/invoices");
  await expect(page.getByText("₹7,875.00").first()).toBeVisible();
  await say(page, "Step 5", "GST invoice: ₹7,500 + CGST ₹187.50 + SGST ₹187.50 = ₹7,875", "Numbered by financial year; HSN, place of supply and both halves of GST on the invoice.", 6000);

  // The invoice PDF, opened from its share link on the same tab.
  const pdfUrl = await page.evaluate(async (api) => {
    const list = await (await fetch(`${api}/invoices`, { credentials: "include" })).json();
    const rows = Array.isArray(list.data) ? list.data : (list.data?.items ?? list.data?.invoices ?? []);
    const id = rows[0]?.id;
    if (!id) return null;
    const link = await (await fetch(`${api}/invoices/${id}/share-link`, { credentials: "include" })).json();
    return (link.data?.url ?? link.data) as string | null;
  }, API);
  if (typeof pdfUrl === "string") {
    try {
      await page.goto(pdfUrl);
      await caption(page, "Step 5", "The invoice PDF", "CGST ₹187.50 and SGST ₹187.50 listed separately.").catch(() => {});
      await pause(page, 7000);
    } catch {
      // A browser that downloads PDFs instead of showing them: skip this shot.
    }
  }

  await page.goto("/admin/dispatch");
  await say(page, "Step 5", "Record dispatch: 150 packets", "Dispatch takes finished stock down, earliest expiry first.", 3000);
  await page.getByRole("button", { name: "Record dispatch" }).click();
  await expect(page.getByText(/^Sent /)).toBeVisible();
  await page.goto("/admin/stock-data");
  await say(page, "Step 5", "Murukku after dispatch: 88 packets", "238 − 150 = 88.", 5000);
  await signOut(page);

  // ── Step 6: Salesman B, the shortage ──────────────────────────────────
  await page.setViewportSize(PHONE);
  await signIn(page, USERS.salesmanB);
  await page.goto("/salesman/orders/new");
  await say(page, "Step 6", "Salesman B: Distributor B (Karnataka), 120 packets", "Only 88 are in stock.", 3000);
  await placeOrder(page, "Distributor B", "120");
  await pause(page, 2000);
  await signOut(page);

  await page.setViewportSize(DESKTOP);
  await signIn(page, USERS.admin);
  await page.goto("/admin/orders");
  await expect(page.getByText("Not enough stock")).toBeVisible();
  await say(page, "Step 6", "Shortage flagged before anyone decides: requested 120, available 88, short by 32", "If invoiced: IGST ₹300 — Karnataka is outside the factory's state.", 7000);
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(page.getByText(/You're 32 short/)).toBeVisible();
  await say(page, "Step 6", "Approval refused: nothing is set aside", "Salesman B, the owner and the admin are notified of the 32-packet shortage.", 5000);
  await signOut(page);

  await page.setViewportSize(PHONE);
  await signIn(page, USERS.salesmanB);
  await page.getByRole("button", { name: "Notifications" }).click();
  await say(page, "Step 6", "Salesman B sees why, on the phone", "", 4500);
  await page.locator('div.fixed.inset-0[aria-hidden="true"]').click();
  await signOut(page);

  // ── Step 7: payment ───────────────────────────────────────────────────
  await page.setViewportSize(DESKTOP);
  await signIn(page, USERS.admin);
  await page.goto("/admin/invoices");
  await say(page, "Step 7", "Record a payment of ₹4,000 from Retailer A", "", 2500);
  await page.getByLabel("Payment amount in rupees").first().fill("4000");
  await pause(page, 1200);
  await page.getByRole("button", { name: "Record payment" }).first().click();
  await expect(page.getByText("₹3,875.00 still owed").first()).toBeVisible();
  await say(page, "Step 7", "Retailer A still owes ₹3,875", "₹7,875 − ₹4,000. A payment larger than what's owed is refused.", 5000);
  await signOut(page);

  // ── Step 8: cost per packet ───────────────────────────────────────────
  await signIn(page, USERS.owner);
  await page.goto("/production/runs");
  await page.getByRole("button", { name: "How did it go?" }).first().click();
  await expect(page.getByText("₹31.14").first()).toBeVisible();
  await say(
    page,
    "Step 8",
    "Cost per packet: ₹31.14 = ₹5,855 ÷ 188 good packets",
    "Materials at moving weighted-average cost (damaged pouches included) + labour ₹1,200 + gas/power ₹600.",
    8000,
  );
  await page.goto("/admin/dashboard");
  await say(page, "Step 8", "Owner's summary", "Today's orders, stock, variance alerts and what's still to collect.", 4500);
  await signOut(page);

  // ── Step 9: the month's reports ───────────────────────────────────────
  await signIn(page, USERS.accountant);
  await page.goto("/admin/reports");
  await say(page, "Step 9", "The month's reports (section 4.6), as the accountant: read-only", "Each one filters by date and exports to CSV (opens in Excel) and PDF.", 4000);
  const report = async (name: string, detail: string, ms = 4500) => {
    await page.getByRole("button", { name, exact: true }).first().click();
    await say(page, "Step 9", name, detail, ms);
  };
  await report("Sales Register", "₹7,875, by customer and by product.");
  await report("GST Summary", "CGST + SGST ₹375; every invoice as B2B/B2C with place of supply, for GSTR-1 and GSTR-3B.", 5000);
  await report("Purchase Register", "The 60 kg flour purchase, ₹2,700.");
  await report("Stock Summary", "Raw, packaging and finished goods, opening to closing.");
  const flourRow = page.getByRole("button", { name: new RegExp(`^${FLOUR}`) }).first();
  if (await flourRow.isVisible().catch(() => false)) {
    await flourRow.click();
    await say(page, "Step 9", "Flour's stock ledger", "+100 opening, +60 purchase, −40 production: 120 kg, each line traced to its source.", 6000);
    await page.keyboard.press("Escape");
  }
  await report("Production", "Planned vs actual consumption, yield −6% flagged, wastage 6 pouches.", 5500);
  await report("Payments & Collections", "₹3,875 outstanding from Retailer A, in the 0–30 day bucket.", 5000);
  await page.getByText("Export CSV").first().click().catch(() => {});
  await pause(page, 1500);

  await page.goto("/admin/audit-log");
  await say(page, "Audit trail", "Activity log: who did what, and when", "Master data, purchase, run, approval, invoice, dispatch and payment. Append-only, enforced by the database.", 6000);
  await say(
    page,
    "",
    "40 kg of flour in, 188 packets out",
    "Consumption, expected and actual output, wastage, closing balances and finished stock were all recorded automatically.",
    6000,
  );
});
