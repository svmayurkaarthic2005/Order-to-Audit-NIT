import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";

type Invoice = {
  id: string;
  financialYear: string;
  invoiceNumber: number;
  status: "ISSUED" | "CANCELLED";
  totalPaise: number;
  customer: { name: string };
  items: { description: string; qtyBase: number }[];
};

type Dispatch = { id: string; qtyBase: number; dispatchedAt: string; invoice: { id: string } };

export default function Dispatch() {
  const queryClient = useQueryClient();
  const [qtyByInvoice, setQtyByInvoice] = useState<Record<string, string>>({});
  const [errorByInvoice, setErrorByInvoice] = useState<Record<string, string>>({});

  const { data: invoices, isLoading } = useQuery({
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
      setErrorByInvoice((prev) => {
        const { [invoiceId]: _removed, ...rest } = prev;
        return rest;
      });
      queryClient.invalidateQueries({ queryKey: ["dispatches"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err, { invoiceId }) => {
      setErrorByInvoice((prev) => ({
        ...prev,
        [invoiceId]: err instanceof ApiError ? err.message : "Failed to dispatch",
      }));
    },
  });

  const dispatchedInvoiceIds = new Set(dispatches?.map((d) => d.invoice.id));

  return (
    <main className="mx-auto max-w-2xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">Dispatch</h1>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !invoices || invoices.length === 0 ? (
        <p className="text-muted-foreground">No invoices yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {invoices
            .filter((inv) => inv.status === "ISSUED")
            .map((inv) => {
              const dispatched = dispatchedInvoiceIds.has(inv.id);
              return (
                <li key={inv.id} className="rounded border border-border p-3">
                  <p className="font-medium">
                    FY {inv.financialYear} / #{inv.invoiceNumber} — {inv.customer.name}
                  </p>
                  <ul className="ml-4 list-disc text-sm text-muted-foreground">
                    {inv.items.map((l, i) => (
                      <li key={i}>
                        {l.description}: {l.qtyBase}
                      </li>
                    ))}
                  </ul>
                  {dispatched ? (
                    <p className="mt-2 text-sm text-primary">Dispatched</p>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        placeholder="Qty"
                        type="number"
                        value={qtyByInvoice[inv.id] ?? ""}
                        onChange={(e) => setQtyByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                        className="w-24 rounded border border-input bg-transparent px-2 py-1 text-sm"
                      />
                      <button
                        onClick={() => dispatchMutation.mutate({ invoiceId: inv.id, qty: Number(qtyByInvoice[inv.id] || 0) })}
                        disabled={dispatchMutation.isPending}
                        className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
                      >
                        Dispatch
                      </button>
                    </div>
                  )}
                  {errorByInvoice[inv.id] && <p className="mt-1 text-sm text-destructive">{errorByInvoice[inv.id]}</p>}
                </li>
              );
            })}
        </ul>
      )}
    </main>
  );
}
