import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/server-api";
import type { Commerce } from "@/lib/region";
import type { Showroom } from "@/lib/vr";
import { ShowroomClient } from "./client";

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const s = await serverApi<Showroom>(`/vr/public/pages/${handle}/showroom`);
  if (!s) return { title: "Showroom not found" };
  return {
    title: `${s.page.name} · 3D showroom`,
    description: `${s.banner}. Walk ${s.page.name}'s room in 3D or VR and hold to buy.`,
    openGraph: { title: `${s.page.name} · 3D showroom on Nyambika`, images: [s.items[0]?.photo ?? "/icon.png"] },
    alternates: { canonical: `/m/${handle}/showroom` },
  };
}

/** E35 WebXR showroom (FR-VR-01..04, 07, 08): one immersive room per Maker Space, with an inline 3D fallback. */
export default async function ShowroomPage({ params }: Props) {
  const { handle } = await params;
  const s = await serverApi<Showroom>(`/vr/public/pages/${handle}/showroom`, 10);
  if (!s) notFound();
  const commerce = await serverApi<Commerce>(`/region/pages/by-handle/${handle}/commerce`, 10); // E40/E41 prices
  return <ShowroomClient room={s} commerce={commerce} />;
}
