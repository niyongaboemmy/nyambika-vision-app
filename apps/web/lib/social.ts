import type { Look } from "./looks";

/** E25 Ask your circle + E26 Digital wardrobe view models (mirror apps/api/src/modules/{circle,wardrobe}). */
export type PollState = "OPEN" | "EXPIRED" | "REVOKED";

export interface PollComment {
  id: string;
  name: string;
  comment: string | null;
  emoji: string | null;
  option: string;
  at: string;
}

export interface Snapshot {
  state: PollState;
  total: number;
  options: { id: string; votes: number; pct: number }[];
  comments: PollComment[];
}

export interface PublicPoll {
  state: PollState;
  question: string;
  expiresAt: string;
  total: number;
  comments: PollComment[];
  myVote: { optionId: string; name: string | null; comment: string | null; emoji: string | null } | null;
  options: { id: string; label: string; image: string; votes: number; pct: number }[];
}

export interface PollMeta {
  state: PollState;
  question: string;
  expiresAt: string;
  options: { id: string; label: string; image: string }[];
}

export interface OwnerPoll extends Snapshot {
  id: string;
  token: string;
  question: string;
  shareUrl: string;
  createdAt: string;
  expiresAt: string;
  winner: string | null;
  options: { id: string; votes: number; pct: number; label: string; lookId: string; image: string | null; look: Look | null }[];
}

/** Wire values accepted by the API (apps/api circle/guards.ts REACTIONS; unchanged, written as escapes so the source
 *  stays emoji-free). The UI never shows them: each maps to an SF-style glyph and a spoken name. */
export const REACTIONS = ["\u2764\uFE0F", "\u{1F525}", "\u{1F60D}", "\u{1F44F}", "\u{1F49B}", "\u{1F499}", "\u{1F451}", "\u2728"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const REACTION_META: Record<Reaction, { icon: "heart" | "fire" | "smile" | "clap" | "star" | "thumbsUp" | "crown" | "sparkle"; label: string; tint: string }> = {
  "\u2764\uFE0F": { icon: "heart", label: "Love", tint: "text-[#ff375f]" },
  "\u{1F525}": { icon: "fire", label: "Fire", tint: "text-[#ff9f0a]" },
  "\u{1F60D}": { icon: "smile", label: "Gorgeous", tint: "text-[#ffd60a]" },
  "\u{1F44F}": { icon: "clap", label: "Applause", tint: "text-[#ffb340]" },
  "\u{1F49B}": { icon: "star", label: "Gold star", tint: "text-[#f2b84b]" },
  "\u{1F499}": { icon: "thumbsUp", label: "Yes", tint: "text-[#0a84ff]" },
  "\u{1F451}": { icon: "crown", label: "Queen", tint: "text-[#f2b84b]" },
  "\u2728": { icon: "sparkle", label: "Sparkle", tint: "text-[#bf5af2]" },
};
export const reactionMeta = (v: string | null | undefined) => (v && v in REACTION_META ? REACTION_META[v as Reaction] : null);

export interface OwnedItem {
  id: string;
  productId: string;
  variantId: string;
  title: string;
  category: string;
  slot: "FULL" | "TOP" | "BOTTOM" | null;
  colourName: string;
  colourHex: string;
  colours: string[];
  occasions: string[];
  priceRwf: number;
  size: string;
  image: string | null;
  maker: { name: string; handle: string };
  orderCode: string;
  since: string;
}

export interface EventSummary {
  id: string;
  title: string;
  occasion: string;
  date: string;
  daysUntil: number;
  outfits: number;
  ready: number;
  rendering: boolean;
  thumbs: string[];
}

export interface OutfitPiece {
  variantId: string;
  productId: string;
  owned: boolean;
  title: string;
  category: string;
  colourName: string;
  colourHex: string;
  priceRwf: number;
  image: string | null;
  maker: { name: string; handle: string } | null;
}

export interface WardrobeEventView extends EventSummary {
  budgetMax: number | null;
  reminderSentAt: string | null;
  looks: { id: string; rank: number; status: Look["status"]; image: string | null; c2pa: { signed: boolean; sha256: string } | null; reasons: string[]; newCostRwf: number; pieces: OutfitPiece[] }[];
}

export interface Wardrobe {
  owned: OwnedItem[];
  saved: (Look & { colours: string[] })[];
  events: EventSummary[];
}

export const OCCASIONS = ["wedding", "office", "church", "party", "graduation", "casual", "traditional-ceremony"];
export const COLOUR_SWATCH: Record<string, string> = {
  red: "#c0392b", orange: "#e07b20", yellow: "#e6b800", gold: "#d4a017", green: "#2e7d4f", blue: "#2b6cb0", indigo: "#2f3e9e", purple: "#6b3fa0", pink: "#d6608a", brown: "#7a4a2a", black: "#1c1c1c", white: "#f2f2f2",
};

export const nice = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");

export function whenLabel(days: number) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 0) return "passed";
  return `in ${days} days`;
}

export function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "closed";
  const h = Math.floor(ms / 3600_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.round(ms / 60_000))} min left`;
}
