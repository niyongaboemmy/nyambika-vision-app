"use client";

import { useParams } from "next/navigation";
import { createContext, useContext, useMemo } from "react";
import { Empty, ScreenSkeleton, SLink } from "@/components/studio";
import { StudioShell, type ShellPage } from "@/components/studio-shell";
import type { OrderView } from "@/lib/orders";
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

const Ctx = createContext<{ page: ManagedPage; reload: () => Promise<void>; refreshBadges?: () => Promise<void> } | null>(null);
export const useManagedPage = () => useContext(Ctx)!;

/** Orders that wait on the maker (shown as dock/sidebar badges and on Home). */
export const NEEDS_MAKER = ["PAID", "DISPUTED"];

export default function PageLayout({ children }: { children: React.ReactNode }) {
  const { pageId } = useParams<{ pageId: string }>();
  const { data: page, error, reload } = useApi<ManagedPage>(`/pages/${pageId}`);
  const { data: pages } = useApi<ShellPage[]>("/pages/mine/list");
  const manager = page?.myAccess === "MANAGER";
  const { data: orders, reload: refreshBadges } = useApi<OrderView[]>(manager ? `/pages/${pageId}/orders` : null);
  const badges = useMemo<Record<string, number>>(() => {
    const n = orders?.filter((o) => NEEDS_MAKER.includes(o.status)).length ?? 0;
    return n ? { Orders: n } : ({} as Record<string, number>);
  }, [orders]);

  if (error)
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Empty icon="alert" title="We couldn't open this page" action={<SLink href="/studio" variant="outline">Back to my pages</SLink>}>
          {error}
        </Empty>
      </div>
    );
  if (!page)
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 lg:pl-[296px]">
        <ScreenSkeleton />
      </div>
    );
  return (
    <Ctx.Provider value={{ page, reload, refreshBadges }}>
      <StudioShell page={page} pages={pages ?? [page]} member={page.myAccess === "MEMBER"} badges={badges}>
        {children}
      </StudioShell>
    </Ctx.Provider>
  );
}
