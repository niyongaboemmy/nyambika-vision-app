/**
 * E36/E37 demo: one AI shopping agent with a live key, and one sandbox partner with a try-on contract.
 * Keys are generated fresh on every run (only hashes are stored) and printed ONLY outside production.
 *
 * Run: `pnpm db:seed:agents`
 */
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { DEFAULT_SCOPES } from "@nyambika/contracts";
import { generateKey, hashKey } from "../src/modules/agents/keys";
import { encryptField } from "../src/modules/tailor/crypto";
import { randomBytes } from "node:crypto";

const PEPPER = process.env.JWT_SECRET ?? "dev-only-change-me";

export async function seedAgents(prisma: PrismaClient) {
  const dev = process.env.NODE_ENV !== "production";
  const out: string[] = [];

  const agent =
    (await prisma.apiClient.findFirst({ where: { name: "Demo Shopping Assistant", kind: "AGENT" } })) ??
    (await prisma.apiClient.create({ data: { name: "Demo Shopping Assistant", kind: "AGENT", contactEmail: "agent-demo@example.com" } }));
  const ak = generateKey("LIVE");
  await prisma.apiKey.create({ data: { clientId: agent.id, name: "seed", prefix: ak.prefix, hash: hashKey(ak.secret, PEPPER), env: "LIVE", scopes: DEFAULT_SCOPES.AGENT, rateLimitPerMin: 120, monthlyQuota: 50_000 } });
  out.push(`agent   ${agent.name}: ${ak.secret}`);

  const partner =
    (await prisma.apiClient.findFirst({ where: { name: "Sandbox Partner · Demo Boutique", kind: "PARTNER" } })) ??
    (await prisma.apiClient.create({ data: { name: "Sandbox Partner · Demo Boutique", kind: "PARTNER", contactEmail: "partner-demo@example.com" } }));
  await prisma.partnerContract.upsert({
    where: { clientId: partner.id },
    create: { clientId: partner.id, status: "ACTIVE", monthlyQuota: 500, monthlyFeeRwf: 60_000, overagePriceRwf: 150, hardCap: false, sandboxDailyCap: 50, notes: "Demo contract (synthetic)" },
    update: {},
  });
  const pk = generateKey("SANDBOX");
  await prisma.apiKey.create({ data: { clientId: partner.id, name: "seed sandbox", prefix: pk.prefix, hash: hashKey(pk.secret, PEPPER), env: "SANDBOX", scopes: DEFAULT_SCOPES.PARTNER, rateLimitPerMin: 60 } });
  const whsec = `whsec_${randomBytes(24).toString("base64url")}`;
  await prisma.apiClient.update({ where: { id: partner.id }, data: { webhookSecretSealed: encryptField(whsec) } });
  out.push(`partner ${partner.name} (sandbox): ${pk.secret}`, `partner webhook secret: ${whsec}`);

  if (dev) console.log(`\n🔑 Demo API keys (dev only, shown once):\n  ${out.join("\n  ")}\n`);
  else console.log("Agent/partner demo clients seeded (keys not printed in production).");
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedAgents(prisma)
    .finally(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
