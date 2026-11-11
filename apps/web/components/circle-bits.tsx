import type { PollComment } from "@/lib/social";

const TONES = ["#C9A27E", "#7FA88A", "#B98BD1", "#E0703F", "#5B8DEF", "#D6608A"];

function tone(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/** Friend comment bubble (prototype v2 · 12-ask-your-circle). */
export function Bubble({ c }: { c: PollComment }) {
  return (
    <div className="flex animate-rise items-start gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-full font-display text-lg font-black text-white" style={{ background: tone(c.name) }} aria-hidden>
        {c.name.charAt(0).toUpperCase()}
      </span>
      <p className="glass rounded-2xl rounded-tl-md px-4 py-2.5 text-[15px] leading-snug">
        <b>{c.name}</b>
        {c.emoji && <> · {c.emoji}</>}
        <span className="text-txt/85"> {c.comment ? c.comment : <>voted {c.option}</>}</span>
      </p>
    </div>
  );
}
