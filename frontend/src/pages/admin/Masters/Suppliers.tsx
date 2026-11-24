import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, PageHeader, Table, Td, Th, THead } from "@/components/ui";

type Supplier = { id: string; name: string; state: string; gstin: string | null };

export default function Suppliers() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", state: "", gstin: "" });
  const [rowError, setRowError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["suppliers", search],
    queryFn: () => api.get<{ items: Supplier[]; total: number }>(`/suppliers?search=${encodeURIComponent(search)}`),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post("/suppliers", { name: form.name, state: form.state, gstin: form.gstin || undefined }),
    onSuccess: () => {
      setForm({ name: "", state: "", gstin: "" });
      setRowError(null);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Failed to create supplier"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/suppliers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Failed to delete supplier"),
  });

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Vendors you buy raw material and packaging from."
        actions={
          <Input
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
        }
      />

      {canMutate && (
        <Card className="mb-4 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <Input placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="State" required value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            <Input
              placeholder="GSTIN (optional)"
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value })}
              className="w-44"
            />
            <Button type="submit" disabled={createMutation.isPending}>
              Add supplier
            </Button>
          </form>
        </Card>
      )}

      {rowError && <div className="mb-4"><ErrorText>{rowError}</ErrorText></div>}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <EmptyState>No suppliers yet.</EmptyState>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>State</Th>
              <Th>GSTIN</Th>
              {canMutate && <Th>Action</Th>}
            </tr>
          </THead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium text-foreground">{s.name}</Td>
                <Td>{s.state}</Td>
                <Td className="text-muted-foreground">{s.gstin ?? "—"}</Td>
                {canMutate && (
                  <Td>
                    <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(s.id)}>
                      Deactivate
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
