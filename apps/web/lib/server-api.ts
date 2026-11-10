import "server-only";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** Server-side fetch for SSR pages (public data only: Maker Spaces, directory). */
export async function serverApi<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
