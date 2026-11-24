import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";

type Order = {
  id: string;
  status: string;
  createdAt: string;
  customer: { name: string };
  items: { qtyBase: number; ratePaise: number; item: { sku: string; name: string } }[];
};

export default function OrderHistory() {
  const { data, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.get<{ items: Order[] }>("/orders"),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-4 text-foreground">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My Orders</h1>
        <Link to="/salesman/orders/new" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">
          + New order
        </Link>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-muted-foreground">No orders yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((o) => {
            const total = o.items.reduce((sum, l) => sum + l.qtyBase * l.ratePaise, 0);
            return (
              <li key={o.id} className="rounded border border-border p-3">
                <p className="font-medium">{o.customer.name}</p>
                <p className="text-sm text-muted-foreground">
                  {o.items.length} item(s) · ₹{(total / 100).toFixed(2)}
                </p>
                <p className="mt-1 text-sm">{o.status}</p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
