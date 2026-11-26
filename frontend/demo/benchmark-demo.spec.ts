import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";

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

// Every field, dropdown and button is brought to the middle of the screen
// (clear of the caption bar), outlined while it's used, and text is typed a
// key at a time, so a viewer can follow each action.
const DRY = !!process.env.DEMO_DRY;
async function centre(target: Locator) {
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
}
async function mark(target: Locator, on: boolean) {
  await target
    .evaluate((el, show) => {
      const s = (el as HTMLElement).style;
      s.outline = show ? "3px solid #f59e0b" : "";
      s.outlineOffset = show ? "2px" : "";
    }, on, { timeout: on ? undefined : 500 })
    .catch(() => {}); // a click can remove the element before its outline is cleared
}
async function put(target: Locator, value: string) {
  await centre(target);
  await mark(target, true);
  await pause(target.page(), 300);
  await target.fill("");
  await target.pressSequentially(value, { delay: DRY ? 0 : 70 });
  await pause(target.page(), 300);
  await mark(target, false);
}
async function choose(target: Locator, option: Parameters<Locator["selectOption"]>[0]) {
  await centre(target);
  await mark(target, true);
  await pause(target.page(), 400);
  await target.selectOption(option);
  await pause(target.page(), 500);
  await mark(target, false);
}
async function press(target: Locator) {
  await centre(target);
  await mark(target, true);
  await pause(target.page(), 400);
  await target.click();
  await mark(target, false);
}
// Move around the way a person does: click the sidebar or tab link, so the
// app switches screens without reloading. A tab that only shows inside its
// section is reached through the section first. A full page load is left
// only for a page no link leads to (the first load, or after the PDF).
const SECTION: Record<string, string> = {
  "/admin/bom": "/production/runs",
  "/admin/purchases": "/admin/stock-data",
  "/admin/dispatch": "/admin/orders",
  "/admin/audit-log": "/admin/reports",
  "/admin/customers": "/admin/items",
};
async function go(page: Page, url: string): Promise<void> {
  const here = page.url().startsWith("http") ? new URL(page.url()) : null;
  if (here && here.pathname + here.search === url) return;
  // Skip the phone slide-out menu: it stays in the page, tucked behind the top bar.
  const link = page.locator(`a[href="${url}"]:not(#mobile-nav a):visible`).first();
  if (await link.count()) {
    await press(link);
  } else if (SECTION[url] && here?.origin === new URL(page.url()).origin && (await page.locator(`a[href="${SECTION[url]}"]:not(#mobile-nav a):visible`).count())) {
    await go(page, SECTION[url]);
    return go(page, url);
  } else {
    await page.goto(url);
  }
  await expect(page).toHaveURL((u) => u.pathname + u.search === url);
  await pause(page, 600);
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms * (process.env.DEMO_DRY ? 0.1 : 1.0));

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
  await go(page, "/login");
  if (!LIVE) {
    await caption(page, "", `Signing in as ${user.label}`);
    await page.getByLabel("Email address").fill(user.email);
    await page.locator('input[type="password"]').fill(LOCAL_PASSWORD);
    await press(page.getByRole("button", { name: "Sign in", exact: true }));
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
  await press(page.getByRole("button", { name: "Sign out" }));
  await expect(page).toHaveURL(/\/login/);
}

async function addItem(page: Page, name: string, type: string, unit: string, hsn?: string) {
  const form = page.locator("form").filter({ has: page.getByPlaceholder("e.g. Murukku 200 g, Groundnut Oil") });
  await put(form.getByPlaceholder("e.g. Murukku 200 g, Groundnut Oil"), name);
  await choose(form.locator("select").nth(0), { label: type });
  if (hsn) {
    await put(form.getByPlaceholder("e.g. 19059090"), hsn);
    await choose(form.locator("select").nth(2), "5");
  } else {
    await choose(form.locator("select").nth(1), { label: unit });
  }
  await pause(page, 500);
  await press(form.getByRole("button", { name: "Add", exact: true }));
  await expect(page.getByRole("cell", { name, exact: true }).first()).toBeVisible();
}

