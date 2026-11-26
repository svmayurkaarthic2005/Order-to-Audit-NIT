import { expect, test, type Browser, type Page } from "@playwright/test";

// The brief's section 5 story, clicked through the real screens by each role,
// on a freshly seeded database (see playwright.config.ts). Steps share that
// database, so they run in order.
test.describe.configure({ mode: "serial" });

// Seed logins (backend/prisma/seed.ts); this database only exists for the test.
const PASSWORD = "password123";
const USERS = {
  production: "production@porulottam.test",
  salesmanA: "salesman@porulottam.test",
  salesmanB: "salesman.b@porulottam.test",
  admin: "admin@porulottam.test",
};

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

async function placeOrder(browser: Browser, email: string, customer: string, packets: number) {
  const page = await signIn(browser, email);
  await page.goto("/salesman/orders/new");
  await page.getByLabel("Customer").selectOption({ label: customer });
  await page.getByRole("combobox").nth(1).selectOption({ label: "Murukku 200 g" });
  await page.getByLabel("Quantity", { exact: true }).fill(String(packets));
  await page.getByLabel("Price per packet").fill("50");
  await page.getByRole("button", { name: "Send order" }).click();
  await expect(page.getByText("Order submitted")).toBeVisible();
  await page.context().close();
}

test("1. production records the purchase and the run (40 kg / 10.5 L / 1.2 kg -> 188 packets)", async ({ browser }) => {
  const page = await signIn(browser, USERS.production);

  // Step 1: 60 kg flour at Rs 45/kg.
  await page.goto("/admin/purchases");
  await page.getByRole("combobox", { name: /^Supplier/ }).selectOption({ index: 1 });
  await page.getByRole("combobox", { name: "Item", exact: true }).first().selectOption({ label: "Flour" });
  await page.getByLabel(/Quantity in/).first().fill("60");
  await page.getByLabel(/Price per .* in rupees/).first().fill("45");
  await page.getByRole("button", { name: "Save purchase" }).click();
  await expect(page.getByText("Received", { exact: true })).toBeVisible();

  // Steps 2-3 (+ step 8's costs): plan one batch, then record it in one form.
  await page.goto("/production/runs");
  await page.getByLabel("What are you making").selectOption({ label: "Murukku 200 g (200 packets per batch)" });
  await page.getByRole("button", { name: "Plan run" }).click();
  await page.getByRole("button", { name: "Record run" }).first().click();

  const form = page.locator("form").filter({ hasText: "Type what was really used" });
  await form.getByLabel("Flour actually used (kg)").fill("40");
  await form.getByLabel("Cooking oil actually used (L)").fill("10.5");
  await form.getByLabel("Spice mix actually used (kg)").fill("1.2");
  await form.getByLabel("200 g pouch actually used (pcs)").fill("194");
  await form.getByLabel("200 g pouch damaged").fill("6");
  await form.getByLabel("Carton (holds 20 packets) actually used (pcs)").fill("9");
  await form.getByLabel(/Good packets/).fill("188");
  await form.getByLabel("Labour").fill("1200");
  await form.getByLabel("Gas, power, other").fill("600");
  await form.getByRole("button", { name: "Record run" }).click();

  await expect(page.getByText("Made 188 packets").first()).toBeVisible();

  // Variance and cost, as the owner would check them in step 8.
  await page.getByRole("button", { name: "How did it go?" }).first().click();
  await expect(page.getByText(/10 L, used 10\.5 L \(\+5\.0%\)/)).toBeVisible();
  await expect(page.getByText(/expected 200, got 188 \(\s*-6\.0%\)/)).toBeVisible();
  await expect(page.getByText("₹31.14").first()).toBeVisible();
  await page.context().close();
});

test("2. Salesman A orders 150 for Retailer A; admin approves, invoices (CGST+SGST) and dispatches", async ({ browser }) => {
  await placeOrder(browser, USERS.salesmanA, "Retailer A", 150);

  const admin = await signIn(browser, USERS.admin);
  await admin.goto("/admin/orders");
  await admin.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(admin.getByText("No orders are waiting for approval.")).toBeVisible();
  await admin.getByRole("button", { name: "To invoice" }).click();
  await admin.getByRole("button", { name: "Create invoice" }).first().click();

  await admin.goto("/admin/invoices");
  await expect(admin.getByText("₹7,875.00").first()).toBeVisible();
  await expect(admin.getByText(/GST ₹375\.00 \(half central, half state\)/)).toBeVisible();

  await admin.goto("/admin/dispatch");
  await admin.getByRole("button", { name: "Record dispatch" }).click();
  await expect(admin.getByText(/^Sent /)).toBeVisible();

  // 50 opening + 188 made - 150 sent.
  await admin.goto("/admin/dashboard");
  await expect(admin.getByText("88", { exact: true }).first()).toBeVisible();
  await admin.context().close();
});

test("3. Salesman B's 120 for Distributor B is refused: 32 packets short, and Salesman B is told", async ({ browser }) => {
  await placeOrder(browser, USERS.salesmanB, "Distributor B", 120);

  const admin = await signIn(browser, USERS.admin);
  await admin.goto("/admin/orders");
  await admin.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(admin.getByText(/You're 32 short/)).toBeVisible();
  await admin.context().close();

  const salesmanB = await signIn(browser, USERS.salesmanB);
  await salesmanB.getByRole("button", { name: "Notifications" }).click();
  await expect(salesmanB.getByText(/32 short/).first()).toBeVisible();
  await salesmanB.context().close();
});

test("4. admin records Rs 4,000 from Retailer A: Rs 3,875 still owed", async ({ browser }) => {
  const admin = await signIn(browser, USERS.admin);
  await admin.goto("/admin/invoices");
  await admin.getByLabel("Payment amount in rupees").first().fill("4000");
  await admin.getByRole("button", { name: "Record payment" }).first().click();
  await expect(admin.getByText("₹3,875.00 still owed").first()).toBeVisible();
  await admin.context().close();
});
