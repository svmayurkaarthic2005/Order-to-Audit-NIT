import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Supplier = { id: string; name: string };
type Item = { id: string; sku: string; name: string; baseUnit: string; type: string };
type Line = { itemId: string; qtyBase: string; rateBasePaise: string };
type Purchase = {
  id: string;
  purchaseDate: string;
  cancelledAt: string | null;
  supplier: { name: string };
  items: { itemId: string; qtyBase: number; rateBasePaise: number }[];
};

const emptyLine: Line = { itemId: "", qtyBase: "", rateBasePaise: "" };

export default function Purchases() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [error, setError] = useState<string | null>(null);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers", "purchase-picker"],
    queryFn: () => api.get<{ items: Supplier[] }>("/suppliers"),
  });
  const { data: items } = useQuery({
    queryKey: ["items", "purchase-picker"],
    queryFn: () => api.get<{ items: Item[] }>("/items"),
  });
  const { data: purchases, isLoading } = useQuery({
    queryKey: ["purchases"],
    queryFn: () => api.get<{ items: Purchase[] }>("/purchases"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/purchases", {
        supplierId,
        items: lines.map((l) => ({
          itemId: l.itemId,
          qtyBase: Number(l.qtyBase),
          rateBasePaise: Number(l.rateBasePaise),
        })),
      }),
    onSuccess: () => {
      setError(null);
      setLines([{ ...emptyLine }]);
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to record purchase"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchases/${id}/cancel`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchases"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to cancel purchase"),
  });

  const rawMaterialItems = items?.items.filter((i) => i.type !== "FINISHED_GOOD") ?? [];

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  return (
    <main className="mx-auto max-w-2xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">Purchases</h1>

      {canMutate && (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="mb-6 flex flex-col gap-2 rounded border border-border p-4"
      >
        <select
          value={supplierId}
          required
          onChange={(e) => setSupplierId(e.target.value)}
          className="rounded border border-input bg-transparent px-2 py-1"
        >
          <option value="">Select a supplier…</option>
          {suppliers?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {lines.map((line, i) => (
          <div key={i} className="flex gap-2">
            <select
              value={line.itemId}
              required
              onChange={(e) => updateLine(i, { itemId: e.target.value })}
              className="flex-1 rounded border border-input bg-transparent px-2 py-1"
            >
              <option value="">Item…</option>
              {rawMaterialItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.sku} — {it.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Qty (base unit)"
              type="number"
              required
              value={line.qtyBase}
              onChange={(e) => updateLine(i, { qtyBase: e.target.value })}
              className="w-32 rounded border border-input bg-transparent px-2 py-1"
            />
            <input
              placeholder="Rate (paise/unit)"
              type="number"
              required
              value={line.rateBasePaise}
              onChange={(e) => updateLine(i, { rateBasePaise: e.target.value })}
              className="w-36 rounded border border-input bg-transparent px-2 py-1"
            />
          </div>
        ))}

        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
          className="self-start text-sm underline"
        >
          + Add line
        </button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
        >
          Record purchase
        </button>
      </form>
      )}

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !purchases || purchases.items.length === 0 ? (
        <p className="text-muted-foreground">No purchases yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {purchases.items.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-3 py-2">
              <span>
                {p.supplier.name} — {p.items.length} line(s)
                {p.cancelledAt && <span className="ml-2 text-destructive">(cancelled)</span>}
              </span>
              {canMutate && !p.cancelledAt && (
                <button onClick={() => cancelMutation.mutate(p.id)} className="text-sm text-destructive hover:underline">
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