async function addParty(page: Page, kind: "customer" | "supplier", name: string, state: string, email?: string) {
  const form = page.locator("form").filter({ has: page.getByPlaceholder(kind === "customer" ? "Customer name" : "Supplier name") });
  await put(form.getByPlaceholder(kind === "customer" ? "Customer name" : "Supplier name"), name);
  await choose(form.locator("select").first(), { label: state });
  if (email) await put(form.getByPlaceholder("Optional, needed to email invoices"), email);
  await pause(page, 400);
  await press(form.getByRole("button", { name: kind === "customer" ? "Add customer" : "Add supplier" }));
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}

async function openingStock(page: Page, item: string, qty: string, totalRupees: string) {
  await press(page.getByRole("button", { name: "Record opening stock" }));
  await choose(page.getByLabel(/^Item/), { label: item });
  await put(page.getByLabel(/^Quantity/), qty);
  await put(page.getByLabel("What it cost in total (₹)"), totalRupees);
  await pause(page, 400);
  await press(page.getByRole("button", { name: "Save opening stock" }));
  await expect(page.getByRole("button", { name: "Record opening stock" })).toBeVisible();
}

// The salesman's scenes play on a phone: the real app at phone width inside a
// phone frame, on a branded background, with the step caption beside it.
// It's served from the site's own origin so the app's sign-in cookie works.
const PHONE_STAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Salesman's phone</title><style>
html,body{margin:0;height:100%;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
  background:radial-gradient(circle at 25% 20%,#4f46e5 0,#312e81 45%,#1e1b4b 100%)}
.wrap{display:flex;align-items:center;justify-content:center;gap:72px;height:100%}
.phone{position:relative;width:340px;height:690px;border-radius:46px;background:#0f0f17;padding:12px;box-sizing:border-box;
  box-shadow:0 40px 80px rgba(0,0,0,.5),inset 0 0 0 2px #2c2c3a}
.notch{position:absolute;top:12px;left:50%;transform:translateX(-50%);width:96px;height:20px;background:#0f0f17;border-radius:0 0 14px 14px;z-index:2}
.screen{width:316px;height:666px;border-radius:35px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
.status{height:32px;flex:none;background:#1e1b4b;color:#fff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:space-between;padding:0 24px}
.app{flex:1;overflow:hidden}
iframe{border:0;width:390px;height:783px;transform:scale(.81);transform-origin:0 0}
.side{width:440px;color:#fff}
.tag{display:inline-block;font-size:13px;font-weight:700;letter-spacing:.02em;color:#c7d2fe;background:rgba(255,255,255,.12);padding:4px 10px;border-radius:999px}
.title{font-size:28px;line-height:1.25;font-weight:700;margin:14px 0 10px}
.detail{font-size:17px;line-height:1.5;opacity:.85}
</style></head><body><div class="wrap">
<div class="phone"><div class="notch"></div><div class="screen"><div class="status"><span>9:41</span><span>5G &#9646;&#9646;&#9646; 100%</span></div><div class="app"><iframe id="phone" src="/login"></iframe></div></div></div>
<div class="side"><span class="tag" id="side-step">On the salesman's phone</span><div class="title" id="side-title"></div><div class="detail" id="side-detail"></div></div>
</div></body></html>`;

async function openPhone(page: Page): Promise<FrameLocator> {
  await page.goto("/__demo_phone");
  const phone = page.frameLocator("#phone");
  await expect(phone.getByLabel("Email address")).toBeVisible();
  return phone;
}

async function phoneSignIn(page: Page, phone: FrameLocator, user: User) {
  await caption(page, "", `Signing in as ${user.label}`, "On the salesman's phone.");
  if (LIVE) {
    // The person recording signs in on the phone; check it's the right account.
    for (;;) {
      await expect(phone.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 10 * 60_000 });
      if (await phone.getByText(user.name, { exact: true }).count()) return;
      await phoneSignOut(phone);
    }
  }
  await phone.getByLabel("Email address").fill(user.email);
  await phone.locator('input[type="password"]').fill(LOCAL_PASSWORD);
  await press(phone.getByRole("button", { name: "Sign in", exact: true }));
  await expect(phone.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function phoneSignOut(phone: FrameLocator) {
  await press(phone.getByRole("button", { name: "Sign out" }));
  await expect(phone.getByLabel("Email address")).toBeVisible();
}

async function placeOrder(page: Page, screen: Page | FrameLocator, customer: string, packets: string) {
  await choose(screen.getByLabel("Customer"), { label: customer });
  await choose(screen.getByRole("combobox").nth(1), { label: MURUKKU });
  await put(screen.getByLabel("Quantity", { exact: true }), packets);
  await put(screen.getByLabel("Price per packet"), "50");
  await pause(page, 1500);
  await press(screen.getByRole("button", { name: "Send order" }));
  await expect(screen.getByText("Order submitted")).toBeVisible();
}

test("section 5 benchmark, end to end", async ({ page }) => {
  test.setTimeout(LIVE ? 45 * 60_000 : 15 * 60_000);

  // Caption bar, redrawn after every full page load from sessionStorage.
  await page.addInitScript(() => {
    const render = () => {
      if (window !== window.top) return; // the app inside the phone frame
      const raw = sessionStorage.getItem("demoCaption");
      const side = document.getElementById("side-title");
      if (side) {
        const [step, title, detail] = raw ? (JSON.parse(raw) as string[]) : ["", "", ""];
        document.getElementById("side-step")!.textContent = step || "On the salesman's phone";
        side.textContent = title;
        document.getElementById("side-detail")!.textContent = detail;
        return;
      }
      let bar = document.getElementById("demo-caption");
      if (!raw) return bar?.remove();
      const [step, title, detail] = JSON.parse(raw) as string[];
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "demo-caption";
        bar.setAttribute(
          "style",
          "position:fixed;left:12px;right:12px;z-index:2147483647;pointer-events:none;" +
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
      bar.style.bottom = "12px";
    };
    (window as unknown as { renderDemoCaption: () => void }).renderDemoCaption = render;
    document.addEventListener("DOMContentLoaded", render);
  });

  await page.route("**/__demo_phone", (route) => route.fulfill({ contentType: "text/html", body: PHONE_STAGE }));

  // ── Master data, typed into the real screens ──────────────────────────
  await go(page, "/login");
  await say(page, "", "Porulottam ERP: the section 5 benchmark", "Starting from an empty database: only the six role logins exist.", 3500);
  await signIn(page, USERS.owner);

  await go(page, "/admin/items");
  await caption(page, "Master data", "Products & materials", "Raw materials, packaging, and the product we sell (HSN 19059090, GST 5%).");
  await addItem(page, FLOUR, "Raw material", "Weight (kg)");
  await addItem(page, OIL, "Raw material", "Volume (litres)");
  await addItem(page, SPICE, "Raw material", "Weight (kg)");
  await addItem(page, POUCH, "Packaging", "Count (pieces)");
  await addItem(page, CARTON, "Packaging", "Count (pieces)");
  await addItem(page, MURUKKU, "Product we sell", "Count (pieces)", "19059090");
  await pause(page, 2500);

  await go(page, "/admin/customers");
  await caption(page, "Master data", "Customers and supplier", "Retailer A in Tamil Nadu (same state as the factory), Distributor B in Karnataka.");
  await addParty(page, "customer", "Retailer A", "Tamil Nadu", "retailer.a@example.com");
  await addParty(page, "customer", "Distributor B", "Karnataka");
  await press(page.getByRole("button", { name: "Suppliers", exact: true }));
  await addParty(page, "supplier", SUPPLIER, "Tamil Nadu");
  await pause(page, 2000);

  await go(page, "/admin/bom");
  await caption(page, "Master data", "Recipe (BOM) for Murukku 200 g: one batch = 200 packets", "40 kg flour, 10 L oil, 1.2 kg spice mix, 200 pouches, 10 cartons.");
  await press(page.getByRole("button", { name: "New recipe" }));
  await choose(page.getByLabel(/^Product/), { label: MURUKKU });
  await put(page.getByLabel("Packets one batch makes"), "200");
  const lines: [string, string][] = [[FLOUR, "40"], [OIL, "10"], [SPICE, "1.2"], [POUCH, "200"], [CARTON, "10"]];
  const lineItem = (i: number) =>
    page.locator("select").filter({ has: page.locator("option", { hasText: "Choose an item" }) }).nth(i);
  for (const [i, [item, amount]] of lines.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Add another item" }).click();
    await choose(lineItem(i), { label: item });
    await put(page.getByPlaceholder(/^Amount \(/).nth(i), amount);
  }
  await pause(page, 1500);
  await press(page.getByRole("button", { name: "Save recipe" }));
  await expect(page.getByText(/makes 200 packets per batch/).first()).toBeVisible();
  await pause(page, 3000);

  await go(page, "/admin/stock-data");
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
  await go(page, "/admin/purchases");
  await say(page, "Step 1", "Record a purchase of 60 kg flour at ₹45/kg", "Production supervisor.", 2500);
  await choose(page.getByRole("combobox", { name: /^Supplier/ }), { label: SUPPLIER });
  await choose(page.getByRole("combobox", { name: "Item", exact: true }).first(), { label: FLOUR });
  await put(page.getByLabel(/Quantity in/).first(), "60");
  await put(page.getByLabel(/Price per .* in rupees/).first(), "45");
  await pause(page, 1500);
  await press(page.getByRole("button", { name: "Save purchase" }));
  await expect(page.getByText("Received", { exact: true })).toBeVisible();
  await say(page, "Step 1", "Purchase saved: stock goes up on save", "Flour's average cost: (100 × ₹42 + 60 × ₹45) ÷ 160 = ₹43.125/kg (moving weighted average).", 5000);

  // ── Steps 2–3 (+ step 8's costs): the production run ──────────────────
  await go(page, "/production/runs");
  await say(page, "Step 2", "Start one production run of Murukku 200 g", "Plan one batch against the recipe.", 2500);
  await choose(page.getByLabel("What are you making"), { label: `${MURUKKU} (200 packets per batch)` });
  await press(page.getByRole("button", { name: "Plan run" }));
  await press(page.getByRole("button", { name: "Record run" }).first());
  const form = page.locator("form").filter({ hasText: "Type what was really used" });
  await say(page, "Step 2", "Issue 40 kg flour, 10.5 L oil (0.5 L over standard), 1.2 kg spice mix", "Planned amounts come from the recipe; type what was really used.", 3000);
  await put(form.getByLabel(`${FLOUR} actually used (kg)`), "40");
  await put(form.getByLabel(`${OIL} actually used (L)`), "10.5");
  await put(form.getByLabel(`${SPICE} actually used (kg)`), "1.2");
  await pause(page, 1500);
  await say(page, "Step 3", "Actual output: 188 good packets, 6 pouches damaged, 9 cartons used", "194 pouches used in all, 6 of them damaged.", 3000);
  await put(form.getByLabel(`${POUCH} actually used (pcs)`), "194");
  await put(form.getByLabel(`${POUCH} damaged`), "6");
  await put(form.getByLabel(`${CARTON} actually used (pcs)`), "9");
  await put(form.getByLabel(/Good packets/), "188");
  await pause(page, 1500);
  await say(page, "Step 3", "Labour and gas/power aren't known yet: left blank", "Until they're added (step 8), the run assumes ₹500 a batch.", 3500);
  await press(form.getByRole("button", { name: "Record run" }));
  await expect(page.getByText("Made 188 packets").first()).toBeVisible();
  await say(page, "Steps 2–3", "Saved in one transaction", "Materials issued, packaging and damage posted, 188 packets added. If anything were short, nothing would move.", 4500);

  await press(page.getByRole("button", { name: "How did it go?" }).first());
  await expect(page.getByText(/expected 200, got 188/)).toBeVisible();
  await say(page, "Steps 2–3", "Planned vs actual: oil +5% flagged, yield −6% flagged (188 vs 200)", "Flour and spice mix are within the ±3% tolerance; cartons 9 vs 10 is also flagged.", 7000);

  await go(page, "/admin/stock-data");
  await say(page, "Steps 2–3", "Closing balances, worked out from the stock ledger", "Flour 120 kg (100 + 60 − 40) at ₹43.125/kg average cost · Oil 19.5 L · Pouches 306 · Murukku 238 packets (50 + 188).", 7500);
  await signOut(page);

  // ── Step 4: Salesman A, on a phone ────────────────────────────────────
  let phone = await openPhone(page);
  await phoneSignIn(page, phone, USERS.salesmanA);
  await press(phone.locator('a[href="/salesman/orders/new"]:not(#mobile-nav a):visible').first());
  await say(page, "Step 4", "Salesman A, on mobile", "Order for Retailer A (Tamil Nadu): 150 packets at ₹50.", 3000);
  await placeOrder(page, phone, "Retailer A", "150");
  await say(page, "Step 4", "Order sent straight to the factory", "No phone call or WhatsApp; the office is notified at once.", 4000);
  await phoneSignOut(phone);

  // ── Step 5: admin approves, invoices, dispatches ──────────────────────
  await signIn(page, USERS.admin);
  await go(page, "/admin/orders");
  await say(page, "Step 5", "Factory admin: approve the order", "The card shows stock covers it, and the tax it will carry: CGST + SGST (same state).", 5000);
  await press(page.getByRole("button", { name: "Approve", exact: true }).first());
  await expect(page.getByText("No orders are waiting for approval.")).toBeVisible();
  await press(page.getByRole("button", { name: "To invoice" }));
  await pause(page, 1500);
  await press(page.getByRole("button", { name: "Create invoice" }).first());
  await expect(page.getByText("Every approved order has an invoice.")).toBeVisible();
  await go(page, "/admin/invoices");
  await expect(page.getByText("₹7,875.00").first()).toBeVisible();
  await say(page, "Step 5", "GST invoice: ₹7,500 + CGST ₹187.50 + SGST ₹187.50 = ₹7,875", "Numbered by financial year; HSN, place of supply and both halves of GST on the invoice.", 6000);
  await press(page.getByRole("button", { name: "Send to customer" }).first());
  await press(page.getByRole("button", { name: "Email Retailer A" }));
  await expect(page.getByText("Invoice emailed to retailer.a@example.com.")).toBeVisible();
  await say(page, "Step 5", "Invoice PDF emailed to Retailer A; WhatsApp sharing sits beside it", "This recording copy uses a test mail outbox, so nothing actually leaves the machine.", 5500);

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
      await go(page, pdfUrl);
      await caption(page, "Step 5", "The invoice PDF", "CGST ₹187.50 and SGST ₹187.50 listed separately.").catch(() => {});
      await pause(page, 7000);
    } catch {
      // A browser that downloads PDFs instead of showing them: skip this shot.
    }
  }

  await go(page, "/admin/dispatch");
  await say(page, "Step 5", "Record dispatch: 150 packets", "Dispatch takes finished stock down, earliest expiry first.", 3000);
  await press(page.getByRole("button", { name: "Record dispatch" }));
  await expect(page.getByText(/^Sent /)).toBeVisible();
  await go(page, "/admin/stock-data");
  await say(page, "Step 5", "Murukku after dispatch: 88 packets", "238 − 150 = 88.", 5000);
  await signOut(page);

  // ── Step 6: Salesman B, the shortage ──────────────────────────────────
  phone = await openPhone(page);
  await phoneSignIn(page, phone, USERS.salesmanB);
  await press(phone.locator('a[href="/salesman/orders/new"]:not(#mobile-nav a):visible').first());
  await say(page, "Step 6", "Salesman B: Distributor B (Karnataka), 120 packets", "Only 88 are in stock.", 3000);
  await placeOrder(page, phone, "Distributor B", "120");
  await pause(page, 2000);
  await phoneSignOut(phone);

  await signIn(page, USERS.admin);
  await go(page, "/admin/orders");
  await expect(page.getByText("Not enough stock")).toBeVisible();
  await say(page, "Step 6", "Shortage flagged before anyone decides: requested 120, available 88, short by 32", "If invoiced: IGST ₹300 — Karnataka is outside the factory's state.", 7000);
  await press(page.getByRole("button", { name: "Approve", exact: true }).first());
  await expect(page.getByText(/You're 32 short/)).toBeVisible();
  await say(page, "Step 6", "Approval refused: nothing is set aside", "Salesman B, the owner and the admin are notified of the 32-packet shortage.", 5000);
  await signOut(page);

  phone = await openPhone(page);
  await phoneSignIn(page, phone, USERS.salesmanB);
  await press(phone.getByRole("button", { name: "Notifications" }));
  await say(page, "Step 6", "Salesman B sees why, on the phone", "32 packets short: make more, or edit the order down.", 5000);
  await phone.locator('div.fixed.inset-0[aria-hidden="true"]').click();
  await phoneSignOut(phone);

  // ── Step 7: payment ───────────────────────────────────────────────────
  await signIn(page, USERS.admin);
  await go(page, "/admin/invoices");
  await say(page, "Step 7", "Record a payment of ₹4,000 from Retailer A", "", 2500);
  await put(page.getByLabel("Payment amount in rupees").first(), "4000");
  await pause(page, 1200);
  await press(page.getByRole("button", { name: "Record payment" }).first());
  await expect(page.getByText("₹3,875.00 still owed").first()).toBeVisible();
  await say(page, "Step 7", "Retailer A still owes ₹3,875", "₹7,875 − ₹4,000. A payment larger than what's owed is refused.", 5000);
  await signOut(page);

  // ── Step 8: cost per packet ───────────────────────────────────────────
  await signIn(page, USERS.owner);
  await go(page, "/production/runs");
  await press(page.getByRole("button", { name: "How did it go?" }).first());
  await page.getByText("Cost per packet", { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await say(page, "Step 8", "Before: ₹500 a batch assumed for labour and gas/power", "Materials ₹4,055 + ₹500 = ₹4,555 ÷ 188 = ₹24.23 a packet, provisional.", 5000);
  await press(page.getByRole("button", { name: "Add labour and gas/power" }));
  await say(page, "Step 8", "Add labour ₹1,200 and gas/power ₹600 for the run", "Overhead rule: each run carries its own actual labour and gas/power.", 2500);
  await put(page.getByLabel("Labour (₹)"), "1200");
  await put(page.getByLabel("Gas, power, other (₹)"), "600");
  await press(page.getByRole("button", { name: "Save costs" }));
  await expect(page.getByText("₹31.14").first()).toBeVisible();
  // The cost table sits low on the page: bring it to the middle, clear of the caption bar.
  await page.getByText("Materials and packaging", { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await say(
    page,
    "Step 8",
    "Materials ₹4,055 at weighted-average cost (flour ₹43.125/kg) + labour ₹1,200 + gas/power ₹600 = ₹5,855",
    "Damaged pouches included. Each material's quantity and rate are on its line.",
    8000,
  );
  await page.getByText("Cost per packet", { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await say(page, "Step 8", "Cost per packet ₹31.14 = ₹5,855 ÷ 188 good packets", "Profit ₹18.86 per packet at the ₹50 selling price.", 6000);
  await go(page, "/admin/dashboard");
  await say(page, "Step 8", "Owner's summary, with cost per packet", "Today's orders, stock, variance alerts, what's still to collect, and the latest run's cost and profit per packet.", 5500);
  await signOut(page);

  // ── Step 9: the month's reports ───────────────────────────────────────
  await signIn(page, USERS.accountant);
  await go(page, "/admin/reports");
  await say(page, "Step 9", "The month's reports (section 4.6), as the accountant: read-only", "Each one filters by date and exports to CSV (opens in Excel) and PDF.", 4000);
  const report = async (name: string, detail: string, ms = 4500) => {
    await press(page.getByRole("button", { name, exact: true }).first());
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

  await go(page, "/admin/audit-log");
  await say(page, "Audit trail", "Activity log: who did what, and when", "Master data, purchase, run, approval, invoice, dispatch and payment. Append-only, enforced by the database.", 4500);
  await say(
    page,
    "",
    "40 kg of flour in, 188 packets out",
    "Consumption, expected and actual output, wastage, closing balances and finished stock were all recorded automatically.",
    5000,
  );
});
