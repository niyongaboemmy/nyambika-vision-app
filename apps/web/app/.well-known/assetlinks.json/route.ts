import { androidFingerprints, assetLinks } from "@/lib/app-links";

export const dynamic = "force-dynamic";

/** Android App Links verification (+ shared sign-in credentials). */
export function GET() {
  const fps = androidFingerprints();
  if (!fps.length) return new Response("Not configured", { status: 404 });
  return Response.json(assetLinks(fps), { headers: { "cache-control": "public, max-age=3600" } });
}
