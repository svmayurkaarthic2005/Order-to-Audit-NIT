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
    },
    onError: (err, { invoiceId }) => {
      setErrorByInvoice((prev) => ({ ...prev, [invoiceId]: err instanceof ApiError ? err.message : "Failed to dispatch" }));
    },
  });

  const dispatchedInvoiceIds = new Set(dispatches?.map((d) => d.invoice.id));
  const issued = invoices?.filter((inv) => inv.status === "ISSUED") ?? [];

  return (
    <div className="w-full min-w-0">
      <PageHeader title="Dispatch" description="Send out orders that have an invoice. Stock goes down when you record a dispatch." />

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorText>{(error as Error).message}</ErrorText>
      ) : issued.length === 0 ? (
        <EmptyState>No invoices awaiting dispatch.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {issued.map((inv) => {
            const dispatched = dispatchedInvoiceIds.has(inv.id);
            return (
              <li key={inv.id}>
                <Card className="overflow-hidden">
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-secondary/30 px-5 py-4">
                    <div>
                      <p className="font-semibold text-foreground">
                        FY {inv.financialYear} · #{inv.invoiceNumber}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{inv.customer.name}</p>
                    </div>
                    <StatusBadge variant={dispatched ? "success" : "warning"}>
                      {dispatched ? "Dispatched" : "Pending"}
                    </StatusBadge>
                  </div>
                  <div className="px-5 py-4">
                    <ul className="mb-3 flex flex-col gap-1.5">
                      {inv.items.map((l, i) => (
                        <li key={i} className="flex items-center justify-between text-sm">
                          <span className="text-foreground">{l.description}</span>
                          <span className="tabular font-medium text-foreground">{l.qtyBase.toLocaleString("en-IN")}</span>
                        </li>
                      ))}
                    </ul>
                    {!dispatched && canMutate && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                        <Input
                          placeholder="Qty to dispatch"
                          type="number"
                          value={qtyByInvoice[inv.id] ?? ""}
                          onChange={(e) => setQtyByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                          className="h-9 w-44 sm:w-48"
                        />
                        <Button
                          size="sm"
                          onClick={() => dispatchMutation.mutate({ invoiceId: inv.id, qty: Number(qtyByInvoice[inv.id] || 0) })}
                          disabled={dispatchMutation.isPending}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                          Dispatch
                        </Button>
                      </div>
                    )}
                    {errorByInvoice[inv.id] && <div className="mt-2"><ErrorText>{errorByInvoice[inv.id]}</ErrorText></div>}
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
