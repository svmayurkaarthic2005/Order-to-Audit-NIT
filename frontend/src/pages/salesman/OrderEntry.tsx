import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorText, Field, Input, PageHeader, Select } from "@/components/ui";

type Customer = { id: string; name: string };
type Item = { id: string; sku: string; name: string; type: string };
type Line = { itemId: string; qtyBase: string; ratePaise: string };

const emptyLine: Line = { itemId: "", qtyBase: "", ratePaise: "" };

export default function OrderEntry() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: customers } = useQuery({
    queryKey: ["customers", "order-picker"],
    queryFn: () => api.get<{ items: Customer[] }>("/customers"),
  });
  const { data: items } = useQuery({
    queryKey: ["items", "order-picker"],
    queryFn: () => api.get<{ items: Item[] }>("/items"),
  });

  const finishedGoods = items?.items.filter((i) => i.type === "FINISHED_GOOD") ?? [];

  const total = lines.reduce((sum, l) => sum + (Number(l.qtyBase) || 0) * (Number(l.ratePaise) || 0), 0);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/orders", {
        customerId,
        items: lines
          .filter((l) => l.itemId)
          .map((l) => ({ itemId: l.itemId, qtyBase: Number(l.qtyBase), ratePaise: Number(l.ratePaise) })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      navigate("/salesman/orders");
    },
    onError: (err) => setSubmitError(err instanceof ApiError ? err.message : "Failed to submit order"),
  });

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const validLines = lines.filter((l) => l.itemId);
    if (validLines.length === 0) {
      setValidationError("Add at least one product.");
      return;
    }
    if (validLines.some((l) => !(Number(l.qtyBase) > 0))) {
      setValidationError("Every line needs a quantity greater than zero.");
      return;
    }
    setValidationError(null);
    createMutation.mutate();
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="New order" description="Select the customer, then add products." />

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field label="Customer" required>
          <Select value={customerId} required onChange={(e) => setCustomerId(e.target.value)} className="h-12 w-full text-base">
            <option value="">Select customer…</option>
            {customers?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex flex-col gap-3">
          {lines.map((line, i) => (
            <Card key={i} className="flex flex-col gap-2 p-3">
              <Select
                value={line.itemId}
                onChange={(e) => updateLine(i, { itemId: e.target.value })}
                className="h-12 w-full text-base"
              >
                <option value="">Product…</option>
                {finishedGoods.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.sku} — {it.name}
                  </option>
                ))}
              </Select>
              <div className="flex gap-2">
                <Input
                  placeholder="Qty"
                  type="number"
                  inputMode="numeric"
                  value={line.qtyBase}
                  onChange={(e) => updateLine(i, { qtyBase: e.target.value })}
                  className="h-12 w-1/2 text-base"
                />
                <Input
                  placeholder="Rate (paise/unit)"
                  type="number"
                  inputMode="numeric"
                  value={line.ratePaise}
                  onChange={(e) => updateLine(i, { ratePaise: e.target.value })}
                  className="h-12 w-1/2 text-base"
                />
              </div>
              {lines.length > 1 && (
                <Button type="button" variant="danger" size="sm" onClick={() => removeLine(i)} className="self-start">
                  Remove
                </Button>
              )}
            </Card>
          ))}
        </div>

        <Button
          type="button"
          variant="secondary"
          onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
          className="h-11 w-full border-dashed"
        >
          + Add product
        </Button>

        <p className="text-base font-medium tabular text-foreground">Total: ₹{(total / 100).toFixed(2)}</p>

        {validationError && <ErrorText>{validationError}</ErrorText>}
        {submitError && <ErrorText>{submitError}</ErrorText>}

        <Button type="submit" disabled={createMutation.isPending} className="h-12 w-full text-base">
          {createMutation.isPending ? "Submitting…" : "Submit order"}
        </Button>
      </form>
    </div>
  );
}
