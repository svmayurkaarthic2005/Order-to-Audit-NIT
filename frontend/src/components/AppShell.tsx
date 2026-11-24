import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth, type Role } from "@/lib/auth";
import { NotificationBell } from "./NotificationBell";

type NavItem = { to: string; label: string; icon: string; roles: Role[] };
type NavGroup = { label: string; icon: string; items: NavItem[] };

const ROLE_SECTION_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  ACCOUNTANT: "Accountant",
  PRODUCTION: "Production",
  SALESMAN: "Salesman",
};

const NAV: NavGroup[] = [
  // ── 1. Overview ──
  {
    label: "Overview",
    // Speedometer / gauge icon
    icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z",
    items: [
      {
        to: "/admin/dashboard",
        label: "Dashboard",
        // Grid / dashboard icon
        icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z",
        roles: ["ADMIN", "OWNER", "ACCOUNTANT"],
      },
    ],
  },

  // ── 2. Sales & Orders ──
  {
    label: "Sales & Orders",
    // Shopping cart
    icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z",
    items: [
      {
        to: "/admin/orders",
        label: "Order queue",
        // Clipboard task list
        icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
        roles: ["ADMIN", "OWNER", "ACCOUNTANT"],
      },
      {
        to: "/salesman/orders",
        label: "My orders",
        // Clipboard with check
        icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
        roles: ["SALESMAN"],
      },
      {
        to: "/salesman/orders/new",
        label: "New order",
        // Plus circle
        icon: "M12 4v16m8-8H4",
        roles: ["SALESMAN"],
      },
    ],
  },

  // ── 3. Production ──
  {
    label: "Production",
    // Beaker / flask
    icon: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z",
    items: [
      {
        to: "/production/runs",
        label: "Production runs",
        // Lightning bolt / activity
        icon: "M13 10V3L4 14h7v7l9-11h-7z",
        roles: ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"],
      },
      {
        to: "/admin/bom",
        label: "BOM / recipes",
        // Recipe checklist card
        icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
        roles: ["ADMIN", "OWNER", "ACCOUNTANT"],
      },
    ],
  },

  // ── 4. Inventory & Logistics ──
  {
    label: "Inventory",
    // Warehouse cube
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    items: [
      {
        to: "/admin/purchases",
        label: "Purchases",
        // Shopping bag
        icon: "M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0",
        roles: ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"],
      },
      {
        to: "/admin/dispatch",
        label: "Dispatch",
        // Fast forward / send arrow
        icon: "M5 12h14M12 5l7 7-7 7",
        roles: ["ADMIN", "OWNER", "ACCOUNTANT"],
      },
      {
        to: "/admin/stock-data",
        label: "Stock Data",
        // Warning triangle
        icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
        roles: ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"],
      },
      {
        to: "/admin/batches",
        label: "Batches & Lots",
        // Archive / layers / lots icon
        icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
        roles: ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"],
      },
    ],
  },

  // ── 5. Billing & Finance ──
  {
    label: "Billing & Finance",
    // Invoice document
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    items: [
      {
        to: "/admin/invoices",
        label: "Invoices & Payments",
        // Document receipt
        icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
        roles: ["ADMIN", "OWNER", "ACCOUNTANT"],
      },
    ],
  },

  // ── 6. Master Data ──
  {
    label: "Master Data",
    // Database / master records
    icon: "M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7M4 7c0-2 1.5-3 3.5-3h9c2 0 3.5 1 3.5 3M4 7c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3m-16 5c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3",
    items: [
      {
        to: "/admin/items",
        label: "Items catalog",
        // Tag / product
        icon: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z",
        roles: ["ADMIN", "OWNER", "ACCOUNTANT"],
      },
      {
        to: "/admin/customers",
        label: "Customers & Suppliers",
        // Person
        icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
        roles: ["ADMIN", "OWNER", "ACCOUNTANT"],
      },
    ],
  },

  // ── 7. Analytics & Compliance ──
  {
    label: "Analytics & Logs",
    // Chart / stats
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    items: [
      {
        to: "/admin/reports",
        label: "Reports",
        // Bar chart
        icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
        roles: ["ADMIN", "OWNER", "ACCOUNTANT"],
      },
      {
        to: "/admin/audit-log",
        label: "Audit log",
        // Shield with check
        icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
        roles: ["ADMIN", "OWNER", "ACCOUNTANT"],
      },
      {
        to: "/admin/reconciliation",
        label: "Reconciliation",
        // Scale / balance
        icon: "M12 3v18M5 7l-3 6a3 3 0 006 0l-3-6zm14 0l-3 6a3 3 0 006 0l-3-6zM5 7h14M5 7l2-3h10l2 3",
        roles: ["ADMIN", "OWNER", "ACCOUNTANT"],
      },
    ],
  },
];

