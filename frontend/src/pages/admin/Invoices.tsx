import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, Loading, PageHeader, StatusBadge, money } from "@/components/ui";

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
  customer: { name: string; state: string; email: string | null };
  items: { description: string; qtyBase: number; ratePaise: number }[];
  creditNotes: { reason: string; amountPaise: number }[];
  payments: { id: string; amountPaise: number; paidAt: string }[];
};

export default function Invoices() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const queryClient = useQueryClient();
  const [creditNoteInvoiceId, setCreditNoteInvoiceId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [whatsappNumberByInvoice, setWhatsappNumberByInvoice] = useState<Record<string, string>>({});
  const [amountByInvoice, setAmountByInvoice] = useState<Record<string, string>>({});
  const [paymentErrorByInvoice, setPaymentErrorByInvoice] = useState<Record<string, string>>({});
  const [emailOverrideByInvoice, setEmailOverrideByInvoice] = useState<Record<string, string>>({});
  const [emailStatusByInvoice, setEmailStatusByInvoice] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => api.get<Invoice[]>("/invoices"),
  });

  const pdfMutation = useMutation({
    mutationFn: (invoiceId: string) => api.get<{ url: string }>(`/invoices/${invoiceId}/pdf`),
  });

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

  const emailMutation = useMutation({
    mutationFn: ({ invoiceId, email }: { invoiceId: string; email?: string }) =>
      api.post(`/invoices/${invoiceId}/send-email`, { email }),
    onSuccess: (_data, { invoiceId }) => setEmailStatusByInvoice((prev) => ({ ...prev, [invoiceId]: "sent" })),
    onError: (err, { invoiceId }) =>
      setEmailStatusByInvoice((prev) => ({
        ...prev,
        [invoiceId]: err instanceof ApiError ? err.message : "Failed to send email",
      })),
  });

  const creditNoteMutation = useMutation({
    mutationFn: ({ invoiceId, reason }: { invoiceId: string; reason: string }) =>
      api.post(`/invoices/${invoiceId}/credit-note`, { reason }),
    onSuccess: () => {
      setCreditNoteInvoiceId(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: ({ invoiceId, amountPaise }: { invoiceId: string; amountPaise: number }) =>
      api.post("/payments", { invoiceId, amountPaise }),
    onSuccess: (_data, { invoiceId }) => {
      setPaymentErrorByInvoice((prev) => { const { [invoiceId]: _removed, ...rest } = prev; return rest; });
      setAmountByInvoice((prev) => ({ ...prev, [invoiceId]: "" }));
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err, { invoiceId }) => {
      setPaymentErrorByInvoice((prev) => ({
        ...prev,
        [invoiceId]: err instanceof ApiError ? err.message : "Failed to record payment",
      }));
    },
  });

  return (
    <div className="w-full min-w-0">
      <PageHeader title="Invoices & Payments" description="GST-compliant invoices, receipts and outstanding balances." />

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorText>{(error as Error).message}</ErrorText>
      ) : !data || data.length === 0 ? (
        <EmptyState>No invoices yet.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-4">
          {data.map((inv) => {
            // Same formula as the Payments & Collections report, so the two
            // never disagree on what an invoice still owes.
            const paidPaise = inv.payments.reduce((sum, p) => sum + p.amountPaise, 0);
            const creditedPaise = inv.creditNotes.reduce((sum, c) => sum + c.amountPaise, 0);
            const outstandingPaise = inv.totalPaise - paidPaise - creditedPaise;
            const fullyPaid = inv.status === "ISSUED" && outstandingPaise <= 0;

            return (
              <li key={inv.id}>
                <Card className="overflow-hidden">
                  {/* Invoice header */}
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-secondary/30 px-5 py-4">
                    <div>
                      <p className="font-semibold text-foreground">
                        FY {inv.financialYear} · #{inv.invoiceNumber}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{inv.customer.name} · {inv.customer.state}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {fullyPaid && <StatusBadge variant="success">Paid</StatusBadge>}
                      <StatusBadge variant={inv.status === "ISSUED" ? "success" : "destructive"}>{inv.status}</StatusBadge>
                    </div>
                  </div>

                  {/* Line items */}
                  <div className="px-5 py-4">
                    <ul className="mb-3 flex flex-col gap-1.5">
                      {inv.items.map((l, i) => (
                        <li key={i} className="flex items-center justify-between gap-4 text-sm">
                          <span className="text-foreground">{l.description}</span>
                          <span className="tabular shrink-0 text-muted-foreground">
                            {l.qtyBase} × {money(l.ratePaise)}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {/* Tax breakdown */}
                    <div className="rounded-lg border border-border/60 bg-secondary/30 p-3">
                      <div className="flex flex-col gap-1.5 text-sm">
                        <div className="flex justify-between text-muted-foreground">
                          <span>Taxable value</span>
                          <span className="tabular">{money(inv.taxableValuePaise)}</span>
                        </div>
                        {inv.igstPaise > 0 ? (
                          <div className="flex justify-between text-muted-foreground">
                            <span>IGST</span>
                            <span className="tabular">{money(inv.igstPaise)}</span>
                          </div>
                        ) : (
                          <>
                            <div className="flex justify-between text-muted-foreground">
                              <span>CGST</span>
                              <span className="tabular">{money(inv.cgstPaise)}</span>
                            </div>
                            <div className="flex justify-between text-muted-foreground">
                              <span>SGST</span>
                              <span className="tabular">{money(inv.sgstPaise)}</span>
                            </div>
                          </>
                        )}
                        <div className="flex justify-between border-t border-border pt-2 text-base font-bold text-foreground">
                          <span>Total</span>
                          <span className="tabular">{money(inv.totalPaise)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Credit notes */}
                    {inv.creditNotes.map((c, i) => (
                      <div key={i} className="mt-2 rounded-lg border border-destructive/20 bg-destructive-bg px-3 py-2 text-sm text-destructive">
                        Credit note: {c.reason} ({money(c.amountPaise)})
                      </div>
                    ))}

                    {/* Payment status */}
                    {inv.status === "ISSUED" && (
                      <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-border/60 bg-secondary/30 p-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Received</p>
                          <p className="tabular mt-0.5 font-bold text-foreground">{money(paidPaise)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Outstanding</p>
                          <p className={`tabular mt-0.5 font-bold ${outstandingPaise > 0 ? "text-warning" : "text-success"}`}>
                            {money(Math.max(outstandingPaise, 0))}
                          </p>
                        </div>
                        {canMutate && outstandingPaise > 0 && (
                          <div className="flex items-center gap-1.5">
                            <Input
                              placeholder="Amount (₹)"
                              type="number"
                              step="0.01"
                              min="0"
                              max={outstandingPaise / 100}
                              value={amountByInvoice[inv.id] ?? ""}
                              onChange={(e) => setAmountByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                              className="h-9 w-32"
                            />
                            <Button
                              size="sm"
                              onClick={() =>
                                paymentMutation.mutate({
                                  invoiceId: inv.id,
                                  amountPaise: Math.round(Number(amountByInvoice[inv.id] || 0) * 100),
                                })
                              }
                              disabled={paymentMutation.isPending}
                            >
                              Record payment
                            </Button>
                          </div>
                        )}
                        {paymentErrorByInvoice[inv.id] && <ErrorText>{paymentErrorByInvoice[inv.id]}</ErrorText>}
                      </div>
                    )}

                    {/* Action row */}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => downloadPdf(inv.id)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                        Download PDF
                      </Button>

                      <div className="flex items-center gap-1.5">
                        <Input
                          placeholder="WhatsApp number"
                          value={whatsappNumberByInvoice[inv.id] ?? ""}
                          onChange={(e) => setWhatsappNumberByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                          className="h-9 w-44 text-sm"
                        />
                        <Button size="sm" variant="secondary" onClick={() => shareOnWhatsApp(inv)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.123 1.532 5.858L0 24l6.335-1.611A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.034-1.386l-.361-.214-3.741.981.998-3.645-.235-.374A9.818 9.818 0 0112 2.182c5.42 0 9.818 4.398 9.818 9.818 0 5.421-4.398 9.818-9.818 9.818z" />
                          </svg>
                          Share
                        </Button>
                      </div>

                      {canMutate && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="email"
                          placeholder={inv.customer.email ?? "Email address"}
                          value={emailOverrideByInvoice[inv.id] ?? ""}
                          onChange={(e) => setEmailOverrideByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                          className="h-9 w-48 text-sm"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={emailMutation.isPending || (!inv.customer.email && !emailOverrideByInvoice[inv.id])}
                          onClick={() => {
                            setEmailStatusByInvoice((prev) => ({ ...prev, [inv.id]: "" }));
                            emailMutation.mutate({ invoiceId: inv.id, email: emailOverrideByInvoice[inv.id] || undefined });
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 4h16v16H4z" /><path d="M22 6l-10 7L2 6" />
                          </svg>
                          Email
                        </Button>
                      </div>
                      )}

                      {canMutate && inv.status === "ISSUED" && (
                        <Button size="sm" variant="danger" onClick={() => setCreditNoteInvoiceId(inv.id)}>
                          Credit note / cancel
                        </Button>
                      )}
                    </div>

                    {emailStatusByInvoice[inv.id] && (
                      <p className={`mt-2 text-sm ${emailStatusByInvoice[inv.id] === "sent" ? "text-success" : "text-destructive"}`}>
                        {emailStatusByInvoice[inv.id] === "sent" ? "Invoice emailed." : emailStatusByInvoice[inv.id]}
                      </p>
                    )}

                    {canMutate && creditNoteInvoiceId === inv.id && (
                      <form
                        onSubmit={(e) => { e.preventDefault(); creditNoteMutation.mutate({ invoiceId: inv.id, reason }); }}
                        className="mt-3 flex gap-2"
                      >
                        <Input
                          placeholder="Reason for credit note…"
                          required
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className="h-9 flex-1"
                        />
                        <Button type="submit" size="sm" variant="destructive">Confirm</Button>
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
