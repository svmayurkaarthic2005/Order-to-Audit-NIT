import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";

type Customer = { id: string; name: string; state: string; gstin: string | null };

export default function Customers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", state: "", gstin: "" });
  const [rowError, setRowError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["customers", search],
    queryFn: () => api.get<{ items: Customer[]; total: number }>(`/customers?search=${encodeURIComponent(search)}`),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post("/customers", { name: form.name, state: form.state, gstin: form.gstin || undefined }),
    onSuccess: () => {
      setForm({ name: "", state: "", gstin: "" });
      setRowError(null);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Failed to create customer"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Failed to delete customer"),
  });

  return (
    <main className="mx-auto max-w-2xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">Customers</h1>

      <input
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full rounded border border-input bg-transparent px-3 py-2"
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="mb-6 flex flex-wrap gap-2"
      >
        <input
          placeholder="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded border border-input bg-transparent px-2 py-1"
        />
        <input
          placeholder="State"
          required
          value={form.state}
          onChange={(e) => setForm({ ...form, state: e.target.value })}
          className="rounded border border-input bg-transparent px-2 py-1"
        />
        <input
          placeholder="GSTIN (optional)"
          value={form.gstin}
          onChange={(e) => setForm({ ...form, gstin: e.target.value })}
          className="rounded border border-input bg-transparent px-2 py-1"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {rowError && <p className="mb-4 text-sm text-destructive">{rowError}</p>}

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-muted-foreground">No customers yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {data.items.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-3 py-2">
              <span>
                {c.name} — {c.state} {c.gstin && <span className="text-muted-foreground">({c.gstin})</span>}
              </span>
              <button
                onClick={() => deleteMutation.mutate(c.id)}
                className="text-sm text-destructive hover:underline"
              >
                Deactivate
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
