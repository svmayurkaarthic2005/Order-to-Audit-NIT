import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, EmptyState, LinkButton, PageHeader, StatusBadge, money } from "@/components/ui";

type Order = {
  id: string;
  status: string;
  createdAt: string;
  customer: { name: string };
  items: { qtyBase: number; ratePaise: number; item: { sku: string; name: string } }[];
};

const STATUS_VARIANT: Record<string, "neutral" | "success" | "warning" | "destructive" | "info"> = {
  SUBMITTED: "info",
  APPROVED: "success",
  REJECTED: "destructive",
  DISPATCHABLE: "warning",
  DISPATCHED: "success",
};

export default function OrderHistory() {
  const { data, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.get<{ items: Order[] }>("/orders"),
  });

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title="My orders"
        actions={<LinkButton to="/salesman/orders/new">+ New order</LinkButton>}
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <EmptyState>No orders yet. Submit your first one.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((o) => {
            const total = o.items.reduce((sum, l) => sum + l.qtyBase * l.ratePaise, 0);
            return (
              <li key={o.id}>
                <Card className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-foreground">{o.customer.name}</p>
                    <StatusBadge variant={STATUS_VARIANT[o.status] ?? "neutral"}>{o.status}</StatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {o.items.length} item{o.items.length !== 1 ? "s" : ""} · <span className="tabular">{money(total)}</span>
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
