import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button, ErrorText, Field, Input } from "@/components/ui";

const SHOW_DEMO_LOGIN = import.meta.env.VITE_ENABLE_DEMO_LOGIN !== "false";
const DEMO_PASSWORD = "password123";
const DEMO_ACCOUNTS = [
  { role: "Owner", email: "owner@porulottam.test" },
  { role: "Admin", email: "admin@porulottam.test" },
  { role: "Accountant", email: "accountant@porulottam.test" },
  { role: "Production", email: "production@porulottam.test" },
  { role: "Salesman", email: "salesman@porulottam.test" },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-background">
      {/* ── Left branding panel (hidden on mobile) ── */}
      <div
        className="hidden flex-col justify-between p-12 lg:flex lg:w-5/12"
        style={{ background: "linear-gradient(145deg, #1e1b4b 0%, #2d2a6e 50%, #3730a3 100%)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 shadow-inner">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div>
            <p className="text-base font-bold text-white">Porulottam ERP</p>
            <p className="text-xs text-white/40">பொருளோட்டம்</p>
          </div>
        </div>

        <div>
          <p className="max-w-sm text-xl font-semibold leading-relaxed text-white">
            Orders, production, stock and billing for the factory, in one place.
          </p>
          <p className="mt-8 mb-3 text-sm text-white/60">How an order moves</p>
          <ol className="flex flex-col gap-2.5 text-sm text-white/80">
            {[
              "A salesman takes the order",
              "Admin approves it and stock is set aside",
              "An invoice is made",
              "The goods are dispatched",
              "The payment is recorded",
            ].map((step, i) => (
              <li key={step} className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs tabular text-white/70">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <span />
      </div>

      {/* ── Right login form ── */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 lg:px-16">
        {/* Mobile logo */}
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-sm shadow-primary/30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Porulottam ERP</p>
            <p className="text-xs text-muted-foreground">பொருளோட்டம்</p>
          </div>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">Sign in to your account to continue</p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <Field label="Email address" required>
              <Input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full"
              />
            </Field>

            <Field label="Password" required>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </Field>

            {error && <ErrorText>{error}</ErrorText>}

            <Button type="submit" disabled={submitting} className="mt-1 h-11 w-full text-base">
              {submitting ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          {SHOW_DEMO_LOGIN && (
            <div className="mt-8 rounded-xl border border-border bg-secondary/40 p-4">
              <p className="text-xs font-semibold text-muted-foreground">Demo accounts</p>
              <p className="mt-1 text-xs text-muted-foreground">Password for every account: <span className="font-mono text-foreground">{DEMO_PASSWORD}</span></p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    onClick={() => fillDemo(a.email)}
                    className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                    title={a.email}
                  >
                    {a.role}
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </main>
  );
}
