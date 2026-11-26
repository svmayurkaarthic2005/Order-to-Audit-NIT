import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, Loading, PageHeader, StatusBadge, money } from "@/components/ui";

type Order = {
  id: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "DISPATCHABLE" | "DISPATCHED" | "CANCELLED";
  rejectionReason: string | null;
  customer: { name: string; state: string };
  salesmanUser: { name: string };
  items: { itemId: string; qtyBase: number; ratePaise: number; item: { sku: string; name: string } }[];
  // From the server: the GST the invoice would carry, and for a waiting
  // order whether stock covers it now (requested vs available).
  taxPreview: { taxableValuePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; interstate: boolean };
  stockCheck: { itemId: string; requested: number; available: number; short: number }[] | null;
};
type EditLine = { itemId: string; sku: string; name: string; qtyBase: string; ratePaise: string };

const TABS = ["SUBMITTED", "APPROVED", "REJECTED"] as const;
const STATUS_VARIANT: Record<string, "info" | "success" | "destructive" | "neutral" | "warning"> = {
  SUBMITTED: "info",
  APPROVED: "success",
  REJECTED: "destructive",
  DISPATCHABLE: "warning",
  DISPATCHED: "success",
  CANCELLED: "destructive",
} as const;

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Waiting for approval",
  APPROVED: "Approved, needs invoice",
  REJECTED: "Rejected",
  DISPATCHABLE: "Invoiced",
  DISPATCHED: "Dispatched",
  CANCELLED: "Cancelled (credit note)",
};

const TAB_LABEL: Record<(typeof TABS)[number], string> = {
  SUBMITTED: "To approve",
  APPROVED: "To invoice",
  REJECTED: "Rejected",
};

const EMPTY_TEXT: Record<(typeof TABS)[number], string> = {
  SUBMITTED: "No orders are waiting for approval.",
  APPROVED: "Every approved order has an invoice.",
  REJECTED: "No rejected orders.",
};

const TAB_ICONS = {
  SUBMITTED: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  APPROVED: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0",
  REJECTED: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0",
};

