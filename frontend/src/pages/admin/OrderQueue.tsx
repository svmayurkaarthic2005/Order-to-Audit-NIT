import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, PageHeader, StatusBadge, money } from "@/components/ui";

type Order = {
  id: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "DISPATCHABLE" | "DISPATCHED";
  rejectionReason: string | null;
  customer: { name: string };
  salesmanUser: { name: string };
  items: { qtyBase: number; ratePaise: number; item: { sku: string; name: string } }[];
};

const TABS = ["SUBMITTED", "APPROVED", "REJECTED"] as const;
const STATUS_VARIANT = { SUBMITTED: "info", APPROVED: "success", REJECTED: "destructive" } as const;

export default function OrderQueue() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("SUBMITTED");
  const [shortfallByOrder, setShortfallByOrder] = useState<Record<string, string>>({});
  const [rejectingOrderId, setRejectingOrderId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "queue", tab],
    queryFn: () => api.get<{ items: Order[] }>(`/orders?status=${tab}`),
  });

  const approveMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/orders/${orderId}/approve`, {}),
    onSuccess: (_data, orderId) => {
      setShortfallByOrder((prev) => {
        const { [orderId]: _removed, ...rest } = prev;
        return rest;
      });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err, orderId) => {
      if (err instanceof ApiError && err.code === "insufficient_stock") {
        const shortfall = (err.details as { shortfall?: number } | undefined)?.shortfall;
        setShortfallByOrder((prev) => ({ ...prev, [orderId]: `Not enough stock — short by ${shortfall} units.` }));
      }
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      api.post(`/orders/${orderId}/reject`, { reason }),
    onSuccess: () => {
      setRejectingOrderId(null);
      setRejectionReason("");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const invoiceMutation = useMutation({
    mutationFn: (orderId: string) => api.post("/invoices", { orderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  return (
    <div>
      <PageHeader
        title="Order queue"
        description="Review, approve and invoice sales orders."
        actions={
          <Link to="/admin/invoices" className="text-sm text-primary underline-offset-4 hover:underline">
            View invoices →
          </Link>
        }
      />

      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm transition-colors ${
              tab === t ? "border-b-2 border-primary font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <EmptyState>No {tab.toLowerCase()} orders.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((o) => {
            const total = o.items.reduce((sum, l) => sum + l.qtyBase * l.ratePaise, 0);
            return (
              <li key={o.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">{o.customer.name}</p>
                      <p className="text-xs text-muted-foreground">by {o.salesmanUser.name}</p>
                    </div>
                    <StatusBadge variant={STATUS_VARIANT[o.status] ?? "neutral"}>{o.status}</StatusBadge>
                  </div>
                  <ul className="mt-2 text-sm text-muted-foreground">
                    {o.items.map((l, i) => (
                      <li key={i} className="flex justify-between">
                        <span>
                          {l.item.sku} — {l.item.name}
                        </span>
                        <span className="tabular">{l.qtyBase}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm font-medium tabular text-foreground">Total: {money(total)}</p>
                  {o.rejectionReason && <p className="mt-1 text-sm text-destructive">Rejected: {o.rejectionReason}</p>}

                  {shortfallByOrder[o.id] && <div className="mt-2"><ErrorText>{shortfallByOrder[o.id]}</ErrorText></div>}

                  {canMutate && o.status === "SUBMITTED" && (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => approveMutation.mutate(o.id)}
                        disabled={approveMutation.isPending}
                      >
                        {approveMutation.isPending && approveMutation.variables === o.id ? "Approving…" : "Approve"}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setRejectingOrderId(o.id)}>
                        Reject
                      </Button>
                    </div>
                  )}

                  {canMutate && o.status === "APPROVED" && (
                    <div className="mt-3">
                      <Button size="sm" onClick={() => invoiceMutation.mutate(o.id)} disabled={invoiceMutation.isPending}>
                        {invoiceMutation.isPending && invoiceMutation.variables === o.id ? "Creating invoice…" : "Create invoice"}
                      </Button>
                    </div>
                  )}

                  {canMutate && rejectingOrderId === o.id && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        rejectMutation.mutate({ orderId: o.id, reason: rejectionReason });
                      }}
                      className="mt-3 flex gap-2"
                    >
                      <Input
                        placeholder="Reason"
                        required
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        className="h-8 flex-1 text-sm"
                      />
                      <Button type="submit" size="sm" variant="destructive">
                        Confirm
                      </Button>
                    </form>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
