# Demo video script — ≤8 minutes

Scene-by-scene script for the submission demo. Timings are cumulative; each scene is a single
continuous screen recording with narration, no edits needed beyond trimming between scenes. This
script doubles as the post-deployment benchmark re-verification: following it step-by-step against
the live Vercel/Render URLs should reproduce the same 10 exact numbers in `README.md`.

Record with the Playwright CLI skill (installed in this repo) if a scripted, repeatable capture is
wanted instead of a manual screen recording.

---

**0:00–0:30 — Cold open.** Show the login screen. *"This is Porulottam ERP — Every material.
Every process. One connected system. An order-to-audit system for a small food manufacturer:
one salesman takes an order, the factory checks stock, production turns raw material into
packets, and the owner can trace every rupee and every gram back to where it came from. I'll
walk through the whole flow once, start to finish."*

**0:30–1:15 — BOM (recipe).** Sign in as Admin. Open **BOM / recipes**. Point at the existing
Murukku 200 g recipe: Flour, Oil, Spice mix per batch, expected yield 200 packets, plus its
200 g pack size. *"This recipe is what production runs against — planned quantities live only
here, never duplicated into the ledger."*

**1:15–2:45 — Production run.** Open **Production runs**. Create a new DRAFT run against the
Murukku recipe. Start it: show the consumption form: empty boxes, each with its recipe amount beside it.
Enter 40 kg flour, 10.5 L oil (10 L planned) and 1.2 kg spice mix, confirm — point out the stock ledger just
posted a negative movement at the *current* moving-average cost. Complete the run: actual output
188, pouches 188 used / 6 damaged, cartons 9 used, labour ₹1,200 and gas/power ₹600. Open
**How did it go?**: Oil +5% flagged, yield −6% flagged, cartons −10% flagged, cost per packet
₹31.14 (₹5,855 ÷ 188) with its stated method
visible right there. *"Anything outside ±3% tolerance is flagged immediately — not buried in a
report someone has to go look for."*

**2:45–3:30 — Salesman order entry (mobile).** Switch viewport to a phone width, sign in as
Salesman. Open **New order**: select Retailer A, add 150 packets of Murukku 200 g at ₹50 each,
submit. Show it land in **My orders** as SUBMITTED. *"The salesman's whole job is three taps —
customer, product and quantity, submit."*

**3:30–4:30 — Approval and the shortage case.** Back to desktop, sign in as Admin, open
**Order queue**. Approve Retailer A's order — on-hand drops accordingly. Then show Distributor
B's pending 120-packet order: attempt to approve it against the now-reduced stock and show the
exact "short by 32 units" message. *"The system blocks an order it can't actually fill, with the
exact shortfall — not a vague low-stock warning."*

**4:30–5:30 — Invoice and GST.** From the approved Retailer A order, create the invoice. Show the
GST split: taxable ₹7,500, CGST ₹187.50, SGST ₹187.50, total ₹7,875 — same state, so CGST+SGST,
not IGST. Download the PDF, then demonstrate **Share on WhatsApp** opening the pre-filled
`wa.me` link with the invoice total and PDF link. *"Once issued, this invoice is frozen — a
correction is always a credit note, never an edit."*

**5:30–6:15 — Dispatch and payment.** Open **Dispatch**, ship the invoice, confirm finished-goods
on-hand lands at 88. Open **Payments**, record ₹4,000 against the ₹7,875 invoice, show outstanding
settle at exactly ₹3,875.

**6:15–7:15 — Owner dashboard and reports.** Open **Dashboard**: revenue, outstanding, finished-
goods stock, flagged production runs all in one glance. Flip through **Reports**: Sales Register,
GST Summary, Payments & Collections ageing buckets — export one as CSV to show it's a real,
numbers-match-the-dashboard document, not a mockup.

**7:15–7:45 — Audit log and role boundary.** Open **Audit log**, point at the real APPROVE /
CREATE / CREDIT_NOTE entries from this exact walkthrough. Sign in as Accountant to show every
screen is visible but every mutation control (Approve, Dispatch, Record payment, …) is simply
absent for that role.

**7:45–8:00 — Close.** *"Every number in this demo is live and traceable — the invoice total to
its GST calculation, the cost per packet to the production run that made it, the outstanding
balance to the payments against it. That traceability, not just the screens, is the point."*
