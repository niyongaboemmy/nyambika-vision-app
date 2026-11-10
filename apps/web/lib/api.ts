/** Browser API client. Same-origin `/api` (rewritten to the core API) with one silent refresh on 401. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

async function refresh() {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
    .then(async (r) => r.ok && (await r.json()).ok === true)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const opts: RequestInit = {
    credentials: "include",
    ...rest,
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  };
  let res = await fetch(`/api${path}`, opts);
  if (res.status === 401 && !path.startsWith("/auth/")) {
    if (await refresh()) res = await fetch(`/api${path}`, opts);
  }
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "message" in body && (body as { message: unknown }).message) || res.statusText;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join(", ") : String(msg), body);
  }
  return body as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export const rwf = (n: number) => `RWF ${n.toLocaleString("en-US")}`;
