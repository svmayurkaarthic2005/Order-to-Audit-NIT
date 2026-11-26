import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, EmptyState, ErrorText, Loading, PageHeader, StatusBadge } from "@/components/ui";

interface ForwardGenealogy {
  rawMaterialBatch: {
    id: string;
    internalBatchNo: string;
    receivedQtyBase: number;
    remainingQtyBase: number;
    status: string;
    receiptDate: string;
    expiryDate?: string | null;
    item: { name: string; sku: string; baseUnit: string };
  };
  productionRuns: Array<{
    id: string;
    batchSize: number;
    status: string;
    startedAt?: string | null;
    completedAt?: string | null;
    bomHeader: { finishedItem: { name: string; sku: string } };
    finishedGoodsBatch?: {
      id: string;
      internalBatchNo: string;
      producedQtyBase: number;
      remainingQtyBase: number;
      dispatchBatches: Array<{
        qtyBase: number;
        dispatch: {
          id: string;
          dispatchedAt: string;
          invoice: {
            invoiceNumber: number;
            customer: { name: string };
          };
        };
      }>;
    } | null;
  }>;
}

interface BackwardGenealogy {
  id: string;
  qtyBase: number;
  dispatchedAt: string;
  invoice: {
    invoiceNumber: number;
    customer: { name: string };
    items: Array<{ item: { name: string; sku: string } }>;
  };
  itemBatches: Array<{
    qtyBase: number;
    finishedGoodsBatch: {
      internalBatchNo: string;
      producedQtyBase: number;
      item: { name: string; sku: string };
      productionRun: {
        id: string;
        materials: Array<{ item: { name: string; sku: string } }>;
      };
    };
    rawMaterialInputs: Array<{
      qtyBase: number;
      rawMaterialBatch?: {
        internalBatchNo: string;
        item: { name: string; sku: string };
        supplier: { name: string };
      } | null;
    }>;
  }>;
}

