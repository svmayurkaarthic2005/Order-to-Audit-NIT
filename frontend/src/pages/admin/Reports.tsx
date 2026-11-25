import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card, DateRangeFilter, Drawer, EmptyState, ErrorText, Loading, PageHeader, StatusBadge, TabBar, Table, Td, Th, THead, buttonClass, money, qty, unitOf } from "@/components/ui";

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
type StockRow = { itemId: string; sku: string; name: string; type: string; baseUnit: string; qtyBase: number; movingAverageCostPaise: number | null };

const STOCK_TYPE_LABEL: Record<string, string> = { RAW_MATERIAL: "Raw material", PACKAGING: "Packaging", FINISHED_GOOD: "Product" };
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
type SalesTrendBucket = { key: string; label: string; invoiceCount: number; taxableValuePaise: number; totalPaise: number };
type SalesTrend = { granularity: "monthly" | "yearly"; buckets: SalesTrendBucket[] };

type StockLedgerEntry = { id: string; qtyBase: number; unitCostPaise: number; totalCostPaise: number; source: string; createdAt: string };
type InvoiceDetail = {
  invoiceId: string;
  customerName: string;
  financialYear: string;
  invoiceNumber: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  payments: { id: string; amountPaise: number; paidAt: string }[];
  creditNotes: { id: string; amountPaise: number; reason: string; createdAt: string }[];
  paidPaise: number;
  creditedPaise: number;
  outstandingPaise: number;
};
type CustomerSalesEntry = { invoiceId: string; financialYear: string; invoiceNumber: number; taxableValuePaise: number; totalPaise: number; createdAt: string };
type GstRateEntry = { invoiceId: string; invoiceNumber: number; customerName: string; description: string; qtyBase: number; taxableValuePaise: number };
type ProductionCostDetail = {
  variance: { materials: { itemId: string; planned: number; actual: number; variancePct: number; flagged: boolean }[]; yield: { planned: number; actual: number; variancePct: number; flagged: boolean } | null };
  cost: {
    materialLines: { itemId: string; sku: string; name: string; qtyBase: number; totalCostPaise: number }[];
    packagingLines: { itemId: string; sku: string; name: string; qtyBase: number; totalCostPaise: number }[];
    laborCostPaise: number;
    overheadCostPaise: number;
    totalCostPaise: number;
    goodOutputQty: number;
    costPerGoodUnitPaise: number;
  } | null;
};

type Drill =
  | { type: "stock"; itemId: string; sku: string }
  | { type: "customerSales"; customerId: string; customerName: string }
  | { type: "customerOutstanding"; customerId: string; customerName: string }
  | { type: "gstRate"; taxRatePct: number }
  | { type: "productionCost"; runId: string; sku: string };

const REPORTS = ["Sales Register", "GST Summary", "Purchase Register", "Stock Summary", "Production", "Payments & Collections"] as const;

const clickableCell = "cursor-pointer decoration-dotted underline-offset-2 hover:text-primary hover:underline";

