import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/server-api";
import type { ShowView } from "@/lib/vr";
import { ShowClient } from "./client";

type Props = { params: Promise<{ handle: string; showId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { showId } = await params;
  const s = await serverApi<ShowView>(`/vr/public/shows/${showId}`);
  if (!s) return { title: "Show not found" };
  return {
    title: `${s.title} · ${s.maker.name}`,
    description: s.description || `A virtual fashion show by ${s.maker.name} on Nyambika.`,
    openGraph: { title: `${s.title} · ${s.maker.name}`, images: s.cover ? [s.cover] : [], type: "video.other" },
  };
}

/** E35 virtual fashion show (FR-VR-05): RSVP, live runway with viewers and reactions, replay. */
export default async function ShowPage({ params }: Props) {
  const { handle, showId } = await params;
  const s = await serverApi<ShowView>(`/vr/public/shows/${showId}`, 0);
  if (!s || s.maker.handle !== handle) notFound();
  return <ShowClient initial={s} />;
}
