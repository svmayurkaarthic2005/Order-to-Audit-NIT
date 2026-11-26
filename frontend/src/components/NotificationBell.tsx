import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// ── Types ──────────────────────────────────────────────────────────────────

type Severity = "INFO" | "WARNING" | "CRITICAL";
type NotificationType =
  | "LOW_STOCK"
  | "STOCK_REPLENISHED"
  | "PRODUCTION_VARIANCE"
  | "ORDER_SHORTAGE"
  | "AUDIT_EXCEPTION"
  | "EXPIRY_WARNING";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  severity: Severity;
  sourceType: string;
  sourceId: string;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  items: Notification[];
  unreadCount: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sourceToPath(sourceType: string, isSalesman: boolean): string {
  switch (sourceType) {
    case "LowStockAlert":
      return "/admin/stock-data";
    case "ProductionRun":
      return `/production/runs`;
    case "SalesOrder":
      // Salesmen can't open the admin order queue; their own list is the place.
      return isSalesman ? "/salesman/orders" : "/admin/orders";
    case "AuditLog":
      return `/admin/audit-log`;
    case "RawMaterialBatch":
    case "FinishedGoodsBatch":
      return "/admin/batches";
    case "ReconciliationException":
      return "/admin/reconciliation";
    default:
      return "/";
  }
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const SEVERITY_DOT: Record<Severity, string> = {
  INFO: "bg-blue-500",
  WARNING: "bg-amber-500",
  CRITICAL: "bg-red-500",
};

const SEVERITY_RING: Record<Severity, string> = {
  INFO: "ring-blue-200",
  WARNING: "ring-amber-200",
  CRITICAL: "ring-red-200",
};

// ── Bell Icon SVG ──────────────────────────────────────────────────────────

function BellIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data } = useQuery<NotificationsResponse>({
    queryKey: ["notifications"],
    queryFn: () => api.get<NotificationsResponse>("/notifications"),
    refetchInterval: 30_000,
  });

  const markReadMut = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/notifications/${id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllReadMut = useMutation({
    mutationFn: () => api.patch("/notifications/read-all", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  function handleItemClick(n: Notification) {
    if (!n.readAt) markReadMut.mutate(n.id);
    setOpen(false);
    navigate(sourceToPath(n.sourceType, user?.role === "SALESMAN"));
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <BellIcon size={20} />
        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Backdrop — clicking outside closes */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />

          <div
            className="fixed inset-x-3 top-16 z-50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 origin-top-right rounded-xl border border-border bg-white shadow-xl ring-1 ring-black/5 focus:outline-none"
            role="dialog"
            aria-label="Notifications"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                Notifications
                {unreadCount > 0 && (
                  <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">
                    {unreadCount} unread
                  </span>
                )}
              </h3>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markAllReadMut.mutate()}
                  disabled={markAllReadMut.isPending}
                  className="text-xs text-primary hover:underline disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
              {items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                  <BellIcon size={28} />
                  <p>You're all caught up.</p>
                </div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 ${
                      n.readAt ? "opacity-60" : ""
                    }`}
                  >
                    {/* Severity dot */}
                    <span
                      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ${SEVERITY_DOT[n.severity]} ${SEVERITY_RING[n.severity]}`}
                      title={n.severity}
                    />

                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-medium ${n.readAt ? "text-muted-foreground" : "text-foreground"}`}>
                        {n.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {n.message}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground/70">
                        {relativeTime(n.createdAt)}
                      </p>
                    </div>

                    {/* Unread dot */}
                    {!n.readAt && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="border-t border-border px-4 py-2 text-center">
                <p className="text-xs text-muted-foreground">
                  Showing last {items.length} notification{items.length !== 1 ? "s" : ""}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