export default function BatchGenealogy() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const isRaw = type === "raw-material";

  const { data: forwardData, isLoading: loadingForward, error: errorForward } = useQuery<ForwardGenealogy>({
    queryKey: ["genealogy", "raw-material", id],
    queryFn: () => api.get<ForwardGenealogy>(`/batches/raw-material/${id}/genealogy`),
    enabled: isRaw && Boolean(id),
  });

  const { data: backwardData, isLoading: loadingBackward, error: errorBackward } = useQuery<BackwardGenealogy>({
    queryKey: ["genealogy", "dispatch", id],
    queryFn: () => api.get<BackwardGenealogy>(`/batches/dispatch/${id}/genealogy`),
    enabled: !isRaw && Boolean(id),
  });

  const isLoading = isRaw ? loadingForward : loadingBackward;
  const error = isRaw ? errorForward : errorBackward;

  return (
    <div>
      <div className="mb-4">
        <Link to="/admin/batches" className="text-xs font-semibold text-primary hover:underline">
          ← Back to Batches
        </Link>
      </div>

      <PageHeader
        title={isRaw ? "Where this lot went" : "Where this lot came from"}
        description={
          isRaw
            ? "From the supplier's delivery, into production runs, and out to customers."
            : "Back from the customer, to the production run that made it, and the supplier lots it used."
        }
      />

      {isLoading && <Loading />}
      {error && <ErrorText>{(error as Error).message}</ErrorText>}

      {/* Forward Genealogy View */}
      {isRaw && forwardData && (
        <div className="space-y-6">
          {/* Stage 1: Origin Batch */}
          <Card className="border-l-4 border-l-primary p-4">
            <span className="text-xs font-medium text-primary">Step 1: Where it came from</span>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-foreground font-mono">
                  {forwardData.rawMaterialBatch.internalBatchNo}
                </h3>
                <p className="text-sm font-medium text-foreground">
                  {forwardData.rawMaterialBatch.item.name}
                </p>
              </div>
              <div className="text-right">
                <StatusBadge variant="info">{forwardData.rawMaterialBatch.status.charAt(0) + forwardData.rawMaterialBatch.status.slice(1).toLowerCase()}</StatusBadge>
                <p className="mt-1 text-xs text-muted-foreground">
                  Received: {forwardData.rawMaterialBatch.receivedQtyBase.toLocaleString()}{" "}
                  {forwardData.rawMaterialBatch.item.baseUnit} | Remaining:{" "}
                  {forwardData.rawMaterialBatch.remainingQtyBase.toLocaleString()}{" "}
                  {forwardData.rawMaterialBatch.item.baseUnit}
                </p>
              </div>
            </div>
          </Card>

          {/* Stage 2 & 3: Production Runs & Downstream Dispatches */}
          <div>
            <h4 className="mb-3 text-sm font-bold text-foreground">
              Step 2: Used in production ({forwardData.productionRuns.length} Runs)
            </h4>

            {forwardData.productionRuns.length === 0 ? (
              <EmptyState>This raw material batch has not been issued to any production run yet.</EmptyState>
            ) : (
              <div className="space-y-4">
                {forwardData.productionRuns.map((run) => (
                  <Card key={run.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                      <div>
                        <span className="font-mono text-xs font-bold text-primary">Run #{run.id.slice(0, 8)}</span>
                        <h4 className="text-sm font-semibold text-foreground">
                          Produced: {run.bomHeader.finishedItem.name}
                        </h4>
                      </div>
                      <StatusBadge variant={run.status === "COMPLETED" ? "success" : "neutral"}>
                        {run.status}
                      </StatusBadge>
                    </div>

                    {/* Finished goods batch info */}
                    {run.finishedGoodsBatch && (
                      <div className="mt-3 rounded-lg bg-secondary/40 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground">
                            Finished Goods Lot:{" "}
                            <span className="font-mono">{run.finishedGoodsBatch.internalBatchNo}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Output: {run.finishedGoodsBatch.producedQtyBase.toLocaleString()} units
                          </span>
                        </div>

                        {/* Step 3: Dispatches */}
                        <div className="mt-3 border-t border-border/60 pt-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Step 3: Sent to customers ({run.finishedGoodsBatch.dispatchBatches.length})
                          </span>
                          {run.finishedGoodsBatch.dispatchBatches.length === 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground italic">No dispatches yet from this batch.</p>
                          ) : (
                            <ul className="mt-2 space-y-1.5">
                              {run.finishedGoodsBatch.dispatchBatches.map((db, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-center justify-between rounded bg-white px-3 py-2 text-xs shadow-xs"
                                >
                                  <div>
                                    <span className="font-semibold text-foreground">
                                      {db.dispatch.invoice.customer.name}
                                    </span>{" "}
                                    (Inv #{db.dispatch.invoice.invoiceNumber})
                                  </div>
                                  <div className="font-mono font-medium text-foreground">
                                    {db.qtyBase.toLocaleString()} units —{" "}
                                    {new Date(db.dispatch.dispatchedAt).toLocaleDateString()}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backward Genealogy View */}
      {!isRaw && backwardData && (
        <div className="space-y-6">
          <Card className="border-l-4 border-l-primary p-4">
            <span className="text-xs font-medium text-primary">
              End Target: Customer Dispatch
            </span>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-foreground">
                  {backwardData.invoice.customer.name}
                </h3>
                <p className="text-sm font-medium text-muted-foreground">
                  Invoice #{backwardData.invoice.invoiceNumber} • Dispatched{" "}
                  {new Date(backwardData.dispatchedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <span className="font-mono text-base font-bold text-foreground">
                  {backwardData.qtyBase.toLocaleString()} units
                </span>
              </div>
            </div>
          </Card>

          {/* Trace backward through finished batches to raw inputs */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-foreground">Source Lots & Ingredients</h4>
            {backwardData.itemBatches.map((ib, idx) => (
              <Card key={idx} className="p-4">
                <div className="border-b border-border pb-3">
                  <span className="text-xs font-medium text-primary">
                    Finished Goods Lot
                  </span>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-foreground">
                      {ib.finishedGoodsBatch.internalBatchNo}
                    </span>
                    <span className="text-xs font-semibold text-foreground">
                      Drawn: {ib.qtyBase.toLocaleString()} units
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{ib.finishedGoodsBatch.item.name}</p>
                </div>

                {/* Raw material inputs */}
                <div className="mt-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Raw Material Lots Consumed in Run #{ib.finishedGoodsBatch.productionRun.id.slice(0, 8)}
                  </span>
                  {ib.rawMaterialInputs.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground italic">No tracked raw batch lots recorded.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {ib.rawMaterialInputs.map((rm, rIdx) => (
                        <li
                          key={rIdx}
                          className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs"
                        >
                          <div>
                            <span className="font-mono font-bold text-foreground">
                              {rm.rawMaterialBatch?.internalBatchNo ?? "Unbatched"}
                            </span>{" "}
                            — {rm.rawMaterialBatch?.item.name}
                            <p className="text-[11px] text-muted-foreground">
                              Supplier: {rm.rawMaterialBatch?.supplier.name ?? "—"}
                            </p>
                          </div>
                          <span className="font-mono font-semibold text-foreground">
                            {Math.abs(rm.qtyBase).toLocaleString()} units issued
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
