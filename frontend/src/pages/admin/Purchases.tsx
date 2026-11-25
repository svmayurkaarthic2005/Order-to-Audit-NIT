import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Loading, PageHeader, StatusBadge, Table, Td, Th, THead, Field, Input, Select, money, unitOf } from "@/components/ui";

type Supplier = { id: string; name: string };
type Item = { id: string; sku: string; name: string; baseUnit: string; type: string };
type Line = { itemId: string; quantity: string; pricePerUnit: string };
type Purchase = {
  id: string;
  purchaseDate: string;
  cancelledAt: string | null;
  supplier: { name: string };
  items: { itemId: string; qtyBase: number; rateBasePaise: number }[];
};

const emptyLine: Line = { itemId: "", quantity: "", pricePerUnit: "" };

// The form takes kg/L/pcs and rupees per kg/L/pc; the API stores whole base
// units (g/ml/pc) and a whole-paise rate per base unit.
function toApiLine(line: Line, baseUnit: string) {
  const { factor } = unitOf(baseUnit);
  return {
    itemId: line.itemId,
    qtyBase: Math.round(Number(line.quantity) * factor),
    rateBasePaise: Math.round((Number(line.pricePerUnit) * 100) / factor),
  };
}

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
  const { data: purchases, isLoading, error: purchasesError } = useQuery({
    queryKey: ["purchases"],
    queryFn: () => api.get<{ items: Purchase[] }>("/purchases"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/purchases", {
        supplierId,
        items: lines.map((l) => toApiLine(l, baseUnitOf(l.itemId))),
      }),
    onSuccess: () => {
      setError(null);
      setLines([{ ...emptyLine }]);
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't save the purchase. Check each line and try again."),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/purchases/${id}/cancel`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchases"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't cancel the purchase."),
  });

  const rawMaterialItems = items?.items.filter((i) => i.type !== "FINISHED_GOOD") ?? [];
  const baseUnitOf = (itemId: string) => items?.items.find((i) => i.id === itemId)?.baseUnit ?? "PIECE";

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  return (
    <div className="w-full min-w-0">
      <PageHeader title="Purchases" description="Record materials and packaging when they arrive from a supplier. Stock goes up as soon as you save." />

      {/* Record form */}
      {canMutate && (
        <Card className="mb-6 overflow-hidden">
          <div className="border-b border-border/60 bg-secondary/30 px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Record a purchase</h2>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }}
            className="flex flex-col gap-4 p-5"
          >
            <Field label="Supplier" required>
              <Select value={supplierId} required onChange={(e) => setSupplierId(e.target.value)} className="w-full sm:w-80">
                <option value="">Choose a supplier</option>
                {suppliers?.items.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>

            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Items</p>
              <div className="flex flex-col gap-2">
                {lines.map((line, i) => {
                  const unit = unitOf(baseUnitOf(line.itemId)).label;
                  const apiLine = toApiLine(line, baseUnitOf(line.itemId));
                  const lineTotal = line.quantity && line.pricePerUnit ? apiLine.qtyBase * apiLine.rateBasePaise : null;
                  return (
                  <div key={i} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_130px_150px_110px_auto]">
                    <Select value={line.itemId} required onChange={(e) => updateLine(i, { itemId: e.target.value })} aria-label="Item">
                      <option value="">Choose an item</option>
                      {rawMaterialItems.map((it) => (
                        <option key={it.id} value={it.id}>{it.name}</option>
                      ))}
                    </Select>
                    <Input
                      placeholder={`Quantity (${unit})`}
                      aria-label={`Quantity in ${unit}`}
                      type="number"
                      step="any"
                      min="0"
                      required
                      value={line.quantity}
                      onChange={(e) => updateLine(i, { quantity: e.target.value })}
                    />
                    <Input
                      placeholder={`₹ per ${unit === "pcs" ? "piece" : unit}`}
                      aria-label={`Price per ${unit} in rupees`}
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={line.pricePerUnit}
                      onChange={(e) => updateLine(i, { pricePerUnit: e.target.value })}
                    />
                    <span className="tabular text-right text-sm text-muted-foreground">{lineTotal === null ? "" : money(lineTotal)}</span>
                    {lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </Button>
                    )}
                  </div>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
                className="mt-2 border-dashed"
              >
                Add another item
              </Button>
            </div>

            {error && <ErrorText>{error}</ErrorText>}

            <div className="flex gap-2">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving…" : "Save purchase"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* History table */}
      {isLoading ? (
        <Loading />
      ) : purchasesError ? (
        <ErrorText>{(purchasesError as Error).message}</ErrorText>
      ) : !purchases || purchases.items.length === 0 ? (
        <EmptyState>No purchases yet.</EmptyState>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Supplier</Th>
              <Th>Date</Th>
              <Th numeric>Items</Th>
              <Th>Status</Th>
              {canMutate && <Th><span className="sr-only">Actions</span></Th>}
            </tr>
          </THead>
          <tbody>
            {purchases.items.map((p) => (
              <tr key={p.id} className="transition-colors hover:bg-secondary/30">
                <Td className="font-medium text-foreground">{p.supplier.name}</Td>
                <Td className="text-muted-foreground">{new Date(p.purchaseDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</Td>
                <Td numeric>{p.items.length}</Td>
                <Td>
                  <StatusBadge variant={p.cancelledAt ? "destructive" : "success"}>
                    {p.cancelledAt ? "Cancelled" : "Received"}
                  </StatusBadge>
                </Td>
                {canMutate && (
                  <Td>
                    {!p.cancelledAt && (
                      <Button size="sm" variant="danger" onClick={() => cancelMutation.mutate(p.id)}>
                        Cancel
                      </Button>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
