import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, PageHeader, StatusBadge, money, qty } from "@/components/ui";

type GstSummary = { totals: { totalPaise: number }; invoiceCount: number };
type CollectionsRow = { customerName: string; outstandingPaise: number };
type StockStatus = {
  itemId: string;
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD";
  unit: "G" | "ML" | "PIECE";
  availableQtyBase: number;
  reorderLevel: number | null;
  status: "LOW" | "NORMAL";
};
type StockValueRow = { valuePaise: number };
type Order = {
  id: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "DISPATCHABLE" | "DISPATCHED" | "CANCELLED";
  createdAt: string;
  customer: { name: string };
  items: { qtyBase: number; ratePaise: number }[];
};
type OrderPage = { items: Order[]; total: number };
type Run = { id: string; status: string; bomHeader: { finishedItem: { name: string } }; packSize: { finishedItem: { name: string } } | null };
type RunCost = { costPerGoodUnitPaise: number; sellingPricePaise: number | null; marginPaise: number | null } | null;

const ORDER_STATUS: Record<Order["status"], { label: string; variant: "warning" | "info" | "success" | "destructive" | "neutral" }> = {
  SUBMITTED: { label: "Waiting for approval", variant: "warning" },
  APPROVED: { label: "Needs invoice", variant: "info" },
  DISPATCHABLE: { label: "Ready to dispatch", variant: "info" },
  DISPATCHED: { label: "Dispatched", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "destructive" },
  REJECTED: { label: "Rejected", variant: "destructive" },
};

function orderCount(status: Order["status"]) {
  return {
    queryKey: ["orders", "count", status],
    queryFn: () => api.get<OrderPage>(`/orders?status=${status}`).then((p) => p.total),
  };
}

type TodoRow = { count: number; title: string; detail: string; to: string; action: string; warn?: boolean };

