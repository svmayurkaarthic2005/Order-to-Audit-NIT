import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, Loading, PageHeader, Table, TabBar, Td, Th, THead } from "@/components/ui";

type Party = { id: string; name: string; state: string; gstin: string | null };

const TABS = ["Customers", "Suppliers"] as const;
type Tab = (typeof TABS)[number];

const CONFIG: Record<
  Tab,
  { endpoint: string; queryKey: string; description: string; formTitle: string; addLabel: string; namePlaceholder: string; emptyNoun: string; noun: string }
> = {
  Customers: {
    endpoint: "/customers",
    queryKey: "customers",
    description: "Buyers you sell to, used when raising orders and invoices.",
    formTitle: "Add Customer",
    addLabel: "Add customer",
    namePlaceholder: "Customer name",
    emptyNoun: "customers",
    noun: "customer",
  },
  Suppliers: {
    endpoint: "/suppliers",
    queryKey: "suppliers",
    description: "Vendors you buy raw material and packaging from.",
    formTitle: "Add Supplier",
    addLabel: "Add supplier",
    namePlaceholder: "Supplier name",
    emptyNoun: "suppliers",
    noun: "supplier",
  },
};

export default function Parties() {
  const { user } = useAuth();
  const canMutate = user?.role !== "ACCOUNTANT";
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get("type") === "supplier" ? "Suppliers" : "Customers";
  const config = CONFIG[tab];

  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", state: "", gstin: "" });
  const [rowError, setRowError] = useState<string | null>(null);

  function switchTab(t: string) {
    setSearchParams(t === "Suppliers" ? { type: "supplier" } : {});
    setSearch("");
    setForm({ name: "", state: "", gstin: "" });
    setRowError(null);
  }

  const { data, isLoading } = useQuery({
    queryKey: [config.queryKey, search],
    queryFn: () => api.get<{ items: Party[]; total: number }>(`${config.endpoint}?search=${encodeURIComponent(search)}`),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post(config.endpoint, { name: form.name, state: form.state, gstin: form.gstin || undefined }),
    onSuccess: () => {
      setForm({ name: "", state: "", gstin: "" });
      setRowError(null);
      queryClient.invalidateQueries({ queryKey: [config.queryKey] });
    },
    onError: (err) => setRowError(err instanceof ApiError ? err.message : `Failed to create ${config.noun}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`${config.endpoint}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [config.queryKey] }),
    onError: (err) => setRowError(err instanceof ApiError ? err.message : `Failed to delete ${config.noun}`),
  });

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title={tab}
        description={config.description}
        actions={
          <div className="relative">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <Input
              placeholder={`Search ${config.emptyNoun}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 pl-9"
            />
          </div>
        }
      />

      <TabBar tabs={TABS} active={tab} onChange={switchTab} />

      {canMutate && (
        <Card className="mb-5 overflow-hidden">
          <div className="border-b border-border/60 bg-secondary/30 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-foreground">{config.formTitle}</h2>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }}
            className="flex flex-wrap items-end gap-3 p-5"
          >
            <div className="flex-1 min-w-[180px]">
              <label className="mb-1.5 block text-sm font-medium text-foreground">Name *</label>
              <Input placeholder={config.namePlaceholder} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="w-32">
              <label className="mb-1.5 block text-sm font-medium text-foreground">State *</label>
              <Input placeholder="State" required value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            </div>
            <div className="w-44">
              <label className="mb-1.5 block text-sm font-medium text-foreground">GSTIN</label>
              <Input placeholder="Optional" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} className="font-mono text-xs" />
            </div>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Adding…" : config.addLabel}
            </Button>
          </form>
        </Card>
      )}

      {rowError && <div className="mb-4"><ErrorText>{rowError}</ErrorText></div>}

      {isLoading ? (
        <Loading />
      ) : !data || data.items.length === 0 ? (
        <EmptyState>{search ? `No ${config.emptyNoun} matching "${search}".` : `No ${config.emptyNoun} yet.`}</EmptyState>
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
            {data.items.map((p) => (
              <tr key={p.id} className="transition-colors hover:bg-secondary/30">
                <Td className="font-semibold text-foreground">{p.name}</Td>
                <Td className="text-muted-foreground">{p.state}</Td>
                <Td className="font-mono text-xs text-muted-foreground">{p.gstin ?? "—"}</Td>
                {canMutate && (
                  <Td>
                    <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(p.id)}>
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
