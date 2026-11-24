import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type GstSummary = { totals: { totalPaise: number; taxableValuePaise: number }; invoiceCount: number };
type CollectionsRow = { outstandingPaise: number };
type StockRow = { type: string; qtyBase: number; movingAverageCostPaise: number | null };
type ProductionRow = { status: string; yieldVariancePct: number | null };

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
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
  const stockValuePaise =
    stock?.reduce((sum, s) => sum + s.qtyBase * (s.movingAverageCostPaise ?? 0), 0) ?? 0;
  const flaggedRuns = production?.filter((r) => r.yieldVariancePct !== null && Math.abs(r.yieldVariancePct) > 0.03).length ?? 0;

  const maxByType = new Map<string, number>();
  for (const s of stock ?? []) {
    maxByType.set(s.type, Math.max(maxByType.get(s.type) ?? 0, s.qtyBase));
  }

  return (
    <main className="mx-auto max-w-3xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">Owner Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Revenue (issued)" value={`₹${((gst?.totals.totalPaise ?? 0) / 100).toFixed(2)}`} />
        <Card label="Invoices issued" value={String(gst?.invoiceCount ?? 0)} />
        <Card label="Outstanding receivables" value={`₹${(totalOutstandingPaise / 100).toFixed(2)}`} />
        <Card label="Stock value (moving avg)" value={`₹${(stockValuePaise / 100).toFixed(2)}`} />
        <Card label="Production runs flagged" value={String(flaggedRuns)} />
      </div>

      <h2 className="mb-2 mt-6 text-lg font-medium">Stock on hand by type</h2>
      <div className="flex flex-col gap-2">
        {["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"].map((type) => {
          const typeStock = stock?.filter((s) => s.type === type) ?? [];
          const total = typeStock.reduce((sum, s) => sum + s.qtyBase, 0);
          const max = Math.max(1, ...Array.from(maxByType.values()));
          return (
            <div key={type} className="flex items-center gap-2 text-sm">
              <span className="w-32 shrink-0">{type}</span>
              <div className="h-4 flex-1 rounded bg-muted">
                <div className="h-4 rounded bg-primary" style={{ width: `${Math.min(100, (total / max) * 100)}%` }} />
              </div>
              <span className="w-20 text-right">{total}</span>
            </div>
          );
        })}
      </div>
    </main>
  );
}
