import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, EmptyState, Input, PageHeader, StatusBadge, Table, Td, Th, THead, money } from "@/components/ui";

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
    <div>
      <PageHeader title="Reports" description="Sales, tax, stock, production and collections — for accounts and audit." />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {REPORTS.map((r) => (
          <button
            key={r}
            onClick={() => setTab(r)}
            className={`px-3 py-2 text-sm transition-colors ${
              tab === r ? "border-b-2 border-primary font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs font-medium text-muted-foreground">
          From
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
        </label>
        <label className="flex flex-col text-xs font-medium text-muted-foreground">
          To
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
        </label>
        {exportPath && (
          <>
            <a href={`${API_BASE}/reports/${exportPath}?${query}&format=csv`} className={isLoading ? "pointer-events-none" : ""}>
              <Button type="button" variant="secondary" disabled={isLoading}>
                Export CSV
              </Button>
            </a>
            <a href={`${API_BASE}/reports/${exportPath}?${query}&format=pdf`} className={isLoading ? "pointer-events-none" : ""}>
              <Button type="button" variant="secondary" disabled={isLoading}>
                Export PDF
              </Button>
            </a>
          </>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {tab === "Sales Register" &&
            salesRegister.data &&
            (salesRegister.data.customerWise.length === 0 ? (
              <EmptyState>No sales in this range.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Customer</Th>
                    <Th numeric>Qty</Th>
                    <Th numeric>Taxable value</Th>
                    <Th numeric>Total</Th>
                  </tr>
                </THead>
                <tbody>
                  {salesRegister.data.customerWise.map((c) => (
                    <tr key={c.customerId}>
                      <Td className="font-medium text-foreground">{c.customerName}</Td>
                      <Td numeric>{c.qtyBase}</Td>
                      <Td numeric>{money(c.taxableValuePaise)}</Td>
                      <Td numeric className="font-medium text-foreground">{money(c.totalPaise)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ))}

          {tab === "GST Summary" && gstSummary.data && (
            <div className="flex flex-col gap-4">
              <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">
                <div>
                  <p className="text-xs text-muted-foreground">Invoices</p>
                  <p className="tabular text-lg font-semibold text-foreground">{gstSummary.data.invoiceCount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Taxable</p>
                  <p className="tabular text-lg font-semibold text-foreground">{money(gstSummary.data.totals.taxableValuePaise)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">CGST + SGST</p>
                  <p className="tabular text-lg font-semibold text-foreground">
                    {money(gstSummary.data.totals.cgstPaise + gstSummary.data.totals.sgstPaise)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">IGST</p>
                  <p className="tabular text-lg font-semibold text-foreground">{money(gstSummary.data.totals.igstPaise)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="tabular text-lg font-semibold text-foreground">{money(gstSummary.data.totals.totalPaise)}</p>
                </div>
              </Card>
              <Table>
                <THead>
                  <tr>
                    <Th>Tax rate</Th>
                    <Th numeric>Taxable value</Th>
                  </tr>
                </THead>
                <tbody>
                  {gstSummary.data.byRate.map((r) => (
                    <tr key={r.taxRatePct}>
                      <Td>{r.taxRatePct}%</Td>
                      <Td numeric>{money(r.taxableValuePaise)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}

          {tab === "Purchase Register" &&
            (purchaseRegister.data?.length === 0 ? (
              <EmptyState>No purchases in this range.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Supplier</Th>
                    <Th numeric>Lines</Th>
                    <Th numeric>Total</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {purchaseRegister.data?.map((p) => (
                    <tr key={p.purchaseId}>
                      <Td className="font-medium text-foreground">{p.supplierName}</Td>
                      <Td numeric>{p.lineCount}</Td>
                      <Td numeric>{money(p.totalPaise)}</Td>
                      <Td>
                        <StatusBadge variant={p.cancelled ? "destructive" : "success"}>
                          {p.cancelled ? "Cancelled" : "Received"}
                        </StatusBadge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ))}

          {tab === "Stock Summary" &&
            (!stockSummary.data || stockSummary.data.length === 0 ? (
              <EmptyState>No stock yet.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>SKU</Th>
                    <Th>Name</Th>
                    <Th>Type</Th>
                    <Th numeric>On hand</Th>
                    <Th numeric>Avg. cost/unit</Th>
                  </tr>
                </THead>
                <tbody>
                  {stockSummary.data.map((s) => (
                    <tr key={s.itemId}>
                      <Td className="font-mono text-xs">{s.sku}</Td>
                      <Td className="font-medium text-foreground">{s.name}</Td>
                      <Td>{s.type.replace("_", " ")}</Td>
                      <Td numeric>{s.qtyBase}</Td>
                      <Td numeric>{s.movingAverageCostPaise !== null ? money(s.movingAverageCostPaise) : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ))}

          {tab === "Production" &&
            (production.data?.length === 0 ? (
              <EmptyState>No production runs in this range.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Finished good</Th>
                    <Th>Status</Th>
                    <Th numeric>Planned</Th>
                    <Th numeric>Actual</Th>
                    <Th numeric>Yield variance</Th>
                  </tr>
                </THead>
                <tbody>
                  {production.data?.map((r) => (
                    <tr key={r.runId}>
                      <Td className="font-medium text-foreground">{r.finishedGoodSku}</Td>
                      <Td>{r.status}</Td>
                      <Td numeric>{r.plannedYield}</Td>
                      <Td numeric>{r.actualYield ?? "—"}</Td>
                      <Td numeric className={r.yieldVariancePct !== null && Math.abs(r.yieldVariancePct) > 0.03 ? "font-medium text-destructive" : ""}>
                        {r.yieldVariancePct !== null ? `${(r.yieldVariancePct * 100).toFixed(1)}%` : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ))}

          {tab === "Payments & Collections" &&
            (collections.data?.length === 0 ? (
              <EmptyState>Nothing outstanding.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Customer</Th>
                    <Th numeric>Outstanding</Th>
                    <Th numeric>0–30 days</Th>
                    <Th numeric>31–60 days</Th>
                    <Th numeric>61–90 days</Th>
                    <Th numeric>90+ days</Th>
                  </tr>
                </THead>
                <tbody>
                  {collections.data?.map((c) => (
                    <tr key={c.customerId}>
                      <Td className="font-medium text-foreground">{c.customerName}</Td>
                      <Td numeric className="font-medium text-foreground">{money(c.outstandingPaise)}</Td>
                      <Td numeric>{money(c["0-30"])}</Td>
                      <Td numeric>{money(c["31-60"])}</Td>
                      <Td numeric>{money(c["61-90"])}</Td>
                      <Td numeric className={c["90+"] > 0 ? "font-medium text-destructive" : ""}>{money(c["90+"])}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ))}
        </>
      )}
    </div>
  );
}
