import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorText, Input, Loading, PageHeader, Table, TabBar, Td, Th, THead } from "@/components/ui";

type Party = { id: string; name: string; state: string; gstin: string | null; email?: string | null };

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
  const [form, setForm] = useState({ name: "", state: "", gstin: "", email: "" });
  const [rowError, setRowError] = useState<string | null>(null);

  function switchTab(t: string) {
    setSearchParams(t === "Suppliers" ? { type: "supplier" } : {});
    setSearch("");
    setForm({ name: "", state: "", gstin: "", email: "" });
    setRowError(null);
  }

  const { data, isLoading, error } = useQuery({
    queryKey: [config.queryKey, search],
    queryFn: () => api.get<{ items: Party[]; total: number }>(`${config.endpoint}?search=${encodeURIComponent(search)}`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(config.endpoint, {
        name: form.name,
        state: form.state,
        gstin: form.gstin || undefined,
        ...(tab === "Customers" ? { email: form.email || undefined } : {}),
      }),
    onSuccess: () => {
      setForm({ name: "", state: "", gstin: "", email: "" });
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
            className="p-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
              <div className="sm:col-span-2 lg:col-span-6">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Name <span className="text-destructive">*</span>
                </label>
                <Input
                  placeholder={config.namePlaceholder}
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full"
                />
              </div>
              <div className="sm:col-span-1 lg:col-span-3">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  State <span className="text-destructive">*</span>
                </label>
                <Input
                  placeholder="e.g. Tamil Nadu"
                  required
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="w-full"
                />
              </div>
              <div className="sm:col-span-1 lg:col-span-3">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  GSTIN
                </label>
                <Input
                  placeholder="Optional 15-digit GSTIN"
                  value={form.gstin}
                  onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                  className="w-full font-mono text-xs uppercase"
                />
              </div>
              {tab === "Customers" && (
                <div className="sm:col-span-2 lg:col-span-6">
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Email
                  </label>
                  <Input
                    type="email"
                    placeholder="Optional — needed to email invoices"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full"
                  />
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border/50 pt-3.5">
              <p className="text-xs text-muted-foreground">
                State is used for SGST/CGST vs IGST tax split calculation.
              </p>
              <Button type="submit" disabled={createMutation.isPending} className="self-end sm:self-auto px-6">
                {createMutation.isPending ? "Adding…" : config.addLabel}
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
        <EmptyState>{search ? `No ${config.emptyNoun} matching "${search}".` : `No ${config.emptyNoun} yet.`}</EmptyState>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>State</Th>
              <Th>GSTIN</Th>
              {tab === "Customers" && <Th>Email</Th>}
              {canMutate && <Th>Action</Th>}
            </tr>
          </THead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id} className="transition-colors hover:bg-secondary/30">
                <Td className="font-semibold text-foreground">{p.name}</Td>
                <Td className="text-muted-foreground">{p.state}</Td>
                <Td className="font-mono text-xs text-muted-foreground">{p.gstin ?? "—"}</Td>
                {tab === "Customers" && <Td className="text-muted-foreground">{p.email ?? "—"}</Td>}
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
