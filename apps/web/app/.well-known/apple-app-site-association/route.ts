import { appleAppSiteAssociation, appleTeamId } from "@/lib/app-links";

export const dynamic = "force-dynamic";

/** iOS universal links + passkey webcredentials. Served as JSON without an extension, no redirects. */
export function GET() {
  const team = appleTeamId();
  if (!team) return new Response("Not configured", { status: 404 });
  return new Response(JSON.stringify(appleAppSiteAssociation(team)), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });
}
