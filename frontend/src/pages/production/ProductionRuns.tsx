import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";

type Bom = {
  id: string;
  expectedYieldQty: number;
  finishedItem: { name: string; sku: string };
  lines: { rawItemId: string; qtyPerBatch: number; rawItem: { sku: string; name: string; type: string } }[];
};
type RunMaterial = { itemId: string; plannedQtyBase: number; actualQtyBase: number | null; item: { sku: string } };
type Run = {
  id: string;
  status: "DRAFT" | "STARTED" | "COMPLETED" | "CANCELLED";
  batchSize: number;
  actualOutputQty: number | null;
  damagedQty: number | null;
  bomHeader: { finishedItem: { name: string; sku: string } };
  materials: RunMaterial[];
};
type ConsumptionLine = { itemId: string; qtyBase: string };
type PackagingLine = { itemId: string; qtyBase: string; damagedQty: string };

export default function ProductionRuns() {
  const queryClient = useQueryClient();
  const [bomId, setBomId] = useState("");
  const [batchSize, setBatchSize] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const [startingRunId, setStartingRunId] = useState<string | null>(null);
  const [consumption, setConsumption] = useState<ConsumptionLine[]>([]);

  const [completingRunId, setCompletingRunId] = useState<string | null>(null);
  const [actualOutputQty, setActualOutputQty] = useState("");
  const [packaging, setPackaging] = useState<PackagingLine[]>([]);

  const { data: boms } = useQuery({
    queryKey: ["boms", "production-picker"],
    queryFn: () => api.get<Bom[]>("/boms"),
  });
  const { data: runs, isLoading } = useQuery({
    queryKey: ["production-runs"],
    queryFn: () => api.get<Run[]>("/production-runs"),
  });

  const selectedBom = boms?.find((b) => b.id === bomId);
  const startingRun = runs?.find((r) => r.id === startingRunId);
  const completingRun = runs?.find((r) => r.id === completingRunId);

  const createMutation = useMutation({
    mutationFn: () => api.post("/production-runs", { bomHeaderId: bomId, batchSize: Number(batchSize) }),
    onSuccess: () => {
      setError(null);
      setBomId("");
      setBatchSize("1");
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to create production run"),
  });

  const startMutation = useMutation({
    mutationFn: (runId: string) =>
      api.post(`/production-runs/${runId}/start`, {
        actualConsumption: consumption.map((c) => ({ itemId: c.itemId, qtyBase: Number(c.qtyBase) })),
      }),
    onSuccess: () => {
      setError(null);
      setStartingRunId(null);
      setConsumption([]);
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to start production run"),
  });

  const completeMutation = useMutation({
    mutationFn: (runId: string) =>
      api.post(
        `/production-runs/${runId}/complete`,
        {
          actualOutputQty: Number(actualOutputQty),
          packagingConsumed: packaging.map((p) => ({
            itemId: p.itemId,
            qtyBase: Number(p.qtyBase || 0),
            damagedQty: Number(p.damagedQty || 0),
          })),
        },
        { "Idempotency-Key": `${runId}-${Date.now()}` },
      ),
    onSuccess: () => {
      setError(null);
      setCompletingRunId(null);
      setActualOutputQty("");
      setPackaging([]);
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to complete production run"),
  });

  const cancelMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/production-runs/${runId}/cancel`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["production-runs"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to cancel production run"),
  });

  function openStartForm(run: Run) {
    setStartingRunId(run.id);
    setCompletingRunId(null);
    const bom = boms?.find((b) => b.finishedItem.sku === run.bomHeader.finishedItem.sku);
    const rawLines = bom?.lines.filter((l) => l.rawItem.type === "RAW_MATERIAL") ?? [];
    setConsumption(rawLines.map((l) => ({ itemId: l.rawItemId, qtyBase: String(l.qtyPerBatch * run.batchSize) })));
  }

  function openCompleteForm(run: Run) {
    setCompletingRunId(run.id);
    setStartingRunId(null);
    const bom = boms?.find((b) => b.finishedItem.sku === run.bomHeader.finishedItem.sku);
    const packagingLines = bom?.lines.filter((l) => l.rawItem.type === "PACKAGING") ?? [];
    setActualOutputQty(String(bom ? bom.expectedYieldQty * run.batchSize : ""));
    setPackaging(packagingLines.map((l) => ({ itemId: l.rawItemId, qtyBase: String(l.qtyPerBatch * run.batchSize), damagedQty: "0" })));
  }

  return (
    <main className="mx-auto max-w-2xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">Production Runs</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="mb-6 flex flex-col gap-2 rounded border border-border p-4"
      >
        <h2 className="font-medium">New production run</h2>
        <select
          value={bomId}
          required
          onChange={(e) => setBomId(e.target.value)}
          className="rounded border border-input bg-transparent px-2 py-1"
        >
          <option value="">BOM…</option>
          {boms?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.finishedItem.sku} — {b.finishedItem.name} (yield {b.expectedYieldQty}/batch)
            </option>
          ))}
        </select>
        <input
          placeholder="Batch size"
          type="number"
          required
          value={batchSize}
          onChange={(e) => setBatchSize(e.target.value)}
          className="rounded border border-input bg-transparent px-2 py-1"
        />
        {selectedBom && (
          <p className="text-sm text-muted-foreground">
            Expected yield: {selectedBom.expectedYieldQty * Number(batchSize || 1)}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
        >
          Create (DRAFT)
        </button>
      </form>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !runs || runs.length === 0 ? (
        <p className="text-muted-foreground">No production runs yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {runs.map((run) => (
            <li key={run.id} className="rounded border border-border p-3">
              <p className="font-medium">
                {run.bomHeader.finishedItem.sku} — {run.bomHeader.finishedItem.name} · batch {run.batchSize} ·{" "}
                <span className="text-sm">{run.status}</span>
              </p>

              {run.status === "STARTED" && run.materials.length > 0 && (
                <ul className="ml-4 list-disc text-sm text-muted-foreground">
                  {run.materials.map((m, i) => (
                    <li key={i}>
                      {m.item.sku}: planned {m.plannedQtyBase}
                      {m.actualQtyBase !== null && `, actual ${m.actualQtyBase}`}
                    </li>
                  ))}
                </ul>
              )}
              {run.status === "COMPLETED" && (
                <p className="text-sm text-muted-foreground">
                  Output {run.actualOutputQty} · damaged {run.damagedQty ?? 0}
                </p>
              )}

              <div className="mt-2 flex gap-3 text-sm">
                {run.status === "DRAFT" && (
                  <button onClick={() => openStartForm(run)} className="text-primary underline">
                    Start
                  </button>
                )}
                {run.status === "STARTED" && (
                  <button onClick={() => openCompleteForm(run)} className="text-primary underline">
                    Complete
                  </button>
                )}
                {(run.status === "DRAFT" || run.status === "STARTED") && (
                  <button onClick={() => cancelMutation.mutate(run.id)} className="text-destructive underline">
                    Cancel
                  </button>
                )}
              </div>

              {startingRunId === run.id && startingRun && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    startMutation.mutate(run.id);
                  }}
                  className="mt-3 flex flex-col gap-2 rounded border border-border p-3"
                >
                  <p className="text-sm font-medium">Actual raw-material consumption</p>
                  {consumption.map((line, i) => (
                    <input
                      key={line.itemId}
                      type="number"
                      required
                      value={line.qtyBase}
                      onChange={(e) =>
                        setConsumption((prev) => prev.map((l, idx) => (idx === i ? { ...l, qtyBase: e.target.value } : l)))
                      }
                      className="rounded border border-input bg-transparent px-2 py-1"
                    />
                  ))}
                  <button
                    type="submit"
                    disabled={startMutation.isPending}
                    className="self-start rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
                  >
                    Confirm start (issues stock)
                  </button>
                </form>
              )}

              {completingRunId === run.id && completingRun && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    completeMutation.mutate(run.id);
                  }}
                  className="mt-3 flex flex-col gap-2 rounded border border-border p-3"
                >
                  <label className="text-sm font-medium">
                    Actual output qty
                    <input
                      type="number"
                      required
                      value={actualOutputQty}
                      onChange={(e) => setActualOutputQty(e.target.value)}
                      className="mt-1 w-full rounded border border-input bg-transparent px-2 py-1"
                    />
                  </label>
                  <p className="text-sm font-medium">Packaging consumed / damaged</p>
                  {packaging.map((line, i) => (
                    <div key={line.itemId} className="flex gap-2">
                      <input
                        placeholder="Consumed"
                        type="number"
                        value={line.qtyBase}
                        onChange={(e) =>
                          setPackaging((prev) => prev.map((l, idx) => (idx === i ? { ...l, qtyBase: e.target.value } : l)))
                        }
                        className="w-1/2 rounded border border-input bg-transparent px-2 py-1"
                      />
                      <input
                        placeholder="Damaged"
                        type="number"
                        value={line.damagedQty}
                        onChange={(e) =>
                          setPackaging((prev) => prev.map((l, idx) => (idx === i ? { ...l, damagedQty: e.target.value } : l)))
                        }
                        className="w-1/2 rounded border border-input bg-transparent px-2 py-1"
                      />
                    </div>
                  ))}
                  <button
                    type="submit"
                    disabled={completeMutation.isPending}
                    className="self-start rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
                  >
                    Confirm complete
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
