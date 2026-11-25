import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Card, EmptyState, ErrorText, LinkButton, Loading, PageHeader, Select, StatusBadge, money } from "@/components/ui";

type Order = {
  id: string;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
  customer: { name: string };
  items: { qtyBase: number; ratePaise: number; item: { sku: string; name: string } }[];
};

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  DISPATCHABLE: "Invoiced",
  DISPATCHED: "Dispatched",
};

const STATUS_VARIANT: Record<string, "neutral" | "success" | "warning" | "destructive" | "info"> = {
  SUBMITTED: "info",
  APPROVED: "success",
  REJECTED: "destructive",
  DISPATCHABLE: "warning",
  DISPATCHED: "success",
};

export default function OrderHistory() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.get<{ items: Order[] }>("/orders"),
  });
  const [customerFilter, setCustomerFilter] = useState("");

  const customerNames = useMemo(
    () => [...new Set(data?.items.map((o) => o.customer.name) ?? [])].sort(),
    [data],
  );
  const visibleOrders = customerFilter ? data?.items.filter((o) => o.customer.name === customerFilter) : data?.items;
  // Customer-wise sales: what this salesman has sold to the chosen customer,
  // counting only orders that weren't rejected.
  const customerTotal = (visibleOrders ?? [])
    .filter((o) => o.status !== "REJECTED")
    .reduce((sum, o) => sum + o.items.reduce((s, l) => s + l.qtyBase * l.ratePaise, 0), 0);

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="My orders"
        description="Orders you've placed and where each one is now."
        actions={
          <LinkButton to="/salesman/orders/new">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4v16m8-8H4" />
            </svg>
            New order
          </LinkButton>
        }
      />

      {isLoading ? (
        <Loading />
      ) : error ? (
        <div className="mt-4">
          <ErrorText>{(error as Error).message}</ErrorText>
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="mt-4">
          <EmptyState>No orders yet. Submit your first one above.</EmptyState>
        </div>
      ) : (
        <>
          {customerNames.length > 1 && (
            <Select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} className="mb-2 w-full">
              <option value="">All customers</option>
              {customerNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </Select>
          )}
          <p className="mb-4 text-sm text-muted-foreground">
            {customerFilter ? `Sold to ${customerFilter}` : "Total sold"}:{" "}
            <span className="tabular font-semibold text-foreground">{money(customerTotal)}</span>
            <span className="ml-1">(rejected orders not counted)</span>
          </p>
          {visibleOrders && visibleOrders.length === 0 ? (
            <EmptyState>No orders for this customer.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {visibleOrders?.map((o) => {
                const total = o.items.reduce((sum, l) => sum + l.qtyBase * l.ratePaise, 0);
                return (
                  <li key={o.id}>
                    <Card className="overflow-hidden transition-shadow hover:shadow-md">
                      <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-secondary/30 px-4 py-3.5">
                        <div>
                          <p className="font-semibold text-foreground">{o.customer.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </div>
                        <StatusBadge variant={STATUS_VARIANT[o.status] ?? "neutral"}>{STATUS_LABEL[o.status] ?? o.status}</StatusBadge>
                      </div>
                      <div className="px-4 py-3">
                        <ul className="mb-2 space-y-1">
                          {o.items.map((l, i) => (
                            <li key={i} className="flex items-center justify-between text-sm">
                              <span className="text-foreground">
                                {l.item.name}
                              </span>
                              <span className="tabular shrink-0 text-muted-foreground">{l.qtyBase} {l.qtyBase === 1 ? "packet" : "packets"}</span>
                            </li>
                          ))}
                        </ul>
                        {o.status === "REJECTED" && o.rejectionReason && (
                          <p className="mb-2 rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">
                            Why it was rejected: {o.rejectionReason}
                          </p>
                        )}
                        <div className="flex items-center justify-between border-t border-border/50 pt-2.5">
                          <span className="text-xs text-muted-foreground">
                            {o.items.length} item{o.items.length !== 1 ? "s" : ""}
                          </span>
                          <span className="tabular text-sm font-bold text-foreground">{money(total)}</span>
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
