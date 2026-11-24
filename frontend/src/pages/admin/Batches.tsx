import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Loading,
  PageHeader,
  StatusBadge,
  Table,
  TabBar,
  Td,
  Th,
  THead,
} from "@/components/ui";

type BatchStatus = "NORMAL" | "EXPIRING" | "EXPIRED" | "QUARANTINED";

interface RawBatch {
  id: string;
  internalBatchNo: string;
  supplierBatchNo?: string | null;
  receivedQtyBase: number;
  remainingQtyBase: number;
  receiptDate: string;
  manufactureDate?: string | null;
  expiryDate?: string | null;
  qualityDocRef?: string | null;
  status: BatchStatus;
  item: { sku: string; name: string; baseUnit: string };
  supplier: { name: string };
}

interface FinishedBatch {
  id: string;
  internalBatchNo: string;
  producedQtyBase: number;
  remainingQtyBase: number;
  manufactureDate: string;
  expiryDate?: string | null;
  status: BatchStatus;
  item: { sku: string; name: string; baseUnit: string };
  productionRun: {
    id: string;
    bomHeader: { finishedItem: { name: string } };
  };
}

const TABS = ["Raw Material Batches", "Finished Goods Batches"] as const;

function statusVariant(status: BatchStatus): "success" | "warning" | "destructive" | "neutral" {
  switch (status) {
    case "NORMAL":
      return "success";
    case "EXPIRING":
      return "warning";
    case "EXPIRED":
      return "destructive";
    case "QUARANTINED":
      return "neutral";
  }
}