export default function Dashboard() {
  const { user } = useAuth();
  const canAct = user?.role === "ADMIN" || user?.role === "OWNER";

  const { data: gst } = useQuery({ queryKey: ["reports", "gst-summary", "", ""], queryFn: () => api.get<GstSummary>("/reports/gst-summary") });
  const { data: collections } = useQuery({
    queryKey: ["reports", "payments-collections"],
    queryFn: () => api.get<CollectionsRow[]>("/reports/payments-collections"),
  });
  const { data: stockValue } = useQuery({ queryKey: ["reports", "stock-summary"], queryFn: () => api.get<StockValueRow[]>("/reports/stock-summary") });
  const { data: stock } = useQuery({ queryKey: ["alerts", "stock-status"], queryFn: () => api.get<StockStatus[]>("/alerts/stock-status") });
  const { data: openChecks } = useQuery({
    queryKey: ["reconciliation", "exceptions", "OPEN", "ALL"],
    queryFn: () => api.get<unknown[]>("/reconciliation/exceptions?status=OPEN"),
  });
  const { data: recent } = useQuery({ queryKey: ["orders", "recent"], queryFn: () => api.get<OrderPage>("/orders") });
  // Cost per packet from the latest finished run: the owner's figure in the brief.
  const { data: runs } = useQuery({ queryKey: ["production-runs"], queryFn: () => api.get<Run[]>("/production-runs") });
  const lastRun = (runs ?? []).find((r) => r.status === "COMPLETED");
  const { data: lastRunCost } = useQuery({
    queryKey: ["production-run-cost-breakdown", lastRun?.id],
    queryFn: () => api.get<RunCost>(`/production-runs/${lastRun!.id}/cost-breakdown`),
    enabled: !!lastRun,
  });
  const { data: waiting = 0 } = useQuery(orderCount("SUBMITTED"));
  const { data: needInvoice = 0 } = useQuery(orderCount("APPROVED"));
  const { data: toDispatch = 0 } = useQuery(orderCount("DISPATCHABLE"));

  const owing = (collections ?? []).filter((c) => c.outstandingPaise > 0);
  const outstandingPaise = owing.reduce((sum, c) => sum + c.outstandingPaise, 0);
  const stockValuePaise = (stockValue ?? []).reduce((sum, s) => sum + s.valuePaise, 0);
  const lowItems = (stock ?? []).filter((s) => s.status === "LOW");
  const packets = (stock ?? []).filter((s) => s.type === "FINISHED_GOOD").reduce((sum, s) => sum + s.availableQtyBase, 0);

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const todo: TodoRow[] = [
    {
      count: waiting,
      title: `${plural(waiting, "order", "orders")} waiting for approval`,
      detail: "Check the quantities and approve, so the packets are set aside for the customer.",
      to: "/admin/orders",
      action: canAct ? "Approve" : "View",
    },
    {
      count: needInvoice,
      title: `${plural(needInvoice, "approved order needs", "approved orders need")} an invoice`,
      detail: "Make the GST invoice. The order can be sent out once it's invoiced.",
      to: "/admin/orders",
      action: canAct ? "Invoice" : "View",
    },
    {
      count: toDispatch,
      title: `${plural(toDispatch, "order", "orders")} ready to send out`,
      detail: "Invoiced and waiting to leave. Stock goes down when you mark it dispatched.",
      to: "/admin/dispatch",
      action: canAct ? "Dispatch" : "View",
    },
    {
      count: lowItems.length,
      title: `${plural(lowItems.length, "item is", "items are")} running low`,
      detail: lowItems.map((i) => `${i.name} (${qty(i.availableQtyBase, i.unit)} left)`).join(", "),
      to: "/admin/stock-data",
      action: canAct ? "Reorder" : "Check stock",
      warn: true,
    },
    {
      count: owing.length,
      title: `${money(outstandingPaise)} still to collect`,
      detail: owing.map((c) => `${c.customerName} ${money(c.outstandingPaise)}`).join(", "),
      to: "/admin/invoices",
      action: canAct ? "Record payment" : "View",
      warn: true,
    },
    {
      count: openChecks?.length ?? 0,
      title: `${plural(openChecks?.length ?? 0, "figure doesn't", "figures don't")} add up`,
      detail: "A stock count, invoice or payment differs from what the books expect.",
      to: "/admin/reconciliation",
      action: "Review",
    },
  ].filter((row) => row.count > 0);

  const quickActions = canAct
    ? [
        { label: "Record a purchase", to: "/admin/purchases" },
        { label: "Start a production run", to: "/production/runs" },
        { label: "Add a customer", to: "/admin/customers" },
        { label: "See reports", to: "/admin/reports" },
      ]
    : [
        { label: "Invoices & payments", to: "/admin/invoices" },
        { label: "Reports", to: "/admin/reports" },
        { label: "Activity log", to: "/admin/audit-log" },
      ];

  const figures = [
    { label: "Sales invoiced", value: money(gst?.totals.totalPaise ?? 0), sub: plural(gst?.invoiceCount ?? 0, "invoice", "invoices"), to: "/admin/invoices" },
    { label: "Still to collect", value: money(outstandingPaise), sub: outstandingPaise > 0 ? plural(owing.length, "customer", "customers") : "Everyone has paid", to: "/admin/invoices", warn: outstandingPaise > 0 },
    { label: "Packets in stock", value: packets.toLocaleString("en-IN"), sub: "Ready to sell", to: "/admin/stock-data" },
    { label: "Stock value", value: money(stockValuePaise), sub: "At average purchase cost", to: "/admin/reports" },
    {
      label: "Cost per packet",
      value: lastRunCost ? money(lastRunCost.costPerGoodUnitPaise) : "—",
      sub: !lastRun
        ? "No finished run yet"
        : lastRunCost?.marginPaise != null
          ? `Profit ${money(lastRunCost.marginPaise)} at ${money(lastRunCost.sellingPricePaise ?? 0)}`
          : `Latest ${(lastRun.packSize ?? lastRun.bomHeader).finishedItem.name} run`,
      to: "/production/runs",
      warn: (lastRunCost?.marginPaise ?? 0) < 0,
    },
  ];

  return (
    <div className="w-full min-w-0">
      <PageHeader title={`Hello, ${user?.name.split(" ")[0] ?? ""}`} description="Here's what needs doing today and how the business stands." />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-foreground">To do</h2>
            {todo.length > 0 && <span className="text-xs text-muted-foreground">{plural(todo.length, "thing", "things")} need you</span>}
          </div>
          {todo.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing is waiting on you right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {todo.map((row) => (
                <li key={row.title} className="flex items-center gap-3 py-3">
                  <span
                    className={`tabular flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      row.warn ? "bg-warning-bg text-warning" : "bg-primary/10 text-primary"
                    }`}
                  >
                    {row.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{row.title}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground" title={row.detail}>{row.detail}</span>
                  </span>
                  <Link
                    to={row.to}
                    className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-primary hover:bg-secondary"
                  >
                    {row.action}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-base font-semibold text-foreground">Shortcuts</h2>
          <div className="flex flex-col gap-2">
            {quickActions.map((a) => (
              <Link key={a.to + a.label} to={a.to} className="rounded-md bg-secondary/60 px-3 py-2.5 text-sm font-medium text-foreground hover:bg-secondary">
                {a.label}
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {figures.map((f) => (
          <Link key={f.label} to={f.to} className="block">
            <Card className="card-hover h-full px-4 py-3">
              <p className="text-sm text-muted-foreground">{f.label}</p>
              <p className={`tabular mt-0.5 text-xl font-semibold ${f.warn ? "text-warning" : "text-foreground"}`}>{f.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{f.sub}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-foreground">Stock levels</h2>
            <Link to="/admin/stock-data" className="text-sm text-primary hover:underline">All stock</Link>
          </div>
          <ul className="divide-y divide-border">
            {(stock ?? []).map((s) => (
              <li key={s.itemId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="text-foreground">{s.name}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular font-medium text-foreground">{qty(s.availableQtyBase, s.unit)}</span>
                  {s.status === "LOW" && <StatusBadge variant="warning">Low</StatusBadge>}
                </span>
              </li>
            ))}
          </ul>
          {stock?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No items yet. Add them in Setup, then record opening stock.</p>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-foreground">Latest orders</h2>
            <Link to="/admin/orders" className="text-sm text-primary hover:underline">All orders</Link>
          </div>
          {!recent || recent.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.items.slice(0, 6).map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">{o.customer.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })},{" "}
                      {money(o.items.reduce((sum, i) => sum + i.qtyBase * i.ratePaise, 0))}
                    </span>
                  </span>
                  <StatusBadge variant={ORDER_STATUS[o.status].variant}>{ORDER_STATUS[o.status].label}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
