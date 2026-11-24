import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, PageHeader, Select, StatusBadge, Table, Td, Th, THead } from "@/components/ui";

type Item = {
  id: string;
  sku: string;
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD";
  baseUnit: "G" | "ML" | "PIECE";
};

const TYPES: Item["type"][] = ["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"];
const UNITS: Item["baseUnit"][] = ["G", "ML", "PIECE"];
const TYPE_VARIANT = { RAW_MATERIAL: "neutral", PACKAGING: "info", FINISHED_GOOD: "success" } as const;

export default function Items() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
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
    <div>
      <PageHeader
        title="Items"
        description="Raw materials, packaging and finished goods — the one catalog everything else references."
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
            <Input placeholder="SKU" required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="w-32" />
            <Input placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Item["type"] })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select value={form.baseUnit} onChange={(e) => setForm({ ...form, baseUnit: e.target.value as Item["baseUnit"] })}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={createMutation.isPending}>
              Add item
            </Button>
          </form>
        </Card>
      )}

      {rowError && <div className="mb-4"><ErrorText>{rowError}</ErrorText></div>}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <EmptyState>No items yet.</EmptyState>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>SKU</Th>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Unit</Th>
              {canMutate && <Th>Action</Th>}
            </tr>
          </THead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.id}>
                <Td className="font-mono text-xs text-foreground">{i.sku}</Td>
                <Td className="font-medium text-foreground">{i.name}</Td>
                <Td>
                  <StatusBadge variant={TYPE_VARIANT[i.type]}>{i.type.replace("_", " ")}</StatusBadge>
                </Td>
                <Td>{i.baseUnit}</Td>
                {canMutate && (
                  <Td>
                    <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(i.id)}>
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
