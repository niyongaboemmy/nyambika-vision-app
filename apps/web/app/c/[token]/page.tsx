import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/server-api";
import type { PollMeta } from "@/lib/social";
import { PollClient } from "./poll-client";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const m = await serverApi<PollMeta>(`/c/${token}/meta`, 0);
  const open = m?.state === "OPEN";
  const title = open ? m!.question : "This poll has closed";
  return {
    title,
    description: open ? `Tap to vote · ${m!.options.length} looks · AI previews on Nyambika` : "Ask your circle on Nyambika",
    robots: { index: false, follow: false },
    openGraph: {
      title: open ? `Help me choose: ${m!.question}` : "Ask your circle",
      description: "Tap to vote. No account needed.",
      images: open ? [{ url: `/api/c/${token}/og.jpg`, width: 1200, height: 630, alt: "AI previews of outfits to vote on" }] : ["/icon.png"],
      type: "website",
    },
    twitter: { card: "summary_large_image" },
  };
}

/** Public poll (E25, FR-SOC-02): server-rendered shell so the looks start loading before any JS runs. */
export default async function PublicPoll({ params }: Props) {
  const { token } = await params;
  const meta = await serverApi<PollMeta>(`/c/${token}/meta`, 0);
  if (!meta) notFound();
  return <PollClient token={token} meta={meta} />;
}
