"use client";

import { useParams } from "next/navigation";
import { createContext, useContext } from "react";
import { Badge, PageTabs } from "@/components/studio";
import { useApi } from "@/lib/use-api";

export interface ManagedPage {
  id: string;
  handle: string;
  name: string;
  memberType: "TAILOR" | "COOPERATIVE" | "SELLER";
  status: string;
  verified: boolean;
  story: string;
  district: string;
  sector: string;
  whatsapp: string;
  instagram: string;
  theme: string;
  momoMerchant: string;
  allowanceOn: boolean;
  myAccess: "MANAGER" | "MEMBER";
  subscription: { planCode: string; monthlyCap: number; plan: { name: string; tryOnAllowance: number } } | null;
  roles: { id: string; role: string; userId: string; user: { phone: string; name: string | null } }[];
}

const Ctx = createContext<{ page: ManagedPage; reload: () => Promise<void> } | null>(null);
export const useManagedPage = () => useContext(Ctx)!;

export default function PageLayout({ children }: { children: React.ReactNode }) {
  const { pageId } = useParams<{ pageId: string }>();
  const { data: page, error, reload } = useApi<ManagedPage>(`/pages/${pageId}`);
  if (error) return <p className="text-red-700">{error}</p>;
  if (!page) return <p className="text-stone-500">Loading…</p>;
  return (
    <Ctx.Provider value={{ page, reload }}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{page.name}</h1>
          <a href={`/m/${page.handle}`} className="text-sm text-stone-500 underline">nyambika.rw/{page.handle}</a>
        </div>
        <Badge value={page.status} />
      </div>
      <PageTabs pageId={page.id} isCoop={page.memberType === "COOPERATIVE"} member={page.myAccess === "MEMBER"} />
      {children}
    </Ctx.Provider>
  );
}
