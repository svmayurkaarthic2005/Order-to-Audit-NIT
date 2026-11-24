import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";

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
    <main className="mx-auto max-w-2xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">BOM (Recipes)</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          createBomMutation.mutate();
        }}
        className="mb-6 flex flex-col gap-2 rounded border border-border p-4"
      >
        <h2 className="font-medium">New BOM</h2>
        <select
          value={finishedItemId}
          required
          onChange={(e) => setFinishedItemId(e.target.value)}
          className="rounded border border-input bg-transparent px-2 py-1"
        >
          <option value="">Finished good…</option>
          {finishedGoods.map((it) => (
            <option key={it.id} value={it.id}>
              {it.sku} — {it.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Expected yield per batch (base unit qty)"
          type="number"
          required
          value={expectedYieldQty}
          onChange={(e) => setExpectedYieldQty(e.target.value)}
          className="rounded border border-input bg-transparent px-2 py-1"
        />

        {lines.map((line, i) => (
          <div key={i} className="flex gap-2">
            <select
              value={line.rawItemId}
              required
              onChange={(e) => updateLine(i, { rawItemId: e.target.value })}
              className="flex-1 rounded border border-input bg-transparent px-2 py-1"
            >
              <option value="">Raw material / packaging…</option>
              {rawAndPackagingItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.sku} — {it.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Qty per batch (base unit)"
              type="number"
              required
              value={line.qtyPerBatch}
              onChange={(e) => updateLine(i, { qtyPerBatch: e.target.value })}
              className="w-40 rounded border border-input bg-transparent px-2 py-1"
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
          disabled={createBomMutation.isPending}
          className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
        >
          Create BOM
        </button>
      </form>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          createPackSizeMutation.mutate();
        }}
        className="mb-6 flex flex-col gap-2 rounded border border-border p-4"
      >
        <h2 className="font-medium">New pack size</h2>
        <select
          value={packBomId}
          required
          onChange={(e) => setPackBomId(e.target.value)}
          className="rounded border border-input bg-transparent px-2 py-1"
        >
          <option value="">Base BOM…</option>
          {boms?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.finishedItem.sku} — {b.finishedItem.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Label (e.g. 500g)"
          required
          value={packLabel}
          onChange={(e) => setPackLabel(e.target.value)}
          className="rounded border border-input bg-transparent px-2 py-1"
        />
        <input
          placeholder="Multiplier (x base BOM)"
          type="number"
          required
          value={packMultiplier}
          onChange={(e) => setPackMultiplier(e.target.value)}
          className="rounded border border-input bg-transparent px-2 py-1"
        />
        {packError && <p className="text-sm text-destructive">{packError}</p>}
        <button
          type="submit"
          disabled={createPackSizeMutation.isPending}
          className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
        >
          Create pack size
        </button>
      </form>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !boms || boms.length === 0 ? (
        <p className="text-muted-foreground">No BOMs yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {boms.map((b) => (
            <li key={b.id} className="rounded border border-border p-3">
              <p className="font-medium">
                {b.finishedItem.sku} — {b.finishedItem.name} · yield {b.expectedYieldQty}/batch
              </p>
              <ul className="ml-4 list-disc text-sm text-muted-foreground">
                {b.lines.map((l, i) => (
                  <li key={i}>
                    {l.rawItem.sku} — {l.rawItem.name}: {l.qtyPerBatch}
                  </li>
                ))}
              </ul>
              {b.packSizes.length > 0 && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Pack sizes: {b.packSizes.map((p) => `${p.label} (x${p.multiplier})`).join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
