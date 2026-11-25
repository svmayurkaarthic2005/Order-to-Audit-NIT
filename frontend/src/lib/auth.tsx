import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { replayOfflineOrders, setOfflineQueueUser } from "./api";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export type Role = "SALESMAN" | "ADMIN" | "PRODUCTION" | "ACCOUNTANT" | "OWNER";
export type AuthUser = { id: string; role: Role; name: string };

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setUser(body?.data ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setOfflineQueueUser(user?.id ?? null);
    if (user && navigator.onLine) void replayOfflineOrders();
  }, [user]);

  async function login(email: string, password: string) {
    setError(null);
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error?.message ?? "Login failed");
      throw new Error(body.error?.message ?? "Login failed");
    }
    setUser(body.data.user);
  }

  async function logout() {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
