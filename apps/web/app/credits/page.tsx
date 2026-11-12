import type { Metadata } from "next";
import Link from "next/link";
import { Group } from "@/components/ios";
import { serverApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "Image credits", description: "Sources and licences of the catalogue images on Nyambika." };

interface Source {
  key: string;
  title: string;
  author: string;
  sourceUrl: string;
  licence: string;
  licenceUrl: string;
  shareAlike: boolean;
  illustration: boolean;
  changes: string[];
  images: number;
}

/** Every credited image source (CC BY / BY-SA / CC0 photos, in-house renders), grouped by licence. */
export default async function CreditsPage() {
  const data = await serverApi<{ sources: Source[] }>("/credits", 300);
  const sources = data?.sources ?? [];
  const licences = [...new Set(sources.map((s) => s.licence))];
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[640px] bg-surface px-4 pb-16 pt-[max(env(safe-area-inset-top),16px)]">
      <Link href="/" aria-label="Back" className="grid size-10 place-items-center rounded-full bg-fill text-fg">←</Link>
      <h1 className="mt-4 font-display text-3xl font-black text-fg">Image credits</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">
        Catalogue photos come from openly licensed sources. Makers and products are fictional. Cut-outs, recolours and illustrations are listed as changes; share-alike images keep their licence.
      </p>
      {sources.length === 0 ? (
        <p className="mt-8 text-fg-muted">No credited images yet.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {licences.map((l) => {
            const group = sources.filter((s) => s.licence === l);
            return (
              <Group key={l} header={`${l} · ${group.length}`}>
                {group.map((s) => (
                  <li key={s.key} className="flex min-h-11 flex-col gap-0.5 px-4 py-3">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-[15px] font-medium text-fg underline underline-offset-2 [overflow-wrap:anywhere]">{s.title}</a>
                      {s.illustration && <span className="rounded-full bg-fill px-2 py-0.5 text-[12px] font-semibold text-fg">Illustration</span>}
                    </span>
                    <span className="text-[13px] text-fg-muted">
                      {s.author} ·{" "}
                      {s.licenceUrl ? <a href={s.licenceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{s.licence}</a> : s.licence}
                      {s.shareAlike ? " · share-alike" : ""}
                    </span>
                    {s.changes.length > 0 && <span className="text-[13px] text-fg-muted">Modified: {s.changes.join(" · ")}</span>}
                  </li>
                ))}
              </Group>
            );
          })}
        </div>
      )}
      <p className="mt-8 text-[13px] text-fg-muted">Via Wikimedia Commons unless noted. Credit does not imply endorsement by the authors.</p>
    </main>
  );
}
