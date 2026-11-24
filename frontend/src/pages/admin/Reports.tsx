import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card, DateRangeFilter, EmptyState, Loading, PageHeader, StatusBadge, TabBar, Table, Td, Th, THead, buttonClass, money } from "@/components/ui";

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

const REPORTS = ["Sales Register", "GST Summary", "Purchase Register", "Stock Summary", "Production", "Payments & Collections"] as const;

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
    "Stock Summary": null,
    "Production": "production",
    "Payments & Collections": null,
  };
  const exportPath = endpointForExport[tab];
  const isLoading = {
    "Sales Register": salesRegister.isLoading,
    "GST Summary": gstSummary.isLoading,
    "Purchase Register": purchaseRegister.isLoading,
    "Stock Summary": stockSummary.isLoading,
    "Production": production.isLoading,
    "Payments & Collections": collections.isLoading,
  }[tab];

  return (
    <div className="w-full min-w-0">
      <PageHeader title="Reports" description="Sales, tax, stock, production and collections, for accounts and audit." />

      {/* Tab bar */}
      <TabBar tabs={REPORTS} active={tab} onChange={(t) => setTab(t as (typeof REPORTS)[number])} />

      {/* Filters + export */}
      <DateRangeFilter
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        actions={
          exportPath ? (
            <div className="flex items-end gap-2">
              <a
                href={`${API_BASE}/reports/${exportPath}?${query}&format=csv`}
                className={buttonClass("secondary", "md", isLoading ? "pointer-events-none opacity-50" : "")}
                aria-disabled={isLoading}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Export CSV
              </a>
              <a
                href={`${API_BASE}/reports/${exportPath}?${query}&format=pdf`}
                className={buttonClass("secondary", "md", isLoading ? "pointer-events-none opacity-50" : "")}
                aria-disabled={isLoading}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" />
                </svg>
                Export PDF
              </a>
            </div>
          ) : null
        }
      />

      {isLoading ? (
        <Loading />
      ) : (
        <>
          {/* ── Sales Register ── */}
          {tab === "Sales Register" && salesRegister.data && (
            salesRegister.data.customerWise.length === 0 ? (
              <EmptyState>No sales in this range.</EmptyState>
            ) : (
              <>
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
                      <tr key={c.customerId} className="transition-colors hover:bg-secondary/30">
                        <Td className="font-medium text-foreground">{c.customerName}</Td>
                        <Td numeric>{c.qtyBase.toLocaleString("en-IN")}</Td>
                        <Td numeric>{money(c.taxableValuePaise)}</Td>
                        <Td numeric className="font-semibold text-foreground">{money(c.totalPaise)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div className="mt-2.5 flex items-center justify-between px-1 text-xs text-muted-foreground">
                  <span>
                    Showing {salesRegister.data.customerWise.length} customer{salesRegister.data.customerWise.length !== 1 ? "s" : ""}
                  </span>
                  <span className="font-semibold text-foreground">
                    Total: {money(salesRegister.data.customerWise.reduce((sum, c) => sum + c.totalPaise, 0))}
                  </span>
                </div>
              </>
            )
          )}

          {/* ── GST Summary ── */}
          {tab === "GST Summary" && gstSummary.data && (
            <div className="flex flex-col gap-4">
              <Card className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-5">
                {[
                  { label: "Invoices", value: String(gstSummary.data.invoiceCount) },
                  { label: "Taxable", value: money(gstSummary.data.totals.taxableValuePaise) },
                  { label: "CGST + SGST", value: money(gstSummary.data.totals.cgstPaise + gstSummary.data.totals.sgstPaise) },
                  { label: "IGST", value: money(gstSummary.data.totals.igstPaise) },
                  { label: "Total", value: money(gstSummary.data.totals.totalPaise) },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="tabular mt-1.5 text-xl font-bold text-foreground">{value}</p>
                  </div>
                ))}
              </Card>
              <Table>
                <THead>
                  <tr><Th>Tax rate</Th><Th numeric>Taxable value</Th></tr>
                </THead>
                <tbody>
                  {gstSummary.data.byRate.map((r) => (
                    <tr key={r.taxRatePct} className="hover:bg-secondary/30">
                      <Td className="font-medium text-foreground">{r.taxRatePct}%</Td>
                      <Td numeric>{money(r.taxableValuePaise)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}

          {/* ── Purchase Register ── */}
          {tab === "Purchase Register" && (
            purchaseRegister.data?.length === 0 ? (
              <EmptyState>No purchases in this range.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <tr><Th>Supplier</Th><Th>Date</Th><Th numeric>Lines</Th><Th numeric>Total</Th><Th>Status</Th></tr>
                </THead>
                <tbody>
                  {purchaseRegister.data?.map((p) => (
                    <tr key={p.purchaseId} className="hover:bg-secondary/30">
                      <Td className="font-medium text-foreground">{p.supplierName}</Td>
                      <Td className="text-muted-foreground">{new Date(p.purchaseDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</Td>
                      <Td numeric>{p.lineCount}</Td>
                      <Td numeric className="font-semibold text-foreground">{money(p.totalPaise)}</Td>
                      <Td><StatusBadge variant={p.cancelled ? "destructive" : "success"}>{p.cancelled ? "Cancelled" : "Received"}</StatusBadge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          )}

          {/* ── Stock Summary ── */}
          {tab === "Stock Summary" && (
            !stockSummary.data || stockSummary.data.length === 0 ? (
              <EmptyState>No stock yet.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <tr><Th>SKU</Th><Th>Name</Th><Th>Type</Th><Th numeric>On hand</Th><Th numeric>Avg. cost/unit</Th></tr>
                </THead>
                <tbody>
                  {stockSummary.data.map((s) => (
                    <tr key={s.itemId} className="hover:bg-secondary/30">
                      <Td className="font-mono text-xs text-muted-foreground">{s.sku}</Td>
                      <Td className="font-medium text-foreground">{s.name}</Td>
                      <Td><span className="text-xs text-muted-foreground">{s.type.replace("_", " ")}</span></Td>
                      <Td numeric className="font-semibold text-foreground">{s.qtyBase.toLocaleString("en-IN")}</Td>
                      <Td numeric>{s.movingAverageCostPaise !== null ? money(s.movingAverageCostPaise) : <span className="text-muted-foreground">—</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          )}

          {/* ── Production ── */}
          {tab === "Production" && (
            production.data?.length === 0 ? (
              <EmptyState>No production runs in this range.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <tr><Th>Finished good</Th><Th>Status</Th><Th numeric>Planned</Th><Th numeric>Actual</Th><Th numeric>Yield variance</Th></tr>
                </THead>
                <tbody>
                  {production.data?.map((r) => (
                    <tr key={r.runId} className="hover:bg-secondary/30">
                      <Td className="font-medium text-foreground">{r.finishedGoodSku}</Td>
                      <Td>{r.status}</Td>
                      <Td numeric>{r.plannedYield}</Td>
                      <Td numeric>{r.actualYield ?? <span className="text-muted-foreground">—</span>}</Td>
                      <Td numeric className={r.yieldVariancePct !== null && Math.abs(r.yieldVariancePct) > 0.03 ? "font-semibold text-destructive" : ""}>
                        {r.yieldVariancePct !== null ? `${(r.yieldVariancePct * 100).toFixed(1)}%` : <span className="text-muted-foreground">—</span>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          )}

          {/* ── Payments & Collections ── */}
          {tab === "Payments & Collections" && (
            collections.data?.length === 0 ? (
              <EmptyState>Nothing outstanding.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <tr><Th>Customer</Th><Th numeric>Outstanding</Th><Th numeric>0–30d</Th><Th numeric>31–60d</Th><Th numeric>61–90d</Th><Th numeric>90+d</Th></tr>
                </THead>
                <tbody>
                  {collections.data?.map((c) => (
                    <tr key={c.customerId} className="hover:bg-secondary/30">
                      <Td className="font-medium text-foreground">{c.customerName}</Td>
                      <Td numeric className="font-bold text-foreground">{money(c.outstandingPaise)}</Td>
                      <Td numeric>{money(c["0-30"])}</Td>
                      <Td numeric>{money(c["31-60"])}</Td>
                      <Td numeric>{money(c["61-90"])}</Td>
                      <Td numeric className={c["90+"] > 0 ? "font-semibold text-destructive" : ""}>{money(c["90+"])}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          )}
        </>
      )}
    </div>
  );
}
