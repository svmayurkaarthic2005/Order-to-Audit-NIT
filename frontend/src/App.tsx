import { Link, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/auth";
import Login from "@/pages/Login";
import BOM from "@/pages/admin/BOM";
import Customers from "@/pages/admin/Masters/Customers";
import Items from "@/pages/admin/Masters/Items";
import Suppliers from "@/pages/admin/Masters/Suppliers";
import OpeningStock from "@/pages/admin/OpeningStock";
import OrderQueue from "@/pages/admin/OrderQueue";
import Purchases from "@/pages/admin/Purchases";
import ProductionRuns from "@/pages/production/ProductionRuns";
import OrderEntry from "@/pages/salesman/OrderEntry";
import OrderHistory from "@/pages/salesman/OrderHistory";

function Home() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "OWNER";
  const canRecordPurchases = isAdmin || user?.role === "PRODUCTION";
  const canOrder = isAdmin || user?.role === "SALESMAN";
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background text-foreground">
      <h1 className="text-3xl font-semibold">Porulottam ERP</h1>
      <p className="text-muted-foreground">
        பொருளோட்டம் &middot; Every material. Every process. One connected system.
      </p>
      <p className="mt-4">
        Signed in as <strong>{user?.name}</strong> ({user?.role})
      </p>
      <nav className="mt-4 flex gap-4 text-sm underline">
        {isAdmin && (
          <>
            <Link to="/admin/customers">Customers</Link>
            <Link to="/admin/suppliers">Suppliers</Link>
            <Link to="/admin/items">Items</Link>
            <Link to="/admin/opening-stock">Opening Stock</Link>
            <Link to="/admin/bom">BOM</Link>
            <Link to="/admin/orders">Order Queue</Link>
          </>
        )}
        {canRecordPurchases && <Link to="/admin/purchases">Purchases</Link>}
        {canRecordPurchases && <Link to="/production/runs">Production</Link>}
        {canOrder && <Link to="/salesman/orders">Orders</Link>}
      </nav>
      <button onClick={() => logout()} className="mt-4 rounded border border-input px-3 py-1">
        Log out
      </button>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/customers"
        element={
          <ProtectedRoute roles={["ADMIN", "OWNER"]}>
            <Customers />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/suppliers"
        element={
          <ProtectedRoute roles={["ADMIN", "OWNER"]}>
            <Suppliers />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/items"
        element={
          <ProtectedRoute roles={["ADMIN", "OWNER"]}>
            <Items />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/opening-stock"
        element={
          <ProtectedRoute roles={["ADMIN", "OWNER"]}>
            <OpeningStock />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/bom"
        element={
          <ProtectedRoute roles={["ADMIN", "OWNER"]}>
            <BOM />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/orders"
        element={
          <ProtectedRoute roles={["ADMIN", "OWNER"]}>
            <OrderQueue />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/purchases"
        element={
          <ProtectedRoute roles={["ADMIN", "OWNER", "PRODUCTION"]}>
            <Purchases />
          </ProtectedRoute>
        }
      />
      <Route
        path="/production/runs"
        element={
          <ProtectedRoute roles={["ADMIN", "OWNER", "PRODUCTION"]}>
            <ProductionRuns />
          </ProtectedRoute>
        }
      />
      <Route
        path="/salesman/orders"
        element={
          <ProtectedRoute roles={["ADMIN", "OWNER", "SALESMAN"]}>
            <OrderHistory />
          </ProtectedRoute>
        }
      />
      <Route
        path="/salesman/orders/new"
        element={
          <ProtectedRoute roles={["ADMIN", "OWNER", "SALESMAN"]}>
            <OrderEntry />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
