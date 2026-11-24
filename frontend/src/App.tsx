import { Link, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/auth";
import Login from "@/pages/Login";
import Customers from "@/pages/admin/Masters/Customers";
import Items from "@/pages/admin/Masters/Items";
import Suppliers from "@/pages/admin/Masters/Suppliers";
import OpeningStock from "@/pages/admin/OpeningStock";
import Purchases from "@/pages/admin/Purchases";

function Home() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "OWNER";
  const canRecordPurchases = isAdmin || user?.role === "PRODUCTION";
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
          </>
        )}
        {canRecordPurchases && <Link to="/admin/purchases">Purchases</Link>}
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
        path="/admin/purchases"
        element={
          <ProtectedRoute roles={["ADMIN", "OWNER", "PRODUCTION"]}>
            <Purchases />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
