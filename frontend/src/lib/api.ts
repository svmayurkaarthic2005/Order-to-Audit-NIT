const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  code: string;
  details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error?.message ?? "Request failed", body?.error?.code ?? "unknown", body?.error?.details);
  }
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown, headers?: HeadersInit) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body), headers }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  submitOrder,
};

// ── Offline order queue ──────────────────────────────────────────────────
// A salesman on the floor may lose connectivity mid-submission. Instead of
// losing the order, we persist it locally and replay it the moment the
// browser comes back online — carrying the same idempotencyKey every time,
// so an impatient manual retry (or a flaky connection retrying the "online"
// event itself) can never post the same order twice.

const OFFLINE_QUEUE_KEY = "offline-order-queue";

// Set by AuthProvider whenever the logged-in user changes, so a queued
// order is replayed only for the salesman who created it — never under a
// different salesman who happens to log in on the same device before the
// original one reconnects.
let currentUserId: string | null = null;
export function setOfflineQueueUser(userId: string | null) {
  currentUserId = userId;
}

type QueuedOrder = { idempotencyKey: string; body: unknown; userId: string | null };

function readQueue(): QueuedOrder[] {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedOrder[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

function postOrder(body: unknown, idempotencyKey: string) {
  return request<unknown>("/orders", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

// A failed fetch() — offline, DNS down, connection refused — throws a
// TypeError before any response exists. A real HTTP error response
// (400/404/...) means the server was reached and rejected the request on
// its merits, so it's never queued, only a genuine network failure is.
function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError;
}

export async function replayOfflineOrders() {
  const replayingFor = currentUserId;
  for (const entry of readQueue().filter((q) => q.userId === replayingFor)) {
    // Re-check on every iteration, not just at the start: a login/logout
    // during this async loop must stop it from posting under the new user.
    if (currentUserId !== replayingFor) return;
    try {
      await postOrder(entry.body, entry.idempotencyKey);
    } catch (err) {
      if (isNetworkFailure(err)) return; // still offline — stop, keep the rest queued for next time
      // A real server rejection for a queued order: nothing more we can do
      // automatically, so drop it rather than retry it forever.
    }
    writeQueue(readQueue().filter((q) => q.idempotencyKey !== entry.idempotencyKey));
  }
}

export function queuedOrderCount(): number {
  return readQueue().filter((q) => q.userId === currentUserId).length;
}

async function submitOrder(
  body: unknown,
  idempotencyKey: string,
): Promise<{ status: "created"; order: unknown } | { status: "queued" }> {
  try {
    const order = await postOrder(body, idempotencyKey);
    return { status: "created", order };
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    const queue = readQueue();
    if (!queue.some((q) => q.idempotencyKey === idempotencyKey)) {
      queue.push({ idempotencyKey, body, userId: currentUserId });
      writeQueue(queue);
    }
    return { status: "queued" };
  }
}

// The initial replay on load (for a user already logged in via cookie) is
// triggered by AuthProvider once it knows who that user is, not here.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void replayOfflineOrders());
}
