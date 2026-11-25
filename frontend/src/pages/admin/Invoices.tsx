import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, Loading, PageHeader, money } from "@/components/ui";

type Invoice = {
  id: string;
  financialYear: string;
  createdAt: string;
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

  // wa.me needs the country code; a plain 10-digit Indian mobile gets 91.
  // With no number, WhatsApp opens and lets you pick the contact.
  async function shareOnWhatsApp(inv: Invoice) {
    const tab = window.open("", "_blank");
    const { message } = await api.get<{ message: string }>(`/invoices/${inv.id}/share-link`);
    let number = (whatsappNumberByInvoice[inv.id] ?? "").replace(/\D/g, "").replace(/^0+/, "");
    if (number.length === 10) number = `91${number}`;
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
      <PageHeader title="Invoices & payments" description="Invoices you've issued, the payments that came in, and what's still owed." />

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorText>{(error as Error).message}</ErrorText>
      ) : !data || data.length === 0 ? (
        <EmptyState>No invoices yet. Create one from an approved order.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((inv) => {
            // Same formula as the Payments & Collections report, so the two
            // never disagree on what an invoice still owes.
            const paidPaise = inv.payments.reduce((sum, p) => sum + p.amountPaise, 0);
            const creditedPaise = inv.creditNotes.reduce((sum, c) => sum + c.amountPaise, 0);
            const outstandingPaise = inv.totalPaise - paidPaise - creditedPaise;
            const cancelled = inv.status !== "ISSUED";
            const balance = cancelled
              ? { text: "Cancelled", tone: "text-destructive" }
              : outstandingPaise <= 0
                ? { text: "Paid in full", tone: "text-success" }
                : { text: `${money(outstandingPaise)} still owed`, tone: "text-warning" };

            return (
              <li key={inv.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                    <div>
                      <p className="text-base font-semibold text-foreground">
                        Invoice #{inv.invoiceNumber}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">FY {inv.financialYear}</span>
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {inv.customer.name}, {inv.customer.state}. Issued{" "}
                        {new Date(inv.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-lg font-semibold text-foreground">{money(inv.totalPaise)}</p>
                      <p className={`text-sm font-medium ${balance.tone}`}>{balance.text}</p>
                    </div>
                  </div>

                  <div className="grid gap-x-10 gap-y-3 border-t border-border px-5 py-3 text-sm md:grid-cols-[1fr_auto]">
                    <div>
                      {inv.items.map((l, i) => (
                        <p key={i} className="text-foreground">
                          {l.description}
                          <span className="tabular ml-2 text-muted-foreground">
                            {l.qtyBase} × {money(l.ratePaise)}
                          </span>
                        </p>
                      ))}
                      <p className="tabular mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                        <span>Taxable {money(inv.taxableValuePaise)}</span>
                        {inv.igstPaise > 0 ? (
                          <span>IGST {money(inv.igstPaise)}</span>
                        ) : (
                          <>
                            <span>CGST {money(inv.cgstPaise)}</span>
                            <span>SGST {money(inv.sgstPaise)}</span>
                          </>
                        )}
                      </p>
                      {inv.creditNotes.map((c, i) => (
                        <p key={i} className="mt-1 text-xs text-destructive">
                          Credit note: {c.reason} ({money(c.amountPaise)})
                        </p>
                      ))}
                    </div>
                    {!cancelled && (
                      <dl className="tabular grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 self-start text-sm">
                        <dt className="text-muted-foreground">Received</dt>
                        <dd className="text-right text-foreground">{money(paidPaise)}</dd>
                        <dt className="text-muted-foreground">Still owed</dt>
                        <dd className={`text-right font-medium ${outstandingPaise > 0 ? "text-warning" : "text-success"}`}>
                          {money(Math.max(outstandingPaise, 0))}
                        </dd>
                      </dl>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/40 px-5 py-3">
                    <Button size="sm" variant="secondary" onClick={() => downloadPdf(inv.id)}>
                      Download PDF
                    </Button>

                    {canMutate && (
                    <div className="flex items-center gap-1.5">
                      <Input
                        placeholder="WhatsApp no. (optional)"
                        inputMode="tel"
                        aria-label="WhatsApp number to share with"
                        value={whatsappNumberByInvoice[inv.id] ?? ""}
                        onChange={(e) => setWhatsappNumberByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                        className="h-8 w-40 text-sm"
                      />
                      <Button size="sm" variant="secondary" onClick={() => shareOnWhatsApp(inv)}>
                        Share on WhatsApp
                      </Button>
                    </div>
                    )}

                    {canMutate && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="email"
                          aria-label="Email address to send the invoice to"
                          placeholder={inv.customer.email ? "Another email (optional)" : "Customer's email"}
                          value={emailOverrideByInvoice[inv.id] ?? ""}
                          onChange={(e) => setEmailOverrideByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                          className="h-8 w-52 text-sm"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          title={
                            emailOverrideByInvoice[inv.id]
                              ? `Send to ${emailOverrideByInvoice[inv.id]}`
                              : inv.customer.email
                                ? `Send to ${inv.customer.name}'s saved email, ${inv.customer.email}`
                                : "Type an email address first"
                          }
                          disabled={emailMutation.isPending || (!inv.customer.email && !emailOverrideByInvoice[inv.id])}
                          onClick={() => {
                            setEmailStatusByInvoice((prev) => ({ ...prev, [inv.id]: "" }));
                            emailMutation.mutate({ invoiceId: inv.id, email: emailOverrideByInvoice[inv.id] || undefined });
                          }}
                        >
                          {emailMutation.isPending && emailMutation.variables?.invoiceId === inv.id
                            ? "Sending…"
                            : inv.customer.email && !emailOverrideByInvoice[inv.id]
                              ? `Email ${inv.customer.name}`
                              : "Email invoice"}
                        </Button>
                      </div>
                    )}

                    {canMutate && !cancelled && outstandingPaise > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          placeholder="Amount (₹)"
                          aria-label="Payment amount in rupees"
                          type="number"
                          step="0.01"
                          min="0"
                          max={outstandingPaise / 100}
                          value={amountByInvoice[inv.id] ?? ""}
                          onChange={(e) => setAmountByInvoice((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                          className="h-8 w-28"
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

                    {canMutate && !cancelled && (
                      <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => setCreditNoteInvoiceId(inv.id)}>
                        Credit note or cancel
                      </Button>
                    )}

                  </div>

                  {(emailStatusByInvoice[inv.id] || paymentErrorByInvoice[inv.id] || (canMutate && creditNoteInvoiceId === inv.id)) && (
                    <div className="flex flex-col gap-2 border-t border-border px-5 py-3">
                      {emailStatusByInvoice[inv.id] && (
                        <p className={`text-sm ${emailStatusByInvoice[inv.id] === "sent" ? "text-success" : "text-destructive"}`}>
                          {emailStatusByInvoice[inv.id] === "sent"
                            ? `Invoice emailed to ${emailOverrideByInvoice[inv.id] || inv.customer.email}.`
                            : emailStatusByInvoice[inv.id]}
                        </p>
                      )}
                      {paymentErrorByInvoice[inv.id] && <ErrorText>{paymentErrorByInvoice[inv.id]}</ErrorText>}
                      {canMutate && creditNoteInvoiceId === inv.id && (
                        <form
                          onSubmit={(e) => { e.preventDefault(); creditNoteMutation.mutate({ invoiceId: inv.id, reason }); }}
                          className="flex gap-2"
                        >
                          <Input
                            placeholder="Why? For example: goods returned damaged"
                            required
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="h-8 flex-1"
                          />
                          <Button type="submit" size="sm" variant="destructive">Issue credit note</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setCreditNoteInvoiceId(null)}>
                            Cancel
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
