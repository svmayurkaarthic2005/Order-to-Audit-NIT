import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Select } from "@/components/ui";

type Item = { id: string; sku: string; name: string; type: string };
type BomLineInput = { rawItemId: string; qtyPerBatch: string };
type Bom = {
  id: string;
  finishedItemId: string;
  expectedYieldQty: number;
  finishedItem: { name: string; sku: string };
  lines: { rawItem: { sku: string; name: string }; qtyPerBatch: number }[];
  packSizes: { id: string; label: string; multiplier: number }[];
};

const emptyLine: BomLineInput = { rawItemId: "", qtyPerBatch: "" };

export default function BOM() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const queryClient = useQueryClient();
  const [finishedItemId, setFinishedItemId] = useState("");
  const [expectedYieldQty, setExpectedYieldQty] = useState("");
  const [lines, setLines] = useState<BomLineInput[]>([{ ...emptyLine }]);
  const [error, setError] = useState<string | null>(null);

  const [packBomId, setPackBomId] = useState("");
  const [packLabel, setPackLabel] = useState("");
  const [packMultiplier, setPackMultiplier] = useState("1");
  const [packError, setPackError] = useState<string | null>(null);

  const { data: items } = useQuery({
    queryKey: ["items", "bom-picker"],
    queryFn: () => api.get<{ items: Item[] }>("/items"),
  });
  const { data: boms, isLoading } = useQuery({
    queryKey: ["boms"],
    queryFn: () => api.get<Bom[]>("/boms"),
  });

  const finishedGoods = items?.items.filter((i) => i.type === "FINISHED_GOOD") ?? [];
  const rawAndPackagingItems = items?.items.filter((i) => i.type !== "FINISHED_GOOD") ?? [];

  const createBomMutation = useMutation({
    mutationFn: () =>
      api.post("/boms", {
        finishedItemId,
        expectedYieldQty: Number(expectedYieldQty),
        lines: lines.map((l) => ({ rawItemId: l.rawItemId, qtyPerBatch: Number(l.qtyPerBatch) })),
      }),
    onSuccess: () => {
      setError(null);
      setFinishedItemId("");
      setExpectedYieldQty("");
      setLines([{ ...emptyLine }]);
      queryClient.invalidateQueries({ queryKey: ["boms"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create BOM"),
  });

  const createPackSizeMutation = useMutation({
    mutationFn: () => {
      const bom = boms?.find((b) => b.id === packBomId);
      return api.post("/pack-sizes", {
        finishedItemId: bom?.finishedItemId,
        baseBomId: packBomId,
        multiplier: Number(packMultiplier),
        label: packLabel,
      });
    },
    onSuccess: () => {
      setPackError(null);
      setPackBomId("");
      setPackLabel("");
      setPackMultiplier("1");
      queryClient.invalidateQueries({ queryKey: ["boms"] });
    },
    onError: (err) => setPackError(err instanceof ApiError ? err.message : "Failed to create pack size"),
  });

  function updateLine(index: number, patch: Partial<BomLineInput>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  return (
    <div className="w-full min-w-0">
      <PageHeader title="BOM / recipes" description="Material requirements and expected yield per finished good." />

      {canMutate && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">New BOM</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createBomMutation.mutate();
            }}
            className="flex flex-col gap-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Finished good" required>
                <Select value={finishedItemId} required onChange={(e) => setFinishedItemId(e.target.value)} className="w-full">
                  <option value="">Select…</option>
                  {finishedGoods.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.sku} — {it.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Expected yield per batch" required>
                <Input type="number" required value={expectedYieldQty} onChange={(e) => setExpectedYieldQty(e.target.value)} className="w-full" />
              </Field>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Material lines</p>
              <div className="flex flex-col gap-2">
                {lines.map((line, i) => (
                  <div key={i} className="flex flex-col sm:flex-row gap-2">
                    <Select
                      value={line.rawItemId}
                      required
                      onChange={(e) => updateLine(i, { rawItemId: e.target.value })}
                      className="flex-1"
                    >
                      <option value="">Raw material / packaging…</option>
                      {rawAndPackagingItems.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.sku} — {it.name}
                        </option>
                      ))}
                    </Select>
                    <Input
                      placeholder="Qty/batch"
                      type="number"
                      required
                      value={line.qtyPerBatch}
                      onChange={(e) => updateLine(i, { qtyPerBatch: e.target.value })}
                      className="w-full sm:w-32"
                    />
                  </div>
                ))}
              </div>
            </div>

            <Button type="button" variant="secondary" size="sm" onClick={() => setLines((prev) => [...prev, { ...emptyLine }])} className="self-start">
              + Add line
            </Button>

            {error && <ErrorText>{error}</ErrorText>}

            <Button type="submit" disabled={createBomMutation.isPending} className="self-start">
              Create BOM
            </Button>
          </form>
        </Card>
      )}

      {canMutate && (
        <Card className="mb-6 p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">New pack size</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createPackSizeMutation.mutate();
            }}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <Field label="Base BOM" required>
                <Select value={packBomId} required onChange={(e) => setPackBomId(e.target.value)} className="w-full">
                  <option value="">Select…</option>
                  {boms?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.finishedItem.sku} — {b.finishedItem.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-full sm:w-36">
              <Field label="Label" required>
                <Input placeholder="e.g. 500g" required value={packLabel} onChange={(e) => setPackLabel(e.target.value)} />
              </Field>
            </div>
            <div className="w-full sm:w-28">
              <Field label="Multiplier" required>
                <Input type="number" required value={packMultiplier} onChange={(e) => setPackMultiplier(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" disabled={createPackSizeMutation.isPending}>
              Create
            </Button>
          </form>
          {packError && <div className="mt-2"><ErrorText>{packError}</ErrorText></div>}
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !boms || boms.length === 0 ? (
        <EmptyState>No BOMs yet.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {boms.map((b) => (
            <li key={b.id}>
              <Card className="p-4">
                <p className="font-medium text-foreground">
                  {b.finishedItem.sku} — {b.finishedItem.name}{" "}
                  <span className="font-normal text-muted-foreground">· yield {b.expectedYieldQty}/batch</span>
                </p>
                <ul className="mt-2 text-sm text-muted-foreground">
                  {b.lines.map((l, i) => (
                    <li key={i} className="flex justify-between">
                      <span>
                        {l.rawItem.sku} — {l.rawItem.name}
                      </span>
                      <span className="tabular">{l.qtyPerBatch}</span>
                    </li>
                  ))}
                </ul>
                {b.packSizes.length > 0 && (
                  <p className="mt-2 border-t border-border pt-2 text-sm text-muted-foreground">
                    Pack sizes: {b.packSizes.map((p) => `${p.label} (×${p.multiplier})`).join(", ")}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
