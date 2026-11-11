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

export const REACTIONS = ["❤️", "🔥", "😍", "👏", "💛", "💙", "👑", "✨"] as const;

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
