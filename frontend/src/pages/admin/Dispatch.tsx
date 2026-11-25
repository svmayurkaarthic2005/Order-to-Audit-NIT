import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, Loading, PageHeader, StatusBadge } from "@/components/ui";

type Invoice = {
  id: string;
  financialYear: string;
  invoiceNumber: number;
  status: "ISSUED" | "CANCELLED";
  customer: { name: string };
  items: { description: string; qtyBase: number }[];
};

type Dispatch = { id: string; qtyBase: number; dispatchedAt: string; invoice: { id: string } };

const packets = (n: number) => `${n.toLocaleString("en-IN")} ${n === 1 ? "packet" : "packets"}`;

export default function Dispatch() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const queryClient = useQueryClient();
  const [qtyByInvoice, setQtyByInvoice] = useState<Record<string, string>>({});
  const [errorByInvoice, setErrorByInvoice] = useState<Record<string, string>>({});

  const { data: invoices, isLoading, error } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => api.get<Invoice[]>("/invoices"),
  });
  const { data: dispatches } = useQuery({
    queryKey: ["dispatches"],
    queryFn: () => api.get<Dispatch[]>("/dispatches"),
  });

  const dispatchMutation = useMutation({
    mutationFn: ({ invoiceId, qty }: { invoiceId: string; qty: number }) => api.post("/dispatches", { invoiceId, qty }),
    onSuccess: (_data, { invoiceId }) => {
      setErrorByInvoice((prev) => { const { [invoiceId]: _removed, ...rest } = prev; return rest; });
      queryClient.invalidateQueries({ queryKey: ["dispatches"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["alerts", "stock-status"] });
    },
    onError: (err, { invoiceId }) => {
      setErrorByInvoice((prev) => ({ ...prev, [invoiceId]: err instanceof ApiError ? err.message : "Couldn't record the dispatch." }));
    },
  });

  const dispatchByInvoice = new Map(dispatches?.map((d) => [d.invoice.id, d]));
  // Not yet sent first, then the ones already gone.
  const issued = (invoices?.filter((inv) => inv.status === "ISSUED") ?? []).sort(
    (a, b) => Number(dispatchByInvoice.has(a.id)) - Number(dispatchByInvoice.has(b.id)),
  );

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Dispatch"
        description="Record goods leaving the factory for orders that have an invoice. Stock goes down when you save."
      />

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorText>{(error as Error).message}</ErrorText>
      ) : issued.length === 0 ? (
        <EmptyState>Nothing to send yet. Invoices appear here once an approved order has been invoiced.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {issued.map((inv) => {
            const dispatch = dispatchByInvoice.get(inv.id);
            const invoiced = inv.items.reduce((sum, l) => sum + l.qtyBase, 0);
            const qty = qtyByInvoice[inv.id] ?? String(invoiced);
            return (
              <li key={inv.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                    <div>
                      <p className="text-base font-semibold text-foreground">
                        {inv.customer.name}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">Invoice #{inv.invoiceNumber}</span>
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {inv.items.map((l) => `${l.description}: ${packets(l.qtyBase)}`).join(", ")}
                      </p>
                    </div>
                    {dispatch ? (
                      <StatusBadge variant="success">
                        Sent {new Date(dispatch.dispatchedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </StatusBadge>
                    ) : (
                      <StatusBadge variant="warning">Not sent yet</StatusBadge>
                    )}
                  </div>

                  {!dispatch && canMutate && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/40 px-5 py-3">
                      <label className="text-sm text-muted-foreground" htmlFor={`qty-${inv.id}`}>
                        Packets going out
                      </label>
                      <Input
                        id={`qty-${inv.id}`}
                        type="number"
                        min="1"
                        max={invoiced}
                        value={qty}
                        onChange={(e) => setQtyByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                        className="h-8 w-24"
                      />
                      <Button
                        size="sm"
                        onClick={() => dispatchMutation.mutate({ invoiceId: inv.id, qty: Number(qty || 0) })}
                        disabled={dispatchMutation.isPending}
                      >
                        Record dispatch
                      </Button>
                    </div>
                  )}
                  {errorByInvoice[inv.id] && <div className="px-5 pb-3"><ErrorText>{errorByInvoice[inv.id]}</ErrorText></div>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
