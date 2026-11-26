import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorText, Field, Input, Label, PageHeader, Select, money } from "@/components/ui";

type Customer = { id: string; name: string };
type Item = { id: string; sku: string; name: string; type: string };
type Line = { itemId: string; qtyBase: string; price: string };

const toPaise = (rupees: string) => Math.round((Number(rupees) || 0) * 100);

const emptyLine: Line = { itemId: "", qtyBase: "", price: "" };

// ── "Recent" chips — purely a client-side convenience, no backend query.
// Populated from this salesman's own successful submissions on this device.
const RECENT_CUSTOMERS_KEY = "recent-order-customers";
const RECENT_ITEMS_KEY = "recent-order-items";
const MAX_RECENT = 6;

function readRecent<T extends { id: string }>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}

function pushRecent<T extends { id: string }>(key: string, entry: T) {
  const rest = readRecent<T>(key).filter((e) => e.id !== entry.id);
  localStorage.setItem(key, JSON.stringify([entry, ...rest].slice(0, MAX_RECENT)));
}

export default function OrderEntry() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ status: "created" | "queued"; customerName: string; total: number } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const { data: customers } = useQuery({
    queryKey: ["customers", "order-picker"],
    queryFn: () => api.get<{ items: Customer[] }>("/customers"),
  });
  const { data: items } = useQuery({
    queryKey: ["items", "order-picker"],
    queryFn: () => api.get<{ items: Item[] }>("/items"),
  });

  const finishedGoods = items?.items.filter((i) => i.type === "FINISHED_GOOD") ?? [];
  const recentCustomers = readRecent<Customer>(RECENT_CUSTOMERS_KEY).filter((c) => customers?.items.some((x) => x.id === c.id));
  const recentItems = readRecent<Item>(RECENT_ITEMS_KEY).filter((i) => finishedGoods.some((x) => x.id === i.id));

  const total = lines.reduce((sum, l) => sum + (Number(l.qtyBase) || 0) * toPaise(l.price), 0);

  const createMutation = useMutation({
    mutationFn: () =>
      api.submitOrder(
        {
          customerId,
          items: lines
            .filter((l) => l.itemId)
            .map((l) => ({ itemId: l.itemId, qtyBase: Number(l.qtyBase), ratePaise: toPaise(l.price) })),
        },
        idempotencyKey,
      ),
    onSuccess: (result) => {
      const customerName = customers?.items.find((c) => c.id === customerId)?.name ?? "this customer";
      pushRecent(RECENT_CUSTOMERS_KEY, { id: customerId, name: customerName });
      for (const line of lines) {
        const item = finishedGoods.find((i) => i.id === line.itemId);
        if (item) pushRecent(RECENT_ITEMS_KEY, item);
      }
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      setConfirmation({ status: result.status, customerName, total });
    },
    onError: (err) => setSubmitError(err instanceof ApiError ? err.message : "Couldn't send the order. Check your connection and try again."),
  });

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function stepQty(index: number, delta: number) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next = Math.max(0, (Number(l.qtyBase) || 0) + delta);
        return { ...l, qtyBase: String(next) };
      }),
    );
  }

  function startNewOrder() {
    setCustomerId("");
    setLines([{ ...emptyLine }]);
    setValidationError(null);
    setSubmitError(null);
    setConfirmation(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const validLines = lines.filter((l) => l.itemId);
    if (validLines.length === 0) { setValidationError("Add at least one product."); return; }
    if (validLines.some((l) => !(Number(l.qtyBase) > 0))) { setValidationError("Each product needs a quantity of at least 1."); return; }
    setValidationError(null);
    createMutation.mutate();
  }

  if (confirmation) {
    const isQueued = confirmation.status === "queued";
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="New order" description="Pick the customer, then add what they want." />
        <Card className={`flex flex-col items-center gap-3 p-8 text-center ${isQueued ? "border-warning/30 bg-warning-bg" : "border-success/30 bg-success-bg"}`}>
          <div className={`flex h-12 w-12 items-center justify-center rounded-full ${isQueued ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}`}>
            {isQueued ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8v4l3 3M3 12a9 9 0 1018 0 9 9 0 00-18 0z" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </div>
          <p className="text-base font-semibold text-foreground">
            {isQueued ? "Saved on this phone" : "Order submitted"}
          </p>
          <p className="text-sm text-muted-foreground">
            {money(confirmation.total)} for {confirmation.customerName}
            {isQueued && ". There's no connection right now; it will send by itself once you're back online."}
          </p>
          <div className="mt-2 flex gap-2">
            <Button onClick={startNewOrder}>New order</Button>
            <Button variant="secondary" onClick={() => navigate("/salesman/orders")}>View orders</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New order" description="Pick the customer, then add what they want." />

      {(customers?.items.length === 0 || items?.items.length === 0) && (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-foreground">
          {customers?.items.length === 0 ? "No customers yet" : "No products yet"}. The office adds them in Setup; once they do, they appear here.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Customer */}
        <Card className="p-4">
          <Field label="Customer" required>
            <Select value={customerId} required onChange={(e) => setCustomerId(e.target.value)} className="w-full">
              <option value="">Choose a customer</option>
              {customers?.items.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          {recentCustomers.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {recentCustomers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCustomerId(c.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    customerId === c.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-white text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Line items */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Products</p>
          </div>
          {recentItems.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {recentItems.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => {
                    const emptySlot = lines.findIndex((l) => !l.itemId);
                    if (emptySlot >= 0) updateLine(emptySlot, { itemId: it.id });
                    else setLines((prev) => [...prev, { ...emptyLine, itemId: it.id }]);
                  }}
                  className="rounded-full border border-border bg-white px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
                  title={`Add ${it.name}`}
                >
                  {it.name}
                </button>
              ))}
            </div>
          )}
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
                    <option value="">Choose a product</option>
                    {finishedGoods.map((it) => (
                      <option key={it.id} value={it.id}>{it.name}</option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] items-end gap-3 px-4 py-3">
                  {/* Not a Field: a label around the stepper would send clicks on
                      "Quantity" to the minus button. The input is named directly. */}
                  <div className="flex flex-col">
                    <Label required>Quantity</Label>
                    <div className="flex items-stretch gap-1">
                      <button
                        type="button"
                        onClick={() => stepQty(i, -1)}
                        aria-label="Decrease quantity"
                        className="flex w-9 shrink-0 items-center justify-center rounded-lg border border-input bg-white text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14" /></svg>
                      </button>
                      <Input
                        placeholder="0"
                        aria-label="Quantity"
                        type="number"
                        inputMode="numeric"
                        value={line.qtyBase}
                        onChange={(e) => updateLine(i, { qtyBase: e.target.value })}
                        className="w-full text-center"
                      />
                      <button
                        type="button"
                        onClick={() => stepQty(i, 1)}
                        aria-label="Increase quantity"
                        className="flex w-9 shrink-0 items-center justify-center rounded-lg border border-input bg-white text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                      </button>
                    </div>
                  </div>
                  <Field label="Price per packet (₹)" required>
                    <Input
                      placeholder="e.g. 50"
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      value={line.price}
                      onChange={(e) => updateLine(i, { price: e.target.value })}
                      className="w-full"
                    />
                  </Field>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="mb-1 self-end sm:self-auto rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive-bg hover:text-destructive"
                      aria-label="Remove line"
                      title="Remove product"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                {line.itemId && Number(line.qtyBase) > 0 && Number(line.price) > 0 && (
                  <div className="border-t border-border/40 bg-secondary/20 px-4 py-2 text-right">
                    <span className="tabular text-sm font-semibold text-foreground">
                      {money(Number(line.qtyBase) * toPaise(line.price))}
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
            Add another product
          </Button>
        </div>

        {/* Total */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/50 px-5 py-4">
          <span className="text-sm font-semibold text-muted-foreground">Total</span>
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
              Sending…
            </span>
          ) : "Send order"}
        </Button>
      </form>
    </div>
  );
}
