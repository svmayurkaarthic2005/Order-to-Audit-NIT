import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Link } from "react-router-dom";

// Shared visual language for every screen: one button system, one input
// style, one table style, one status-badge system. Pages compose these
// instead of each inventing its own spacing and color.

export const inputClass =
  "h-9 rounded-md border border-input bg-white px-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`${inputClass} ${className}`} {...rest} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return <select className={`${inputClass} ${className}`} {...rest} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea className={`${inputClass} h-auto py-2 ${className}`} {...rest} />;
}

export function Label({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="mb-1 block text-xs font-medium text-muted-foreground">
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

const buttonVariants = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-input bg-white text-foreground hover:bg-secondary",
  ghost: "text-foreground hover:bg-secondary",
  danger: "border border-destructive/30 bg-white text-destructive hover:bg-destructive-bg",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
  link: "text-primary underline-offset-4 hover:underline",
} as const;

type ButtonVariant = keyof typeof buttonVariants;
type ButtonSize = "sm" | "md";

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = ""): string {
  const sizeClass = size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm";
  return `inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 ${sizeClass} ${buttonVariants[variant]} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

// A navigation link styled as a button — for "go to another page" actions
// (e.g. "+ New order"). Renders one <a>, never a <button> nested inside a
// <Link>, which is invalid HTML (nested interactive elements) and ambiguous
// for assistive tech about what the one click target actually is.
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

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-border bg-card shadow-sm ${className}`}>{children}</div>;
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
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold text-foreground">{children}</h2>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-white px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-destructive/20 bg-destructive-bg px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

// --- Table primitives: consistent header, numeric alignment, row rules ---

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-white shadow-sm">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-secondary/60">{children}</thead>;
}

export function Th({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground ${numeric ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, numeric, className = "" }: { children: ReactNode; numeric?: boolean; className?: string }) {
  return (
    <td className={`border-b border-border px-3 py-2 ${numeric ? "tabular text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}

// --- Status badges: color + label, never color alone ---

const statusVariants = {
  neutral: "bg-secondary text-muted-foreground",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  destructive: "bg-destructive-bg text-destructive",
  info: "bg-blue-50 text-primary",
} as const;

export function StatusBadge({ children, variant = "neutral" }: { children: ReactNode; variant?: keyof typeof statusVariants }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${statusVariants[variant]}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function money(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
