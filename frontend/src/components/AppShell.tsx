import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth, type Role } from "@/lib/auth";

type NavItem = { to: string; label: string; roles: Role[] };
type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: "Sales",
    items: [
      { to: "/admin/orders", label: "Order queue", roles: ["ADMIN", "OWNER", "ACCOUNTANT"] },
      { to: "/salesman/orders", label: "My orders", roles: ["SALESMAN"] },
      { to: "/salesman/orders/new", label: "New order", roles: ["SALESMAN"] },
    ],
  },
  {
    label: "Production",
    items: [
      { to: "/production/runs", label: "Production runs", roles: ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"] },
      { to: "/admin/bom", label: "BOM / recipes", roles: ["ADMIN", "OWNER", "ACCOUNTANT"] },
    ],
  },
  {
    label: "Inventory",
    items: [
      { to: "/admin/opening-stock", label: "Opening stock", roles: ["ADMIN", "OWNER"] },
      { to: "/admin/purchases", label: "Purchases", roles: ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"] },
      { to: "/admin/dispatch", label: "Dispatch", roles: ["ADMIN", "OWNER", "ACCOUNTANT"] },
    ],
  },
  {
    label: "Billing",
    items: [
      { to: "/admin/invoices", label: "Invoices", roles: ["ADMIN", "OWNER", "ACCOUNTANT"] },
      { to: "/admin/payments", label: "Payments", roles: ["ADMIN", "OWNER", "ACCOUNTANT"] },
    ],
  },
  {
    label: "Records",
    items: [
      { to: "/admin/customers", label: "Customers", roles: ["ADMIN", "OWNER", "ACCOUNTANT"] },
      { to: "/admin/suppliers", label: "Suppliers", roles: ["ADMIN", "OWNER", "ACCOUNTANT"] },
      { to: "/admin/items", label: "Items", roles: ["ADMIN", "OWNER", "ACCOUNTANT"] },
    ],
  },
  {
    label: "Reports",
    items: [
      { to: "/admin/dashboard", label: "Dashboard", roles: ["ADMIN", "OWNER", "ACCOUNTANT"] },
      { to: "/admin/reports", label: "Reports", roles: ["ADMIN", "OWNER", "ACCOUNTANT"] },
      { to: "/admin/audit-log", label: "Audit log", roles: ["ADMIN", "OWNER", "ACCOUNTANT"] },
    ],
  },
];

function NavLinks({ role, onNavigate }: { role: Role; path: string; onNavigate?: () => void }) {
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) })).filter(
    (g) => g.items.length > 0,
  );
  const { pathname } = useLocation();

  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">{group.label}</p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    active ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {item.label}
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

  return (
    <div className="min-h-screen bg-background md:flex">
      {/* Desktop / tablet sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col bg-navy md:flex">
        <div className="border-b border-white/10 px-4 py-4">
          <p className="text-sm font-semibold text-white">Porulottam ERP</p>
          <p className="text-xs text-white/50">பொருளோட்டம்</p>
        </div>
        <NavLinks role={user.role} path={pathname} />
        <div className="border-t border-white/10 px-4 py-3">
          <p className="truncate text-sm text-white">{user.name}</p>
          <p className="text-xs text-white/50">{user.role}</p>
          <button onClick={() => logout()} className="mt-2 text-xs text-white/60 underline hover:text-white">
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile top bar + slide-down nav — the salesman's primary surface */}
      <header className="flex items-center justify-between border-b border-border bg-navy px-4 py-3 md:hidden">
        <p className="text-sm font-semibold text-white">Porulottam ERP</p>
        <button
          onClick={() => setMobileNavOpen((v) => !v)}
          className="rounded-md px-2 py-1 text-sm text-white/80 hover:bg-white/10"
          aria-label="Toggle menu"
        >
          {mobileNavOpen ? "Close" : "Menu"}
        </button>
      </header>
      {mobileNavOpen && (
        <div className="flex flex-col bg-navy md:hidden">
          <NavLinks role={user.role} path={pathname} onNavigate={() => setMobileNavOpen(false)} />
          <div className="border-t border-white/10 px-4 py-3">
            <p className="truncate text-sm text-white">
              {user.name} · {user.role}
            </p>
            <button onClick={() => logout()} className="mt-2 text-xs text-white/60 underline">
              Log out
            </button>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
