import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, EmptyState, ErrorText, Loading, PageHeader, StatusBadge, Table, Td, Th, THead } from "@/components/ui";

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

const ACTION_VARIANTS: Record<string, "success" | "info" | "destructive" | "warning" | "neutral"> = {
  CREATE: "success",
  UPDATE: "info",
  DELETE: "destructive",
  CANCEL: "warning",
};

const ACTION_ICONS: Record<string, string> = {
  CREATE: "M12 4v16m8-8H4",
  UPDATE: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  DELETE: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  CANCEL: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636",
};

function formatPreview(jsonStr: string | null): string {
  if (!jsonStr || jsonStr === "null") return "—";
  try {
    const obj = JSON.parse(jsonStr);
    if (typeof obj === "object" && obj !== null) {
      return Object.entries(obj)
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${typeof v === "object" ? "…" : String(v)}`)
        .join(" · ");
    }
    return String(obj);
  } catch {
    return jsonStr.slice(0, 50);
  }
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
        e.action.toLowerCase().includes(q) ||
        e.entityType.toLowerCase().includes(q) ||
        e.entityId.toLowerCase().includes(q) ||
        (e.user?.name ?? "").toLowerCase().includes(q) ||
        (e.user?.email ?? "").toLowerCase().includes(q) ||
        (e.afterJson ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search, actionFilter]);

  const ACTIONS = ["ALL", "CREATE", "UPDATE", "DELETE", "CANCEL"] as const;

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Activity log"
        description="Every change made in the app: who did it, what changed and when. Entries can't be edited or deleted."
        actions={
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-xs">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            Read-only & Append-only
          </span>
        }
      />

      {/* Filter and search bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Action pills */}
        <div className="flex flex-wrap gap-1">
          {ACTIONS.map((act) => (
            <button
              key={act}
              onClick={() => setActionFilter(act)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                actionFilter === act
                  ? "bg-primary text-white shadow-xs"
                  : "bg-white text-muted-foreground hover:bg-secondary border border-border hover:text-foreground"
              }`}
            >
              {act}
            </button>
          ))}
        </div>

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
            placeholder="Search action, entity, user…"
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
        <EmptyState>No audit entries recorded yet.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>No audit logs matching your current filters.</EmptyState>
      ) : (
        <div className="w-full min-w-0">
          <div className="mb-2 text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {data.length} logs
          </div>

          {/* Guaranteed contained table that never causes page-level overflow */}
          <Table>
            <THead>
              <tr>
                <Th className="w-36">When</Th>
                <Th className="w-44">User</Th>
                <Th className="w-28">Action</Th>
                <Th className="w-44">Entity</Th>
                <Th className="min-w-[200px]">Changes / Details</Th>
                <Th className="w-20 text-right">Inspect</Th>
              </tr>
            </THead>
            <tbody>
              {filtered.map((e) => {
                const variant = ACTION_VARIANTS[e.action] ?? "neutral";
                const icon = ACTION_ICONS[e.action];
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
                        {icon && (
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d={icon} />
                          </svg>
                        )}
                        {e.action}
                      </StatusBadge>
                    </Td>

                    {/* Entity */}
                    <Td className="whitespace-nowrap">
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-foreground">
                        {e.entityType.replace(/_/g, " ")}
                      </span>
                      <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                        {e.entityId.slice(0, 8)}…
                      </span>
                    </Td>

                    {/* Details Preview — strictly bounded to prevent blowout */}
                    <Td>
                      <div className="max-w-[280px] md:max-w-sm truncate font-mono text-xs text-muted-foreground" title={e.afterJson ?? e.beforeJson ?? ""}>
                        {formatPreview(e.afterJson ?? e.beforeJson)}
                      </div>
                    </Td>

                    {/* Inspect button */}
                    <Td className="text-right whitespace-nowrap">
                      <button
                        onClick={() => setInspectEntry(e)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        View
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
                    {inspectEntry.action}
                  </StatusBadge>
                  <span className="text-sm font-bold text-foreground">
                    {inspectEntry.entityType} ({inspectEntry.entityId})
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
                  <p className="mb-1 text-sm font-semibold text-foreground">State Before</p>
                  <pre className="max-h-56 overflow-auto rounded-lg bg-secondary/70 p-3 font-mono text-xs text-foreground">
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(inspectEntry.beforeJson), null, 2);
                      } catch {
                        return inspectEntry.beforeJson;
                      }
                    })()}
                  </pre>
                </div>
              )}

              {inspectEntry.afterJson && inspectEntry.afterJson !== "null" && (
                <div>
                  <p className="mb-1 text-sm font-semibold text-foreground">
                    {inspectEntry.beforeJson ? "State After (Changes)" : "Created Payload"}
                  </p>
                  <pre className="max-h-72 overflow-auto rounded-lg bg-secondary/70 p-3 font-mono text-xs text-foreground">
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(inspectEntry.afterJson), null, 2);
                      } catch {
                        return inspectEntry.afterJson;
                      }
                    })()}
                  </pre>
                </div>
              )}

              {!inspectEntry.beforeJson && !inspectEntry.afterJson && (
                <p className="text-sm text-muted-foreground">No JSON payload recorded for this event.</p>
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
