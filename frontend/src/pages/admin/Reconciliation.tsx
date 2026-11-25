import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Loading,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  Td,
  Th,
  THead,
  Textarea,
} from "@/components/ui";

type CheckType = "STOCK" | "PRODUCTION_VARIANCE" | "PACKAGING" | "INVOICE" | "DISPATCH";
type ExceptionStatus = "OPEN" | "REVIEWED" | "RESOLVED";

type ReconciliationException = {
  id: string;
  checkType: CheckType;
  sourceType: string;
  sourceId: string;
  expectedValue: string;
  actualValue: string;
  differenceValue: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  status: ExceptionStatus;
  explanation: string | null;
  resolutionNote: string | null;
  createdAt: string;
};

type RunSummary = { total: number; passed: number; warnings: number; critical: number };

const CHECK_LABEL: Record<CheckType, string> = {
  STOCK: "Stock ledger",
  PRODUCTION_VARIANCE: "Production variance",
  PACKAGING: "Packaging",
  INVOICE: "Invoice",
  DISPATCH: "Dispatch",
};

const SOURCE_LABEL: Record<string, string> = {
  ProductionRun: "Production run",
  ProductionRunMaterial: "Material used in a run",
  Dispatch: "Dispatch",
  Invoice: "Invoice",
  Item: "Stock item",
};

const STATUS_LABEL = { OPEN: "Open", REVIEWED: "Reviewed", RESOLVED: "Resolved" } as const;
const SEVERITY_LABEL = { INFO: "Info", WARNING: "Warning", CRITICAL: "Serious" } as const;

// IDs are long UUIDs; the first block is enough to tell rows apart on screen.
const shortId = (id: string) => `#${id.slice(0, 8)}`;

const SEVERITY_VARIANT = { INFO: "info", WARNING: "warning", CRITICAL: "destructive" } as const;
const STATUS_VARIANT = { OPEN: "warning", REVIEWED: "info", RESOLVED: "success" } as const;

