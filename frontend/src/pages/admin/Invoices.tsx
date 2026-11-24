import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";

type Invoice = {
  id: string;
  financialYear: string;
  invoiceNumber: number;
  status: "ISSUED" | "CANCELLED";
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  customer: { name: string; state: string };
  items: { description: string; qtyBase: number; ratePaise: number }[];
  creditNotes: { reason: string; amountPaise: number }[];
};

export default function Invoices() {
  const queryClient = useQueryClient();
  const [creditNoteInvoiceId, setCreditNoteInvoiceId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [whatsappNumberByInvoice, setWhatsappNumberByInvoice] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => api.get<Invoice[]>("/invoices"),
  });

  const pdfMutation = useMutation({
    mutationFn: (invoiceId: string) => api.get<{ url: string }>(`/invoices/${invoiceId}/pdf`),
  });

  // The PDF URL is only known after an async request, but window.open must
  // run synchronously within the click handler or popup blockers silently
  // swallow it — so the tab is opened immediately and pointed at the real
  // URL once it resolves, instead of being opened after the await.
  async function downloadPdf(invoiceId: string) {
    const tab = window.open("", "_blank");
    const { url } = await pdfMutation.mutateAsync(invoiceId);
    if (tab) tab.location.href = url;
  }

  async function shareOnWhatsApp(inv: Invoice) {
    const tab = window.open("", "_blank");
    const { url } = await pdfMutation.mutateAsync(inv.id);
    const number = (whatsappNumberByInvoice[inv.id] ?? "").replace(/\D/g, "");
    const message = `Invoice ${inv.financialYear}/${inv.invoiceNumber} for ₹${(inv.totalPaise / 100).toFixed(2)}: ${url}`;
    if (tab) tab.location.href = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  }

  const creditNoteMutation = useMutation({
    mutationFn: ({ invoiceId, reason }: { invoiceId: string; reason: string }) =>
      api.post(`/invoices/${invoiceId}/credit-note`, { reason }),
    onSuccess: () => {
      setCreditNoteInvoiceId(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  return (
    <main className="mx-auto max-w-2xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">Invoices</h1>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <p className="text-muted-foreground">No invoices yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((inv) => (
            <li key={inv.id} className="rounded border border-border p-3">
              <p className="font-medium">
                FY {inv.financialYear} / #{inv.invoiceNumber} — {inv.customer.name}{" "}
                <span className="text-sm text-muted-foreground">({inv.status})</span>
              </p>
              <ul className="ml-4 list-disc text-sm text-muted-foreground">
                {inv.items.map((l, i) => (
                  <li key={i}>
                    {l.description}: {l.qtyBase} × ₹{(l.ratePaise / 100).toFixed(2)}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-sm">
                Taxable ₹{(inv.taxableValuePaise / 100).toFixed(2)}
                {inv.igstPaise > 0 ? (
                  <> + IGST ₹{(inv.igstPaise / 100).toFixed(2)}</>
                ) : (
                  <>
                    {" "}
                    + CGST ₹{(inv.cgstPaise / 100).toFixed(2)} + SGST ₹{(inv.sgstPaise / 100).toFixed(2)}
                  </>
                )}{" "}
                = <strong>₹{(inv.totalPaise / 100).toFixed(2)}</strong>
              </p>

              {inv.creditNotes.map((c, i) => (
                <p key={i} className="mt-1 text-sm text-destructive">
                  Credit note: {c.reason} (₹{(c.amountPaise / 100).toFixed(2)})
                </p>
              ))}

              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <button onClick={() => downloadPdf(inv.id)} className="text-primary underline">
                  Download PDF
                </button>
                <input
                  placeholder="WhatsApp number"
                  value={whatsappNumberByInvoice[inv.id] ?? ""}
                  onChange={(e) => setWhatsappNumberByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                  className="w-36 rounded border border-input bg-transparent px-2 py-1"
                />
                <button onClick={() => shareOnWhatsApp(inv)} className="text-primary underline">
                  Share on WhatsApp
                </button>
                {inv.status === "ISSUED" && (
                  <button onClick={() => setCreditNoteInvoiceId(inv.id)} className="text-destructive underline">
                    Credit note / cancel
                  </button>
                )}
              </div>

              {creditNoteInvoiceId === inv.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    creditNoteMutation.mutate({ invoiceId: inv.id, reason });
                  }}
                  className="mt-2 flex gap-2"
                >
                  <input
                    placeholder="Reason"
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="flex-1 rounded border border-input bg-transparent px-2 py-1 text-sm"
                  />
                  <button type="submit" className="rounded bg-destructive px-3 py-1 text-sm text-destructive-foreground">
                    Confirm
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
