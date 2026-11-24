import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
};

export default function AuditLog() {
  const { data, isLoading } = useQuery({
    queryKey: ["audit-log"],
    queryFn: () => api.get<AuditEntry[]>("/audit-log"),
  });

  return (
    <main className="mx-auto max-w-3xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">Audit Log</h1>
      <p className="mb-4 text-sm text-muted-foreground">Who changed what, when — read-only, append-only.</p>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <p className="text-muted-foreground">No audit entries yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {data.map((e) => (
            <li key={e.id} className="rounded border border-border p-2">
              <p>
                <strong>{e.user?.name ?? "system"}</strong> {e.action} {e.entityType} ({e.entityId.slice(0, 8)}…) ·{" "}
                {new Date(e.createdAt).toLocaleString()}
              </p>
              {e.afterJson && <p className="text-muted-foreground">{e.afterJson}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
