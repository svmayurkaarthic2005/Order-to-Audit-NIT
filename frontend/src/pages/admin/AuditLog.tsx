import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, EmptyState, ErrorText, Loading, PageHeader, Select, StatusBadge, Table, Td, Th, THead, money } from "@/components/ui";

type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
};

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Created",
  UPDATE: "Changed",
  EDIT: "Edited",
  DELETE: "Removed",
  CANCEL: "Cancelled",
  APPROVE: "Approved",
  REJECT: "Rejected",
  CREDIT_NOTE: "Credit note",
  DISPATCH: "Dispatched",
  EMAIL_SENT: "Emailed",
  PAYMENT: "Payment",
  PRODUCTION_RUN_STARTED: "Run started",
  PRODUCTION_RUN_COMPLETED: "Run finished",
  PRODUCTION_RUN_CANCELLED: "Run cancelled",
  PRODUCTION_RUN_RECIPE_UPDATED: "Run moved to latest recipe",
  RECIPE_CREATED: "Recipe added",
  RECIPE_EDITED: "Recipe changed",
  QUARANTINE: "Put on hold",
  FEFO_OVERRIDE: "Batch chosen by hand",
};

const ACTION_VARIANTS: Record<string, "success" | "info" | "destructive" | "warning" | "neutral"> = {
  CREATE: "success",
  APPROVE: "success",
  PAYMENT: "success",
  PRODUCTION_RUN_COMPLETED: "success",
  UPDATE: "info",
  EDIT: "info",
  DISPATCH: "info",
  EMAIL_SENT: "info",
  PRODUCTION_RUN_STARTED: "info",
  PRODUCTION_RUN_RECIPE_UPDATED: "info",
  RECIPE_CREATED: "success",
  RECIPE_EDITED: "info",
  DELETE: "destructive",
  REJECT: "destructive",
  CANCEL: "warning",
  CREDIT_NOTE: "warning",
  QUARANTINE: "warning",
  PRODUCTION_RUN_CANCELLED: "warning",
};

const RECORD_LABEL: Record<string, string> = {
  SalesOrder: "Order",
  Invoice: "Invoice",
  Dispatch: "Dispatch",
  ProductionRun: "Production run",
  ReconciliationException: "Check",
  Item: "Item",
  Customer: "Customer",
  Supplier: "Supplier",
  Purchase: "Purchase",
  BomHeader: "Recipe",
  RawMaterialBatch: "Batch",
  FinishedGoodsBatch: "Batch",
};

const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.charAt(0) + a.slice(1).toLowerCase().replace(/_/g, " ");
const recordLabel = (t: string) => RECORD_LABEL[t] ?? t.replace(/([a-z])([A-Z])/g, "$1 $2");

