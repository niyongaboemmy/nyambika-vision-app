"use client";

import Link from "next/link";
import { ErrorNote, Screen, TopBar } from "@/components/ui";
import { timeLeft, type PollState } from "@/lib/social";
import { useApi } from "@/lib/use-api";

interface Row {
  id: string;
  question: string;
  state: PollState;
  votes: number;
  expiresAt: string;
}

/** The shopper's circle polls. New polls start from the Ask button on any look. */
export default function MyPolls() {
  const { data, error } = useApi<Row[]>("/circle/polls");
  return (
    <Screen className="pb-10">
      <TopBar back="/wardrobe" title="Your polls" />
      <div className="space-y-3 px-4 pt-2">
        <ErrorNote error={error} />
        {data === null && !error && [0, 1].map((i) => <div key={i} className="skeleton h-20 rounded-3xl" />)}
        {data?.length === 0 && (
          <div className="glass rounded-3xl p-6 text-center">
            <p className="text-3xl">👥</p>
            <p className="mt-2 font-display text-lg font-black">No polls yet</p>
            <p className="mt-1 text-sm text-mut">Tap <b>Ask</b> on any look to let your friends vote from WhatsApp.</p>
            <Link href="/" className="grad-cta mt-4 inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold">Ask the Muse</Link>
          </div>
        )}
        {data?.map((p) => (
          <Link key={p.id} href={`/circle/${p.id}`} className="glass flex items-center justify-between gap-3 rounded-3xl p-4">
            <div className="min-w-0">
              <p className="truncate font-semibold">“{p.question}”</p>
              <p className="text-xs text-mut">{p.votes} vote{p.votes === 1 ? "" : "s"} · {p.state === "OPEN" ? timeLeft(p.expiresAt) : p.state === "REVOKED" ? "taken down" : "closed"}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${p.state === "OPEN" ? "bg-mint/20 text-mint" : "bg-white/10 text-mut"}`}>{p.state === "OPEN" ? "Live" : "Closed"}</span>
          </Link>
        ))}
      </div>
    </Screen>
  );
}
