import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, PageHeader, StatusBadge } from "@/components/ui";

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
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
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
  const issued = invoices?.filter((inv) => inv.status === "ISSUED") ?? [];

  return (
    <div>
      <PageHeader title="Dispatch" description="Ship issued invoices and record what left the warehouse." />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : issued.length === 0 ? (
        <EmptyState>No invoices awaiting dispatch.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {issued.map((inv) => {
            const dispatched = dispatchedInvoiceIds.has(inv.id);
            return (
              <li key={inv.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-foreground">
                      FY {inv.financialYear} / #{inv.invoiceNumber} — {inv.customer.name}
                    </p>
                    {dispatched ? (
                      <StatusBadge variant="success">Dispatched</StatusBadge>
                    ) : (
                      <StatusBadge variant="warning">Pending</StatusBadge>
                    )}
                  </div>
                  <ul className="mt-2 text-sm text-muted-foreground">
                    {inv.items.map((l, i) => (
                      <li key={i} className="flex justify-between">
                        <span>{l.description}</span>
                        <span className="tabular">{l.qtyBase}</span>
                      </li>
                    ))}
                  </ul>
                  {!dispatched && canMutate && (
                    <div className="mt-3 flex items-center gap-2">
                      <Input
                        placeholder="Qty"
                        type="number"
                        value={qtyByInvoice[inv.id] ?? ""}
                        onChange={(e) => setQtyByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                        className="h-8 w-24 text-sm"
                      />
                      <Button
                        size="sm"
                        onClick={() => dispatchMutation.mutate({ invoiceId: inv.id, qty: Number(qtyByInvoice[inv.id] || 0) })}
                        disabled={dispatchMutation.isPending}
                      >
                        Dispatch
                      </Button>
                    </div>
                  )}
                  {errorByInvoice[inv.id] && <div className="mt-2"><ErrorText>{errorByInvoice[inv.id]}</ErrorText></div>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
