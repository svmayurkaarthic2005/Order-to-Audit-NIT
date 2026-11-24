import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { useAuth, type Role } from "@/lib/auth";
import Login from "@/pages/Login";
import BOM from "@/pages/admin/BOM";
import Customers from "@/pages/admin/Masters/Customers";
import Items from "@/pages/admin/Masters/Items";
import Suppliers from "@/pages/admin/Masters/Suppliers";
import AuditLog from "@/pages/admin/AuditLog";
import Dashboard from "@/pages/admin/Dashboard";
import Dispatch from "@/pages/admin/Dispatch";
import Invoices from "@/pages/admin/Invoices";
import OpeningStock from "@/pages/admin/OpeningStock";
import Payments from "@/pages/admin/Payments";
import Reports from "@/pages/admin/Reports";
import OrderQueue from "@/pages/admin/OrderQueue";
import Purchases from "@/pages/admin/Purchases";
import ProductionRuns from "@/pages/production/ProductionRuns";
import OrderEntry from "@/pages/salesman/OrderEntry";
import OrderHistory from "@/pages/salesman/OrderHistory";

function Home() {
  const { user } = useAuth();
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Welcome, {user?.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        பொருளோட்டம் · Every material. Every process. One connected system. Pick a section from the menu to get
        started.
      </p>
    </div>
  );
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
      <Route path="/" element={page(<Home />)} />
      <Route path="/admin/customers" element={page(<Customers />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/suppliers" element={page(<Suppliers />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/items" element={page(<Items />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/opening-stock" element={page(<OpeningStock />, ["ADMIN", "OWNER"])} />
      <Route path="/admin/bom" element={page(<BOM />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/orders" element={page(<OrderQueue />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/invoices" element={page(<Invoices />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/dispatch" element={page(<Dispatch />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/payments" element={page(<Payments />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/reports" element={page(<Reports />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/dashboard" element={page(<Dashboard />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/audit-log" element={page(<AuditLog />, ["ADMIN", "OWNER", "ACCOUNTANT"])} />
      <Route path="/admin/purchases" element={page(<Purchases />, ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"])} />
      <Route path="/production/runs" element={page(<ProductionRuns />, ["ADMIN", "OWNER", "PRODUCTION", "ACCOUNTANT"])} />
      <Route path="/salesman/orders" element={page(<OrderHistory />, ["ADMIN", "OWNER", "SALESMAN"])} />
      <Route path="/salesman/orders/new" element={page(<OrderEntry />, ["ADMIN", "OWNER", "SALESMAN"])} />
    </Routes>
  );
}
