import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, Loading, PageHeader, Select, StatusBadge, Table, Td, Th, THead, qty } from "@/components/ui";

type Item = {
  id: string;
  sku: string;
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD";
  baseUnit: "G" | "ML" | "PIECE";
};

const TYPES: Item["type"][] = ["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"];
const UNITS: Item["baseUnit"][] = ["G", "ML", "PIECE"];
const TYPE_LABEL: Record<Item["type"], string> = {
  RAW_MATERIAL: "Raw material",
  PACKAGING: "Packaging",
  FINISHED_GOOD: "Product we sell",
};
const UNIT_LABEL: Record<Item["baseUnit"], string> = {
  G: "Weight (kg)",
  ML: "Volume (litres)",
  PIECE: "Count (pieces)",
};
// Common GST slabs for packaged food; 5% covers namkeen/murukku.
const GST_RATES = [0, 5, 12, 18, 28];
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
  const emptyForm = { sku: "", name: "", type: TYPES[0], baseUnit: UNITS[0], hsnCode: "", taxRatePct: "5" };
  const [form, setForm] = useState(emptyForm);
  const [skuEditedManually, setSkuEditedManually] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["items", search],
    queryFn: () => api.get<{ items: Item[]; total: number }>(`/items?search=${encodeURIComponent(search)}`),
  });
  // On hand comes from the stock ledger (the same figure as Stock and Reports).
  const { data: stock } = useQuery({
    queryKey: ["reports", "stock-summary"],
    queryFn: () => api.get<{ itemId: string; qtyBase: number }[]>("/reports/stock-summary"),
  });
  const onHand = (itemId: string) => stock?.find((s) => s.itemId === itemId)?.qtyBase ?? 0;

  const createMutation = useMutation({
    // HSN and GST only mean something on a product you invoice; without them
    // the invoice would go out with no HSN and 0% tax.
    mutationFn: () =>
      api.post("/items", {
        sku: form.sku,
        name: form.name,
        type: form.type,
        baseUnit: form.baseUnit,
        ...(form.type === "FINISHED_GOOD" ? { hsnCode: form.hsnCode.trim(), taxRatePct: Number(form.taxRatePct) } : {}),
      }),
    onSuccess: () => {
      setForm(emptyForm);
      setSkuEditedManually(false);
      setRowError(null);
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Couldn't add it. That code may already be in use."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/items/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Couldn't remove it."),
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
              placeholder="Search by name or code"
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
            <h2 className="text-sm font-semibold text-foreground">Add a product or material</h2>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }}
            className="p-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
              {/* Item Name */}
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                  Name <span className="text-destructive">*</span>
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
              <div className="sm:col-span-1 lg:col-span-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    className="block text-sm font-medium text-muted-foreground"
                    title="A short code other pages and reports use. Filled in from the name; change it if you have your own codes."
                  >
                    Code <span className="text-destructive">*</span>
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    {skuEditedManually ? "Your own" : "Filled in for you"}
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
              <div className="sm:col-span-1 lg:col-span-3">
                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                  Type <span className="text-destructive">*</span>
                </label>
                <Select
                  value={form.type}
                  onChange={(e) => {
                    const type = e.target.value as Item["type"];
                    // A product we sell is counted in packets, never by weight.
                    setForm({ ...form, type, baseUnit: type === "FINISHED_GOOD" ? "PIECE" : form.baseUnit });
                  }}
                  className="w-full"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Base Unit */}
              <div className="sm:col-span-1 lg:col-span-3">
                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                  Measured by <span className="text-destructive">*</span>
                </label>
                <Select
                  value={form.baseUnit}
                  onChange={(e) => setForm({ ...form, baseUnit: e.target.value as Item["baseUnit"] })}
                  disabled={form.type === "FINISHED_GOOD"}
                  className="w-full"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABEL[u]}
                    </option>
                  ))}
                </Select>
              </div>

              {form.type === "FINISHED_GOOD" && (
                <>
                  <div className="sm:col-span-1 lg:col-span-3">
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                      HSN code <span className="text-destructive">*</span>
                    </label>
                    <Input
                      required
                      inputMode="numeric"
                      pattern="[0-9]{4,8}"
                      title="4 to 8 digits, printed on the GST invoice"
                      placeholder="e.g. 19059090"
                      value={form.hsnCode}
                      onChange={(e) => setForm({ ...form, hsnCode: e.target.value })}
                      className="w-full"
                    />
                  </div>
                  <div className="sm:col-span-1 lg:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                      GST rate <span className="text-destructive">*</span>
                    </label>
                    <Select value={form.taxRatePct} onChange={(e) => setForm({ ...form, taxRatePct: e.target.value })} className="w-full">
                      {GST_RATES.map((r) => (
                        <option key={r} value={r}>{r}%</option>
                      ))}
                    </Select>
                  </div>
                </>
              )}
            </div>

            {/* Form actions row */}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border/50 pt-3.5">
              <p className="text-xs text-muted-foreground">
                Products you sell need an HSN code and GST rate; they're printed on every invoice.
              </p>
              <Button type="submit" disabled={createMutation.isPending} className="self-end sm:self-auto px-6">
                {createMutation.isPending ? "Adding…" : "Add"}
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
        <EmptyState>Nothing here yet. Add your raw materials, packaging and products above.</EmptyState>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Measured by</Th>
              <Th numeric>On hand</Th>
              {canMutate && <Th className="text-right"><span className="sr-only">Actions</span></Th>}
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
                  <StatusBadge variant={TYPE_VARIANT[i.type]}>{TYPE_LABEL[i.type]}</StatusBadge>
                </Td>
                <Td className="text-muted-foreground">{UNIT_LABEL[i.baseUnit]}</Td>
                <Td numeric className={`font-semibold ${stock && onHand(i.id) <= 0 ? "text-destructive" : "text-foreground"}`}>
                  {stock ? qty(onHand(i.id), i.baseUnit) : "…"}
                </Td>
                {canMutate && (
                  <Td className="text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (window.confirm(`Remove "${i.name}"? It won't appear in orders, purchases or recipes any more. Past records keep it.`)) {
                          deleteMutation.mutate(i.id);
                        }
                      }}
                    >
                      Remove
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
