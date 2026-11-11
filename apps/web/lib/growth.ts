/** E30 growth tools + E31 coop flows: client types. */

export interface Suggestion {
  key: string;
  tone: "violet" | "gold" | "mint" | "sky";
  text: string;
  action?: { label: string; href: string };
  productId?: string;
}

export interface Insights {
  periodDays: number;
  visits: number;
  sources: { source: string; n: number; share: number }[];
  byProduct: { id: string; title: string; priceRwf: number; colours: number; looks: number; sales: number; conversion: number; image: string | null }[];
  hours: number[];
  suggestions: Suggestion[];
  writer: "rules" | "llm";
}

export interface Discount {
  id: string;
  code: string | null;
  label: string;
  kind: "PERCENT" | "AMOUNT";
  value: number;
  productId: string | null;
  productTitle: string | null;
  minSpendRwf: number;
  maxUses: number | null;
  uses: number;
  perShopper: number;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  givenRwf: number;
  state: "LIVE" | "PAUSED" | "SCHEDULED" | "ENDED" | "USED_UP";
  display: string;
}

export interface BroadcastState {
  history: { id: string; message: string; recipients: number; skipped: number; createdAt: string; link: string }[];
  followers: number;
  optedIn: number;
  canSend: boolean;
  blocked: { reason: string; message: string; retryAt: string | null } | null;
}

export interface PromoCard {
  url: string;
  width: number;
  height: number;
  shareText: string;
  link: string;
  links: Record<string, { url: string; whatsapp: string }>;
}

export const SOURCE_LABEL: Record<string, string> = {
  wa_status: "WhatsApp Status",
  wa_chat: "WhatsApp chat",
  wa_catalogue: "WhatsApp catalogue",
  broadcast: "Follower updates",
  ig_story: "Instagram story",
  qr_card: "QR · square card",
  qr_story: "QR · story card",
  link: "Shared link",
  direct: "Direct / search",
};

export interface CoopMe {
  maker: { id: string; name: string; phone: string; momoMerchant: string };
  page: { name: string };
  access: { voiceMode: boolean; smsMode: boolean; locale: "rw" | "en" | "fr" };
  sales: { monthCount: number; monthRwf: number; lastCount: number; lastRwf: number };
  payout: { nextRwf: number; nextDate: string; directRwf: number };
  orders: { id: string; code: string; title: string; colour: string; size: string; totalRwf: number }[];
  pendingAssist: { id: string; adminName: string; consentText: string; days: number } | null;
  activeAssist: { id: string; expiresAt: string } | null;
}

export interface MakerAccessRow {
  makerId: string;
  voiceMode: boolean;
  smsMode: boolean;
  locale: string;
  assist: { status: "ACTIVE" | "PENDING"; id: string; expiresAt?: string; method?: string; createdAt?: string } | null;
}

export interface Statement {
  maker: { id: string; name: string };
  month: string;
  lines: { date: string; code: string; title: string; size: string; amountRwf: number; route: "DIRECT" | "COOPERATIVE" }[];
  totals: { count: number; totalRwf: number; directRwf: number; cooperativeRwf: number; payoutDate: string };
  spoken: string;
  locale: "rw" | "en" | "fr";
}

/** Speak a prompt with the browser's speech synthesis (Kinyarwanda first, falls back to any voice). */
export function speak(text: string, locale: "rw" | "en" | "fr" = "rw") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const u = new SpeechSynthesisUtterance(text);
  const tag = locale === "rw" ? "rw-RW" : locale === "fr" ? "fr-FR" : "en-GB";
  u.lang = tag;
  const voices = window.speechSynthesis.getVoices();
  u.voice = voices.find((v) => v.lang.startsWith(locale)) ?? voices.find((v) => v.lang.startsWith(locale === "rw" ? "sw" : locale)) ?? null;
  u.rate = 0.92;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return true;
}
