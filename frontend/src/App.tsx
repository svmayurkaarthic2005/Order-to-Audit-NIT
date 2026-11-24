import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/auth";
import Login from "@/pages/Login";

function Home() {
  const { user, logout } = useAuth();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background text-foreground">
      <h1 className="text-3xl font-semibold">Porulottam ERP</h1>
      <p className="text-muted-foreground">
        பொருளோட்டம் &middot; Every material. Every process. One connected system.
      </p>
      <p className="mt-4">
        Signed in as <strong>{user?.name}</strong> ({user?.role})
      </p>
      <button onClick={() => logout()} className="rounded border border-input px-3 py-1">
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
    </Routes>
  );
}
