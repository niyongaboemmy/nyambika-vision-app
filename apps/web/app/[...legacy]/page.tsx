import { notFound, permanentRedirect } from "next/navigation";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** Legacy member-page URLs → new Maker Spaces (migration runbook §16.3 step 5); misses are logged for 404 monitoring. */
export default async function Legacy({ params }: { params: Promise<{ legacy: string[] }> }) {
  const { legacy } = await params;
  const path = "/" + legacy.map(encodeURIComponent).join("/");
  const r = await fetch(`${API}/redirects/resolve?path=${encodeURIComponent(path)}`, { cache: "no-store" })
    .then((x) => x.json() as Promise<{ to: string | null }>)
    .catch(() => ({ to: null }));
  if (r.to) permanentRedirect(r.to);
  notFound();
}
