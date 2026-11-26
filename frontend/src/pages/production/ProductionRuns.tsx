import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Field, Input, Loading, PageHeader, Select, StatusBadge, money, qty, unitOf } from "@/components/ui";

type Bom = {
  id: string;
  familyId: string;
  version: number;
  expectedYieldQty: number;
  finishedItem: { name: string; sku: string };
  lines: { rawItemId: string; qtyPerBatch: number; rawItem: { sku: string; name: string; type: string; baseUnit: string } }[];
  packSizes: {
    id: string;
    label: string;
    expectedYieldQty: number;
    finishedItemId: string;
    finishedItem: { name: string; sku: string };
    lines: { id: string; itemId: string; qtyPerBatch: number; item: { sku: string; name: string; type: string; baseUnit: string } }[];
  }[];
};
type RunMaterial = { itemId: string; plannedQtyBase: number; actualQtyBase: number | null; item: { sku: string; name: string; baseUnit: string } };
type Run = {
  id: string;
  status: "DRAFT" | "STARTED" | "COMPLETED" | "CANCELLED";
  batchSize: number;
  actualOutputQty: number | null;
  damagedQty: number | null;
  // The recipe version this run was planned with (it may since have been edited).
  bomHeader: Omit<Bom, "packSizes"> & { active: boolean };
  packSize: null | {
    id: string;
    label: string;
    expectedYieldQty: number;
    finishedItemId: string;
    finishedItem: { name: string; sku: string };
    lines: { id: string; itemId: string; qtyPerBatch: number; item: { sku: string; name: string; baseUnit: string } }[];
  };
  materials: RunMaterial[];
};
// Form quantities are in kg / L / pcs; converted to base units on submit.
type ConsumptionLine = { itemId: string; name: string; baseUnit: string; planned: string; quantity: string };
type PackagingLine = { itemId: string; name: string; baseUnit: string; planned: string; quantity: string; damagedQty: string };
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
const RUN_STATUS_LABEL = { DRAFT: "Planned", STARTED: "In progress", COMPLETED: "Done", CANCELLED: "Cancelled" } as const;

