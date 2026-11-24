import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, Input, PageHeader, StatusBadge, money } from "@/components/ui";

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
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
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
    <div>
      <PageHeader title="Invoices" description="GST-compliant invoices, PDF export and WhatsApp sharing." />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <EmptyState>No invoices yet.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((inv) => (
            <li key={inv.id}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-foreground">
                    FY {inv.financialYear} / #{inv.invoiceNumber} — {inv.customer.name}
                  </p>
                  <StatusBadge variant={inv.status === "ISSUED" ? "success" : "destructive"}>{inv.status}</StatusBadge>
                </div>
                <ul className="mt-2 text-sm text-muted-foreground">
                  {inv.items.map((l, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{l.description}</span>
                      <span className="tabular">
                        {l.qtyBase} × {money(l.ratePaise)}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-col gap-0.5 border-t border-border pt-2 text-sm tabular">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Taxable value</span>
                    <span>{money(inv.taxableValuePaise)}</span>
                  </div>
                  {inv.igstPaise > 0 ? (
                    <div className="flex justify-between text-muted-foreground">
                      <span>IGST</span>
                      <span>{money(inv.igstPaise)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between text-muted-foreground">
                        <span>CGST</span>
                        <span>{money(inv.cgstPaise)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>SGST</span>
                        <span>{money(inv.sgstPaise)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between border-t border-border pt-1 text-base font-semibold text-foreground">
                    <span>Total</span>
                    <span>{money(inv.totalPaise)}</span>
                  </div>
                </div>

                {inv.creditNotes.map((c, i) => (
                  <p key={i} className="mt-2 text-sm text-destructive">
                    Credit note: {c.reason} ({money(c.amountPaise)})
                  </p>
                ))}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => downloadPdf(inv.id)}>
                    Download PDF
                  </Button>
                  <Input
                    placeholder="WhatsApp number"
                    value={whatsappNumberByInvoice[inv.id] ?? ""}
                    onChange={(e) => setWhatsappNumberByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                    className="h-8 w-36 text-sm"
                  />
                  <Button size="sm" variant="secondary" onClick={() => shareOnWhatsApp(inv)}>
                    Share on WhatsApp
                  </Button>
                  {canMutate && inv.status === "ISSUED" && (
                    <Button size="sm" variant="danger" onClick={() => setCreditNoteInvoiceId(inv.id)}>
                      Credit note / cancel
                    </Button>
                  )}
                </div>

                {canMutate && creditNoteInvoiceId === inv.id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      creditNoteMutation.mutate({ invoiceId: inv.id, reason });
                    }}
                    className="mt-2 flex gap-2"
                  >
                    <Input
                      placeholder="Reason"
                      required
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="h-8 flex-1 text-sm"
                    />
                    <Button type="submit" size="sm" variant="destructive">
                      Confirm
                    </Button>
                  </form>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
