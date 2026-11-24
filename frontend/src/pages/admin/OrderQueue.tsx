import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Order = {
  id: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "DISPATCHABLE" | "DISPATCHED";
  rejectionReason: string | null;
  customer: { name: string };
  salesmanUser: { name: string };
  items: { qtyBase: number; ratePaise: number; item: { sku: string; name: string } }[];
};

const TABS = ["SUBMITTED", "APPROVED", "REJECTED"] as const;

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
    <main className="mx-auto max-w-2xl p-6 text-foreground">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Order Queue</h1>
        <Link to="/admin/invoices" className="text-sm text-primary underline">
          Invoices
        </Link>
      </div>

      <div className="mb-4 flex gap-2 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm ${tab === t ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-muted-foreground">No {tab.toLowerCase()} orders.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((o) => {
            const total = o.items.reduce((sum, l) => sum + l.qtyBase * l.ratePaise, 0);
            return (
              <li key={o.id} className="rounded border border-border p-3">
                <p className="font-medium">
                  {o.customer.name} · by {o.salesmanUser.name}
                </p>
                <ul className="ml-4 list-disc text-sm text-muted-foreground">
                  {o.items.map((l, i) => (
                    <li key={i}>
                      {l.item.sku} — {l.item.name}: {l.qtyBase}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-sm">Total: ₹{(total / 100).toFixed(2)}</p>
                {o.rejectionReason && <p className="mt-1 text-sm text-destructive">Rejected: {o.rejectionReason}</p>}

                {shortfallByOrder[o.id] && (
                  <p className="mt-2 rounded bg-destructive/10 p-2 text-sm text-destructive">{shortfallByOrder[o.id]}</p>
                )}

                {canMutate && o.status === "SUBMITTED" && (
                  <div className="mt-2 flex gap-3 text-sm">
                    <button
                      onClick={() => approveMutation.mutate(o.id)}
                      disabled={approveMutation.isPending}
                      className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
                    >
                      {approveMutation.isPending && approveMutation.variables === o.id ? "Approving…" : "Approve"}
                    </button>
                    <button onClick={() => setRejectingOrderId(o.id)} className="text-destructive underline">
                      Reject
                    </button>
                  </div>
                )}

                {canMutate && o.status === "APPROVED" && (
                  <div className="mt-2 flex gap-3 text-sm">
                    <button
                      onClick={() => invoiceMutation.mutate(o.id)}
                      disabled={invoiceMutation.isPending}
                      className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
                    >
                      {invoiceMutation.isPending && invoiceMutation.variables === o.id ? "Creating invoice…" : "Create invoice"}
                    </button>
                  </div>
                )}

                {canMutate && rejectingOrderId === o.id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      rejectMutation.mutate({ orderId: o.id, reason: rejectionReason });
                    }}
                    className="mt-2 flex gap-2"
                  >
                    <input
                      placeholder="Reason"
                      required
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      className="flex-1 rounded border border-input bg-transparent px-2 py-1 text-sm"
                    />
                    <button type="submit" className="rounded bg-destructive px-3 py-1 text-sm text-destructive-foreground">
                      Confirm
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