export default function Reports() {
  const [tab, setTab] = useState<(typeof REPORTS)[number]>("Sales Register");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const query = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const [trendGranularity, setTrendGranularity] = useState<"monthly" | "yearly">("monthly");

  const salesRegister = useQuery({
    queryKey: ["reports", "sales-register", from, to],
    queryFn: () => api.get<SalesRegister>(`/reports/sales-register?${query}`),
    enabled: tab === "Sales Register",
  });
  const salesTrend = useQuery({
    queryKey: ["reports", "sales-trend", trendGranularity, from, to],
    queryFn: () => api.get<SalesTrend>(`/reports/sales-trend?granularity=${trendGranularity}&${query}`),
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

  const [drill, setDrill] = useState<Drill | null>(null);
  const drillQuery = useQuery({
    queryKey: ["reports", "drill", drill, from, to],
    queryFn: async () => {
      if (!drill) return null;
      if (drill.type === "stock") return api.get<StockLedgerEntry[]>(`/reports/stock-ledger?itemId=${drill.itemId}`);
      if (drill.type === "customerSales") return api.get<CustomerSalesEntry[]>(`/reports/customers/${drill.customerId}/sales-detail?${query}`);
      if (drill.type === "customerOutstanding") return api.get<InvoiceDetail[]>(`/reports/customers/${drill.customerId}/outstanding-detail`);
      if (drill.type === "gstRate") return api.get<GstRateEntry[]>(`/reports/gst-summary/${drill.taxRatePct}/detail?${query}`);
      return api.get<ProductionCostDetail>(`/reports/production/${drill.runId}/cost-detail`);
    },
    enabled: drill !== null,
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

  const currentError = {
    "Sales Register": salesRegister.error,
    "GST Summary": gstSummary.error,
    "Purchase Register": purchaseRegister.error,
    "Stock Summary": stockSummary.error,
    "Production": production.error,
    "Payments & Collections": collections.error,
  }[tab];

  return (
    <div className="w-full min-w-0">
      <PageHeader title="Reports" description="Sales, GST, stock, production and payments. Click a number to see the entries behind it." />

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
      ) : currentError ? (
        <ErrorText>{(currentError as Error).message}</ErrorText>
      ) : (
        <>
          {/* ── Sales Register ── */}
          {tab === "Sales Register" && (
            <Card className="mb-5 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Sales Trend</h2>
                <div className="flex gap-0.5 rounded-lg border border-border bg-secondary/50 p-0.5">
                  {(["monthly", "yearly"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setTrendGranularity(g)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                        trendGranularity === g ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              {salesTrend.isLoading ? (
                <Loading />
              ) : !salesTrend.data || salesTrend.data.buckets.every((b) => b.totalPaise === 0) ? (
                <EmptyState>No sales in this period.</EmptyState>
              ) : (
                <SalesTrendBars buckets={salesTrend.data.buckets} />
              )}
            </Card>
          )}

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
                        <Td
                          numeric
                          className={`font-semibold text-foreground ${clickableCell}`}
                          onClick={() => setDrill({ type: "customerSales", customerId: c.customerId, customerName: c.customerName })}
                        >
                          {money(c.totalPaise)}
                        </Td>
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
                    <p className="text-sm text-muted-foreground">{label}</p>
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
                      <Td
                        numeric
                        className={clickableCell}
                        onClick={() => setDrill({ type: "gstRate", taxRatePct: r.taxRatePct })}
                      >
                        {money(r.taxableValuePaise)}
                      </Td>
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
                  <tr><Th>Item</Th><Th>Type</Th><Th numeric>On hand</Th><Th numeric>Average cost</Th></tr>
                </THead>
                <tbody>
                  {stockSummary.data.map((s) => (
                    <tr key={s.itemId} className="hover:bg-secondary/30">
                      <Td className="font-medium text-foreground">{s.name}</Td>
                      <Td><span className="text-xs text-muted-foreground">{STOCK_TYPE_LABEL[s.type] ?? s.type}</span></Td>
                      <Td
                        numeric
                        className={`font-semibold text-foreground ${clickableCell}`}
                        onClick={() => setDrill({ type: "stock", itemId: s.itemId, sku: s.sku })}
                      >
                        {qty(s.qtyBase, s.baseUnit)}
                      </Td>
                      <Td numeric>
                        {s.movingAverageCostPaise !== null ? (
                          `${money(s.movingAverageCostPaise * unitOf(s.baseUnit).factor)} per ${unitOf(s.baseUnit).label === "pcs" ? "piece" : unitOf(s.baseUnit).label}`
                        ) : (
                          <span className="text-muted-foreground">Not bought yet</span>
                        )}
                      </Td>
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
                      <Td>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Td>
                      <Td numeric>{r.plannedYield}</Td>
                      <Td
                        numeric
                        className={r.status === "COMPLETED" ? clickableCell : ""}
                        onClick={() => r.status === "COMPLETED" && setDrill({ type: "productionCost", runId: r.runId, sku: r.finishedGoodSku })}
                      >
                        {r.actualYield ?? <span className="text-muted-foreground">—</span>}
                      </Td>
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
                      <Td
                        numeric
                        className={`font-bold text-foreground ${clickableCell}`}
                        onClick={() => setDrill({ type: "customerOutstanding", customerId: c.customerId, customerName: c.customerName })}
                      >
                        {money(c.outstandingPaise)}
                      </Td>
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

      <Drawer open={drill !== null} onClose={() => setDrill(null)} title={drillTitle(drill)}>
        {drillQuery.isLoading ? (
          <Loading />
        ) : drillQuery.error ? (
          <ErrorText>{(drillQuery.error as Error).message}</ErrorText>
        ) : drill?.type === "stock" ? (
          <StockLedgerDrill rows={(drillQuery.data as StockLedgerEntry[] | null) ?? []} />
        ) : drill?.type === "customerSales" ? (
          <CustomerSalesDrill rows={(drillQuery.data as CustomerSalesEntry[] | null) ?? []} />
        ) : drill?.type === "customerOutstanding" ? (
          <CustomerOutstandingDrill invoices={(drillQuery.data as InvoiceDetail[] | null) ?? []} />
        ) : drill?.type === "gstRate" ? (
          <GstRateDrill rows={(drillQuery.data as GstRateEntry[] | null) ?? []} />
        ) : drill?.type === "productionCost" ? (
          <ProductionCostDrill detail={drillQuery.data as ProductionCostDetail | null} />
        ) : null}
      </Drawer>
    </div>
  );
}

function drillTitle(drill: Drill | null): string {
  if (!drill) return "";
  if (drill.type === "stock") return `Stock ledger — ${drill.sku}`;
  if (drill.type === "customerSales") return `Invoices — ${drill.customerName}`;
  if (drill.type === "customerOutstanding") return `Outstanding invoices — ${drill.customerName}`;
  if (drill.type === "gstRate") return `Invoice lines taxed at ${drill.taxRatePct}%`;
  return `Cost breakdown — ${drill.sku}`;
}

// A plain CSS/flex bar chart — no charting library, since these are the
// only two axes (one bucket, one rupee total) a <div> and Tailwind already
// draw correctly.
function SalesTrendBars({ buckets }: { buckets: SalesTrendBucket[] }) {
  const maxPaise = Math.max(1, ...buckets.map((b) => b.totalPaise));
  return (
    <div className="flex h-48 items-end gap-2 overflow-x-auto pb-1">
      {buckets.map((b) => (
        <div key={b.key} className="flex h-full min-w-[2.5rem] flex-1 flex-col items-center justify-end gap-1.5" title={`${b.label}: ${money(b.totalPaise)} (${b.invoiceCount} invoice${b.invoiceCount !== 1 ? "s" : ""})`}>
          <span className="text-[10px] font-medium tabular text-muted-foreground">
            {b.totalPaise > 0 ? money(b.totalPaise).replace(".00", "") : ""}
          </span>
          <div
            className={`w-full rounded-t-md transition-all duration-500 ${b.totalPaise > 0 ? "bg-primary" : "bg-secondary"}`}
            style={{ height: `${Math.max(2, (b.totalPaise / maxPaise) * 100)}%` }}
          />
          <span className="whitespace-nowrap text-[10px] text-muted-foreground">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function StockLedgerDrill({ rows }: { rows: StockLedgerEntry[] }) {
  if (rows.length === 0) return <EmptyState>No stock movements yet.</EmptyState>;
  let running = 0;
  return (
    <Table>
      <THead>
        <tr><Th>Date</Th><Th>Source</Th><Th numeric>Qty</Th><Th numeric>Running balance</Th><Th numeric>Value</Th></tr>
      </THead>
      <tbody>
        {rows.map((m) => {
          running += m.qtyBase;
          return (
            <tr key={m.id}>
              <Td className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</Td>
              <Td className="text-xs">{m.source.replace(/_/g, " ")}</Td>
              <Td numeric className={m.qtyBase < 0 ? "text-destructive" : "text-success"}>{m.qtyBase > 0 ? "+" : ""}{m.qtyBase.toLocaleString("en-IN")}</Td>
              <Td numeric className="font-semibold text-foreground">{running.toLocaleString("en-IN")}</Td>
              <Td numeric>{money(m.totalCostPaise)}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function CustomerSalesDrill({ rows }: { rows: CustomerSalesEntry[] }) {
  if (rows.length === 0) return <EmptyState>No invoices in this range.</EmptyState>;
  const total = rows.reduce((sum, r) => sum + r.totalPaise, 0);
  return (
    <>
      <Table>
        <THead>
          <tr><Th>Invoice</Th><Th numeric>Taxable</Th><Th numeric>Total</Th></tr>
        </THead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.invoiceId}>
              <Td className="font-mono text-xs text-muted-foreground">{r.financialYear}/{r.invoiceNumber}</Td>
              <Td numeric>{money(r.taxableValuePaise)}</Td>
              <Td numeric className="font-semibold text-foreground">{money(r.totalPaise)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="mt-3 text-right text-sm font-semibold text-foreground">Total: {money(total)}</p>
    </>
  );
}

function CustomerOutstandingDrill({ invoices }: { invoices: InvoiceDetail[] }) {
  if (invoices.length === 0) return <EmptyState>Nothing outstanding.</EmptyState>;
  return (
    <div className="flex flex-col gap-4">
      {invoices.map((inv) => (
        <Card key={inv.invoiceId} className="p-4">
          <p className="mb-2 font-mono text-xs text-muted-foreground">{inv.financialYear}/{inv.invoiceNumber}</p>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Taxable value</dt><dd className="text-right tabular">{money(inv.taxableValuePaise)}</dd>
            <dt className="text-muted-foreground">CGST + SGST</dt><dd className="text-right tabular">{money(inv.cgstPaise + inv.sgstPaise)}</dd>
            <dt className="text-muted-foreground">IGST</dt><dd className="text-right tabular">{money(inv.igstPaise)}</dd>
            <dt className="font-medium text-foreground">Total</dt><dd className="text-right tabular font-semibold text-foreground">{money(inv.totalPaise)}</dd>
          </dl>
          {inv.payments.length > 0 && (
            <div className="mt-3 border-t border-border/60 pt-2">
              <p className="mb-1 text-xs font-semibold text-foreground">Payments</p>
              {inv.payments.map((p) => (
                <div key={p.id} className="flex justify-between text-sm text-muted-foreground">
                  <span>{new Date(p.paidAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  <span className="tabular">{money(p.amountPaise)}</span>
                </div>
              ))}
            </div>
          )}
          {inv.creditNotes.length > 0 && (
            <div className="mt-2 border-t border-border/60 pt-2">
              <p className="mb-1 text-xs font-semibold text-foreground">Credit notes</p>
              {inv.creditNotes.map((c) => (
                <div key={c.id} className="flex justify-between text-sm text-muted-foreground">
                  <span>{c.reason}</span>
                  <span className="tabular">{money(c.amountPaise)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 border-t border-border/60 pt-2 text-right text-sm font-bold text-destructive">
            Outstanding: {money(inv.outstandingPaise)}
          </p>
        </Card>
      ))}
    </div>
  );
}

function GstRateDrill({ rows }: { rows: GstRateEntry[] }) {
  if (rows.length === 0) return <EmptyState>No invoice lines at this rate.</EmptyState>;
  const total = rows.reduce((sum, r) => sum + r.taxableValuePaise, 0);
  return (
    <>
      <Table>
        <THead>
          <tr><Th>Invoice</Th><Th>Customer</Th><Th>Item</Th><Th numeric>Taxable</Th></tr>
        </THead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.invoiceId}-${i}`}>
              <Td className="font-mono text-xs text-muted-foreground">#{r.invoiceNumber}</Td>
              <Td className="text-sm">{r.customerName}</Td>
              <Td className="text-sm">{r.description}</Td>
              <Td numeric>{money(r.taxableValuePaise)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="mt-3 text-right text-sm font-semibold text-foreground">Total: {money(total)}</p>
    </>
  );
}

function ProductionCostDrill({ detail }: { detail: ProductionCostDetail | null }) {
  if (!detail?.cost) return <EmptyState>Cost not yet available for this run.</EmptyState>;
  const { cost } = detail;
  return (
    <table className="w-full text-sm">
      <tbody>
        {cost.materialLines.map((l) => (
          <tr key={l.itemId}><td className="py-0.5 text-muted-foreground">{l.name}</td><td className="py-0.5 text-right tabular">{money(l.totalCostPaise)}</td></tr>
        ))}
        {cost.packagingLines.map((l) => (
          <tr key={l.itemId}><td className="py-0.5 text-muted-foreground">{l.name}</td><td className="py-0.5 text-right tabular">{money(l.totalCostPaise)}</td></tr>
        ))}
        <tr><td className="py-0.5 text-muted-foreground">Labour</td><td className="py-0.5 text-right tabular">{money(cost.laborCostPaise)}</td></tr>
        <tr><td className="py-0.5 text-muted-foreground">Overhead</td><td className="py-0.5 text-right tabular">{money(cost.overheadCostPaise)}</td></tr>
        <tr className="border-t border-border/60">
          <td className="pt-1.5 font-medium text-foreground">Total ({cost.goodOutputQty} good units)</td>
          <td className="pt-1.5 text-right tabular font-semibold text-foreground">{money(cost.totalCostPaise)}</td>
        </tr>
        <tr><td className="py-0.5 font-medium text-foreground">Cost per good unit</td><td className="py-0.5 text-right tabular font-semibold text-foreground">{money(cost.costPerGoodUnitPaise)}</td></tr>
      </tbody>
    </table>
  );
}
