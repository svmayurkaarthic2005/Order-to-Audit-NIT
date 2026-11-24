import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

type SalesRegister = {
  customerWise: { customerId: string; customerName: string; qtyBase: number; taxableValuePaise: number; totalPaise: number }[];
  productWise: { itemId: string; description: string; qtyBase: number; taxableValuePaise: number }[];
};
type GstSummary = {
  totals: { taxableValuePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number };
  byRate: { taxRatePct: number; taxableValuePaise: number }[];
  invoiceCount: number;
};
type PurchaseRow = { purchaseId: string; supplierName: string; purchaseDate: string; cancelled: boolean; totalPaise: number; lineCount: number };
type StockRow = { itemId: string; sku: string; name: string; type: string; qtyBase: number; movingAverageCostPaise: number | null };
type ProductionRow = {
  runId: string;
  finishedGoodSku: string;
  status: string;
  plannedYield: number;
  actualYield: number | null;
  yieldVariancePct: number | null;
  damagedQty: number | null;
};
type CollectionsRow = { customerId: string; customerName: string; outstandingPaise: number; "0-30": number; "31-60": number; "61-90": number; "90+": number };

const REPORTS = [
  "Sales Register",
  "GST Summary",
  "Purchase Register",
  "Stock Summary",
  "Production",
  "Payments & Collections",
] as const;

