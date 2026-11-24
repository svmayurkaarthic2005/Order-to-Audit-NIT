import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, PageHeader, money } from "@/components/ui";

type Invoice = {
  id: string;
  financialYear: string;
  invoiceNumber: number;
  status: "ISSUED" | "CANCELLED";
  totalPaise: number;
  customer: { name: string };
};

export default function Payments() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const queryClient = useQueryClient();
  const [amountByInvoice, setAmountByInvoice] = useState<Record<string, string>>({});
  const [errorByInvoice, setErrorByInvoice] = useState<Record<string, string>>({});
  const [outstandingByInvoice, setOutstandingByInvoice] = useState<Record<string, number>>({});

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => api.get<Invoice[]>("/invoices"),
  });

  const paymentMutation = useMutation({
    mutationFn: ({ invoiceId, amountPaise }: { invoiceId: string; amountPaise: number }) =>
      api.post<{ outstandingPaise: number }>("/payments", { invoiceId, amountPaise }),
    onSuccess: (data, { invoiceId }) => {
      setErrorByInvoice((prev) => {
        const { [invoiceId]: _removed, ...rest } = prev;
        return rest;
      });
      setOutstandingByInvoice((prev) => ({ ...prev, [invoiceId]: data.outstandingPaise }));
      setAmountByInvoice((prev) => ({ ...prev, [invoiceId]: "" }));
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err, { invoiceId }) => {
      setErrorByInvoice((prev) => ({
        ...prev,
        [invoiceId]: err instanceof ApiError ? err.message : "Failed to record payment",
      }));
    },
  });

  const issued = invoices?.filter((inv) => inv.status === "ISSUED") ?? [];

  return (
    <div>
      <PageHeader title="Payments" description="Record customer receipts against issued invoices." />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : issued.length === 0 ? (
        <EmptyState>No invoices awaiting payment.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {issued.map((inv) => {
            const outstanding = outstandingByInvoice[inv.id];
            return (
              <li key={inv.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">
                      FY {inv.financialYear} / #{inv.invoiceNumber} — {inv.customer.name}
                    </p>
                    <p className="text-sm tabular text-muted-foreground">
                      Total <span className="font-medium text-foreground">{money(inv.totalPaise)}</span>
                      {outstanding !== undefined && (
                        <>
                          {" "}
                          · Outstanding <span className="font-medium text-warning">{money(outstanding)}</span>
                        </>
                      )}
                    </p>
                  </div>
                  {canMutate && (
                    <div className="mt-3 flex items-center gap-2">
                      <Input
                        placeholder="Amount (paise)"
                        type="number"
                        value={amountByInvoice[inv.id] ?? ""}
                        onChange={(e) => setAmountByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                        className="h-8 w-36 text-sm"
                      />
                      <Button
                        size="sm"
                        onClick={() =>
                          paymentMutation.mutate({ invoiceId: inv.id, amountPaise: Number(amountByInvoice[inv.id] || 0) })
                        }
                        disabled={paymentMutation.isPending}
                      >
                        Record payment
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
