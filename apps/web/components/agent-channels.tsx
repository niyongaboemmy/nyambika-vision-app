"use client";

import { useState } from "react";
import { Card, Note, Switch } from "@/components/studio";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface Channels {
  agentsEnabled: boolean;
  marketplacesEnabled: boolean;
  last30d: { agentCheckouts: number; confirmed: number };
}

/** FR-AGT-05: the member decides whether AI shopping assistants and external marketplaces can list their page. */
export function AgentChannels({ pageId }: { pageId: string }) {
  const { data, setData } = useApi<Channels>(`/pages/${pageId}/agent-channels`);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function save(next: Pick<Channels, "agentsEnabled" | "marketplacesEnabled">) {
    setErr(null);
    try {
      setData(await api<Channels>(`/pages/${pageId}/agent-channels`, { method: "PUT", json: next }));
      setMsg("Saved.");
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <Card className="space-y-3">
      <h2 id="agents" className="scroll-mt-28 font-display text-lg font-black tracking-tight text-cocoa">AI assistants & marketplaces</h2>
      <p className="text-sm text-cocoa-2">Let AI shopping assistants find your products and send shoppers to you. Every order is still confirmed by the shopper in Nyambika and paid straight to you.</p>
      {data ? (
        <>
          <Switch checked={data.agentsEnabled} onChange={(v) => save({ agentsEnabled: v, marketplacesEnabled: data.marketplacesEnabled })} label="Show my page to AI assistants" description="Public catalogue API, MCP and agent checkout." />
          <Switch checked={data.marketplacesEnabled} onChange={(v) => save({ agentsEnabled: data.agentsEnabled, marketplacesEnabled: v })} label="List me on external marketplaces" description="Product feeds for partner catalogues." />
          <p className="text-xs font-semibold text-cocoa-2">Last 30 days: {data.last30d.agentCheckouts} assistant checkouts · {data.last30d.confirmed} confirmed by shoppers</p>
        </>
      ) : (
        <div data-skeleton className="st-skel h-20 rounded-2xl" />
      )}
      <Note ok={msg} error={err} />
    </Card>
  );
}