export default function Reports() {
  const [tab, setTab] = useState<(typeof REPORTS)[number]>("Sales Register");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const query = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();

  const salesRegister = useQuery({
    queryKey: ["reports", "sales-register", from, to],
    queryFn: () => api.get<SalesRegister>(`/reports/sales-register?${query}`),
    enabled: tab === "Sales Register",
  });
  const gstSummary = useQuery({
    queryKey: ["reports", "gst-summary", from, to],
    queryFn: () => api.get<GstSummary>(`/reports/gst-summary?${query}`),
    enabled: tab === "GST Summary",
  });
  const purchaseRegister = useQuery({
    queryKey: ["reports", "purchase-register", from, to],
    queryFn: () => api.get<PurchaseRow[]>(`/reports/purchase-register?${query}`),
    enabled: tab === "Purchase Register",
  });
  const stockSummary = useQuery({
    queryKey: ["reports", "stock-summary"],
    queryFn: () => api.get<StockRow[]>(`/reports/stock-summary`),
    enabled: tab === "Stock Summary",
  });
  const production = useQuery({
    queryKey: ["reports", "production", from, to],
    queryFn: () => api.get<ProductionRow[]>(`/reports/production?${query}`),
    enabled: tab === "Production",
  });
  const collections = useQuery({
    queryKey: ["reports", "payments-collections"],
    queryFn: () => api.get<CollectionsRow[]>(`/reports/payments-collections`),
    enabled: tab === "Payments & Collections",
  });

  const endpointForExport: Record<(typeof REPORTS)[number], string | null> = {
    "Sales Register": "sales-register",
    "GST Summary": "gst-summary",
    "Purchase Register": "purchase-register",
    "Stock Summary": null, // no date range / export for this one
    Production: "production",
    "Payments & Collections": null,
  };
  const exportPath = endpointForExport[tab];
  const isLoading = {
    "Sales Register": salesRegister.isLoading,
    "GST Summary": gstSummary.isLoading,
    "Purchase Register": purchaseRegister.isLoading,
    "Stock Summary": stockSummary.isLoading,
    Production: production.isLoading,
    "Payments & Collections": collections.isLoading,
  }[tab];

  return (
    <main className="mx-auto max-w-3xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">Reports</h1>

      <div className="mb-4 flex flex-wrap gap-2 border-b border-border">
        {REPORTS.map((r) => (
          <button
            key={r}
            onClick={() => setTab(r)}
            className={`px-3 py-2 text-sm ${tab === r ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2 text-sm">
        <label>
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-input bg-transparent px-2 py-1" />
        </label>
        <label>
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-input bg-transparent px-2 py-1" />
        </label>
        {exportPath && (
          <>
            <a
              href={`${API_BASE}/reports/${exportPath}?${query}&format=csv`}
              className={`rounded border border-input px-2 py-1 ${isLoading ? "pointer-events-none opacity-50" : ""}`}
            >
              Export CSV
            </a>
            <a
              href={`${API_BASE}/reports/${exportPath}?${query}&format=pdf`}
              className={`rounded border border-input px-2 py-1 ${isLoading ? "pointer-events-none opacity-50" : ""}`}
            >
              Export PDF
            </a>
          </>
        )}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          {tab === "Sales Register" && salesRegister.data && (
            <>
              {salesRegister.data.customerWise.length === 0 ? (
                <p className="text-muted-foreground">No sales in this range.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {salesRegister.data.customerWise.map((c) => (
                    <li key={c.customerId} className="rounded border border-border p-2">
                      {c.customerName}: {c.qtyBase} units · ₹{(c.totalPaise / 100).toFixed(2)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === "GST Summary" && gstSummary.data && (
            <div className="text-sm">
              <p>Invoices: {gstSummary.data.invoiceCount}</p>
              <p>
                Taxable ₹{(gstSummary.data.totals.taxableValuePaise / 100).toFixed(2)} · CGST ₹
                {(gstSummary.data.totals.cgstPaise / 100).toFixed(2)} · SGST ₹{(gstSummary.data.totals.sgstPaise / 100).toFixed(2)} ·
                IGST ₹{(gstSummary.data.totals.igstPaise / 100).toFixed(2)} · Total ₹
                {(gstSummary.data.totals.totalPaise / 100).toFixed(2)}
              </p>
              <ul className="mt-2 list-disc pl-4">
                {gstSummary.data.byRate.map((r) => (
                  <li key={r.taxRatePct}>
                    {r.taxRatePct}%: ₹{(r.taxableValuePaise / 100).toFixed(2)} taxable
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === "Purchase Register" &&
            (purchaseRegister.data?.length === 0 ? (
              <p className="text-muted-foreground">No purchases in this range.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {purchaseRegister.data?.map((p) => (
                  <li key={p.purchaseId} className="rounded border border-border p-2">
                    {p.supplierName} · {p.lineCount} line(s) · ₹{(p.totalPaise / 100).toFixed(2)}
                    {p.cancelled && <span className="ml-2 text-destructive">(cancelled)</span>}
                  </li>
                ))}
              </ul>
            ))}

          {tab === "Stock Summary" && (
            <ul className="flex flex-col gap-1 text-sm">
              {stockSummary.data?.map((s) => (
                <li key={s.itemId}>
                  {s.sku} — {s.name} ({s.type}): {s.qtyBase}
                  {s.movingAverageCostPaise !== null && <> · ₹{(s.movingAverageCostPaise / 100).toFixed(2)}/unit</>}
                </li>
              ))}
            </ul>
          )}

          {tab === "Production" &&
            (production.data?.length === 0 ? (
              <p className="text-muted-foreground">No production runs in this range.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {production.data?.map((r) => (
                  <li key={r.runId} className="rounded border border-border p-2">
                    {r.finishedGoodSku} · {r.status} · planned {r.plannedYield}, actual {r.actualYield ?? "-"}
                    {r.yieldVariancePct !== null && <> ({(r.yieldVariancePct * 100).toFixed(1)}%)</>}
                  </li>
                ))}
              </ul>
            ))}

          {tab === "Payments & Collections" && (
            <ul className="flex flex-col gap-2 text-sm">
              {collections.data?.map((c) => (
                <li key={c.customerId} className="rounded border border-border p-2">
                  {c.customerName}: outstanding ₹{(c.outstandingPaise / 100).toFixed(2)} (0-30: ₹{(c["0-30"] / 100).toFixed(2)}, 31-60: ₹
                  {(c["31-60"] / 100).toFixed(2)}, 61-90: ₹{(c["61-90"] / 100).toFixed(2)}, 90+: ₹{(c["90+"] / 100).toFixed(2)})
                </li>
              ))}
              {collections.data?.length === 0 && <p className="text-muted-foreground">Nothing outstanding.</p>}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
