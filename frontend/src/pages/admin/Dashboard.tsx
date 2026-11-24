import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, money } from "@/components/ui";

const DASHBOARD_TITLE: Record<string, string> = {
  OWNER: "Owner Dashboard",
  ADMIN: "Admin Dashboard",
  ACCOUNTANT: "Accountant Dashboard",
};

type GstSummary = { totals: { totalPaise: number; taxableValuePaise: number }; invoiceCount: number };
type CollectionsRow = { outstandingPaise: number };
type StockRow = { type: string; qtyBase: number; movingAverageCostPaise: number | null };
type ProductionRow = { status: string; yieldVariancePct: number | null };

function KpiCard({
  label,
  value,
  icon,
  tone = "neutral",
  sub,
  to,
}: {
  label: string;
  value: string;
  icon: string;
  tone?: "neutral" | "warning" | "success";
  sub?: string;
  to?: string;
}) {
  const toneConfig = {
    neutral: { text: "text-foreground", bg: "bg-primary/8", icon: "text-primary" },
    warning: { text: "text-warning", bg: "bg-warning-bg", icon: "text-warning" },
    success: { text: "text-success", bg: "bg-success-bg", icon: "text-success" },
  }[tone];

  const content = (
    <Card className={`p-5 h-full transition-shadow ${to ? "card-hover" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={`mt-2 text-2xl font-bold tabular leading-none ${toneConfig.text}`}>{value}</p>
          {sub && <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneConfig.bg}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={toneConfig.icon}>
            <path d={icon} />
          </svg>
        </div>
      </div>
    </Card>
  );

  if (to) {
    return (
      <Link to={to} className="block h-full" aria-label={`${label}: ${value}. View details.`}>
        {content}
      </Link>
    );
  }

  return content;
}

const STOCK_TYPE_LABEL: Record<string, string> = {
  RAW_MATERIAL: "Raw Material",
  PACKAGING: "Packaging",
  FINISHED_GOOD: "Finished Goods",
};

const STOCK_COLORS: Record<string, string> = {
  RAW_MATERIAL: "bg-blue-500",
  PACKAGING: "bg-indigo-400",
  FINISHED_GOOD: "bg-primary",
};

export default function Dashboard() {
  const { user } = useAuth();
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

  const kpis = [
    {
      label: "Revenue Issued",
      value: money(gst?.totals.totalPaise ?? 0),
      icon: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
      tone: "neutral" as const,
      sub: `Taxable: ${money(gst?.totals.taxableValuePaise ?? 0)}`,
      to: "/admin/invoices",
    },
    {
      label: "Invoices Issued",
      value: String(gst?.invoiceCount ?? 0),
      icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
      tone: "neutral" as const,
      to: "/admin/invoices",
    },
    {
      label: "Outstanding Receivables",
      value: money(totalOutstandingPaise),
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      tone: (totalOutstandingPaise > 0 ? "warning" : "neutral") as "neutral" | "warning" | "success",
      to: "/admin/invoices",
    },
    {
      label: "Finished Goods Stock",
      value: `${finishedGoodsQty.toLocaleString("en-IN")} units`,
      icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
      tone: "neutral" as const,
      to: "/admin/reports",
    },
    {
      label: "Stock Value",
      value: money(stockValuePaise),
      icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
      tone: "neutral" as const,
      sub: "Moving average cost",
      to: "/admin/reports",
    },
    {
      label: "Production Flags",
      value: String(flaggedRuns.length),
      icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
      tone: (flaggedRuns.length > 0 ? "warning" : "success") as "neutral" | "warning" | "success",
      sub: flaggedRuns.length > 0 ? "Beyond ±3% tolerance" : "All within tolerance",
      to: "/production/runs",
    },
  ];

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title={DASHBOARD_TITLE[user?.role ?? ""] ?? "Dashboard"}
        description="Operational and financial status at a glance."
        actions={
          <div className="flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1 text-xs font-semibold text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Live
          </div>
        }
      />

      {/* KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* Charts row */}
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* Stock bar chart */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Stock on Hand</h2>
            <span className="text-xs text-muted-foreground">by type</span>
          </div>
          <div className="flex flex-col gap-4">
            {stockByType.map(({ type, total }) => (
              <div key={type}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{STOCK_TYPE_LABEL[type] ?? type}</span>
                  <span className="tabular text-sm font-semibold text-foreground">
                    {total.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${STOCK_COLORS[type] ?? "bg-primary"}`}
                    style={{ width: `${Math.min(100, (total / maxQty) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Production variance */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Production Variance</h2>
            <span className="text-xs text-muted-foreground">±3% tolerance</span>
          </div>
          {flaggedRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-bg">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="text-success">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-foreground">All runs within tolerance</p>
              <p className="text-xs text-muted-foreground">No yield variance alerts right now</p>
            </div>
          ) : (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <StatusBadge variant="warning">{flaggedRuns.length} run{flaggedRuns.length > 1 ? "s" : ""} flagged</StatusBadge>
              </div>
              <p className="text-sm text-muted-foreground">
                {flaggedRuns.length} production run{flaggedRuns.length > 1 ? "s" : ""} outside the ±3% yield tolerance. Review the{" "}
                <Link to="/production/runs" className="font-semibold text-primary hover:underline">
                  Production runs
                </Link>{" "}
                page for details.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
