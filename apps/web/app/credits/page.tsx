import type { Metadata } from "next";
import Link from "next/link";
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

/** Every credited image source (CC BY / BY-SA / CC0 photos, in-house renders), with licence and changes. */
export default async function CreditsPage() {
  const data = await serverApi<{ sources: Source[] }>("/credits", 300);
  const sources = data?.sources ?? [];
  const licences = [...new Set(sources.map((s) => s.licence))];
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[640px] bg-ink px-4 pb-16 pt-[max(env(safe-area-inset-top),16px)]">
      <Link href="/" aria-label="Back" className="glass grid size-10 place-items-center rounded-full">←</Link>
      <h1 className="mt-4 font-display text-3xl font-black">Image credits</h1>
      <p className="mt-2 text-[15px] text-txt/80">
        Catalogue photos come from openly licensed sources. Makers and products are fictional. Cut-outs, recolours and illustrations are marked as changes; share-alike images stay under their licence.
      </p>
      {licences.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Licences">
          {licences.map((l) => (
            <li key={l} className="glass rounded-full px-3 py-1 text-xs font-semibold">
              {l} · {sources.filter((s) => s.licence === l).length}
            </li>
          ))}
        </ul>
      )}
      {sources.length === 0 ? (
        <p className="mt-8 text-mut">No credited images yet.</p>
      ) : (
        <ol className="mt-6 space-y-3">
          {sources.map((s) => (
            <li key={s.key} className="glass rounded-2xl p-4">
              <p className="font-semibold leading-snug">
                <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{s.title}</a>
                {s.illustration && <span className="ml-2 rounded-full bg-gold/20 px-2 py-0.5 align-middle text-[11px] font-semibold text-gold">Illustration</span>}
              </p>
              <p className="mt-1 text-sm text-txt/80">
                {s.author} ·{" "}
                {s.licenceUrl ? <a href={s.licenceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{s.licence}</a> : s.licence}
                {s.shareAlike ? " · share-alike" : ""}
              </p>
              {s.changes.length > 0 && <p className="mt-1 text-xs text-mut">Modified: {s.changes.join(" · ")}</p>}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-8 text-xs text-mut">Via Wikimedia Commons unless noted. Credit does not imply endorsement by the authors.</p>
    </main>
  );
}
