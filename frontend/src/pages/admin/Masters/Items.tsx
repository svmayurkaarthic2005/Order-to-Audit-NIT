import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, Loading, PageHeader, Select, StatusBadge, Table, Td, Th, THead } from "@/components/ui";

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

// A short, unique code the rest of the app refers to this item by (reports,
// dropdowns, dispatch). Auto-suggested from the name so filling it in isn't
// its own chore — still editable, since a real factory may have its own
// SKU convention to match.
function suggestSku(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function Items() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ sku: "", name: "", type: TYPES[0], baseUnit: UNITS[0] });
  const [skuEditedManually, setSkuEditedManually] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["items", search],
    queryFn: () => api.get<{ items: Item[]; total: number }>(`/items?search=${encodeURIComponent(search)}`),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post("/items", form),
    onSuccess: () => {
      setForm({ sku: "", name: "", type: TYPES[0], baseUnit: UNITS[0] });
      setSkuEditedManually(false);
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
    <div className="w-full min-w-0">
      <PageHeader
        title="Products & materials"
        description="Everything you buy, use or sell. Other pages pick from this list."
        actions={
          <div className="relative">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <Input
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 pl-9"
            />
          </div>
        }
      />

      {canMutate && (
        <Card className="mb-5 overflow-hidden">
          <div className="border-b border-border/60 bg-secondary/30 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-foreground">Add Item</h2>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }}
            className="p-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
              {/* Item Name */}
              <div className="sm:col-span-2 lg:col-span-5">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Item Name <span className="text-destructive">*</span>
                </label>
                <Input
                  placeholder="e.g. Murukku 200 g, Groundnut Oil"
                  required
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((prev) => ({ ...prev, name, sku: skuEditedManually ? prev.sku : suggestSku(name) }));
                  }}
                  className="w-full"
                />
              </div>

              {/* SKU */}
              <div className="sm:col-span-1 lg:col-span-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    title="Unique SKU code. Auto-suggested from the item name, or enter your custom code."
                  >
                    SKU Code <span className="text-destructive">*</span>
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    {skuEditedManually ? "Custom" : "Auto-generated"}
                  </span>
                </div>
                <Input
                  placeholder="AUTO-FROM-NAME"
                  required
                  value={form.sku}
                  onChange={(e) => {
                    setSkuEditedManually(true);
                    setForm({ ...form, sku: e.target.value.toUpperCase() });
                  }}
                  className="w-full font-mono uppercase tracking-wide"
                />
              </div>

              {/* Type */}
              <div className="sm:col-span-1 lg:col-span-2">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Type <span className="text-destructive">*</span>
                </label>
                <Select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as Item["type"] })}
                  className="w-full"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Base Unit */}
              <div className="sm:col-span-1 lg:col-span-2">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Unit <span className="text-destructive">*</span>
                </label>
                <Select
                  value={form.baseUnit}
                  onChange={(e) => setForm({ ...form, baseUnit: e.target.value as Item["baseUnit"] })}
                  className="w-full"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Form actions row */}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border/50 pt-3.5">
              <p className="text-xs text-muted-foreground">
                SKU is auto-suggested from the name. All inventory transactions track by base unit.
              </p>
              <Button type="submit" disabled={createMutation.isPending} className="self-end sm:self-auto px-6">
                {createMutation.isPending ? "Adding…" : "Add Item"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {rowError && <div className="mb-4"><ErrorText>{rowError}</ErrorText></div>}

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorText>{(error as Error).message}</ErrorText>
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
              {canMutate && <Th className="text-right">Action</Th>}
            </tr>
          </THead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.id} className="transition-colors hover:bg-secondary/30">
                <Td className="whitespace-nowrap">
                  <span className="font-mono text-xs font-semibold text-foreground bg-secondary/80 px-2 py-0.5 rounded border border-border/60">
                    {i.sku}
                  </span>
                </Td>
                <Td className="font-semibold text-foreground">{i.name}</Td>
                <Td>
                  <StatusBadge variant={TYPE_VARIANT[i.type]}>{i.type.replace(/_/g, " ")}</StatusBadge>
                </Td>
                <Td className="text-muted-foreground font-medium">{i.baseUnit}</Td>
                {canMutate && (
                  <Td className="text-right whitespace-nowrap">
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
