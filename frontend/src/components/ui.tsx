import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Link } from "react-router-dom";

// ─────────────────────────────────────────────────────────────────────────────
//  Stitch AI — Professional visual language for Porulottam ERP
//  One consistent system: inputs, buttons, tables, badges, cards, layout.
// ─────────────────────────────────────────────────────────────────────────────

// ── Inputs ───────────────────────────────────────────────────────────────────

export const inputClass =
  "h-10 rounded-lg border border-input bg-white px-3.5 text-sm text-foreground shadow-sm transition-all duration-150 placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60 hover:border-muted-foreground/40";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`${inputClass} ${className}`} {...rest} />;
}

// A Tailwind arbitrary-value background-image (a data-URI SVG) was silently
// failing to compile here, leaving every <select> in the app with reserved
// padding but no visible chevron — it looked like a plain, badly-aligned
// text box instead of a dropdown. A real SVG icon, positioned over the
// select, can't silently fail to render the way an arbitrary-value utility
// class can.
export function Select({
  className = "",
  selectClassName = "",
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  /** Sizes/positions the wrapper (e.g. "w-full", "flex-1"). */
  className?: string;
  /** Overrides the native <select>'s own look (e.g. a borderless select inlined into a custom row). */
  selectClassName?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select className={`${inputClass} w-full cursor-pointer appearance-none pr-9 ${selectClassName}`} {...rest} />
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea className={`${inputClass} h-auto min-h-[80px] py-2.5 ${className}`} {...rest} />;
}

export function Label({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-foreground">
      {children}
      {required && <span className="ml-0.5 text-destructive">*</span>}
    </label>
  );
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────────

const buttonVariants = {
  primary:     "bg-primary text-white shadow-sm shadow-primary/25 hover:bg-[var(--primary-hover)] active:scale-[0.98]",
  secondary:   "border border-border bg-white text-foreground shadow-sm hover:bg-secondary hover:border-muted-foreground/25 active:scale-[0.98]",
  ghost:       "text-foreground hover:bg-secondary active:scale-[0.98]",
  danger:      "border border-destructive/25 bg-white text-destructive hover:bg-destructive-bg hover:border-destructive/40 active:scale-[0.98]",
  destructive: "bg-destructive text-white shadow-sm shadow-destructive/25 hover:bg-destructive/90 active:scale-[0.98]",
  link:        "text-primary underline-offset-4 hover:underline",
} as const;

type ButtonVariant = keyof typeof buttonVariants;
type ButtonSize = "sm" | "md";

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = ""): string {
  const sizeClass = size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm";
  return `inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 rounded-lg font-semibold transition-all duration-150 focus:outline-none focus:ring-3 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:scale-100 ${sizeClass} ${buttonVariants[variant]} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  to,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

// ── Layout primitives ─────────────────────────────────────────────────────────

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card shadow-sm shadow-black/[0.04] ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold text-foreground">{children}</h2>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
          <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 9h6M9 12h6M9 15h4" />
        </svg>
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive-bg px-4 py-3">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-destructive">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
      </svg>
      <p className="text-sm text-destructive">{children}</p>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

export function Loading() {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
      </svg>
      Loading…
    </div>
  );
}

// ── Table primitives ──────────────────────────────────────────────────────────

export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="w-full max-w-full overflow-x-auto rounded-xl border border-border bg-white shadow-sm shadow-black/[0.04]">
      <table className={`w-full min-w-full border-collapse text-sm ${className}`}>{children}</table>
    </div>
  );
}

export function THead({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <thead className={`border-b border-border bg-secondary/50 ${className}`}>{children}</thead>;
}

export function Th({ children, numeric, className = "" }: { children: ReactNode; numeric?: boolean; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap px-4 py-3 text-xs font-bold text-foreground ${
        numeric ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, numeric, className = "" }: { children: ReactNode; numeric?: boolean; className?: string }) {
  return (
    <td
      className={`border-t border-border/60 px-4 py-3 text-foreground ${
        numeric ? "tabular text-right whitespace-nowrap" : "text-left break-words"
      } ${className}`}
    >
      {children}
    </td>
  );
}

// ── Status badges ─────────────────────────────────────────────────────────────

const statusVariants = {
  neutral:     "bg-secondary text-muted-foreground ring-1 ring-border",
  success:     "bg-success-bg text-success ring-1 ring-success/20",
  warning:     "bg-warning-bg text-warning ring-1 ring-warning/20",
  destructive: "bg-destructive-bg text-destructive ring-1 ring-destructive/20",
  info:        "bg-blue-50 text-primary ring-1 ring-primary/20",
} as const;

export function StatusBadge({ children, variant = "neutral" }: { children: ReactNode; variant?: keyof typeof statusVariants }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusVariants[variant]}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

export function TabBar({ tabs, active, onChange }: { tabs: readonly string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-5 overflow-x-auto">
      <div className="flex min-w-max gap-0.5 rounded-lg border border-border bg-secondary/50 p-1">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => onChange(t)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
              active === t
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Date filter row ───────────────────────────────────────────────────────────

export function DateRangeFilter({
  from,
  to,
  onFrom,
  onTo,
  actions,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <Field label="From">
        <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="w-40" />
      </Field>
      <Field label="To">
        <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="w-40" />
      </Field>
      {actions}
    </div>
  );
}

// ── Money formatter ───────────────────────────────────────────────────────────

export function money(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
