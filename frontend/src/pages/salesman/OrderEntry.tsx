import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";

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
    if (validLines.length === 0) {
      setValidationError("Add at least one product.");
      return;
    }
    if (validLines.some((l) => !(Number(l.qtyBase) > 0))) {
      setValidationError("Every line needs a quantity greater than zero.");
      return;
    }
    setValidationError(null);
    createMutation.mutate();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-4 text-foreground">
      <h1 className="text-xl font-semibold">New Order</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Customer
          <select
            value={customerId}
            required
            onChange={(e) => setCustomerId(e.target.value)}
            className="w-full rounded border border-input bg-transparent px-3 py-2 text-base"
          >
            <option value="">Select customer…</option>
            {customers?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-2">
          {lines.map((line, i) => (
            <div key={i} className="flex flex-col gap-2 rounded border border-border p-3">
              <select
                value={line.itemId}
                onChange={(e) => updateLine(i, { itemId: e.target.value })}
                className="w-full rounded border border-input bg-transparent px-3 py-2 text-base"
              >
                <option value="">Product…</option>
                {finishedGoods.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.sku} — {it.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  placeholder="Qty"
                  type="number"
                  inputMode="numeric"
                  value={line.qtyBase}
                  onChange={(e) => updateLine(i, { qtyBase: e.target.value })}
                  className="w-1/2 rounded border border-input bg-transparent px-3 py-2 text-base"
                />
                <input
                  placeholder="Rate (₹/unit, in paise)"
                  type="number"
                  inputMode="numeric"
                  value={line.ratePaise}
                  onChange={(e) => updateLine(i, { ratePaise: e.target.value })}
                  className="w-1/2 rounded border border-input bg-transparent px-3 py-2 text-base"
                />
              </div>
              {lines.length > 1 && (
                <button type="button" onClick={() => removeLine(i)} className="self-start text-sm text-destructive underline">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
          className="rounded border border-dashed border-input py-2 text-sm"
        >
          + Add product
        </button>

        <p className="text-base font-medium">Total: ₹{(total / 100).toFixed(2)}</p>

        {validationError && <p className="text-sm text-destructive">{validationError}</p>}
        {submitError && <p className="text-sm text-destructive">{submitError}</p>}

        <button
          type="submit"
          disabled={createMutation.isPending}
          className="w-full rounded bg-primary py-3 text-base font-medium text-primary-foreground disabled:opacity-50"
        >
          {createMutation.isPending ? "Submitting…" : "Submit order"}
        </button>
      </form>
    </main>
  );
}
