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
type StockValueRow = { qtyBase: number; movingAverageCostPaise: number | null };
type Order = {
  id: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "DISPATCHABLE" | "DISPATCHED";
  createdAt: string;
  customer: { name: string };
  items: { qtyBase: number; ratePaise: number }[];
};
type OrderPage = { items: Order[]; total: number };

const ORDER_STATUS: Record<Order["status"], { label: string; variant: "warning" | "info" | "success" | "destructive" | "neutral" }> = {
  SUBMITTED: { label: "Waiting for approval", variant: "warning" },
  APPROVED: { label: "Needs invoice", variant: "info" },
  DISPATCHABLE: { label: "Ready to dispatch", variant: "info" },
  DISPATCHED: { label: "Dispatched", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
};

function orderCount(status: Order["status"]) {
  return {
    queryKey: ["orders", "count", status],
    queryFn: () => api.get<OrderPage>(`/orders?status=${status}`).then((p) => p.total),
  };
}

type TodoRow = { count: number; text: string; to: string; action: string };

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
  const { data: waiting = 0 } = useQuery(orderCount("SUBMITTED"));
  const { data: needInvoice = 0 } = useQuery(orderCount("APPROVED"));
  const { data: toDispatch = 0 } = useQuery(orderCount("DISPATCHABLE"));

  const owing = (collections ?? []).filter((c) => c.outstandingPaise > 0);
  const outstandingPaise = owing.reduce((sum, c) => sum + c.outstandingPaise, 0);
  const stockValuePaise = (stockValue ?? []).reduce((sum, s) => sum + s.qtyBase * (s.movingAverageCostPaise ?? 0), 0);
  const lowItems = (stock ?? []).filter((s) => s.status === "LOW");
  const packets = (stock ?? []).filter((s) => s.type === "FINISHED_GOOD").reduce((sum, s) => sum + s.availableQtyBase, 0);

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const todo: TodoRow[] = [
    { count: waiting, text: `${plural(waiting, "order is", "orders are")} waiting for approval`, to: "/admin/orders", action: canAct ? "Approve" : "View" },
    { count: needInvoice, text: `${plural(needInvoice, "approved order needs", "approved orders need")} an invoice`, to: "/admin/orders", action: canAct ? "Invoice" : "View" },
    { count: toDispatch, text: `${plural(toDispatch, "order is", "orders are")} invoiced and ready to send out`, to: "/admin/dispatch", action: canAct ? "Dispatch" : "View" },
    {
      count: lowItems.length,
      text: `Running low: ${lowItems.map((i) => i.name).join(", ")}`,
      to: "/admin/stock-data",
      action: "Check stock",
    },
    {
      count: owing.length,
      text: `${money(outstandingPaise)} still to collect from ${owing.map((c) => c.customerName).join(", ")}`,
      to: "/admin/invoices",
      action: canAct ? "Record payment" : "View",
    },
    {
      count: openChecks?.length ?? 0,
      text: `${plural(openChecks?.length ?? 0, "number doesn't", "numbers don't")} add up and need a look`,
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
  ];

  return (
    <div className="w-full min-w-0">
      <PageHeader title={`Hello, ${user?.name.split(" ")[0] ?? ""}`} description="Here's what needs doing today and how the business stands." />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 text-base font-semibold text-foreground">To do</h2>
          {todo.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing is waiting on you right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {todo.map((row) => (
                <li key={row.text} className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-foreground">{row.text}</span>
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

        <Card className="p-5">
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

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {figures.map((f) => (
          <Link key={f.label} to={f.to} className="block">
            <Card className="card-hover h-full p-4">
              <p className="text-sm text-muted-foreground">{f.label}</p>
              <p className={`tabular mt-1 text-2xl font-bold ${f.warn ? "text-warning" : "text-foreground"}`}>{f.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{f.sub}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
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
        </Card>

        <Card className="p-5">
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
