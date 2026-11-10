"use client";

import Link from "next/link";
import { Card, Note, SButton, Select } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useState } from "react";
import { useManagedPage } from "./layout";

interface Analytics {
  periodDays: number;
  looks: number;
  saves: number;
  orders: number;
  revenueRwf: number;
  conversion: number;
  followers: number;
  plan: { code: string; name: string; monthlyCap: number; allowanceUsed: number } | null;
  topProducts: { id: string; title: string; looks: number; orders: number }[];
}

interface Plan {
  code: string;
  name: string;
  priceRwf: number;
  maxProducts: number;
  tryOnAllowance: number;
}

export default function Overview() {
  const { page, reload } = useManagedPage();
  const manager = page.myAccess === "MANAGER";
  const { data: a, reload: reloadA } = useApi<Analytics>(manager ? `/pages/${page.id}/analytics` : null);
  const { data: plans } = useApi<Plan[]>(manager ? "/plans" : null);
  const [plan, setPlan] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);

  const used = a?.plan ? a.plan.allowanceUsed / Math.max(1, a.plan.monthlyCap) : 0;
  return (
    <div className="space-y-4">
      {page.status === "PENDING_VERIFICATION" && (
        <Card className="border-amber-300 bg-amber-50">
          <p className="font-semibold text-amber-900">Waiting for verification</p>
          <p className="text-sm text-amber-800">You can add products now. Your page goes live as soon as the Nyambika team verifies you.</p>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Link href={`/studio/${page.id}/products/new`}><Card className="h-full"><p className="text-2xl">➕</p><p className="mt-1 font-semibold">Add a product</p></Card></Link>
        <Link href={`/m/${page.handle}`}><Card className="h-full"><p className="text-2xl">🪡</p><p className="mt-1 font-semibold">View my Maker Space</p></Card></Link>
      </div>
      {a && (
        <>
          <h2 className="pt-2 font-bold">Last {a.periodDays} days</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Looks on shoppers" value={a.looks} />
            <Stat label="Saves" value={a.saves} />
            <Stat label="Paid orders" value={a.orders} />
            <Stat label="Revenue (to you)" value={rwf(a.revenueRwf)} />
            <Stat label="Look → order" value={`${(a.conversion * 100).toFixed(1)}%`} />
            <Stat label="Followers" value={a.followers} />
          </div>
          {a.topProducts.length > 0 && (
            <Card>
              <p className="mb-2 font-semibold">Most tried on</p>
              <ul className="space-y-1 text-sm">
                {a.topProducts.map((p) => <li key={p.id} className="flex justify-between"><span className="truncate">{p.title}</span><span className="text-stone-500">{p.looks} looks · {p.orders} orders</span></li>)}
              </ul>
            </Card>
          )}
          {a.plan && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{a.plan.name} plan</p>
                <p className="text-sm text-stone-500">try-on allowance {a.plan.allowanceUsed}/{a.plan.monthlyCap}</p>
              </div>
              <div className="h-2 rounded-full bg-stone-200"><div className={`h-2 rounded-full ${used >= 1 ? "bg-red-500" : used >= 0.8 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, used * 100)}%` }} /></div>
              {used >= 0.8 && <Note error={used >= 1 ? "Allowance used up: shoppers continue with their own free looks." : "You've used 80% of this month's allowance."} />}
              {plans && (
                <div className="flex gap-2">
                  <Select value={plan || a.plan.code} onChange={(e) => setPlan(e.target.value)}>
                    {plans.map((p) => <option key={p.code} value={p.code}>{p.name} · {p.priceRwf ? `${rwf(p.priceRwf)}/month` : "free"} · {p.tryOnAllowance} looks</option>)}
                  </Select>
                  <SButton
                    disabled={!plan || plan === a.plan.code}
                    onClick={async () => {
                      await api(`/pages/${page.id}/plan`, { method: "POST", json: { planCode: plan } });
                      setMsg("Plan updated.");
                      await Promise.all([reloadA(), reload()]);
                    }}
                  >
                    Change
                  </SButton>
                </div>
              )}
              <Note ok={msg} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </Card>
  );
}
