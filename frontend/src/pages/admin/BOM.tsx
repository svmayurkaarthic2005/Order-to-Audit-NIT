import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Field, Input, Loading, PageHeader, Select, qty, unitOf } from "@/components/ui";

type Item = { id: string; sku: string; name: string; type: string; baseUnit: string };
type BomLineInput = { rawItemId: string; qtyPerBatch: string };
type PackLineInput = { itemId: string; qtyPerBatch: string };
type Bom = {
  id: string;
  finishedItemId: string;
  expectedYieldQty: number;
  version: number;
  createdAt: string;
  finishedItem: { name: string; sku: string };
  lines: { rawItemId: string; rawItem: { sku: string; name: string; baseUnit: string }; qtyPerBatch: number }[];
  packSizes: {
    id: string;
    label: string;
    expectedYieldQty: number;
    finishedItem: { name: string };
    lines: { itemId: string; qtyPerBatch: number; item: { name: string; baseUnit: string } }[];
  }[];
};

const emptyLine: BomLineInput = { rawItemId: "", qtyPerBatch: "" };

export default function BOM() {
  const { user } = useAuth();
  // Same rule as the server: only admin and owner change recipes.
  const canMutate = user?.role === "ADMIN" || user?.role === "OWNER";
  // The recipe being edited; saving makes its next version.
  const [editing, setEditing] = useState<Bom | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  // The page scrolls inside the layout, not the window, so bring the form itself into view.
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editing]);
  const queryClient = useQueryClient();
  const [finishedItemId, setFinishedItemId] = useState("");
  const [expectedYieldQty, setExpectedYieldQty] = useState("");
  const [lines, setLines] = useState<BomLineInput[]>([{ ...emptyLine }]);
  const [error, setError] = useState<string | null>(null);
  const [showRecipeForm, setShowRecipeForm] = useState(false);
  const [showPackForm, setShowPackForm] = useState(false);

  const [packBomId, setPackBomId] = useState("");
  const [packLabel, setPackLabel] = useState("");
  const [packItemId, setPackItemId] = useState("");
  const [packExpectedYieldQty, setPackExpectedYieldQty] = useState("");
  const [packLines, setPackLines] = useState<PackLineInput[]>([{ itemId: "", qtyPerBatch: "" }]);
  const [packError, setPackError] = useState<string | null>(null);

  const { data: items } = useQuery({
    queryKey: ["items", "bom-picker"],
    queryFn: () => api.get<{ items: Item[] }>("/items"),
  });
  const { data: boms, isLoading, error: bomsError } = useQuery({
    queryKey: ["boms"],
    queryFn: () => api.get<Bom[]>("/boms"),
  });

  const finishedGoods = items?.items.filter((i) => i.type === "FINISHED_GOOD") ?? [];
  const rawAndPackagingItems = items?.items.filter((i) => i.type !== "FINISHED_GOOD") ?? [];
  const packagingItems = items?.items.filter((i) => i.type === "PACKAGING") ?? [];
  const baseUnitOf = (itemId: string) => items?.items.find((i) => i.id === itemId)?.baseUnit ?? "PIECE";

  const { data: versions } = useQuery({
    queryKey: ["boms", historyFor, "versions"],
    queryFn: () => api.get<Bom[]>(`/boms/${historyFor}/versions`),
    enabled: historyFor !== null,
  });

  const createBomMutation = useMutation({
    mutationFn: () => {
      const body = {
        expectedYieldQty: Number(expectedYieldQty),
        lines: lines.map((l) => ({ rawItemId: l.rawItemId, qtyPerBatch: Math.round(Number(l.qtyPerBatch) * unitOf(baseUnitOf(l.rawItemId)).factor) })),
      };
      return editing ? api.put(`/boms/${editing.id}`, body) : api.post("/boms", { finishedItemId, ...body });
    },
    onSuccess: () => {
      setError(null);
      setFinishedItemId("");
      setExpectedYieldQty("");
      setLines([{ ...emptyLine }]);
      setShowRecipeForm(false);
      setEditing(null);
      setHistoryFor(null);
      queryClient.invalidateQueries({ queryKey: ["boms"] });
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't save the recipe."),
  });

  const createPackSizeMutation = useMutation({
    mutationFn: () => {
      const bom = boms?.find((b) => b.id === packBomId);
      return api.post("/pack-sizes", {
        // The product whose stock a run packed this way goes into. Blank
        // means the recipe's own product (same item, just a named pack).
        finishedItemId: packItemId || bom?.finishedItemId,
        baseBomId: packBomId,
        // Output quantity is specific to the selected finished pack.
        multiplier: 1,
        label: packLabel,
        expectedYieldQty: Number(packExpectedYieldQty),
        lines: packLines.map((line) => ({
          itemId: line.itemId,
          qtyPerBatch: Math.round(Number(line.qtyPerBatch) * unitOf(baseUnitOf(line.itemId)).factor),
        })),
      });
    },
    onSuccess: () => {
      setPackError(null);
      setPackBomId("");
      setPackLabel("");
      setPackItemId("");
      setPackExpectedYieldQty("");
      setPackLines([{ itemId: "", qtyPerBatch: "" }]);
      setShowPackForm(false);
      queryClient.invalidateQueries({ queryKey: ["boms"] });
    },
    onError: (err) => setPackError(err instanceof ApiError ? err.message : "Couldn't save the pack size."),
  });

  function startEdit(b: Bom) {
    setEditing(b);
    setShowRecipeForm(true);
    setError(null);
    setFinishedItemId(b.finishedItemId);
    setExpectedYieldQty(String(b.expectedYieldQty));
    setLines(b.lines.map((l) => ({ rawItemId: l.rawItemId, qtyPerBatch: String(l.qtyPerBatch / unitOf(l.rawItem.baseUnit).factor) })));
  }

  function closeRecipeForm() {
    setShowRecipeForm(false);
    setEditing(null);
    setFinishedItemId("");
    setExpectedYieldQty("");
    setLines([{ ...emptyLine }]);
  }

  function updateLine(index: number, patch: Partial<BomLineInput>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function updatePackLine(index: number, patch: Partial<PackLineInput>) {
    setPackLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Recipes"
        description="What goes into one batch of each product, and how many packets a batch should make. Production runs use these amounts."
        actions={
          canMutate ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => setShowPackForm((v) => !v)}>
                {showPackForm ? "Close" : "New pack size"}
              </Button>
              <Button size="sm" onClick={() => (showRecipeForm ? closeRecipeForm() : setShowRecipeForm(true))}>
                {showRecipeForm ? "Close" : "New recipe"}
              </Button>
            </>
          ) : undefined
        }
      />

      {canMutate && showRecipeForm && (
        <div ref={formRef} className="scroll-mt-4">
        <Card className="mb-4 p-4">
          <h2 className="text-sm font-semibold text-foreground">
            {editing ? `Edit recipe: ${editing.finishedItem.name}` : "New recipe"}
          </h2>
          <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
            {editing
              ? `Saving makes version ${editing.version + 1}. Version ${editing.version} is kept, and runs already planned or done keep using it.`
              : "What goes into one batch, and how many packets it makes."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createBomMutation.mutate();
            }}
            className="flex flex-col gap-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Product" required>
                <Select value={finishedItemId} required disabled={editing !== null} onChange={(e) => setFinishedItemId(e.target.value)} className="w-full">
                  <option value="">Choose a product</option>
                  {finishedGoods.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Packets one batch makes" required>
                <Input type="number" required value={expectedYieldQty} onChange={(e) => setExpectedYieldQty(e.target.value)} className="w-full" />
              </Field>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Ingredients and packaging for one batch</p>
              <div className="flex flex-col gap-2">
                {lines.map((line, i) => (
                  <div key={i} className="flex flex-col sm:flex-row items-center gap-2">
                    <Select
                      value={line.rawItemId}
                      required
                      onChange={(e) => updateLine(i, { rawItemId: e.target.value })}
                      className="flex-1 w-full"
                    >
                      <option value="">Choose an item</option>
                      {rawAndPackagingItems.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name}
                        </option>
                      ))}
                    </Select>
                    <Input
                      placeholder={`Amount (${unitOf(baseUnitOf(line.rawItemId)).label})`}
                      aria-label={`Amount per batch in ${unitOf(baseUnitOf(line.rawItemId)).label}`}
                      type="number"
                      step="any"
                      min="0"
                      required
                      value={line.qtyPerBatch}
                      onChange={(e) => updateLine(i, { qtyPerBatch: e.target.value })}
                      className="w-full sm:w-36"
                    />
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive-bg hover:text-destructive"
                        title="Remove"
                        aria-label="Remove this item"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <Button type="button" variant="secondary" size="sm" onClick={() => setLines((prev) => [...prev, { ...emptyLine }])} className="self-start">
              Add another item
            </Button>

            {error && <ErrorText>{error}</ErrorText>}

            <Button type="submit" disabled={createBomMutation.isPending} className="self-start">
              {editing ? `Save as version ${editing.version + 1}` : "Save recipe"}
            </Button>
          </form>
        </Card>
        </div>
      )}

      {canMutate && showPackForm && (
        <Card className="mb-6 overflow-hidden">
          <div className="border-b border-border/60 bg-secondary/30 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-foreground">New pack size</h2>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createPackSizeMutation.mutate();
            }}
            className="p-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
              <div className="sm:col-span-1 lg:col-span-4">
                <Field label="Recipe" required>
                  <Select value={packBomId} required onChange={(e) => setPackBomId(e.target.value)} className="w-full">
                    <option value="">Choose a recipe</option>
                    {boms?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.finishedItem.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-1 lg:col-span-4">
                <Field label="Stock goes into">
                  <Select value={packItemId} onChange={(e) => setPackItemId(e.target.value)} className="w-full">
                    <option value="">Same product as the recipe</option>
                    {finishedGoods.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-1 lg:col-span-2">
                <Field label="Pack label" required>
                  <Input placeholder="e.g. 500 g" required value={packLabel} onChange={(e) => setPackLabel(e.target.value)} className="w-full" />
                </Field>
              </div>
              <div className="sm:col-span-1 lg:col-span-2">
                <Field label="Expected packets per batch" required>
                  <Input type="number" min="1" step="1" required value={packExpectedYieldQty} onChange={(e) => setPackExpectedYieldQty(e.target.value)} className="w-full" />
                </Field>
              </div>
            </div>

            <div className="mt-4 border-t border-border/50 pt-3.5">
              <p className="mb-2 text-sm font-medium text-foreground">Packaging required for this pack, per batch</p>
              <div className="flex flex-col gap-2">
                {packLines.map((line, i) => (
                  <div key={i} className="flex flex-col items-center gap-2 sm:flex-row">
                    <Select
                      value={line.itemId}
                      required
                      onChange={(e) => updatePackLine(i, { itemId: e.target.value })}
                      className="w-full flex-1"
                    >
                      <option value="">Choose packaging item</option>
                      {packagingItems.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </Select>
                    <Input
                      type="number"
                      min="0.001"
                      step="any"
                      required
                      placeholder={`Amount (${unitOf(baseUnitOf(line.itemId)).label})`}
                      aria-label={`Packaging amount per batch in ${unitOf(baseUnitOf(line.itemId)).label}`}
                      value={line.qtyPerBatch}
                      onChange={(e) => updatePackLine(i, { qtyPerBatch: e.target.value })}
                      className="w-full sm:w-44"
                    />
                    {packLines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPackLines((prev) => prev.filter((_, index) => index !== i))}
                        className="rounded-lg p-2 text-muted-foreground hover:bg-destructive-bg hover:text-destructive"
                        aria-label="Remove packaging line"
                        title="Remove packaging line"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => setPackLines((prev) => [...prev, { itemId: "", qtyPerBatch: "" }])}>
                Add packaging item
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Raw ingredients remain shared with the recipe. Only the packaging listed here is required for this pack.
                For example, a 500 g pack might make 80 packets per batch and use 80 pouches.
              </p>
            </div>

            <div className="mt-4 flex justify-end border-t border-border/50 pt-3.5">
              <Button type="submit" disabled={createPackSizeMutation.isPending} className="px-6">
                {createPackSizeMutation.isPending ? "Saving…" : "Save pack size"}
              </Button>
            </div>
          </form>
          {packError && <div className="p-4 pt-0"><ErrorText>{packError}</ErrorText></div>}
        </Card>
      )}

      {isLoading ? (
        <Loading />
      ) : bomsError ? (
        <ErrorText>{(bomsError as Error).message}</ErrorText>
      ) : !boms || boms.length === 0 ? (
        <EmptyState>No recipes yet. Add one so production runs know what to use.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {boms.map((b) => (
            <li key={b.id}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-foreground">
                    {b.finishedItem.name}
                    <span className="ml-2 font-normal text-muted-foreground">makes {b.expectedYieldQty} packets per batch</span>
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">Version {b.version}</span>
                    {b.version > 1 && (
                      <Button size="sm" variant="secondary" onClick={() => setHistoryFor(historyFor === b.id ? null : b.id)}>
                        {historyFor === b.id ? "Hide history" : "History"}
                      </Button>
                    )}
                    {canMutate && (
                      <Button size="sm" variant="secondary" onClick={() => startEdit(b)}>
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
                <ul className="mt-2 text-sm text-muted-foreground">
                  {b.lines.map((l, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{l.rawItem.name}</span>
                      <span className="tabular">{qty(l.qtyPerBatch, l.rawItem.baseUnit)}</span>
                    </li>
                  ))}
                </ul>
                {historyFor === b.id && versions && (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Earlier versions (kept for the runs that used them)</p>
                    <ul className="flex flex-col gap-2">
                      {versions
                        .filter((v) => v.id !== b.id)
                        .map((v) => (
                          <li key={v.id} className="rounded-md bg-secondary/50 p-2.5 text-sm">
                            <p className="text-xs text-muted-foreground">
                              Version {v.version}, from {new Date(v.createdAt).toLocaleDateString("en-IN")}: {v.expectedYieldQty} packets per batch
                            </p>
                            <p className="mt-1 text-muted-foreground">
                              {v.lines.map((l) => `${l.rawItem.name} ${qty(l.qtyPerBatch, l.rawItem.baseUnit)}`).join(", ")}
                            </p>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
                {b.packSizes.length > 0 && (
                  <p className="mt-2 border-t border-border pt-2 text-sm text-muted-foreground">
                    Also packed as: {b.packSizes.map((p) => {
                      const packaging = p.lines.map((line) => `${line.item.name} ${qty(line.qtyPerBatch, line.item.baseUnit)}`).join(", ");
                      return `${p.finishedItem.name} (${p.label}: ${p.expectedYieldQty} packets per batch; ${packaging})`;
                    }).join("; ")}
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
