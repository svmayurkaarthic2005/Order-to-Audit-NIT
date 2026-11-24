import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorText, Field, Input, PageHeader, Select, money } from "@/components/ui";

type Customer = { id: string; name: string };
type Item = { id: string; sku: string; name: string; type: string };
type Line = { itemId: string; qtyBase: string; ratePaise: string };

const emptyLine: Line = { itemId: "", qtyBase: "", ratePaise: "" };

export default function OrderEntry() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: customers } = useQuery({
    queryKey: ["customers", "order-picker"],
    queryFn: () => api.get<{ items: Customer[] }>("/customers"),
  });
  const { data: items } = useQuery({
    queryKey: ["items", "order-picker"],
    queryFn: () => api.get<{ items: Item[] }>("/items"),
  });

  const finishedGoods = items?.items.filter((i) => i.type === "FINISHED_GOOD") ?? [];

  const total = lines.reduce((sum, l) => sum + (Number(l.qtyBase) || 0) * (Number(l.ratePaise) || 0), 0);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/orders", {
        customerId,
        items: lines
          .filter((l) => l.itemId)
          .map((l) => ({ itemId: l.itemId, qtyBase: Number(l.qtyBase), ratePaise: Number(l.ratePaise) })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      navigate("/salesman/orders");
    },
    onError: (err) => setSubmitError(err instanceof ApiError ? err.message : "Failed to submit order"),
  });

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const validLines = lines.filter((l) => l.itemId);
    if (validLines.length === 0) { setValidationError("Add at least one product."); return; }
    if (validLines.some((l) => !(Number(l.qtyBase) > 0))) { setValidationError("Every line needs a quantity greater than zero."); return; }
    setValidationError(null);
    createMutation.mutate();
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New Order" description="Select the customer, then add products." />

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Customer */}
        <Card className="p-4">
          <Field label="Customer" required>
            <Select value={customerId} required onChange={(e) => setCustomerId(e.target.value)} className="w-full">
              <option value="">Select customer…</option>
              {customers?.items.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        </Card>

        {/* Line items */}
        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">Products</p>
          <div className="flex flex-col gap-3">
            {lines.map((line, i) => (
              <Card key={i} className="overflow-hidden">
                <div className="border-b border-border/60 bg-secondary/30 px-4 py-2.5">
                  <Select
                    value={line.itemId}
                    onChange={(e) => updateLine(i, { itemId: e.target.value })}
                    className="w-full"
                    selectClassName="h-auto border-0 bg-transparent py-0 pl-0 shadow-none focus:ring-0 text-sm font-medium"
                  >
                    <option value="">Select product…</option>
                    {finishedGoods.map((it) => (
                      <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-center gap-3 px-4 py-3">
                  <Field label="Quantity" required>
                    <Input
                      placeholder="0"
                      type="number"
                      inputMode="numeric"
                      value={line.qtyBase}
                      onChange={(e) => updateLine(i, { qtyBase: e.target.value })}
                      className="w-full"
                    />
                  </Field>
                  <Field label="Rate (paise)" required>
                    <Input
                      placeholder="0"
                      type="number"
                      inputMode="numeric"
                      value={line.ratePaise}
                      onChange={(e) => updateLine(i, { ratePaise: e.target.value })}
                      className="w-full"
                    />
                  </Field>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="mt-5 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive-bg hover:text-destructive"
                      aria-label="Remove line"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                {line.itemId && Number(line.qtyBase) > 0 && Number(line.ratePaise) > 0 && (
                  <div className="border-t border-border/40 bg-secondary/20 px-4 py-2 text-right">
                    <span className="tabular text-sm font-semibold text-foreground">
                      {money(Number(line.qtyBase) * Number(line.ratePaise))}
                    </span>
                  </div>
                )}
              </Card>
            ))}
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
            className="mt-3 w-full border-dashed"
          >
            + Add product
          </Button>
        </div>

        {/* Total */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/50 px-5 py-4">
          <span className="text-sm font-semibold text-muted-foreground">Order Total</span>
          <span className="tabular text-2xl font-bold text-foreground">{money(total)}</span>
        </div>

        {validationError && <ErrorText>{validationError}</ErrorText>}
        {submitError && <ErrorText>{submitError}</ErrorText>}

        <Button type="submit" disabled={createMutation.isPending} className="h-12 w-full text-base">
          {createMutation.isPending ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
              </svg>
              Submitting…
            </span>
          ) : "Submit Order"}
        </Button>
      </form>
    </div>
  );
}