export default function OrderQueue() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("SUBMITTED");
  const [shortfallByOrder, setShortfallByOrder] = useState<Record<string, string>>({});
  const [rejectingOrderId, setRejectingOrderId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["orders", "queue", tab],
    queryFn: () => api.get<{ items: Order[] }>(`/orders?status=${tab}`),
  });

  const approveMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/orders/${orderId}/approve`, {}),
    onSuccess: (_data, orderId) => {
      setShortfallByOrder((prev) => { const { [orderId]: _removed, ...rest } = prev; return rest; });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err, orderId) => {
      if (err instanceof ApiError && err.code === "insufficient_stock") {
        const shortfall = (err.details as { shortfall?: number } | undefined)?.shortfall;
        const d = err.details as { requested?: number; available?: number } | undefined;
        setShortfallByOrder((prev) => ({ ...prev, [orderId]: `Not enough packets in stock: ${d?.requested ?? "?"} requested, ${d?.available ?? "?"} available. You're ${shortfall} short; make more or edit the order. Nothing was set aside.` }));
      } else {
        // Any other failure must show too, never leave the click looking ignored.
        setShortfallByOrder((prev) => ({ ...prev, [orderId]: err instanceof ApiError ? err.message : "Couldn't approve the order. Try again." }));
      }
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) => api.post(`/orders/${orderId}/reject`, { reason }),
    onSuccess: () => {
      setRejectingOrderId(null);
      setRejectionReason("");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ orderId, items }: { orderId: string; items: { itemId: string; qtyBase: number; ratePaise: number }[] }) =>
      api.patch(`/orders/${orderId}`, { items }),
    onSuccess: () => {
      setEditingOrderId(null);
      setEditError(null);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => setEditError(err instanceof ApiError ? err.message : "Couldn't save your changes."),
  });

  function startEditing(o: Order) {
    setEditingOrderId(o.id);
    setEditError(null);
    setEditLines(o.items.map((l) => ({ itemId: l.itemId, sku: l.item.sku, name: l.item.name, qtyBase: String(l.qtyBase), ratePaise: String(l.ratePaise / 100) })));
  }

  function saveEdits(orderId: string) {
    const items = editLines.map((l) => ({ itemId: l.itemId, qtyBase: Number(l.qtyBase), ratePaise: Math.round(Number(l.ratePaise) * 100) }));
    if (items.some((l) => !(l.qtyBase > 0))) { setEditError("Each product needs a quantity of at least 1."); return; }
    editMutation.mutate({ orderId, items });
  }

  const invoiceMutation = useMutation({
    mutationFn: (orderId: string) => api.post("/invoices", { orderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Orders"
        description="Approve orders from your salesmen, then create the invoice. Approving sets the stock aside for that customer."
        actions={
          <Link to="/admin/invoices" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            View invoices
          </Link>
        }
      />

      {/* Tab pills */}
      <div className="mb-5 overflow-x-auto">
        <div className="flex min-w-max gap-1 rounded-xl border border-border bg-secondary/50 p-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
                tab === t ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={TAB_ICONS[t]} />
              </svg>
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorText>{(error as Error).message}</ErrorText>
      ) : !data || data.items.length === 0 ? (
        <EmptyState>{EMPTY_TEXT[tab]}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((o) => {
            const total =
              editingOrderId === o.id
                ? editLines.reduce((sum, l) => sum + (Number(l.qtyBase) || 0) * Math.round((Number(l.ratePaise) || 0) * 100), 0)
                : o.items.reduce((sum, l) => sum + l.qtyBase * l.ratePaise, 0);
            return (
              <li key={o.id}>
                <Card className="overflow-hidden">
                  {/* Card header */}
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-secondary/30 px-5 py-3.5">
                    <div>
                      <p className="font-semibold text-foreground">{o.customer.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Placed by {o.salesmanUser.name}</p>
                    </div>
                    {o.stockCheck?.some((c) => c.short > 0) ? (
                      <StatusBadge variant="warning">Not enough stock</StatusBadge>
                    ) : (
                      <StatusBadge variant={STATUS_VARIANT[o.status] ?? "neutral"}>{STATUS_LABEL[o.status] ?? o.status}</StatusBadge>
                    )}
                  </div>

                  {/* Card body */}
                  <div className="px-5 py-4">
                    {editingOrderId === o.id ? (
                      <ul className="mb-3 flex flex-col gap-2">
                        {editLines.map((l, i) => (
                          <li key={l.itemId} className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 flex-1 truncate text-foreground">
                              {l.name}
                            </span>
                            <Input
                              type="number"
                              value={l.qtyBase}
                              onChange={(e) => setEditLines((prev) => prev.map((p, idx) => (idx === i ? { ...p, qtyBase: e.target.value } : p)))}
                              className="h-8 w-20 text-right"
                              aria-label={`Quantity of ${l.name}`}
                            />
                            <span className="text-muted-foreground">×</span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={l.ratePaise}
                              onChange={(e) => setEditLines((prev) => prev.map((p, idx) => (idx === i ? { ...p, ratePaise: e.target.value } : p)))}
                              className="h-8 w-24 text-right"
                              aria-label={`Price per packet in rupees for ${l.name}`}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <ul className="mb-3 flex flex-col gap-1.5">
                        {o.items.map((l, i) => (
                          <li key={i} className="flex items-center justify-between gap-4 text-sm">
                            <span className="text-foreground">
                              {l.item.name}
                            </span>
                            <span className="tabular shrink-0 font-medium text-foreground">
                              {l.qtyBase} × {money(l.ratePaise)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="flex items-center justify-between border-t border-border/60 pt-3">
                      <span className="text-sm text-muted-foreground">Total before tax</span>
                      <span className="tabular text-base font-bold text-foreground">{money(total)}</span>
                    </div>
                    <p className="tabular mt-1 text-right text-xs text-muted-foreground">
                      {o.taxPreview.interstate
                        ? `If invoiced: IGST ${money(o.taxPreview.igstPaise)} (${o.customer.state} is outside the factory's state), total ${money(o.taxPreview.totalPaise)}`
                        : `If invoiced: CGST ${money(o.taxPreview.cgstPaise)} + SGST ${money(o.taxPreview.sgstPaise)}, total ${money(o.taxPreview.totalPaise)}`}
                    </p>

                    {o.stockCheck?.filter((c) => c.short > 0).map((c) => {
                      const name = o.items.find((l) => l.itemId === c.itemId)?.item.name ?? "Product";
                      return (
                        <div key={c.itemId} className="mt-3 grid grid-cols-3 gap-2 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-center text-sm">
                          <div><p className="text-xs text-muted-foreground">{name} requested</p><p className="tabular font-semibold text-foreground">{c.requested}</p></div>
                          <div><p className="text-xs text-muted-foreground">Available now</p><p className="tabular font-semibold text-foreground">{c.available}</p></div>
                          <div><p className="text-xs text-muted-foreground">Short by</p><p className="tabular font-semibold text-warning">{c.short}</p></div>
                        </div>
                      );
                    })}

                    {editingOrderId === o.id && editError && <div className="mt-3"><ErrorText>{editError}</ErrorText></div>}

                    {o.rejectionReason && (
                      <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive-bg px-3 py-2 text-sm text-destructive">
                        Rejected: {o.rejectionReason}
                      </div>
                    )}
                    {shortfallByOrder[o.id] && <div className="mt-3"><ErrorText>{shortfallByOrder[o.id]}</ErrorText></div>}

                    {/* Actions */}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {canMutate && o.status === "SUBMITTED" && editingOrderId === o.id && (
                        <>
                          <Button size="sm" onClick={() => saveEdits(o.id)} disabled={editMutation.isPending}>
                            {editMutation.isPending ? "Saving…" : "Save changes"}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditingOrderId(null)}>
                            Cancel
                          </Button>
                        </>
                      )}
                      {canMutate && o.status === "SUBMITTED" && editingOrderId !== o.id && (
                        <>
                          <Button size="sm" onClick={() => approveMutation.mutate(o.id)} disabled={approveMutation.isPending}>
                            {approveMutation.isPending && approveMutation.variables === o.id ? "Approving…" : "Approve"}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => startEditing(o)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setRejectingOrderId(o.id)}>
                            Reject
                          </Button>
                        </>
                      )}
                      {canMutate && o.status === "APPROVED" && (
                        <Button size="sm" onClick={() => invoiceMutation.mutate(o.id)} disabled={invoiceMutation.isPending}>
                          {invoiceMutation.isPending && invoiceMutation.variables === o.id ? "Creating invoice…" : "Create invoice"}
                        </Button>
                      )}
                    </div>

                    {canMutate && rejectingOrderId === o.id && (
                      <form
                        onSubmit={(e) => { e.preventDefault(); rejectMutation.mutate({ orderId: o.id, reason: rejectionReason }); }}
                        className="mt-3 flex gap-2"
                      >
                        <Input
                          placeholder="Why are you rejecting it? The salesman will see this."
                          required
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          className="h-9 flex-1"
                        />
                        <Button type="submit" size="sm" variant="destructive">Reject order</Button>
                      </form>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
