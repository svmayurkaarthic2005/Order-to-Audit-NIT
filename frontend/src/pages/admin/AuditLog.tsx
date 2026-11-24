import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState, PageHeader, Table, Td, Th, THead } from "@/components/ui";

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
    <div>
      <PageHeader title="Audit log" description="Who changed what, when — read-only, append-only." />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <EmptyState>No audit entries yet.</EmptyState>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>When</Th>
              <Th>User</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Detail</Th>
            </tr>
          </THead>
          <tbody>
            {data.map((e) => (
              <tr key={e.id}>
                <Td className="tabular whitespace-nowrap text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</Td>
                <Td className="font-medium text-foreground">{e.user?.name ?? "system"}</Td>
                <Td>{e.action}</Td>
                <Td className="font-mono text-xs text-muted-foreground">
                  {e.entityType} ({e.entityId.slice(0, 8)}…)
                </Td>
                <Td className="max-w-xs truncate text-muted-foreground">{e.afterJson ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
