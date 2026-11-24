import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, ErrorText, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, Td, Th, THead } from "@/components/ui";

type StockStatusRow = {
  itemId: string;
  sku: string;
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD";
  unit: string;
  availableQtyBase: number;
  reorderLevel: number | null;
  status: "LOW" | "NORMAL";
};

type OnHand = { qtyBase: number; unit: string; asOf: string };

const TYPE_LABEL: Record<StockStatusRow["type"], string> = {
  RAW_MATERIAL: "Raw Material",
  PACKAGING: "Packaging",
  FINISHED_GOOD: "Finished Goods",
};

function ReorderLevelCell({ row, canMutate }: { row: StockStatusRow; canMutate: boolean }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(row.reorderLevel?.toString() ?? "");

  const mutation = useMutation({
    mutationFn: (reorderLevel: number) => api.patch(`/alerts/items/${row.itemId}/reorder-level`, { reorderLevel }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts", "stock-status"] }),
  });

  if (!canMutate) {
    return <span className="tabular">{row.reorderLevel ?? <span className="text-muted-foreground">—</span>}</span>;
  }

  return (
    <Input
      type="number"
      min={0}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const n = Number(value);
        if (value !== "" && Number.isInteger(n) && n >= 0 && n !== row.reorderLevel) {
          mutation.mutate(n);
        }
      }}
      className="h-8 w-28 text-right tabular"
      placeholder="Not set"
    />
  );
}

function OpeningStockForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState("");
  const [qtyBase, setQtyBase] = useState("");
  const [totalCostPaise, setTotalCostPaise] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["items", "opening-stock-picker"],
    queryFn: () => api.get<{ items: { id: string; sku: string; name: string; baseUnit: string }[] }>("/items"),
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
      queryClient.invalidateQueries({ queryKey: ["on-hand", itemId] });
      queryClient.invalidateQueries({ queryKey: ["alerts", "stock-status"] });
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to post opening stock"),
  });

  const selectedItem = items?.items.find((i) => i.id === itemId);

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="border-b border-border/60 bg-secondary/30 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-foreground">Record opening stock</h2>
      </div>
      <div className="p-5">
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
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <div className="w-40">
            <Field label={`Quantity (${selectedItem?.baseUnit ?? "base unit"})`} required>
              <Input type="number" required value={qtyBase} onChange={(e) => setQtyBase(e.target.value)} className="w-full" />
            </Field>
          </div>
          <div className="w-44">
            <Field label="Total cost (paise)" required>
              <Input type="number" required value={totalCostPaise} onChange={(e) => setTotalCostPaise(e.target.value)} className="w-full" />
            </Field>
          </div>
          <Button type="submit" disabled={!itemId || submitMutation.isPending}>
            Post opening stock
          </Button>
        </form>
        {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
      </div>
    </Card>
  );
}

export default function LowStockAlerts() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const canRecordOpeningStock = user?.role === "ADMIN" || user?.role === "OWNER";
  const [showOpeningStockForm, setShowOpeningStockForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["alerts", "stock-status"],
    queryFn: () => api.get<StockStatusRow[]>("/alerts/stock-status"),
  });

  const lowCount = data?.filter((r) => r.status === "LOW").length ?? 0;

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Stock Data"
        description="Raw materials, packaging and finished goods approaching a shortage."
        actions={
          canRecordOpeningStock ? (
            <Button
              variant={showOpeningStockForm ? "secondary" : "primary"}
              size="sm"
              onClick={() => setShowOpeningStockForm((v) => !v)}
            >
              {showOpeningStockForm ? (
                "Close"
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 4v16m8-8H4" />
                  </svg>
                  Record opening stock
                </>
              )}
            </Button>
          ) : undefined
        }
      />

      {canRecordOpeningStock && showOpeningStockForm && (
        <OpeningStockForm onDone={() => setShowOpeningStockForm(false)} />
      )}

      <Card className="mb-4 flex items-center gap-3 p-4">
        <StatusBadge variant={lowCount > 0 ? "warning" : "success"}>
          {lowCount > 0 ? `${lowCount} item${lowCount > 1 ? "s" : ""} low` : "All items normal"}
        </StatusBadge>
        <span className="text-sm text-muted-foreground">
          Available = on-hand stock minus reserved (approved, undispatched) orders.
        </span>
      </Card>

      {isLoading ? (
        <Loading />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Item</Th>
              <Th>Type</Th>
              <Th numeric>Available</Th>
              <Th numeric>Reorder level</Th>
              <Th>Status</Th>
            </tr>
          </THead>
          <tbody>
            {data?.map((row) => (
              <tr key={row.itemId} className="hover:bg-secondary/30">
                <Td>
                  <p className="font-medium text-foreground">{row.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">{row.sku}</p>
                </Td>
                <Td className="text-muted-foreground">{TYPE_LABEL[row.type]}</Td>
                <Td numeric className="font-semibold text-foreground">
                  {row.availableQtyBase.toLocaleString("en-IN")} {row.unit}
                </Td>
                <Td numeric>
                  <ReorderLevelCell row={row} canMutate={canMutate} />
                </Td>
                <Td>
                  <StatusBadge variant={row.status === "LOW" ? "warning" : "success"}>{row.status}</StatusBadge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
