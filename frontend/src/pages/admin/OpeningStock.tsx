import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorText, Field, Input, PageHeader, Select } from "@/components/ui";

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
    <div className="max-w-xl">
      <PageHeader title="Opening stock" description="One-time starting balance for an item — recorded once per item." />

      <Card className="p-4">
        <Field label="Item" required>
          {itemsLoading ? (
            <p className="text-sm text-muted-foreground">Loading items…</p>
          ) : (
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)} className="w-full">
              <option value="">Select an item…</option>
              {items?.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} — {i.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {itemId && onHand && (
          <p className="mt-2 text-sm text-muted-foreground">
            Current on-hand: <span className="tabular font-medium text-foreground">{onHand.qtyBase}</span> {onHand.unit}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMutation.mutate();
          }}
          className="mt-4 flex flex-col gap-3"
        >
          <Field label={`Quantity (${selectedItem?.baseUnit ?? "base unit"})`} required>
            <Input type="number" required value={qtyBase} onChange={(e) => setQtyBase(e.target.value)} className="w-full" />
          </Field>
          <Field label="Total cost (paise)" required>
            <Input type="number" required value={totalCostPaise} onChange={(e) => setTotalCostPaise(e.target.value)} className="w-full" />
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
          <Button type="submit" disabled={!itemId || submitMutation.isPending} className="self-start">
            Post opening stock
          </Button>
        </form>
      </Card>
    </div>
  );
}
