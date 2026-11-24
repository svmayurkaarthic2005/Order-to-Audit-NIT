import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Field, Input, Loading, PageHeader, Select, StatusBadge, money } from "@/components/ui";

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
type ConsumptionLine = { itemId: string; sku: string; qtyBase: string };
type PackagingLine = { itemId: string; sku: string; qtyBase: string; damagedQty: string };
type VarianceLine = { itemId: string; planned: number; actual: number; variancePct: number; flagged: boolean };
type Variance = { materials: VarianceLine[]; yield: VarianceLine | null };
type CostLine = { itemId: string; sku: string; name: string; qtyBase: number; unitCostPaise: number; totalCostPaise: number };
type CostBreakdown = {
  materialLines: CostLine[];
  packagingLines: CostLine[];
  laborCostPaise: number;
  overheadCostPaise: number;
  totalCostPaise: number;
  goodOutputQty: number;
  costPerGoodUnitPaise: number;
  sellingPricePaise: number | null;
  marginPaise: number | null;
} | null;

const RUN_STATUS_VARIANT = { DRAFT: "neutral", STARTED: "info", COMPLETED: "success", CANCELLED: "destructive" } as const;

function pct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

export default function ProductionRuns() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const queryClient = useQueryClient();
  const [bomId, setBomId] = useState("");
  const [batchSize, setBatchSize] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const [startingRunId, setStartingRunId] = useState<string | null>(null);
  const [consumption, setConsumption] = useState<ConsumptionLine[]>([]);

  const [completingRunId, setCompletingRunId] = useState<string | null>(null);
  const [actualOutputQty, setActualOutputQty] = useState("");
  const [packaging, setPackaging] = useState<PackagingLine[]>([]);
  const [laborCostPaise, setLaborCostPaise] = useState("");
  const [overheadCostPaise, setOverheadCostPaise] = useState("");

  const [varianceRunId, setVarianceRunId] = useState<string | null>(null);
  const [showCostExplanation, setShowCostExplanation] = useState(false);

  const { data: boms } = useQuery({
    queryKey: ["boms", "production-picker"],
    queryFn: () => api.get<Bom[]>("/boms"),
  });
  const { data: runs, isLoading, error: runsError } = useQuery({
    queryKey: ["production-runs"],
    queryFn: () => api.get<Run[]>("/production-runs"),
  });
  const { data: varianceDetail } = useQuery({
    queryKey: ["production-run-variance", varianceRunId],
    queryFn: () => api.get<Variance>(`/production-runs/${varianceRunId}/variance`),
    enabled: varianceRunId !== null,
  });
  const { data: costBreakdown } = useQuery({
    queryKey: ["production-run-cost-breakdown", varianceRunId],
    queryFn: () => api.get<CostBreakdown>(`/production-runs/${varianceRunId}/cost-breakdown`),
    enabled: varianceRunId !== null,
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
          ...(laborCostPaise ? { laborCostPaise: Number(laborCostPaise) } : {}),
          ...(overheadCostPaise ? { overheadCostPaise: Number(overheadCostPaise) } : {}),
        },
        { "Idempotency-Key": `${runId}-${Date.now()}` },
      ),
    onSuccess: () => {
      setError(null);
      setCompletingRunId(null);
      setActualOutputQty("");
      setPackaging([]);
      setLaborCostPaise("");
      setOverheadCostPaise("");
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
    setConsumption(
      rawLines.map((l) => ({ itemId: l.rawItemId, sku: l.rawItem.sku, qtyBase: String(l.qtyPerBatch * run.batchSize) })),
    );
  }

  function openCompleteForm(run: Run) {
    setCompletingRunId(run.id);
    setStartingRunId(null);
    const bom = boms?.find((b) => b.finishedItem.sku === run.bomHeader.finishedItem.sku);
    const packagingLines = bom?.lines.filter((l) => l.rawItem.type === "PACKAGING") ?? [];
    setActualOutputQty(String(bom ? bom.expectedYieldQty * run.batchSize : ""));
    setPackaging(
      packagingLines.map((l) => ({
        itemId: l.rawItemId,
        sku: l.rawItem.sku,
        qtyBase: String(l.qtyPerBatch * run.batchSize),
        damagedQty: "0",
      })),
    );
  }

  return (
    <div className="w-full min-w-0">
      <PageHeader title="Production runs" description="Create batches, issue materials, record output and track variance." />

      {canMutate && (
        <Card className="mb-6 overflow-hidden">
          <div className="border-b border-border/60 bg-secondary/30 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-foreground">New Production Run</h2>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            className="p-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
              <div className="sm:col-span-8">
                <Field label="BOM / Recipe" required>
                  <Select value={bomId} required onChange={(e) => setBomId(e.target.value)} className="w-full">
                    <option value="">Select a recipe…</option>
                    {boms?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.finishedItem.sku} — {b.finishedItem.name} (Expected yield: {b.expectedYieldQty}/batch)
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-4">
                <Field label="Batch Size (Multiplier)" required>
                  <Input type="number" required min="1" value={batchSize} onChange={(e) => setBatchSize(e.target.value)} className="w-full" />
                </Field>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border/50 pt-3.5">
              <p className="text-xs text-muted-foreground">
                {selectedBom ? (
                  <>
                    Expected yield: <span className="tabular font-semibold text-foreground">{selectedBom.expectedYieldQty * Number(batchSize || 1)}</span> units
                  </>
                ) : (
                  "Select a recipe and batch multiplier to plan required materials."
                )}
              </p>
              <Button type="submit" disabled={createMutation.isPending} className="self-end sm:self-auto px-6">
                {createMutation.isPending ? "Creating…" : "Create Run (DRAFT)"}
              </Button>
            </div>
          </form>
          {error && <div className="p-4 pt-0"><ErrorText>{error}</ErrorText></div>}
        </Card>
      )}

      {isLoading ? (
        <Loading />
      ) : runsError ? (
        <ErrorText>{(runsError as Error).message}</ErrorText>
      ) : !runs || runs.length === 0 ? (
        <EmptyState>No production runs yet.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {runs.map((run) => (
            <li key={run.id}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">
                      {run.bomHeader.finishedItem.sku} — {run.bomHeader.finishedItem.name}
                    </p>
                    <p className="text-xs text-muted-foreground">Batch size {run.batchSize}</p>
                  </div>
                  <StatusBadge variant={RUN_STATUS_VARIANT[run.status]}>{run.status}</StatusBadge>
                </div>

                {run.status === "STARTED" && run.materials.length > 0 && (
                  <ul className="mt-2 text-sm text-muted-foreground">
                    {run.materials.map((m, i) => (
                      <li key={i} className="flex justify-between">
                        <span>{m.item.sku}</span>
                        <span className="tabular">
                          planned {m.plannedQtyBase}
                          {m.actualQtyBase !== null && `, actual ${m.actualQtyBase}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {run.status === "COMPLETED" && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Output <span className="tabular font-medium text-foreground">{run.actualOutputQty}</span> · damaged{" "}
                    <span className="tabular font-medium text-foreground">{run.damagedQty ?? 0}</span>
                  </p>
                )}

                <div className="mt-3 flex gap-2">
                  {canMutate && run.status === "DRAFT" && (
                    <Button size="sm" onClick={() => openStartForm(run)}>
                      Start
                    </Button>
                  )}
                  {canMutate && run.status === "STARTED" && (
                    <Button size="sm" onClick={() => openCompleteForm(run)}>
                      Complete
                    </Button>
                  )}
                  {canMutate && (run.status === "DRAFT" || run.status === "STARTED") && (
                    <Button size="sm" variant="danger" onClick={() => cancelMutation.mutate(run.id)}>
                      Cancel
                    </Button>
                  )}
                  {run.status === "COMPLETED" && (
                    <Button size="sm" variant="secondary" onClick={() => setVarianceRunId(varianceRunId === run.id ? null : run.id)}>
                      {varianceRunId === run.id ? "Hide variance & cost" : "Variance & cost"}
                    </Button>
                  )}
                </div>

                {varianceRunId === run.id && varianceDetail && (
                  <div className="mt-3 rounded-md border border-border bg-secondary/40 p-3 text-sm">
                    <p className="mb-2 font-medium text-foreground">Planned vs. actual (±3% tolerance)</p>
                    <ul className="flex flex-col gap-1">
                      {varianceDetail.materials.map((m) => {
                        const sku = run.materials.find((rm) => rm.itemId === m.itemId)?.item.sku ?? m.itemId;
                        return (
                          <li
                            key={m.itemId}
                            className={`flex flex-wrap items-center justify-between gap-1 rounded px-2 py-1 ${m.flagged ? "bg-destructive-bg" : ""}`}
                          >
                            <span className={m.flagged ? "font-medium text-destructive" : "text-muted-foreground"}>{sku}</span>
                            <span className="tabular text-right">
                              planned {m.planned}, actual {m.actual} ({pct(m.variancePct)})
                              {m.flagged && <span className="ml-1.5 font-medium text-destructive">⚠ flagged</span>}
                            </span>
                          </li>
                        );
                      })}
                      {varianceDetail.yield && (
                        <li
                          className={`flex flex-wrap items-center justify-between gap-1 rounded px-2 py-1 ${varianceDetail.yield.flagged ? "bg-destructive-bg" : ""}`}
                        >
                          <span className={varianceDetail.yield.flagged ? "font-medium text-destructive" : "text-muted-foreground"}>
                            Yield
                          </span>
                          <span className="tabular text-right">
                            planned {varianceDetail.yield.planned}, actual {varianceDetail.yield.actual} (
                            {pct(varianceDetail.yield.variancePct)})
                            {varianceDetail.yield.flagged && <span className="ml-1.5 font-medium text-destructive">⚠ flagged</span>}
                          </span>
                        </li>
                      )}
                    </ul>
                    {costBreakdown && (
                      <div className="mt-3 border-t border-border pt-3">
                        <table className="w-full text-sm">
                          <tbody>
                            {costBreakdown.materialLines.map((l) => (
                              <tr key={l.itemId}>
                                <td className="py-0.5 text-muted-foreground">{l.sku} ({l.qtyBase})</td>
                                <td className="py-0.5 text-right tabular text-foreground">{money(l.totalCostPaise)}</td>
                              </tr>
                            ))}
                            {costBreakdown.packagingLines.map((l) => (
                              <tr key={l.itemId}>
                                <td className="py-0.5 text-muted-foreground">{l.sku} ({l.qtyBase})</td>
                                <td className="py-0.5 text-right tabular text-foreground">{money(l.totalCostPaise)}</td>
                              </tr>
                            ))}
                            <tr>
                              <td className="py-0.5 text-muted-foreground">Labour</td>
                              <td className="py-0.5 text-right tabular text-foreground">{money(costBreakdown.laborCostPaise)}</td>
                            </tr>
                            <tr>
                              <td className="py-0.5 text-muted-foreground">Overhead (power/gas)</td>
                              <td className="py-0.5 text-right tabular text-foreground">{money(costBreakdown.overheadCostPaise)}</td>
                            </tr>
                            <tr className="border-t border-border/60">
                              <td className="pt-1.5 font-medium text-foreground">Total ({costBreakdown.goodOutputQty} good units)</td>
                              <td className="pt-1.5 text-right tabular font-semibold text-foreground">{money(costBreakdown.totalCostPaise)}</td>
                            </tr>
                            <tr>
                              <td className="py-0.5 font-medium text-foreground">Cost per good unit</td>
                              <td className="py-0.5 text-right tabular font-semibold text-foreground">{money(costBreakdown.costPerGoodUnitPaise)}</td>
                            </tr>
                            {costBreakdown.sellingPricePaise !== null && (
                              <>
                                <tr>
                                  <td className="py-0.5 text-muted-foreground">Selling price (latest invoice rate)</td>
                                  <td className="py-0.5 text-right tabular text-foreground">{money(costBreakdown.sellingPricePaise)}</td>
                                </tr>
                                <tr>
                                  <td className="py-0.5 font-medium text-foreground">Margin</td>
                                  <td
                                    className={`py-0.5 text-right tabular font-semibold ${
                                      (costBreakdown.marginPaise ?? 0) >= 0 ? "text-success" : "text-destructive"
                                    }`}
                                  >
                                    {money(costBreakdown.marginPaise ?? 0)}
                                  </td>
                                </tr>
                              </>
                            )}
                          </tbody>
                        </table>

                        <button
                          type="button"
                          onClick={() => setShowCostExplanation((v) => !v)}
                          className="mt-2 text-xs font-medium text-primary hover:underline"
                        >
                          {showCostExplanation ? "Hide" : "How was this cost calculated?"}
                        </button>
                        {showCostExplanation && (
                          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                            Each raw-material and packaging line is costed at the moving weighted-average
                            rate in effect when it was issued (damaged packaging counted at the same rate
                            as what was used, since it still cost money to make). Labour and overhead are
                            entered once at completion — overhead defaults to a flat ₹500/batch when left
                            blank. The total is divided by <strong>good</strong> output only, so damaged or
                            short-yield units still carry their share of every cost. All of this is read
                            from the stock ledger as it stood at completion, so it never changes afterward
                            even if a later purchase or a BOM edit changes today's prices.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {startingRunId === run.id && startingRun && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      startMutation.mutate(run.id);
                    }}
                    className="mt-3 flex flex-col gap-2 rounded-md border border-border p-3"
                  >
                    <p className="text-sm font-medium text-foreground">Actual raw-material consumption</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {consumption.map((line, i) => (
                        <Field key={line.itemId} label={line.sku} required>
                          <Input
                            type="number"
                            required
                            value={line.qtyBase}
                            onChange={(e) =>
                              setConsumption((prev) => prev.map((l, idx) => (idx === i ? { ...l, qtyBase: e.target.value } : l)))
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    <Button type="submit" disabled={startMutation.isPending} className="mt-1 self-start">
                      Confirm start (issues stock)
                    </Button>
                  </form>
                )}

                {completingRunId === run.id && completingRun && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      completeMutation.mutate(run.id);
                    }}
                    className="mt-3 flex flex-col gap-2 rounded-md border border-border p-3"
                  >
                    <Field label="Actual output quantity" required>
                      <Input type="number" required value={actualOutputQty} onChange={(e) => setActualOutputQty(e.target.value)} />
                    </Field>
                    <p className="mt-1 text-sm font-medium text-foreground">Packaging consumed / damaged</p>
                    <div className="flex flex-col gap-2">
                      {packaging.map((line, i) => (
                        <div key={line.itemId} className="flex items-end gap-2">
                          <div className="flex-1">
                            <Field label={`${line.sku} — consumed`}>
                              <Input
                                type="number"
                                value={line.qtyBase}
                                onChange={(e) =>
                                  setPackaging((prev) => prev.map((l, idx) => (idx === i ? { ...l, qtyBase: e.target.value } : l)))
                                }
                              />
                            </Field>
                          </div>
                          <div className="flex-1">
                            <Field label="Damaged">
                              <Input
                                type="number"
                                value={line.damagedQty}
                                onChange={(e) =>
                                  setPackaging((prev) => prev.map((l, idx) => (idx === i ? { ...l, damagedQty: e.target.value } : l)))
                                }
                              />
                            </Field>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1 text-sm font-medium text-foreground">Actual expense (optional)</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="Labour cost (paise)">
                        <Input
                          type="number"
                          placeholder="Not recorded"
                          value={laborCostPaise}
                          onChange={(e) => setLaborCostPaise(e.target.value)}
                        />
                      </Field>
                      <Field label="Overhead cost (paise)">
                        <Input
                          type="number"
                          placeholder={`Default: ₹500/batch × ${run.batchSize}`}
                          value={overheadCostPaise}
                          onChange={(e) => setOverheadCostPaise(e.target.value)}
                        />
                      </Field>
                    </div>
                    <Button type="submit" disabled={completeMutation.isPending} className="mt-1 self-start">
                      Confirm complete
                    </Button>
                  </form>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