export default function Batches() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Raw Material Batches");
  const [quarantineTarget, setQuarantineTarget] = useState<{ id: string; batchType: "raw" | "finished" } | null>(null);
  const [quarantineReason, setQuarantineReason] = useState("");
  const queryClient = useQueryClient();

  const {
    data: rawBatches,
    isLoading: loadingRaw,
    error: errorRaw,
  } = useQuery<RawBatch[]>({
    queryKey: ["batches", "raw-material"],
    queryFn: () => api.get<RawBatch[]>("/batches/raw-material"),
    enabled: activeTab === "Raw Material Batches",
  });

  const {
    data: finishedBatches,
    isLoading: loadingFinished,
    error: errorFinished,
  } = useQuery<FinishedBatch[]>({
    queryKey: ["batches", "finished-goods"],
    queryFn: () => api.get<FinishedBatch[]>("/batches/finished-goods"),
    enabled: activeTab === "Finished Goods Batches",
  });

  const quarantineMut = useMutation({
    mutationFn: ({ id, batchType, reason }: { id: string; batchType: "raw" | "finished"; reason: string }) =>
      api.patch(`/batches/${id}/quarantine`, { batchType, reason }),
    onSuccess: () => {
      setQuarantineTarget(null);
      setQuarantineReason("");
      queryClient.invalidateQueries({ queryKey: ["batches"] });
    },
  });

  return (
    <div>
      <PageHeader
        title="Batch & Lot Tracking"
        description="FEFO tracking, expiry monitors, and full batch genealogy from supplier to dispatch."
      />

      <TabBar tabs={TABS} active={activeTab} onChange={(t) => setActiveTab(t as (typeof TABS)[number])} />

      {/* Quarantine Modal */}
      {quarantineTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-foreground">Quarantine Batch</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Quarantining this batch immediately blocks it from FEFO selection in production and dispatch.
            </p>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-muted-foreground">Reason for quarantine</label>
              <textarea
                value={quarantineReason}
                onChange={(e) => setQuarantineReason(e.target.value)}
                placeholder="e.g. Quality inspection failed, seal compromised..."
                className="mt-1 w-full rounded-md border border-input p-2.5 text-sm"
                rows={3}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setQuarantineTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!quarantineReason.trim() || quarantineMut.isPending}
                onClick={() =>
                  quarantineMut.mutate({
                    id: quarantineTarget.id,
                    batchType: quarantineTarget.batchType,
                    reason: quarantineReason,
                  })
                }
              >
                {quarantineMut.isPending ? "Quarantining..." : "Confirm Quarantine"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Raw Material Tab */}
      {activeTab === "Raw Material Batches" && (
        <>
          {loadingRaw && <Loading />}
          {errorRaw && <ErrorText>{(errorRaw as Error).message}</ErrorText>}
          {!loadingRaw && !errorRaw && (!rawBatches || rawBatches.length === 0) && (
            <EmptyState>No raw material batches received yet. Purchase items with batch details to create lots.</EmptyState>
          )}
          {!loadingRaw && !errorRaw && rawBatches && rawBatches.length > 0 && (
            <Card>
              <Table>
                <THead>
                  <tr>
                    <Th>Batch #</Th>
                    <Th>Item</Th>
                    <Th>Supplier</Th>
                    <Th className="text-right">Received</Th>
                    <Th className="text-right">Remaining</Th>
                    <Th>Expiry Date</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </THead>
                <tbody>
                  {rawBatches.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/30">
                      <Td className="font-mono text-xs font-semibold">{b.internalBatchNo}</Td>
                      <Td>
                        <div className="font-medium text-foreground">{b.item.name}</div>
                        <div className="text-xs text-muted-foreground">{b.item.sku}</div>
                      </Td>
                      <Td>{b.supplier.name}</Td>
                      <Td className="text-right font-medium">
                        {b.receivedQtyBase.toLocaleString()} {b.item.baseUnit}
                      </Td>
                      <Td className="text-right font-semibold text-foreground">
                        {b.remainingQtyBase.toLocaleString()} {b.item.baseUnit}
                      </Td>
                      <Td className="text-xs">
                        {b.expiryDate ? new Date(b.expiryDate).toLocaleDateString() : "—"}
                      </Td>
                      <Td>
                        <StatusBadge variant={statusVariant(b.status)}>{b.status}</StatusBadge>
                      </Td>
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to={`/admin/batches/raw-material/${b.id}/genealogy`}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Trace
                          </Link>
                          {b.status !== "QUARANTINED" && (
                            <button
                              onClick={() => setQuarantineTarget({ id: b.id, batchType: "raw" })}
                              className="text-xs text-destructive hover:underline"
                            >
                              Quarantine
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}

      {/* Finished Goods Tab */}
      {activeTab === "Finished Goods Batches" && (
        <>
          {loadingFinished && <Loading />}
          {errorFinished && <ErrorText>{(errorFinished as Error).message}</ErrorText>}
          {!loadingFinished && !errorFinished && (!finishedBatches || finishedBatches.length === 0) && (
            <EmptyState>No finished goods batches recorded yet. Complete production runs to generate lots.</EmptyState>
          )}
          {!loadingFinished && !errorFinished && finishedBatches && finishedBatches.length > 0 && (
            <Card>
              <Table>
                <THead>
                  <tr>
                    <Th>Batch #</Th>
                    <Th>Finished Good</Th>
                    <Th>Production Run</Th>
                    <Th className="text-right">Produced</Th>
                    <Th className="text-right">Remaining</Th>
                    <Th>Manufacture Date</Th>
                    <Th>Expiry Date</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </THead>
                <tbody>
                  {finishedBatches.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/30">
                      <Td className="font-mono text-xs font-semibold">{b.internalBatchNo}</Td>
                      <Td>
                        <div className="font-medium text-foreground">{b.item.name}</div>
                        <div className="text-xs text-muted-foreground">{b.item.sku}</div>
                      </Td>
                      <Td className="font-mono text-xs text-muted-foreground">
                        #{b.productionRun.id.slice(0, 8)}
                      </Td>
                      <Td className="text-right font-medium">
                        {b.producedQtyBase.toLocaleString()} {b.item.baseUnit}
                      </Td>
                      <Td className="text-right font-semibold text-foreground">
                        {b.remainingQtyBase.toLocaleString()} {b.item.baseUnit}
                      </Td>
                      <Td className="text-xs">{new Date(b.manufactureDate).toLocaleDateString()}</Td>
                      <Td className="text-xs">
                        {b.expiryDate ? new Date(b.expiryDate).toLocaleDateString() : "—"}
                      </Td>
                      <Td>
                        <StatusBadge variant={statusVariant(b.status)}>{b.status}</StatusBadge>
                      </Td>
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to={`/admin/batches/raw-material/${b.id}/genealogy`}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Trace
                          </Link>
                          {b.status !== "QUARANTINED" && (
                            <button
                              onClick={() => setQuarantineTarget({ id: b.id, batchType: "finished" })}
                              className="text-xs text-destructive hover:underline"
                            >
                              Quarantine
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
