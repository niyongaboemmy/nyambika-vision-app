"use client";

import Link from "next/link";
import { Card } from "@/components/studio";
import { useManagedPage } from "./layout";

export default function Overview() {
  const { page } = useManagedPage();
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
      {page.myAccess === "MANAGER" && <Card>
        <p className="text-sm text-stone-500">Plan</p>
        <p className="font-semibold">{page.subscription?.plan.name ?? "Basic"} · try-on allowance {page.subscription?.monthlyCap ?? 0}/month {page.allowanceOn ? "(shared with shoppers)" : "(off)"}</p>
      </Card>}
    </div>
  );
}
