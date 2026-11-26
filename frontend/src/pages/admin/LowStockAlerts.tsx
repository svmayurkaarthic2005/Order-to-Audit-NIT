import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, Td, Th, THead, qty, unitOf } from "@/components/ui";

type StockStatusRow = {
  itemId: string;
  sku: string;
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD";
  unit: string;
  availableQtyBase: number;
  onHandQtyBase: number;
  valuePaise: number;
  reorderLevel: number | null;
  status: "LOW" | "NORMAL";
};

// Moving weighted-average cost per display unit, from the ledger's exact value
// and quantity: flour after the benchmark purchase is ₹43.125/kg.
function averageCost(row: StockStatusRow) {
  if (row.onHandQtyBase <= 0) return null;
  const { label, factor } = unitOf(row.unit);
  const rupees = (row.valuePaise / row.onHandQtyBase) * factor / 100;
  return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 3 })}/${label}`;
}

type OnHand = { qtyBase: number; unit: string; asOf: string };

const TYPE_LABEL: Record<StockStatusRow["type"], string> = {
  RAW_MATERIAL: "Raw material",
  PACKAGING: "Packaging",
  FINISHED_GOOD: "Product",
};

function ReorderLevelCell({ row, canMutate }: { row: StockStatusRow; canMutate: boolean }) {
  const queryClient = useQueryClient();
  const { label, factor } = unitOf(row.unit);
  const [value, setValue] = useState(row.reorderLevel === null ? "" : String(row.reorderLevel / factor));

  const mutation = useMutation({
    mutationFn: (reorderLevel: number) => api.patch(`/alerts/items/${row.itemId}/reorder-level`, { reorderLevel }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts", "stock-status"] }),
    onError: () => {
      setValue(row.reorderLevel === null ? "" : String(row.reorderLevel / factor));
      window.alert("Couldn't save the warning level. Please try again.");
    },
  });

  if (!canMutate) {
    return <span className="tabular">{row.reorderLevel === null ? <span className="text-muted-foreground">Not set</span> : qty(row.reorderLevel, row.unit)}</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Input
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const n = Math.round(Number(value) * factor);
          if (value !== "" && n >= 0 && n !== row.reorderLevel) mutation.mutate(n);
        }}
        className="h-8 w-24 text-right tabular"
        placeholder="Not set"
        aria-label={`Warn me below this many ${label} of ${row.name}`}
      />
      <span className="w-6 text-left text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

function OpeningStockForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [totalCost, setTotalCost] = useState("");
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

  const selectedItem = items?.items.find((i) => i.id === itemId);
  const unit = unitOf(selectedItem?.baseUnit ?? "PIECE");

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post("/inventory/opening-stock", {
        itemId,
        qtyBase: Math.round(Number(quantity) * unit.factor),
        totalCostPaise: Math.round(Number(totalCost) * 100),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["on-hand", itemId] });
      queryClient.invalidateQueries({ queryKey: ["alerts", "stock-status"] });
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't save the opening stock. Check the numbers and try again."),
  });

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
              <option value="">Choose an item</option>
              {items?.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {itemId && onHand && (
          <p className="mt-2 text-sm text-muted-foreground">
            In stock now: <span className="tabular font-medium text-foreground">{qty(onHand.qtyBase, selectedItem?.baseUnit ?? onHand.unit)}</span>
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMutation.mutate();
          }}
          className="mt-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Field label={`Quantity (${unit.label})`} required>
                <Input type="number" step="any" min="0" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full" />
              </Field>
            </div>
            <div>
              <Field label="What it cost in total (₹)" required>
                <Input type="number" step="0.01" min="0" required value={totalCost} onChange={(e) => setTotalCost(e.target.value)} className="w-full" />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border/50 pt-3.5">
            <p className="text-xs text-muted-foreground">
              Use this once per item, for stock you already had before you started using the app.
            </p>
            <Button type="submit" disabled={!itemId || submitMutation.isPending} className="self-end sm:self-auto px-6">
              {submitMutation.isPending ? "Saving…" : "Save opening stock"}
            </Button>
          </div>
        </form>
        {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
      </div>
    </Card>
  );
}

function AdjustmentForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState("");
  const [direction, setDirection] = useState<"add" | "remove">("remove");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
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

  const selectedItem = items?.items.find((i) => i.id === itemId);
  const unit = unitOf(selectedItem?.baseUnit ?? "PIECE");

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post("/inventory/adjustments", {
        itemId,
        qtyBase: Math.round(Number(quantity) * unit.factor) * (direction === "remove" ? -1 : 1),
        reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["on-hand", itemId] });
      queryClient.invalidateQueries({ queryKey: ["alerts", "stock-status"] });
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't save the adjustment. Check the numbers and try again."),
  });

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="border-b border-border/60 bg-secondary/30 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-foreground">Record adjustment</h2>
      </div>
      <div className="p-5">
        <Field label="Item" required>
          {itemsLoading ? (
            <p className="text-sm text-muted-foreground">Loading items…</p>
          ) : (
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)} className="w-full">
              <option value="">Choose an item</option>
              {items?.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {itemId && onHand && (
          <p className="mt-2 text-sm text-muted-foreground">
            In stock now: <span className="tabular font-medium text-foreground">{qty(onHand.qtyBase, selectedItem?.baseUnit ?? onHand.unit)}</span>
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMutation.mutate();
          }}
          className="mt-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Field label="What happened" required>
                <Select value={direction} onChange={(e) => setDirection(e.target.value as "add" | "remove")} className="w-full">
                  <option value="remove">Less than the books say (shrinkage, damage, write-off)</option>
                  <option value="add">More than the books say (found on a physical count)</option>
                </Select>
              </Field>
            </div>
            <div>
              <Field label={`Quantity (${unit.label})`} required>
                <Input type="number" step="any" min="0" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full" />
              </Field>
            </div>
            <div>
              <Field label="Reason" required>
                <Input type="text" required minLength={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" placeholder="e.g. Monthly stock count" />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border/50 pt-3.5">
            <p className="text-xs text-muted-foreground">
              This adds a new, permanent entry to the stock ledger — it never edits or removes an earlier one.
            </p>
            <Button type="submit" disabled={!itemId || !reason.trim() || submitMutation.isPending} className="self-end sm:self-auto px-6">
              {submitMutation.isPending ? "Saving…" : "Save adjustment"}
            </Button>
          </div>
        </form>
        {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
      </div>
    </Card>
  );
}

export default function LowStockAlerts() {
  const { user } = useAuth();
  // Warning levels are an Admin/Owner setting on the server too.
  const canMutate = user?.role === "ADMIN" || user?.role === "OWNER";
  const canRecordOpeningStock = user?.role === "ADMIN" || user?.role === "OWNER";
  const [showOpeningStockForm, setShowOpeningStockForm] = useState(false);
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["alerts", "stock-status"],
    queryFn: () => api.get<StockStatusRow[]>("/alerts/stock-status"),
  });

  const lowCount = data?.filter((r) => r.status === "LOW").length ?? 0;

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Stock levels"
        description="How much of each item you have. Set a warning level and you'll be told when it runs low."
        actions={
          canRecordOpeningStock ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowAdjustmentForm((v) => !v);
                  setShowOpeningStockForm(false);
                }}
              >
                {showAdjustmentForm ? "Close" : "Record adjustment"}
              </Button>
              <Button
                variant={showOpeningStockForm ? "secondary" : "primary"}
                size="sm"
                onClick={() => {
                  setShowOpeningStockForm((v) => !v);
                  setShowAdjustmentForm(false);
                }}
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
            </div>
          ) : undefined
        }
      />

      {canRecordOpeningStock && showAdjustmentForm && (
        <AdjustmentForm onDone={() => setShowAdjustmentForm(false)} />
      )}

      {canRecordOpeningStock && showOpeningStockForm && (
        <OpeningStockForm onDone={() => setShowOpeningStockForm(false)} />
      )}

      {!isLoading && !error && data?.length !== 0 && (
      <Card className="mb-4 flex items-center gap-3 p-4">
        <StatusBadge variant={lowCount > 0 ? "warning" : "success"}>
          {lowCount > 0 ? `${lowCount} item${lowCount > 1 ? "s" : ""} running low` : "Nothing is running low"}
        </StatusBadge>
        <span className="text-sm text-muted-foreground">
          Available leaves out stock already promised to approved orders.
        </span>
      </Card>
      )}

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorText>{(error as Error).message}</ErrorText>
      ) : data?.length === 0 ? (
        <EmptyState>No items yet. Add your materials and products in Setup, Products &amp; materials, then record their opening stock here.</EmptyState>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Item</Th>
              <Th>Type</Th>
              <Th numeric>Available</Th>
              <Th numeric>Average cost</Th>
              <Th numeric>Warn me below</Th>
              <Th>Status</Th>
            </tr>
          </THead>
          <tbody>
            {data?.map((row) => (
              <tr key={row.itemId} className="hover:bg-secondary/30">
                <Td>
                  <p className="font-medium text-foreground">{row.name}</p>
                </Td>
                <Td className="text-muted-foreground">{TYPE_LABEL[row.type]}</Td>
                <Td numeric className="font-semibold text-foreground">
                  {qty(row.availableQtyBase, row.unit)}
                </Td>
                <Td numeric className="tabular text-muted-foreground">{averageCost(row) ?? "—"}</Td>
                <Td numeric>
                  <ReorderLevelCell row={row} canMutate={canMutate} />
                </Td>
                <Td>
                  <StatusBadge variant={row.status === "LOW" ? "warning" : "success"}>{row.status === "LOW" ? "Low" : "OK"}</StatusBadge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
