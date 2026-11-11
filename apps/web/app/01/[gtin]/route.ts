import { NextResponse } from "next/server";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** GS1 Digital Link resolver (FR-DPP-02): `/01/<GTIN>` → the product passport. */
export async function GET(req: Request, { params }: { params: Promise<{ gtin: string }> }) {
  const { gtin } = await params;
  if (!/^\d{8,14}$/.test(gtin)) return new NextResponse("Not a GTIN", { status: 404 });
  const res = await fetch(`${API}/passports/by-gtin/${gtin}`, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return new NextResponse("No passport for this GTIN", { status: 404 });
  const { productId } = (await res.json()) as { productId: string };
  return NextResponse.redirect(new URL(`/p/${productId}`, req.url), 307);
}
