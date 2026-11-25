import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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
  qty,
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

const TABS = ["Raw materials", "Finished products"] as const;

const STATUS_LABEL: Record<BatchStatus, string> = {
  NORMAL: "OK",
  EXPIRING: "Expiring soon",
  EXPIRED: "Expired",
  QUARANTINED: "On hold",
};

const day = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

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
  const { user } = useAuth();
  const canHold = user?.role !== "ACCOUNTANT";
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Raw materials");
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
    enabled: activeTab === "Raw materials",
  });

  const {
    data: finishedBatches,
    isLoading: loadingFinished,
    error: errorFinished,
  } = useQuery<FinishedBatch[]>({
    queryKey: ["batches", "finished-goods"],
    queryFn: () => api.get<FinishedBatch[]>("/batches/finished-goods"),
    enabled: activeTab === "Finished products",
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
        title="Batches"
        description="Each lot of stock, when it expires, and where it went. The oldest stock that hasn't expired is always used first."
      />

      <TabBar tabs={TABS} active={activeTab} onChange={(t) => setActiveTab(t as (typeof TABS)[number])} />

      {/* Quarantine Modal */}
      {quarantineTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-foreground">Put this batch on hold</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Stock on hold won't be used in production or sent to customers.
            </p>
            <div className="mt-4">
              <label className="block text-sm font-medium text-foreground">Why?</label>
              <textarea
                value={quarantineReason}
                onChange={(e) => setQuarantineReason(e.target.value)}
                placeholder="For example: failed quality check, damaged seal"
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
                {quarantineMut.isPending ? "Saving…" : "Put on hold"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Raw Material Tab */}
      {activeTab === "Raw materials" && (
        <>
          {loadingRaw && <Loading />}
          {errorRaw && <ErrorText>{(errorRaw as Error).message}</ErrorText>}
          {!loadingRaw && !errorRaw && (!rawBatches || rawBatches.length === 0) && (
            <EmptyState>No raw-material batches yet. Add a lot number or expiry date when you record a purchase and it will appear here.</EmptyState>
          )}
          {!loadingRaw && !errorRaw && rawBatches && rawBatches.length > 0 && (
            <Card>
              <Table>
                <THead>
                  <tr>
                    <Th>Batch</Th>
                    <Th>Item</Th>
                    <Th>Supplier</Th>
                    <Th className="text-right">Received</Th>
                    <Th className="text-right">Remaining</Th>
                    <Th>Expires</Th>
                    <Th>Status</Th>
                    <Th className="text-right"><span className="sr-only">Actions</span></Th>
                  </tr>
                </THead>
                <tbody>
                  {rawBatches.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/30">
                      <Td className="font-mono text-xs font-semibold">{b.internalBatchNo}</Td>
                      <Td>
                        <div className="font-medium text-foreground">{b.item.name}</div>
                      </Td>
                      <Td>{b.supplier.name}</Td>
                      <Td className="text-right font-medium">
                        {qty(b.receivedQtyBase, b.item.baseUnit)}
                      </Td>
                      <Td className="text-right font-semibold text-foreground">
                        {qty(b.remainingQtyBase, b.item.baseUnit)}
                      </Td>
                      <Td className="text-xs">
                        {b.expiryDate ? day(b.expiryDate) : "Not set"}
                      </Td>
                      <Td>
                        <StatusBadge variant={statusVariant(b.status)}>{STATUS_LABEL[b.status]}</StatusBadge>
                      </Td>
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to={`/admin/batches/raw-material/${b.id}/genealogy`}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Where it went
                          </Link>
                          {canHold && b.status !== "QUARANTINED" && (
                            <button
                              onClick={() => setQuarantineTarget({ id: b.id, batchType: "raw" })}
                              className="text-xs text-destructive hover:underline"
                            >
                              Put on hold
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
      {activeTab === "Finished products" && (
        <>
          {loadingFinished && <Loading />}
          {errorFinished && <ErrorText>{(errorFinished as Error).message}</ErrorText>}
          {!loadingFinished && !errorFinished && (!finishedBatches || finishedBatches.length === 0) && (
            <EmptyState>No finished batches yet. Each finished production run creates one.</EmptyState>
          )}
          {!loadingFinished && !errorFinished && finishedBatches && finishedBatches.length > 0 && (
            <Card>
              <Table>
                <THead>
                  <tr>
                    <Th>Batch</Th>
                    <Th>Product</Th>
                    <Th className="text-right">Produced</Th>
                    <Th className="text-right">Remaining</Th>
                    <Th>Made</Th>
                    <Th>Expires</Th>
                    <Th>Status</Th>
                    <Th className="text-right"><span className="sr-only">Actions</span></Th>
                  </tr>
                </THead>
                <tbody>
                  {finishedBatches.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/30">
                      <Td className="font-mono text-xs font-semibold">{b.internalBatchNo}</Td>
                      <Td>
                        <div className="font-medium text-foreground">{b.item.name}</div>
                      </Td>
                      <Td className="text-right font-medium">
                        {qty(b.producedQtyBase, b.item.baseUnit)}
                      </Td>
                      <Td className="text-right font-semibold text-foreground">
                        {qty(b.remainingQtyBase, b.item.baseUnit)}
                      </Td>
                      <Td className="text-xs">{day(b.manufactureDate)}</Td>
                      <Td className="text-xs">
                        {b.expiryDate ? day(b.expiryDate) : "Not set"}
                      </Td>
                      <Td>
                        <StatusBadge variant={statusVariant(b.status)}>{STATUS_LABEL[b.status]}</StatusBadge>
                      </Td>
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canHold && b.status !== "QUARANTINED" && (
                            <button
                              onClick={() => setQuarantineTarget({ id: b.id, batchType: "finished" })}
                              className="text-xs text-destructive hover:underline"
                            >
                              Put on hold
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
