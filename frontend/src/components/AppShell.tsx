import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth, type Role } from "@/lib/auth";
import { NotificationBell } from "./NotificationBell";

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  ACCOUNTANT: "Accountant",
  PRODUCTION: "Production",
  SALESMAN: "Salesman",
};

type Tab = { to: string; label: string; roles: Role[] };
type Section = { label: string; icon: string; tabs: Tab[] };

const BACK_OFFICE: Role[] = ["ADMIN", "OWNER", "ACCOUNTANT"];
const WITH_PRODUCTION: Role[] = ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"];

// Each section is one sidebar link; its tabs sit along the top of the page.
// Keeps the sidebar short while every existing URL keeps working.
const SECTIONS: Section[] = [
  {
    label: "Home",
    icon: "M3 11l9-8 9 8M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10",
    tabs: [{ to: "/admin/dashboard", label: "Home", roles: BACK_OFFICE }],
  },
  {
    label: "Orders",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
    tabs: [
      { to: "/salesman/orders/new", label: "New order", roles: ["SALESMAN"] },
      { to: "/salesman/orders", label: "My orders", roles: ["SALESMAN"] },
      { to: "/admin/orders", label: "Approve orders", roles: BACK_OFFICE },
      { to: "/admin/dispatch", label: "Dispatch", roles: BACK_OFFICE },
    ],
  },
  {
    label: "Billing",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    tabs: [{ to: "/admin/invoices", label: "Invoices & payments", roles: BACK_OFFICE }],
  },
  {
    label: "Production",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
    tabs: [
      { to: "/production/runs", label: "Production runs", roles: WITH_PRODUCTION },
      { to: "/admin/bom", label: "Recipes", roles: WITH_PRODUCTION },
    ],
  },
  {
    label: "Stock",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    tabs: [
      { to: "/admin/stock-data", label: "Stock levels", roles: WITH_PRODUCTION },
      { to: "/admin/purchases", label: "Purchases", roles: WITH_PRODUCTION },
      { to: "/admin/batches", label: "Batches", roles: WITH_PRODUCTION },
    ],
  },
  {
    label: "Setup",
    icon: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z",
    tabs: [
      { to: "/admin/items", label: "Products & materials", roles: BACK_OFFICE },
      { to: "/admin/customers", label: "Customers & suppliers", roles: BACK_OFFICE },
    ],
  },
  {
    label: "Reports",
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    tabs: [
      { to: "/admin/reports", label: "Reports", roles: BACK_OFFICE },
      { to: "/admin/reconciliation", label: "Checks", roles: BACK_OFFICE },
      { to: "/admin/audit-log", label: "Activity log", roles: BACK_OFFICE },
    ],
  },
];

function sectionsFor(role: Role) {
  return SECTIONS.map((s) => ({ ...s, tabs: s.tabs.filter((t) => t.roles.includes(role)) })).filter((s) => s.tabs.length > 0);
}

// Longest matching tab wins, so /salesman/orders/new doesn't also light up
// /salesman/orders, and /admin/batches/... detail pages stay under Batches.
function findActive(role: Role, pathname: string) {
  let best: { section: Section; tab: Tab } | null = null;
  for (const section of sectionsFor(role)) {
    for (const tab of section.tabs) {
      const matches = pathname === tab.to || pathname.startsWith(tab.to + "/");
      if (matches && (!best || tab.to.length > best.tab.to.length)) best = { section, tab };
    }
  }
  return best;
}

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

function NavLinks({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const active = findActive(role, pathname);

  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4" aria-label="Main navigation">
      {sectionsFor(role).map((section) => {
        const isActive = active?.section.label === section.label;
        return (
          <Link
            key={section.label}
            to={section.tabs[0]!.to}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
              isActive ? "bg-white/15 font-semibold text-white" : "text-white/70 hover:bg-white/[0.07] hover:text-white"
            }`}
          >
            <NavIcon d={section.icon} size={17} />
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SectionTabs({ role }: { role: Role }) {
  const { pathname } = useLocation();
  const active = findActive(role, pathname);
  if (!active || active.section.tabs.length < 2) return null;

  return (
    <nav className="flex gap-5 overflow-x-auto px-4 md:px-8" aria-label="Pages in this section">
      {active.section.tabs.map((tab) => {
        const isActive = tab.to === active.tab.to;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={isActive ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 pt-1 text-sm transition-colors ${
              isActive ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
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

  // A role with one section (the salesman: Orders) has nowhere else to go, so
  // no side bar or menu button: the brand sits in the top bar. The user's name
  // and Sign out live only in the top bar, for every role.
  const singleSection = sectionsFor(user.role).length === 1;
  const homePath = user.role === "SALESMAN" ? "/salesman/orders" : user.role === "PRODUCTION" ? "/production/runs" : "/admin/dashboard";
  const signOutButton = (
    <button
      onClick={() => logout()}
      className="flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors hover:bg-secondary hover:text-foreground"
    >
      Sign out
    </button>
  );

  return (
    <div className="flex min-h-screen flex-col md:h-screen md:flex-row md:overflow-hidden bg-background">
      {/* ── Desktop sidebar ────────────────────────────────────────────── */}
      {!singleSection && (
      <aside
        className="hidden md:flex md:w-60 md:h-screen md:shrink-0 md:flex-col"
        style={{ background: "#1e1b4b" }}
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

      </aside>
      )}

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
            {singleSection ? (
              <button
                onClick={() => logout()}
                className="flex min-h-[44px] items-center rounded-lg px-3 text-xs font-medium text-white/80 ring-1 ring-white/20 transition-colors hover:bg-white/10 hover:text-white"
              >
                Sign out
              </button>
            ) : (
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
            )}
          </div>
        </header>

        {/* Mobile nav drawer */}
        <div
          id="mobile-nav"
          aria-hidden={!mobileNavOpen}
          className="overflow-hidden transition-all duration-300 ease-in-out"
          style={{
            maxHeight: mobileNavOpen ? "100vh" : "0px",
            background: "#1e1b4b",
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
                  <p className="text-xs text-white/45">{ROLE_LABEL[user.role]}</p>
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
        <header className="shrink-0 border-b border-border bg-white">
          <div className="hidden items-center justify-between px-8 py-3 md:flex">
            {singleSection ? (
              <Link to={homePath} className="flex items-center gap-2.5" title="Porulottam ERP">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: "#1e1b4b" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <span className="text-base font-bold text-foreground">Porulottam ERP</span>
              </Link>
            ) : (
              <p className="text-base font-semibold text-foreground">{findActive(user.role, pathname)?.section.label ?? ""}</p>
            )}
            <div className="flex items-center gap-3">
              <NotificationBell />
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
                {initials}
              </div>
              <div className="text-right">
                <p className="text-sm font-medium leading-tight text-foreground">{user.name}</p>
                <p className="text-xs leading-tight text-muted-foreground">{ROLE_LABEL[user.role]}</p>
              </div>
              {signOutButton}
            </div>
          </div>
          <SectionTabs role={user.role} />
        </header>

        {/* Page content — independently scrollable pane */}
        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
          <div className="w-full min-w-0 max-w-full px-4 py-6 md:px-8 md:py-8">
            <div className="mx-auto w-full min-w-0 max-w-6xl">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
