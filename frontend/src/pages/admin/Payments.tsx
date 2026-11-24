import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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

  return (
    <main className="mx-auto max-w-2xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">Payments</h1>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !invoices || invoices.length === 0 ? (
        <p className="text-muted-foreground">No invoices yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {invoices
            .filter((inv) => inv.status === "ISSUED")
            .map((inv) => (
              <li key={inv.id} className="rounded border border-border p-3">
                <p className="font-medium">
                  FY {inv.financialYear} / #{inv.invoiceNumber} — {inv.customer.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  Total ₹{(inv.totalPaise / 100).toFixed(2)}
                  {outstandingByInvoice[inv.id] !== undefined && (
                    <> · Outstanding ₹{(outstandingByInvoice[inv.id] / 100).toFixed(2)}</>
                  )}
                </p>
                {canMutate && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      placeholder="Amount (paise)"
                      type="number"
                      value={amountByInvoice[inv.id] ?? ""}
                      onChange={(e) => setAmountByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                      className="w-36 rounded border border-input bg-transparent px-2 py-1 text-sm"
                    />
                    <button
                      onClick={() =>
                        paymentMutation.mutate({ invoiceId: inv.id, amountPaise: Number(amountByInvoice[inv.id] || 0) })
                      }
                      disabled={paymentMutation.isPending}
                      className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
                    >
                      Record payment
                    </button>
                  </div>
                )}
                {errorByInvoice[inv.id] && <p className="mt-1 text-sm text-destructive">{errorByInvoice[inv.id]}</p>}
              </li>
            ))}
        </ul>
      )}
    </main>
  );
}