/** Lightweight inline SVG icon — zero external deps */
function NavIcon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function NavLinks({
  role,
  onNavigate,
}: {
  role: Role;
  onNavigate?: () => void;
}) {
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles.includes(role)),
  })).filter((g) => g.items.length > 0);
  const { pathname } = useLocation();

  return (
    <nav
      className="flex flex-1 flex-col gap-1 px-3 py-3"
      aria-label="Main navigation"
    >
      {groups.map((group) => (
        <div key={group.label} className="mb-2.5">
          {/* Group header */}
          <p className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-white/40">
            <NavIcon d={group.icon} size={11} />
            {group.label}
          </p>

          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`relative group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-all duration-150 ${
                    active
                      ? "font-semibold text-white shadow-xs"
                      : "text-white/70 hover:text-white hover:bg-white/[0.07] active:bg-white/10"
                  }`}
                  style={
                    active
                      ? { background: "rgba(255,255,255,0.13)" }
                      : undefined
                  }
                >
                  {/* Active left indicator */}
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-indigo-300" />
                  )}

                  {/* Nav icon */}
                  <span
                    className={`shrink-0 transition-opacity ${
                      active
                        ? "text-white opacity-100"
                        : "text-white/60 group-hover:text-white group-hover:opacity-100"
                    }`}
                  >
                    <NavIcon d={item.icon} size={15} />
                  </span>

                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (!user) return <>{children}</>;

  const initials = user.name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex min-h-screen flex-col md:h-screen md:flex-row md:overflow-hidden bg-background">
      {/* ── Desktop sidebar ────────────────────────────────────────────── */}
      <aside
        className="hidden md:flex md:w-60 md:h-screen md:shrink-0 md:flex-col"
        style={{ background: "linear-gradient(180deg, #1e1b4b 0%, #25225c 50%, #2d2a6e 100%)" }}
      >
        {/* Logo / brand — Clickable to Role Dashboard */}
        <Link
          to={user.role === "SALESMAN" ? "/salesman/orders" : user.role === "PRODUCTION" ? "/production/runs" : "/admin/dashboard"}
          className="flex shrink-0 items-center gap-3 border-b border-white/10 px-5 py-4 transition-colors hover:bg-white/5"
          title="Porulottam ERP"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/25 ring-1 ring-white/20 shadow-inner">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">
              Porulottam ERP
            </p>
            <p className="text-[11px] text-white/40 leading-tight">
              பொருளோட்டம்
            </p>
          </div>
        </Link>

        {/* Nav — smooth scrollable list */}
        <div className="relative flex-1 min-h-0 overflow-y-auto">
          <NavLinks role={user.role} />
        </div>

        {/* User footer */}
        <div className="shrink-0 border-t border-white/10 px-4 py-3.5 bg-black/10">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-400/30 text-xs font-bold text-white ring-1 ring-white/15">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white leading-tight">
                {user.name}
              </p>
              <p className="text-xs text-white/45 leading-tight">{user.role}</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="mt-2.5 flex w-full items-center gap-1.5 text-xs text-white/50 transition-colors hover:text-white"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Mobile header ──────────────────────────────────────────────── */}
      <div className="md:hidden">
        <header
          className="flex items-center justify-between border-b border-white/10 px-4 py-3"
          style={{ background: "#1e1b4b" }}
        >
          {/* Brand */}
          <Link
            to={user.role === "SALESMAN" ? "/salesman/orders" : user.role === "PRODUCTION" ? "/production/runs" : "/admin/dashboard"}
            className="flex items-center gap-2.5"
            title="Porulottam ERP"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/15">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <span className="text-sm font-bold text-white">Porulottam ERP</span>
          </Link>

          {/* Hamburger / Close — 44 px min touch target */}
          <div className="flex items-center gap-1">
            <NotificationBell />
            <button
              onClick={() => setMobileNavOpen((v) => !v)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white active:bg-white/15"
              aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav"
            >
            {mobileNavOpen ? (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
          </div>
        </header>

        {/* Mobile nav drawer */}
        <div
          id="mobile-nav"
          aria-hidden={!mobileNavOpen}
          className="overflow-hidden transition-all duration-300 ease-in-out"
          style={{
            maxHeight: mobileNavOpen ? "100vh" : "0px",
            background: "linear-gradient(180deg, #1e1b4b 0%, #2d2a6e 100%)",
          }}
        >
          <div
            className="overflow-y-auto border-b border-white/10 shadow-xl"
            style={{ maxHeight: "calc(100vh - 56px)" }}
          >
            <NavLinks
              role={user.role}
              onNavigate={() => setMobileNavOpen(false)}
            />
            {/* User row in drawer */}
            <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 bg-black/10">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-400/30 text-xs font-bold text-white">
                  {initials}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {user.name}
                  </p>
                  <p className="text-xs text-white/45">{user.role}</p>
                </div>
              </div>
              <button
                onClick={() => logout()}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-white/70 ring-1 ring-white/15 transition-colors hover:bg-white/10 hover:text-white active:bg-white/15"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 md:h-screen flex flex-col md:overflow-hidden">
        {/* Top bar on desktop */}
        <div className="hidden shrink-0 items-center justify-between border-b border-border bg-white px-8 py-3.5 md:flex">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
            {pathname
              .split("/")
              .filter(Boolean)
              .map((seg, i, arr) => (
                <span key={i}>
                  {i > 0 && (
                    <span className="mx-1.5 text-muted-foreground/40">›</span>
                  )}
                  <span
                    className={
                      i === arr.length - 1
                        ? "font-medium text-foreground capitalize"
                        : "capitalize"
                    }
                  >
                    {/* The leading path segment ("admin"/"production"/"salesman") is a
                        routing artifact shared across roles — an Owner or Accountant on
                        an /admin/* route is not "Admin", so show their own role there
                        instead of echoing the URL segment literally. */}
                    {i === 0 ? ROLE_SECTION_LABEL[user.role] : seg.replace(/-/g, " ")}
                  </span>
                </span>
              ))}
          </nav>

          {/* User chip */}
          <div className="flex items-center gap-3">
            <NotificationBell />
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {initials}
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-foreground leading-tight">
                {user.name}
              </p>
              <p className="text-xs text-muted-foreground leading-tight">{user.role}</p>
            </div>
          </div>
        </div>

        {/* Page content — independently scrollable pane */}
        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
          <div className="w-full min-w-0 max-w-full px-4 py-6 md:px-8 md:py-8">
            <div className="mx-auto w-full min-w-0 max-w-6xl page-enter">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