function ReviewRow({ exception }: { exception: ReconciliationException }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [explanation, setExplanation] = useState(exception.explanation ?? "");
  const [resolutionNote, setResolutionNote] = useState(exception.resolutionNote ?? "");

  const reviewMutation = useMutation({
    mutationFn: (status: ExceptionStatus) =>
      api.patch(`/reconciliation/exceptions/${exception.id}`, {
        status,
        ...(explanation.trim() ? { explanation: explanation.trim() } : {}),
        ...(resolutionNote.trim() ? { resolutionNote: resolutionNote.trim() } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation", "exceptions"] });
      setOpen(false);
    },
  });

  return (
    <>
      <Button size="sm" variant={exception.status === "RESOLVED" ? "ghost" : "secondary"} onClick={() => setOpen(true)}>
        {exception.status === "RESOLVED" ? "View note" : "Review"}
      </Button>

      {/* A centered Modal, not an inline expansion: this used to render
          straight into the table cell, which forced the Review column (and
          the whole table) to the width of the open form, pushing every
          other column off-screen the moment any row was reviewed. */}
      <Modal open={open} onClose={() => setOpen(false)} title={`${CHECK_LABEL[exception.checkType]} exception`}>
        <div className="mb-4 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
          <p className="text-foreground">{SOURCE_LABEL[exception.sourceType] ?? exception.sourceType}</p>
          <p className="font-mono text-xs text-muted-foreground">{shortId(exception.sourceId)}</p>
          <div className="mt-2 flex justify-between text-muted-foreground">
            <span>Expected: {exception.expectedValue}</span>
            <span>Actual: {exception.actualValue}</span>
          </div>
        </div>
        <Textarea
          placeholder="Explanation (why this happened)…"
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          className="mb-3 min-h-[80px] w-full text-sm"
          disabled={exception.status === "RESOLVED"}
        />
        <Textarea
          placeholder="Resolution note…"
          value={resolutionNote}
          onChange={(e) => setResolutionNote(e.target.value)}
          className="mb-3 min-h-[80px] w-full text-sm"
          disabled={exception.status === "RESOLVED"}
        />
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          {exception.status === "OPEN" && (
            <Button size="sm" variant="secondary" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate("REVIEWED")}>
              Mark reviewed
            </Button>
          )}
          {exception.status !== "RESOLVED" && (
            <Button size="sm" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate("RESOLVED")}>
              Mark resolved
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}

export default function Reconciliation() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ExceptionStatus | "ALL">("OPEN");
  const [checkTypeFilter, setCheckTypeFilter] = useState<CheckType | "ALL">("ALL");
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["reconciliation", "exceptions", statusFilter, checkTypeFilter],
    queryFn: () =>
      api.get<ReconciliationException[]>(
        `/reconciliation/exceptions?${new URLSearchParams({
          ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
          ...(checkTypeFilter !== "ALL" ? { checkType: checkTypeFilter } : {}),
        })}`,
      ),
  });

  const runMutation = useMutation({
    mutationFn: () => api.post<RunSummary>("/reconciliation/run", {}),
    onSuccess: (summary) => {
      setLastRun(summary);
      setRunError(null);
      queryClient.invalidateQueries({ queryKey: ["reconciliation", "exceptions"] });
    },
    onError: (err) => setRunError(err instanceof ApiError ? err.message : "Failed to run reconciliation checks"),
  });

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Checks"
        description="Looks for numbers that don't add up across stock, production, invoices and dispatch. It only reports problems; it never changes your records."
        actions={
          <Button size="sm" disabled={runMutation.isPending} onClick={() => runMutation.mutate()}>
            {runMutation.isPending ? "Running…" : "Run checks"}
          </Button>
        }
      />

      {runError && <div className="mb-4"><ErrorText>{runError}</ErrorText></div>}

      {lastRun && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Checked</p>
            <p className="mt-1 text-xl font-bold text-foreground">{lastRun.total}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Passed</p>
            <p className="mt-1 text-xl font-bold text-success">{lastRun.passed}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Warnings</p>
            <p className="mt-1 text-xl font-bold text-warning">{lastRun.warnings}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Critical</p>
            <p className="mt-1 text-xl font-bold text-destructive">{lastRun.critical}</p>
          </Card>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ExceptionStatus | "ALL")} className="w-40">
          <option value="ALL">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="REVIEWED">Reviewed</option>
          <option value="RESOLVED">Resolved</option>
        </Select>
        <Select value={checkTypeFilter} onChange={(e) => setCheckTypeFilter(e.target.value as CheckType | "ALL")} className="w-48">
          <option value="ALL">All check types</option>
          {Object.entries(CHECK_LABEL).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorText>{(error as Error).message}</ErrorText>
      ) : !data || data.length === 0 ? (
        <EmptyState>Nothing to show here. Press "Run checks" to look again.</EmptyState>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Check</Th>
              <Th>Source</Th>
              <Th numeric>Expected</Th>
              <Th numeric>Actual</Th>
              <Th numeric>Difference</Th>
              <Th>Severity</Th>
              <Th>Status</Th>
              <Th className="text-right">Review</Th>
            </tr>
          </THead>
          <tbody>
            {data.map((e) => (
              <tr key={e.id} className="hover:bg-secondary/30">
                <Td className="font-medium text-foreground">{CHECK_LABEL[e.checkType]}</Td>
                <Td>
                  <p className="text-foreground">{SOURCE_LABEL[e.sourceType] ?? e.sourceType}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground" title={e.sourceId}>{shortId(e.sourceId)}</p>
                </Td>
                <Td numeric>{e.expectedValue}</Td>
                <Td numeric>{e.actualValue}</Td>
                <Td numeric className="font-semibold text-foreground">{e.differenceValue}</Td>
                <Td><StatusBadge variant={SEVERITY_VARIANT[e.severity]}>{SEVERITY_LABEL[e.severity]}</StatusBadge></Td>
                <Td><StatusBadge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status]}</StatusBadge></Td>
                <Td className="text-right"><ReviewRow exception={e} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
