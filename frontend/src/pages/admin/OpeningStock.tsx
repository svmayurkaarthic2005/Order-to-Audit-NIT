import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";

type Item = { id: string; sku: string; name: string; baseUnit: "G" | "ML" | "PIECE" };
type OnHand = { qtyBase: number; unit: string; asOf: string };

export default function OpeningStock() {
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState("");
  const [qtyBase, setQtyBase] = useState("");
  const [totalCostPaise, setTotalCostPaise] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["items", "opening-stock-picker"],
    queryFn: () => api.get<{ items: Item[] }>("/items"),
  });

  const { data: onHand } = useQuery({
    queryKey: ["on-hand", itemId],
    queryFn: () => api.get<OnHand>(`/inventory/${itemId}/on-hand`),
    enabled: !!itemId,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post("/inventory/opening-stock", {
        itemId,
        qtyBase: Number(qtyBase),
        totalCostPaise: Number(totalCostPaise),
      }),
    onSuccess: () => {
      setError(null);
      setQtyBase("");
      setTotalCostPaise("");
      queryClient.invalidateQueries({ queryKey: ["on-hand", itemId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to post opening stock"),
  });

  const selectedItem = items?.items.find((i) => i.id === itemId);

  return (
    <main className="mx-auto max-w-xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">Opening Stock</h1>

      {itemsLoading ? (
        <p className="text-muted-foreground">Loading items…</p>
      ) : (
        <select
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          className="mb-4 w-full rounded border border-input bg-transparent px-3 py-2"
        >
          <option value="">Select an item…</option>
          {items?.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.sku} — {i.name}
            </option>
          ))}
        </select>
      )}

      {itemId && onHand && (
        <p className="mb-4 text-muted-foreground">
          Current on-hand: {onHand.qtyBase} {onHand.unit}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitMutation.mutate();
        }}
        className="flex flex-col gap-2"
      >
        <input
          placeholder={`Quantity (in ${selectedItem?.baseUnit ?? "base unit"})`}
          type="number"
          required
          value={qtyBase}
          onChange={(e) => setQtyBase(e.target.value)}
          className="rounded border border-input bg-transparent px-3 py-2"
        />
        <input
          placeholder="Total cost (in paise)"
          type="number"
          required
          value={totalCostPaise}
          onChange={(e) => setTotalCostPaise(e.target.value)}
          className="rounded border border-input bg-transparent px-3 py-2"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={!itemId || submitMutation.isPending}
          className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
        >
          Post opening stock
        </button>
      </form>
    </main>
  );
}