const toBase = (quantity: string, baseUnit: string) => Math.round((Number(quantity) || 0) * unitOf(baseUnit).factor);
const fromBase = (qtyBase: number, baseUnit: string) => String(qtyBase / unitOf(baseUnit).factor);

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
  // Start/finish/cancel errors belong to one run and show on its card.
  const [runError, setRunError] = useState<{ runId: string; message: string } | null>(null);

  const [startingRunId, setStartingRunId] = useState<string | null>(null);
  const [consumption, setConsumption] = useState<ConsumptionLine[]>([]);

  const [completingRunId, setCompletingRunId] = useState<string | null>(null);
  const [actualOutputQty, setActualOutputQty] = useState("");
  const [packSizeId, setPackSizeId] = useState("");
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

  const { data: stock } = useQuery({
    queryKey: ["alerts", "stock-status"],
    queryFn: () => api.get<{ itemId: string; availableQtyBase: number }[]>("/alerts/stock-status"),
  });
  const inStock = (itemId: string) => stock?.find((s) => s.itemId === itemId)?.availableQtyBase ?? 0;

  const selectedBom = boms?.find((b) => b.id === bomId);
  const selectedPackSize = selectedBom?.packSizes.find((p) => p.id === packSizeId);
  const plannedBatches = Math.max(1, Number(batchSize) || 1);
  // Shared ingredients come from the base recipe. The selected pack supplies
  // only its own packaging and the expected good packets per recipe batch.
  const plannedLines = selectedBom
    ? selectedPackSize
      ? [
          ...selectedBom.lines.filter((line) => line.rawItem.type === "RAW_MATERIAL"),
          ...selectedPackSize.lines.map((line) => ({
            rawItemId: line.itemId,
            qtyPerBatch: line.qtyPerBatch,
            rawItem: line.item,
          })),
        ]
      : selectedBom.lines
    : [];
  // The scarcest required material or pack-specific packaging limits batches.
  const maxBatches = plannedLines.length > 0
    ? Math.min(...plannedLines.filter((line) => line.qtyPerBatch > 0).map((line) => Math.floor(inStock(line.rawItemId) / line.qtyPerBatch)))
    : null;
  // Ingredients leave stock at start; packaging is issued at finish.
  const shortLines = stock && selectedBom ? plannedLines.filter((line) => inStock(line.rawItemId) < line.qtyPerBatch * plannedBatches) : [];
  const rawShort = shortLines.some((line) => line.rawItem.type === "RAW_MATERIAL");
  const packShort = shortLines.some((line) => line.rawItem.type === "PACKAGING");
  const expectedPacketsPerBatch = selectedPackSize?.expectedYieldQty ?? selectedBom?.expectedYieldQty;
  // Only ask about pack size when the product really comes in another size.
  const hasOtherPacks = !!selectedBom?.packSizes.some((p) => p.lines.length > 0 && p.finishedItem.name !== selectedBom.finishedItem.name);
  const [showCancelled, setShowCancelled] = useState(false);
  const cancelledCount = runs?.filter((r) => r.status === "CANCELLED").length ?? 0;
  const visibleRuns = runs?.filter((r) => showCancelled || r.status !== "CANCELLED");
  const startingRun = runs?.find((r) => r.id === startingRunId);
  const completingRun = runs?.find((r) => r.id === completingRunId);

  const createMutation = useMutation({
    mutationFn: () => api.post("/production-runs", {
      bomHeaderId: bomId,
      batchSize: Number(batchSize),
      ...(packSizeId ? { packSizeId } : {}),
    }),
    onSuccess: () => {
      setError(null);
      setBomId("");
      setPackSizeId("");
      setBatchSize("1");
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't plan the run."),
  });

  const recordMutation = useMutation({
    mutationFn: (runId: string) =>
      api.post(
        `/production-runs/${runId}/record`,
        {
          actualConsumption: consumption.map((c) => ({ itemId: c.itemId, qtyBase: toBase(c.quantity, c.baseUnit) })),
          actualOutputQty: Number(actualOutputQty),
          packagingConsumed: packaging.map((p) => ({
            itemId: p.itemId,
            qtyBase: toBase(p.quantity, p.baseUnit) - Number(p.damagedQty || 0), // "used" includes the damaged ones
            damagedQty: Number(p.damagedQty || 0),
          })),
          ...(laborCostPaise ? { laborCostPaise: Math.round(Number(laborCostPaise) * 100) } : {}),
          ...(overheadCostPaise ? { overheadCostPaise: Math.round(Number(overheadCostPaise) * 100) } : {}),
        },
        { "Idempotency-Key": `${runId}-${Date.now()}` },
      ),
    onSuccess: () => {
      setRunError(null);
      setStartingRunId(null);
      setConsumption([]);
      setPackaging([]);
      setActualOutputQty("");
      setLaborCostPaise("");
      setOverheadCostPaise("");
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
    onError: (err, runId) => setRunError({ runId, message: err instanceof ApiError ? err.message : "Couldn't record the run. There may not be enough of a material in stock." }),
  });

  const completeMutation = useMutation({
    mutationFn: (runId: string) =>
      api.post(
        `/production-runs/${runId}/complete`,
        {
          actualOutputQty: Number(actualOutputQty),
          packagingConsumed: packaging.map((p) => ({
            itemId: p.itemId,
            qtyBase: toBase(p.quantity, p.baseUnit) - Number(p.damagedQty || 0), // "used" includes the damaged ones
            damagedQty: Number(p.damagedQty || 0),
          })),
          ...(laborCostPaise ? { laborCostPaise: Math.round(Number(laborCostPaise) * 100) } : {}),
          ...(overheadCostPaise ? { overheadCostPaise: Math.round(Number(overheadCostPaise) * 100) } : {}),
        },
        { "Idempotency-Key": `${runId}-${Date.now()}` },
      ),
    onSuccess: () => {
      setRunError(null);
      setCompletingRunId(null);
      setActualOutputQty("");
      setPackaging([]);
      setLaborCostPaise("");
      setOverheadCostPaise("");
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
    onError: (err, runId) => setRunError({ runId, message: err instanceof ApiError ? err.message : "Couldn't finish the run." }),
  });

  const latestRecipeMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/production-runs/${runId}/use-latest-recipe`, {}),
    onSuccess: () => {
      setRunError(null);
      setStartingRunId(null);
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
    onError: (err, runId) => setRunError({ runId, message: err instanceof ApiError ? err.message : "Couldn't update the run's recipe." }),
  });

  const cancelMutation = useMutation({
    mutationFn: (runId: string) => api.post(`/production-runs/${runId}/cancel`, {}),
    onSuccess: () => {
      setRunError(null);
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
    onError: (err, runId) => setRunError({ runId, message: err instanceof ApiError ? err.message : "Couldn't cancel the run." }),
  });

  // The run's own recipe version and pack format, not whatever is latest.
  function packagingFor(run: Run): PackagingLine[] {
    const lines = run.packSize
      ? run.packSize.lines.map((line) => ({ itemId: line.itemId, name: line.item.name, baseUnit: line.item.baseUnit, qtyPerBatch: line.qtyPerBatch }))
      : run.bomHeader.lines
          .filter((line) => line.rawItem.type === "PACKAGING")
          .map((line) => ({ itemId: line.rawItemId, name: line.rawItem.name, baseUnit: line.rawItem.baseUnit, qtyPerBatch: line.qtyPerBatch }));
    return lines.map((line) => ({
      itemId: line.itemId,
      name: line.name,
      baseUnit: line.baseUnit,
      planned: fromBase(line.qtyPerBatch * run.batchSize, line.baseUnit),
      quantity: "",
      damagedQty: "",
    }));
  }

  // One form for the whole run: what went in, and what came out.
  function openRecordForm(run: Run) {
    setStartingRunId(run.id);
    setCompletingRunId(null);
    const rawLines = run.bomHeader.lines.filter((l) => l.rawItem.type === "RAW_MATERIAL");
    setConsumption(
      rawLines.map((l) => ({ itemId: l.rawItemId, name: l.rawItem.name, baseUnit: l.rawItem.baseUnit, planned: fromBase(l.qtyPerBatch * run.batchSize, l.rawItem.baseUnit), quantity: "" })),
    );
    setPackaging(packagingFor(run));
    setActualOutputQty("");
    setLaborCostPaise("");
    setOverheadCostPaise("");
  }

  // Runs started before the one-step form still finish here.
  function openCompleteForm(run: Run) {
    setCompletingRunId(run.id);
    setStartingRunId(null);
    setActualOutputQty("");
    setPackaging(packagingFor(run));
  }

  return (
    <div className="w-full min-w-0">
      <PageHeader title="Production runs" description="Plan a batch, then record it: what you used and how many packets came out." />

      {canMutate && (
        <Card className="mb-6 overflow-hidden">
          <div className="border-b border-border/60 bg-secondary/30 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-foreground">Plan a new run</h2>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            className="p-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <Field label="What are you making?" required>
                  <Select value={bomId} required onChange={(e) => { setBomId(e.target.value); setPackSizeId(""); }} className="w-full">
                    <option value="">Choose a product</option>
                    {boms?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.finishedItem.name} ({b.expectedYieldQty} packets per batch)
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {hasOtherPacks && (
              <div className="sm:col-span-5">
                <Field label="Pack size">
                  <Select
                    value={packSizeId}
                    disabled={!selectedBom}
                    onChange={(e) => setPackSizeId(e.target.value)}
                    className="w-full"
                  >
                    <option value="">{selectedBom?.finishedItem.name ?? "Standard pack"}</option>
                    {selectedBom?.packSizes.map((pack) => (
                      <option key={pack.id} value={pack.id} disabled={pack.lines.length === 0}>
                        {pack.finishedItem.name} — {pack.label} ({pack.expectedYieldQty} packets per batch)
                        {pack.lines.length === 0 ? " · set it up in Recipes first" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              )}
              <div className="sm:col-span-3">
                <Field label="Number of batches" required>
                  <Input type="number" required min="1" value={batchSize} onChange={(e) => setBatchSize(e.target.value)} className="w-full" />
                </Field>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border/50 pt-3.5">
              <p className="text-xs text-muted-foreground">
                {selectedBom ? (
                  <>
                    You should get about <span className="tabular font-semibold text-foreground">{(expectedPacketsPerBatch ?? 0) * plannedBatches}</span> packets
                    {maxBatches !== null && stock && (
                      <> · stock today covers {maxBatches} {maxBatches === 1 ? "batch" : "batches"}</>
                    )}
                  </>
                ) : (
                  "Pick a product to see how many packets to expect."
                )}
              </p>
              <Button type="submit" disabled={createMutation.isPending} className="self-end sm:self-auto px-6">
                {createMutation.isPending ? "Saving…" : "Plan run"}
              </Button>
            </div>
            {selectedBom && (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-1.5 font-medium">This run needs</th>
                    <th className="pb-1.5 text-right font-medium">Needed</th>
                    <th className="pb-1.5 text-right font-medium">In stock</th>
                  </tr>
                </thead>
                <tbody>
                  {plannedLines.map((l) => {
                    const need = l.qtyPerBatch * plannedBatches;
                    const have = inStock(l.rawItemId);
                    const short = stock !== undefined && have < need;
                    return (
                      <tr key={l.rawItemId} className="border-t border-border/50">
                        <td className="py-1.5">{l.rawItem.name}</td>
                        <td className="py-1.5 text-right tabular">{qty(need, l.rawItem.baseUnit)}</td>
                        <td className={`py-1.5 text-right tabular ${short ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                          {stock ? qty(have, l.rawItem.baseUnit) : "…"}
                          {short && " (short)"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {(rawShort || packShort) && (
              <p className="mt-3 text-xs text-muted-foreground">
                You can still plan this run.{" "}
                {rawShort
                  ? "It can't start until the short ingredients are bought."
                  : "It can start now, but buy the short packaging before you finish it."}
              </p>
            )}
          </form>
          {error && <div className="p-4 pt-0"><ErrorText>{error}</ErrorText></div>}
        </Card>
      )}

      {isLoading ? (
        <Loading />
      ) : runsError ? (
        <ErrorText>{(runsError as Error).message}</ErrorText>
      ) : !runs || runs.length === 0 ? (
        <EmptyState>No runs yet. Plan one above to get started.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleRuns?.map((run) => (
            <li key={run.id}>
              <Card className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">
                      {run.packSize?.finishedItem.name ?? run.bomHeader.finishedItem.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {run.batchSize} {run.batchSize === 1 ? "batch" : "batches"}{run.packSize ? `, ${run.packSize.label} pack` : ""}
                    </p>
                  </div>
                  <StatusBadge variant={RUN_STATUS_VARIANT[run.status]}>{RUN_STATUS_LABEL[run.status]}</StatusBadge>
                </div>

                {run.status === "STARTED" && run.materials.length > 0 && (
                  <ul className="mt-2 text-sm text-muted-foreground">
                    {run.materials.map((m, i) => (
                      <li key={i} className="flex justify-between">
                        <span>{m.item.name}</span>
                        <span className="tabular">
                          {m.actualQtyBase !== null ? `used ${qty(m.actualQtyBase, m.item.baseUnit)}` : `plan ${qty(m.plannedQtyBase, m.item.baseUnit)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {run.status === "COMPLETED" && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Made <span className="tabular font-medium text-foreground">{run.actualOutputQty}</span> packets, {" "}
                    <span className="tabular font-medium text-foreground">{run.damagedQty ?? 0}</span> damaged
                  </p>
                )}

                {run.status === "DRAFT" && !run.bomHeader.active && (() => {
                  const latest = boms?.find((b) => b.familyId === run.bomHeader.familyId);
                  return (
                    <div className="mt-2 flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-bg p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-foreground">
                        The recipe has changed since this run was planned
                        {latest ? ` (now version ${latest.version})` : ""}. It will use version {run.bomHeader.version} unless you update it.
                      </span>
                      {canMutate && (
                        <Button size="sm" variant="secondary" disabled={latestRecipeMutation.isPending} onClick={() => latestRecipeMutation.mutate(run.id)}>
                          Use latest recipe
                        </Button>
                      )}
                    </div>
                  );
                })()}
                {runError?.runId === run.id && (
                  <div className="mt-2">
                    <ErrorText>{runError.message}</ErrorText>
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  {canMutate && run.status === "DRAFT" && (
                    <Button size="sm" onClick={() => openRecordForm(run)}>
                      Record run
                    </Button>
                  )}
                  {canMutate && run.status === "STARTED" && (
                    <Button size="sm" onClick={() => openCompleteForm(run)}>
                      Finish run
                    </Button>
                  )}
                  {canMutate && (run.status === "DRAFT" || run.status === "STARTED") && (
                    <Button size="sm" variant="danger" onClick={() => cancelMutation.mutate(run.id)}>
                      Cancel
                    </Button>
                  )}
                  {run.status === "COMPLETED" && (
                    <Button size="sm" variant="secondary" onClick={() => setVarianceRunId(varianceRunId === run.id ? null : run.id)}>
                      {varianceRunId === run.id ? "Hide details" : "How did it go?"}
                    </Button>
                  )}
                </div>

                {varianceRunId === run.id && varianceDetail && (
                  <div className="mt-3 rounded-md border border-border bg-secondary/40 p-3 text-sm">
                    <p className="mb-2 font-medium text-foreground">Plan against what was actually used. More than 3% off gets flagged.</p>
                    <ul className="flex flex-col gap-1">
                      {varianceDetail.materials.map((m) => {
                        const item = run.materials.find((rm) => rm.itemId === m.itemId)?.item;
                        return (
                          <li
                            key={m.itemId}
                            className={`flex flex-wrap items-center justify-between gap-1 rounded px-2 py-1 ${m.flagged ? "bg-destructive-bg" : ""}`}
                          >
                            <span className={m.flagged ? "font-medium text-destructive" : "text-muted-foreground"}>{item?.name ?? "Material"}</span>
                            <span className="tabular text-right">
                              plan {item ? qty(m.planned, item.baseUnit) : m.planned}, used {item ? qty(m.actual, item.baseUnit) : m.actual} ({pct(m.variancePct)})
                              {m.flagged && <span className="ml-1.5 font-medium text-destructive">too far off</span>}
                            </span>
                          </li>
                        );
                      })}
                      {varianceDetail.yield && (
                        <li
                          className={`flex flex-wrap items-center justify-between gap-1 rounded px-2 py-1 ${varianceDetail.yield.flagged ? "bg-destructive-bg" : ""}`}
                        >
                          <span className={varianceDetail.yield.flagged ? "font-medium text-destructive" : "text-muted-foreground"}>
                            Packets made
                          </span>
                          <span className="tabular text-right">
                            expected {varianceDetail.yield.planned}, got {varianceDetail.yield.actual} (
                            {pct(varianceDetail.yield.variancePct)})
                            {varianceDetail.yield.flagged && <span className="ml-1.5 font-medium text-destructive">too far off</span>}
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
                                <td className="py-0.5 text-muted-foreground">{l.name}</td>
                                <td className="py-0.5 text-right tabular text-foreground">{money(l.totalCostPaise)}</td>
                              </tr>
                            ))}
                            {costBreakdown.packagingLines.map((l) => (
                              <tr key={l.itemId}>
                                <td className="py-0.5 text-muted-foreground">{l.name}</td>
                                <td className="py-0.5 text-right tabular text-foreground">{money(l.totalCostPaise)}</td>
                              </tr>
                            ))}
                            <tr>
                              <td className="py-0.5 text-muted-foreground">Labour</td>
                              <td className="py-0.5 text-right tabular text-foreground">{money(costBreakdown.laborCostPaise)}</td>
                            </tr>
                            <tr>
                              <td className="py-0.5 text-muted-foreground">Gas, power and other running costs</td>
                              <td className="py-0.5 text-right tabular text-foreground">{money(costBreakdown.overheadCostPaise)}</td>
                            </tr>
                            <tr className="border-t border-border/60">
                              <td className="pt-1.5 font-medium text-foreground">Total cost ({costBreakdown.goodOutputQty} good packets)</td>
                              <td className="pt-1.5 text-right tabular font-semibold text-foreground">{money(costBreakdown.totalCostPaise)}</td>
                            </tr>
                            <tr>
                              <td className="py-0.5 font-medium text-foreground">Cost per packet</td>
                              <td className="py-0.5 text-right tabular font-semibold text-foreground">{money(costBreakdown.costPerGoodUnitPaise)}</td>
                            </tr>
                            {costBreakdown.sellingPricePaise !== null && (
                              <>
                                <tr>
                                  <td className="py-0.5 text-muted-foreground">Selling price (from the latest invoice)</td>
                                  <td className="py-0.5 text-right tabular text-foreground">{money(costBreakdown.sellingPricePaise)}</td>
                                </tr>
                                <tr>
                                  <td className="py-0.5 font-medium text-foreground">Profit per packet</td>
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
                            Each material is priced at the average you'd paid for it when the run started.
                            Damaged packaging counts too, because you still paid for it. Running costs are
                            ₹500 per batch unless you entered your own. The total is then split across the
                            good packets only. These figures are saved when the run finishes, so later
                            price changes don't alter them.
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
                      recordMutation.mutate(run.id);
                    }}
                    className="mt-3 flex flex-col gap-3 rounded-md border border-border p-3"
                  >
                    <p className="text-sm text-muted-foreground">Type what was really used.</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-xs text-muted-foreground">
                            <th className="py-1.5 text-left font-medium">Material</th>
                            <th className="py-1.5 text-right font-medium">Planned</th>
                            <th className="py-1.5 pl-3 text-left font-medium">Actually used</th>
                            <th className="py-1.5 pl-3 text-left font-medium">Of which damaged</th>
                          </tr>
                        </thead>
                        <tbody>
                          {consumption.map((line, i) => (
                            <tr key={line.itemId} className="border-b border-border/60">
                              <td className="py-1.5 text-foreground">{line.name}</td>
                              <td className="tabular py-1.5 text-right text-muted-foreground">
                                {line.planned} {unitOf(line.baseUnit).label}
                              </td>
                              <td className="py-1.5 pl-3">
                                <Input
                                  type="number"
                                  step="any"
                                  min="0"
                                  required
                                  aria-label={`${line.name} actually used (${unitOf(line.baseUnit).label})`}
                                  className="w-32"
                                  value={line.quantity}
                                  onChange={(e) => setConsumption((prev) => prev.map((l, idx) => (idx === i ? { ...l, quantity: e.target.value } : l)))}
                                />
                              </td>
                              <td />
                            </tr>
                          ))}
                          {packaging.map((line, i) => (
                            <tr key={line.itemId} className="border-b border-border/60">
                              <td className="py-1.5 text-foreground">{line.name}</td>
                              <td className="tabular py-1.5 text-right text-muted-foreground">
                                {line.planned} {unitOf(line.baseUnit).label}
                              </td>
                              <td className="py-1.5 pl-3">
                                <Input
                                  type="number"
                                  step="any"
                                  min="0"
                                  required
                                  aria-label={`${line.name} actually used (${unitOf(line.baseUnit).label})`}
                                  className="w-32"
                                  value={line.quantity}
                                  onChange={(e) => setPackaging((prev) => prev.map((l, idx) => (idx === i ? { ...l, quantity: e.target.value } : l)))}
                                />
                              </td>
                              <td className="py-1.5 pl-3">
                                <Input
                                  type="number"
                                  min="0"
                                  max={line.quantity || undefined}
                                  placeholder="0"
                                  aria-label={`${line.name} damaged, out of those used`}
                                  className="w-24"
                                  value={line.damagedQty}
                                  onChange={(e) => setPackaging((prev) => prev.map((l, idx) => (idx === i ? { ...l, damagedQty: e.target.value } : l)))}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Field label={`Good packets (expected ${(run.packSize?.expectedYieldQty ?? run.bomHeader.expectedYieldQty) * run.batchSize})`} required>
                        <Input type="number" min="0" required value={actualOutputQty} onChange={(e) => setActualOutputQty(e.target.value)} />
                      </Field>
                      <Field label="Labour (₹)">
                        <Input type="number" step="0.01" min="0" placeholder="Optional" value={laborCostPaise} onChange={(e) => setLaborCostPaise(e.target.value)} />
                      </Field>
                      <Field label="Gas, power, other (₹)">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={`Blank uses ₹${500 * run.batchSize}`}
                          value={overheadCostPaise}
                          onChange={(e) => setOverheadCostPaise(e.target.value)}
                        />
                      </Field>
                    </div>
                    <Button type="submit" disabled={recordMutation.isPending} className="self-start">
                      Record run
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
                    <Field label="Good packets made" required>
                      <Input type="number" required value={actualOutputQty} onChange={(e) => setActualOutputQty(e.target.value)} />
                    </Field>
                    <p className="mt-1 text-sm font-medium text-foreground">Packaging used</p>
                    <div className="flex flex-col gap-2">
                      {packaging.map((line, i) => (
                        <div key={line.itemId} className="flex items-end gap-2">
                          <div className="flex-1">
                            <Field label={`${line.name} used (damaged included)`}>
                              <Input
                                type="number"
                                min="0"
                                value={line.quantity}
                                onChange={(e) =>
                                  setPackaging((prev) => prev.map((l, idx) => (idx === i ? { ...l, quantity: e.target.value } : l)))
                                }
                              />
                            </Field>
                          </div>
                          <div className="flex-1">
                            <Field label="Of which damaged">
                              <Input
                                type="number"
                                min="0"
                                max={line.quantity || undefined}
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
                    <p className="mt-1 text-sm font-medium text-foreground">Other costs (optional)</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="Labour (₹)">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Leave blank if not tracked"
                          value={laborCostPaise}
                          onChange={(e) => setLaborCostPaise(e.target.value)}
                        />
                      </Field>
                      <Field label="Gas, power, other (₹)">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={`Blank uses ₹${500 * run.batchSize}`}
                          value={overheadCostPaise}
                          onChange={(e) => setOverheadCostPaise(e.target.value)}
                        />
                      </Field>
                    </div>
                    <Button type="submit" disabled={completeMutation.isPending} className="mt-1 self-start">
                      Finish run
                    </Button>
                  </form>
                )}
              </Card>
            </li>
          ))}
          {cancelledCount > 0 && (
            <li>
              <button type="button" onClick={() => setShowCancelled((v) => !v)} className="text-xs font-medium text-primary hover:underline">
                {showCancelled ? "Hide cancelled runs" : `Show ${cancelledCount} cancelled ${cancelledCount === 1 ? "run" : "runs"}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
