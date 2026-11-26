# Demo video script (8 minutes)

Scene by scene, in the order of the brief's section 5 benchmark. Timings are cumulative. The live
site is https://porulottam-erp-bay.vercel.app; its database starts with the six logins only, so
the master data is entered on camera. Following this script against the live site reproduces the
numbers in the README's benchmark table. The browser tests (`cd frontend && npm run e2e`) click
through the same story and check the same numbers.

Before recording: press Ctrl+Shift+R once; each demo account is a button on the login page.

---

**0:00–1:00 — Setup (Owner).** Sign in as **Owner**.

- **Setup → Products & materials:** add Flour, Cooking oil and Spice mix (raw material), 200 g
  pouch and Carton (packaging), and Murukku 200 g (a product we sell: HSN 19059090, GST 5%).
- **Setup → Customers & suppliers:** add Retailer A (Tamil Nadu), Distributor B (Karnataka) and a
  flour supplier.
- **Production → Recipes → New recipe:** Murukku 200 g, 200 packets per batch, with 40 kg flour,
  10 L oil, 1.2 kg spice mix, 200 pouches and 10 cartons.
- **Stock → Stock levels → Record opening stock:** flour 100 kg (₹4,200), oil 30 L (₹4,200),
  spice mix 5 kg (₹1,000), 500 pouches (₹1,250), 30 cartons (₹450), 50 packets (₹0). Set "Warn me
  below" to 25 L for oil and 100 kg for flour.

*"Home now shows stock worth ₹11,100: every item at its average cost."* (Pre-record this part and
speed it up if time is short.)

**1:00–1:30 — Step 1, purchase (Production).** Sign in as **Production supervisor**. **Stock →
Purchases:** flour supplier, Flour, 60 kg at ₹45. *"Stock goes up on save, and flour's average
cost becomes ₹43.125/kg: (100 × 42 + 60 × 45) ÷ 160."*

**1:30–3:00 — Steps 2–3 and 8, the run (Production).** **Production → Production runs:** plan one
batch of Murukku 200 g, then **Record run**. Enter, against each planned amount:

- flour 40 kg, oil 10.5 L (10 L planned), spice mix 1.2 kg;
- pouches 194 used, 6 of them damaged; cartons 9;
- good packets 188, labour ₹1,200, gas/power ₹600.

*"It's all-or-nothing: if any material were short, nothing would leave stock."* Open **How did it
go?**: oil +5% and yield −6% flagged (cartons −10% too), cost per packet **₹31.14** (₹5,855 ÷
188). Show the bell: variance warnings, and oil now below its reorder level. **Stock levels:**
flour 120 kg, oil 19.5 L, pouches 306, Murukku 238.

**3:00–3:30 — Step 4, Salesman A on a phone.** Switch to phone view. Sign in as **Salesman A**.
**New order:** Retailer A, Murukku 200 g, 150 packets at ₹50, **Send order**. *"The office is
told straight away."*

**3:30–4:45 — Step 5, approve, invoice, dispatch (Admin).** Desktop view, sign in as **Factory
admin**.

- The bell shows the new order. **Orders → Approve orders**: the card already says "If
  invoiced: CGST + SGST". Click **Approve**, then **To invoice → Create invoice**.
- **Billing:** ₹7,500 before tax + GST ₹375 (half central, half state) = **₹7,875**. **Download
  PDF**: CGST ₹187.50 and SGST ₹187.50 listed separately. It reads "TAX INVOICE (DEMO)" because
  no real factory GSTIN is configured.
- **Orders → Dispatch:** 150 packets, **Record dispatch**. Finished stock is now **88**.

**4:45–5:45 — Step 6, the shortage (Salesman B, then Admin).** Sign in as **Salesman B**: order
120 packets for Distributor B. Sign in as **Factory admin**: the card shows **Not enough stock**,
**requested 120 · available now 88 · short by 32**, and **If invoiced: IGST ₹300.00 (Karnataka is
outside the factory's state)**. Click **Approve**: refused, nothing set aside. *"Salesman B, the
owner and the admin are all notified of the 32-packet shortage."*

**5:45–6:15 — Step 7, payment (Admin).** **Billing:** ₹4,000 against Retailer A's invoice. Still
owed: **₹3,875**. *"A payment larger than what's owed is refused."*

**6:15–7:15 — Step 9, the month's reports (Accountant).** Sign in as **Accountant** (read-only).
**Reports:** Sales Register (₹7,875), GST Summary (CGST + SGST ₹375, invoice by invoice for
GSTR-1), Purchase Register (₹2,700), Stock Summary (click flour for its ledger: +100, +60, −40),
Production (yield variance −6% flagged, wastage 6, planned vs actual per material), Payments &
Collections (₹3,875 in "Up to 30 days"). Export one as CSV and one as PDF.

**7:15–7:45 — Audit and roles.** **Reports → Activity log:** the purchase, the run, the approval,
invoice, dispatch and payment, each with who and when. Every screen opens for the accountant, but
no button that changes data is shown.

**7:45–8:00 — Close.** *"40 kg of flour went in; the system recorded consumption, expected and
actual output, wastage, closing balances and finished stock on its own, and every number traces
back to the entry that made it."*
