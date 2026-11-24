import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, PageHeader, StatusBadge, money } from "@/components/ui";

type GstSummary = { totals: { totalPaise: number; taxableValuePaise: number }; invoiceCount: number };
type CollectionsRow = { outstandingPaise: number };
type StockRow = { type: string; qtyBase: number; movingAverageCostPaise: number | null };
type ProductionRow = { status: string; yieldVariancePct: number | null };

function KpiCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "warning" | "success" }) {
  const valueColor = tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular ${valueColor}`}>{value}</p>
    </Card>
  );
}

export default function Dashboard() {
  const { data: gst } = useQuery({ queryKey: ["reports", "gst-summary", "", ""], queryFn: () => api.get<GstSummary>("/reports/gst-summary") });
  const { data: collections } = useQuery({
    queryKey: ["reports", "payments-collections"],
    queryFn: () => api.get<CollectionsRow[]>("/reports/payments-collections"),
  });
  const { data: stock } = useQuery({ queryKey: ["reports", "stock-summary"], queryFn: () => api.get<StockRow[]>("/reports/stock-summary") });
  const { data: production } = useQuery({ queryKey: ["reports", "production", "", ""], queryFn: () => api.get<ProductionRow[]>("/reports/production") });

  const totalOutstandingPaise = collections?.reduce((sum, c) => sum + c.outstandingPaise, 0) ?? 0;
  const stockValuePaise = stock?.reduce((sum, s) => sum + s.qtyBase * (s.movingAverageCostPaise ?? 0), 0) ?? 0;
  const finishedGoodsQty = stock?.filter((s) => s.type === "FINISHED_GOOD").reduce((sum, s) => sum + s.qtyBase, 0) ?? 0;
  const flaggedRuns = production?.filter((r) => r.yieldVariancePct !== null && Math.abs(r.yieldVariancePct) > 0.03) ?? [];

  const stockByType = ["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"].map((type) => ({
    type,
    total: stock?.filter((s) => s.type === type).reduce((sum, s) => sum + s.qtyBase, 0) ?? 0,
  }));
  const maxQty = Math.max(1, ...stockByType.map((s) => s.total));

  return (
    <div>
      <PageHeader title="Owner dashboard" description="Operational and financial status at a glance." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Revenue (issued)" value={money(gst?.totals.totalPaise ?? 0)} />
        <KpiCard label="Invoices issued" value={String(gst?.invoiceCount ?? 0)} />
        <KpiCard label="Outstanding receivables" value={money(totalOutstandingPaise)} tone={totalOutstandingPaise > 0 ? "warning" : "neutral"} />
        <KpiCard label="Finished-goods stock" value={`${finishedGoodsQty.toLocaleString("en-IN")} units`} />
        <KpiCard label="Stock value (moving avg)" value={money(stockValuePaise)} />
        <KpiCard
          label="Production runs flagged"
          value={String(flaggedRuns.length)}
          tone={flaggedRuns.length > 0 ? "warning" : "success"}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Stock on hand by type</h2>
          <div className="flex flex-col gap-3">
            {stockByType.map(({ type, total }) => (
              <div key={type} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 text-muted-foreground">{type.replace("_", " ")}</span>
                <div className="h-2 flex-1 rounded-full bg-secondary">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, (total / maxQty) * 100)}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right font-medium tabular">{total.toLocaleString("en-IN")}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Production variance alerts</h2>
          {flaggedRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs outside the ±3% tolerance right now.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {flaggedRuns.length} run{flaggedRuns.length > 1 ? "s" : ""} flagged for yield variance beyond ±3% — see{" "}
              <StatusBadge variant="warning">Production runs</StatusBadge> for detail.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
