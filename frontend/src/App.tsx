import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { useAuth, type Role } from "@/lib/auth";
import Login from "@/pages/Login";
import BOM from "@/pages/admin/BOM";
import Parties from "@/pages/admin/Masters/Parties";
import Items from "@/pages/admin/Masters/Items";
import AuditLog from "@/pages/admin/AuditLog";
import Reconciliation from "@/pages/admin/Reconciliation";
import Dashboard from "@/pages/admin/Dashboard";
import Dispatch from "@/pages/admin/Dispatch";
import Invoices from "@/pages/admin/Invoices";
import LowStockAlerts from "@/pages/admin/LowStockAlerts";
import Reports from "@/pages/admin/Reports";
import OrderQueue from "@/pages/admin/OrderQueue";
import Purchases from "@/pages/admin/Purchases";
import Batches from "@/pages/admin/Batches";
import BatchGenealogy from "@/pages/admin/BatchGenealogy";
import ProductionRuns from "@/pages/production/ProductionRuns";
import OrderEntry from "@/pages/salesman/OrderEntry";
import OrderHistory from "@/pages/salesman/OrderHistory";

/** Role-aware landing: sends every role directly to their relevant command center */
function RoleRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "SALESMAN") return <Navigate to="/salesman/orders" replace />;
  if (user.role === "PRODUCTION") return <Navigate to="/production/runs" replace />;
  return <Navigate to="/admin/dashboard" replace />;
}

function page(element: ReactNode, roles?: Role[]) {
  return (
    <ProtectedRoute roles={roles}>
      <AppShell>{element}</AppShell>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Root route redirects each role to their proper dashboard/page */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <RoleRedirect />
          </ProtectedRoute>
        }
      />
      {/* Admin / Owner / Accountant core ERP pages */}
      <Route path="/admin/dashboard" element={page(<Dashboard />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/orders" element={page(<OrderQueue />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/invoices" element={page(<Invoices />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      {/* Payments is now part of the Invoices page — keep the old URL working. */}
      <Route path="/admin/payments" element={<Navigate to="/admin/invoices" replace />} />
      <Route path="/admin/dispatch" element={page(<Dispatch />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/reports" element={page(<Reports />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/audit-log" element={page(<AuditLog />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/reconciliation" element={page(<Reconciliation />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />

      {/* Production & Inventory */}
      <Route path="/admin/bom" element={page(<BOM />, ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"])} />
      {/* Opening stock is now a secondary action on Low Stock Alerts. */}
      <Route path="/admin/opening-stock" element={<Navigate to="/admin/stock-data" replace />} />
      {/* Renamed from "Low Stock Alerts" — the page covers all stock, not just low items. */}
      <Route path="/admin/low-stock" element={<Navigate to="/admin/stock-data" replace />} />
      <Route path="/admin/stock-data" element={page(<LowStockAlerts />, ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"])} />
      <Route path="/admin/purchases" element={page(<Purchases />, ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"])} />
      <Route path="/admin/batches" element={page(<Batches />, ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"])} />
      <Route path="/admin/batches/:type/:id/genealogy" element={page(<BatchGenealogy />, ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"])} />
      <Route path="/production/runs" element={page(<ProductionRuns />, ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"])} />

      {/* Master Data */}
      <Route path="/admin/customers" element={page(<Parties />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      {/* Suppliers is now a tab on the same page — keep the old URL working. */}
      <Route path="/admin/suppliers" element={<Navigate to="/admin/customers?type=supplier" replace />} />
      <Route path="/admin/items" element={page(<Items />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />

      {/* Salesman specific pages — restricted ONLY to SALESMAN role */}
      <Route path="/salesman/orders" element={page(<OrderHistory />, ["SALESMAN"])} />
      <Route path="/salesman/orders/new" element={page(<OrderEntry />, ["SALESMAN"])} />
    </Routes>
  );
}