// "taxableValuePaise" -> "Taxable value"; money fields are stored in paise.
function fieldLabel(key: string): string {
  const words = key.replace(/Paise$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function fieldValue(key: string, v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (key.endsWith("Paise") && typeof v === "number") return money(v);
  if (typeof v === "string" && /^[A-Z_]+$/.test(v)) return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fields(jsonStr: string | null): [string, string][] {
  if (!jsonStr || jsonStr === "null") return [];
  try {
    const obj = JSON.parse(jsonStr);
    if (typeof obj !== "object" || obj === null) return [["Value", String(obj)]];
    return Object.entries(obj).map(([k, v]) => [fieldLabel(k), fieldValue(k, v)]);
  } catch {
    return [["Value", jsonStr]];
  }
}

function FieldList({ jsonStr }: { jsonStr: string | null }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-secondary/60 p-3 text-sm">
      {fields(jsonStr).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-words text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function AuditLog() {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [inspectEntry, setInspectEntry] = useState<AuditEntry | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["audit-log"],
    queryFn: () => api.get<AuditEntry[]>("/audit-log"),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((e) => {
      if (actionFilter !== "ALL" && e.action !== actionFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        actionLabel(e.action).toLowerCase().includes(q) ||
        recordLabel(e.entityType).toLowerCase().includes(q) ||
        e.entityType.toLowerCase().includes(q) ||
        e.entityId.toLowerCase().includes(q) ||
        (e.user?.name ?? "").toLowerCase().includes(q) ||
        (e.user?.email ?? "").toLowerCase().includes(q) ||
        (e.afterJson ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search, actionFilter]);

  const actionsInLog = [...new Set((data ?? []).map((e) => e.action))].sort((x, y) => actionLabel(x).localeCompare(actionLabel(y)));

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Activity log"
        description="Every change made in the app: who did it, what changed and when. Entries can't be edited or deleted."
      />

      {/* Filter and search bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="w-48" aria-label="Filter by action">
          <option value="ALL">All activity</option>
          {actionsInLog.map((act) => (
            <option key={act} value={act}>{actionLabel(act)}</option>
          ))}
        </Select>

        {/* Search input */}
        <div className="relative w-full sm:w-64">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            placeholder="Search by person, record or detail"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8.5 w-full rounded-lg border border-input bg-white pl-9 pr-3 text-xs placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorText>{(error as Error).message}</ErrorText>
      ) : !data || data.length === 0 ? (
        <EmptyState>Nothing has happened yet.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>No activity matches that search.</EmptyState>
      ) : (
        <div className="w-full min-w-0">
          <div className="mb-2 text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {data.length} entries
          </div>

          {/* Guaranteed contained table that never causes page-level overflow */}
          <Table>
            <THead>
              <tr>
                <Th className="w-36">When</Th>
                <Th className="w-44">Who</Th>
                <Th className="w-32">What</Th>
                <Th className="w-44">Record</Th>
                <Th className="min-w-[200px]">Details</Th>
                <Th className="w-20 text-right"><span className="sr-only">Open</span></Th>
              </tr>
            </THead>
            <tbody>
              {filtered.map((e) => {
                const variant = ACTION_VARIANTS[e.action] ?? "neutral";
                const date = new Date(e.createdAt);
                const initials = (e.user?.name ?? "SY")
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);

                return (
                  <tr key={e.id} className="transition-colors hover:bg-secondary/25">
                    {/* Timestamp */}
                    <Td className="whitespace-nowrap">
                      <span className="block text-xs font-semibold text-foreground">{timeAgo(e.createdAt)}</span>
                      <span className="block text-[11px] text-muted-foreground tabular">
                        {date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}{" "}
                        {date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </Td>

                    {/* User */}
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                          {initials}
                        </div>
                        <div className="min-w-0 truncate">
                          <p className="truncate text-xs font-medium text-foreground">{e.user?.name ?? "system"}</p>
                          {e.user?.email && <p className="truncate text-[10px] text-muted-foreground">{e.user.email}</p>}
                        </div>
                      </div>
                    </Td>

                    {/* Action */}
                    <Td className="whitespace-nowrap">
                      <StatusBadge variant={variant}>
                        {actionLabel(e.action)}
                      </StatusBadge>
                    </Td>

                    {/* Entity */}
                    <Td className="whitespace-nowrap">
                      <span className="text-sm text-foreground">{recordLabel(e.entityType)}</span>
                      <span className="ml-1.5 font-mono text-[11px] text-muted-foreground" title={e.entityId}>
                        #{e.entityId.slice(0, 8)}
                      </span>
                    </Td>

                    {/* Details Preview — strictly bounded to prevent blowout */}
                    <Td>
                      <div className="max-w-[280px] md:max-w-sm truncate text-xs text-muted-foreground">
                        {fields(e.afterJson ?? e.beforeJson).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(", ") || "No details"}
                      </div>
                    </Td>

                    {/* Inspect button */}
                    <Td className="text-right whitespace-nowrap">
                      <button
                        onClick={() => setInspectEntry(e)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                      >
                        Open
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      {/* ── Detail Inspection Modal ───────────────────────────────────────── */}
      {inspectEntry && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          onClick={() => setInspectEntry(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-border bg-white p-6 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-start justify-between border-b border-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <StatusBadge variant={ACTION_VARIANTS[inspectEntry.action] ?? "neutral"}>
                    {actionLabel(inspectEntry.action)}
                  </StatusBadge>
                  <span className="text-sm font-semibold text-foreground">
                    {recordLabel(inspectEntry.entityType)} <span className="font-mono text-xs font-normal text-muted-foreground">#{inspectEntry.entityId.slice(0, 8)}</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  By {inspectEntry.user?.name ?? "system"} on{" "}
                  {new Date(inspectEntry.createdAt).toLocaleString("en-IN")}
                </p>
              </div>
              <button
                onClick={() => setInspectEntry(null)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal content: JSON payload */}
            <div className="overflow-y-auto py-4 flex-1 flex flex-col gap-4">
              {inspectEntry.beforeJson && inspectEntry.beforeJson !== "null" && (
                <div>
                  <p className="mb-1 text-sm font-semibold text-foreground">Before</p>
                  <FieldList jsonStr={inspectEntry.beforeJson} />
                </div>
              )}

              {inspectEntry.afterJson && inspectEntry.afterJson !== "null" && (
                <div>
                  <p className="mb-1 text-sm font-semibold text-foreground">{inspectEntry.beforeJson ? "After" : "Details"}</p>
                  <FieldList jsonStr={inspectEntry.afterJson} />
                </div>
              )}

              {!inspectEntry.beforeJson && !inspectEntry.afterJson && (
                <p className="text-sm text-muted-foreground">No details were recorded for this entry.</p>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex justify-end border-t border-border pt-4">
              <Button size="sm" variant="secondary" onClick={() => setInspectEntry(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
