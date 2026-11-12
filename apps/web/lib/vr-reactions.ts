import type { IconName } from "@/components/icons";

/**
 * Fashion-show / shared-room reactions (contracts `REACTIONS`) keep their wire values (the API and presence server
 * validate them), but the UI never shows emoji: each value maps to an SF-style glyph, a spoken name and a tint.
 * Values are written as \u escapes so the web source stays emoji-free (lib/no-emoji.test.ts).
 */
export const VR_REACTION: Record<string, { icon: IconName; label: string; color: string }> = {
  "\u{1F525}": { icon: "fire", label: "Fire", color: "#ff9f0a" },
  "\u{1F60D}": { icon: "heart", label: "Love it", color: "#ff375f" },
  "\u{1F44F}": { icon: "clap", label: "Applause", color: "#ffb340" },
  "\u2728": { icon: "sparkle", label: "Sparkle", color: "#bf5af2" },
  "\u{1F483}": { icon: "music", label: "Dance", color: "#64d2ff" },
};

export const vrReaction = (v: string) => VR_REACTION[v] ?? { icon: "star" as IconName, label: "Reaction", color: "#f2b84b" };
