import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";

type Item = {
  id: string;
  sku: string;
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD";
  baseUnit: "G" | "ML" | "PIECE";
};

const TYPES: Item["type"][] = ["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"];
const UNITS: Item["baseUnit"][] = ["G", "ML", "PIECE"];

export default function Items() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ sku: "", name: "", type: TYPES[0], baseUnit: UNITS[0] });
  const [rowError, setRowError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["items", search],
    queryFn: () => api.get<{ items: Item[]; total: number }>(`/items?search=${encodeURIComponent(search)}`),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post("/items", form),
    onSuccess: () => {
      setForm({ sku: "", name: "", type: TYPES[0], baseUnit: UNITS[0] });
      setRowError(null);
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Failed to create item"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/items/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Failed to delete item"),
  });

  return (
    <main className="mx-auto max-w-2xl p-6 text-foreground">
      <h1 className="mb-4 text-2xl font-semibold">Items</h1>

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
          placeholder="SKU"
          required
          value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
          className="rounded border border-input bg-transparent px-2 py-1"
        />
        <input
          placeholder="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded border border-input bg-transparent px-2 py-1"
        />
        <select
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value as Item["type"] })}
          className="rounded border border-input bg-transparent px-2 py-1"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={form.baseUnit}
          onChange={(e) => setForm({ ...form, baseUnit: e.target.value as Item["baseUnit"] })}
          className="rounded border border-input bg-transparent px-2 py-1"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
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
        <p className="text-muted-foreground">No items yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {data.items.map((i) => (
            <li key={i.id} className="flex items-center justify-between px-3 py-2">
              <span>
                <span className="font-mono text-sm">{i.sku}</span> — {i.name}{" "}
                <span className="text-muted-foreground">
                  ({i.type}, {i.baseUnit})
                </span>
              </span>
              <button
                onClick={() => deleteMutation.mutate(i.id)}
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
