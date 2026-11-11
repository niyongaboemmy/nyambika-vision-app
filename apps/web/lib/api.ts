import { describeError, errorText, rememberFriendly } from "./api-errors";

/**
 * Browser API client. Same-origin `/api` (rewritten to the core API) with one silent refresh on 401.
 * Failures throw ApiError whose `message` is already friendly and localised (lib/api-errors.ts);
 * the API's own words stay on `raw`, its machine `code` on `code`.
 */
export class ApiError extends Error {
  raw: string;
  code: string | null;
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    public retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.raw = message;
    this.code = body && typeof body === "object" && "code" in body ? String((body as { code: unknown }).code) : null;
    this.message = errorText(this);
    rememberFriendly(this.message, describeError(this));
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
  let res: Response;
  try {
    res = await fetch(`/api${path}`, opts);
    if (res.status === 401 && !path.startsWith("/auth/")) {
      if (await refresh()) res = await fetch(`/api${path}`, opts);
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e; // callers cancel on purpose
    throw new ApiError(0, (e as Error).message || "Network error", { code: "OFFLINE" });
  }
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "message" in body && (body as { message: unknown }).message) || res.statusText;
    const ra = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join(", ") : String(msg), body, Number.isFinite(ra) && ra > 0 ? ra : null);
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
