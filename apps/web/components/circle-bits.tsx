import { Icon } from "@/components/icons";
import { haptic } from "@/lib/native";
import { REACTIONS, reactionMeta, type PollComment } from "@/lib/social";

/** A stored reaction rendered as its SF-style glyph (the wire value stays the API's). */
export function ReactionGlyph({ value, className = "size-4" }: { value: string | null | undefined; className?: string }) {
  const m = reactionMeta(value);
  if (!m) return null;
  return (
    <span role="img" aria-label={m.label} className={`inline-flex align-[-2px] ${m.tint}`}>
      <Icon name={m.icon} filled className={className} />
    </span>
  );
}

/** Animated reaction picker: icon toggle buttons with a spring pop and a light haptic. */
export function ReactionPicker({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {REACTIONS.map((r) => {
        const m = reactionMeta(r)!;
        const on = value === r;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            aria-label={`React: ${m.label}`}
            onClick={() => {
              haptic("light");
              onChange(on ? undefined : r);
            }}
            className={`press grid size-11 place-items-center rounded-full transition-colors ${on ? `bg-white/15 ring-2 ring-gold ${m.tint}` : "bg-white/10 text-txt/80"}`}
          >
            <span key={on ? "on" : "off"} className={on ? "spring-pop" : ""}>
              <Icon name={m.icon} filled={on} className="size-6" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

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
        {c.emoji && <> · <ReactionGlyph value={c.emoji} /></>}
        <span className="text-txt/85"> {c.comment ? c.comment : <>voted {c.option}</>}</span>
      </p>
    </div>
  );
}
