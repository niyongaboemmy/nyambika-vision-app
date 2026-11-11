/**
 * USSD menu for cooperative makers without a smartphone (FR-COOP-09, E31).
 * Stateless, Africa's Talking style: the gateway sends the whole input path ("3*1*1") on every step,
 * so the state machine is a pure function of (context, path). "0" goes back one level (exit at the root).
 */

export const USSD_CODE = "*775#";
export type UssdLocale = "rw" | "en" | "fr";

export interface UssdOrder {
  id: string;
  code: string;
  title: string;
  colour: string;
  size: string;
  totalRwf: number;
}

export interface UssdContext {
  makerName: string;
  locale: UssdLocale;
  sales: { monthCount: number; monthRwf: number; lastCount: number; lastRwf: number };
  payout: { nextRwf: number; nextDate: string; directRwf: number };
  orders: UssdOrder[];
  pendingAssist: { id: string; adminName: string; days: number } | null;
}

export type UssdAction =
  | { type: "ACCEPT_ORDER"; orderId: string }
  | { type: "GRANT_ASSIST"; grantId: string }
  | { type: "DENY_ASSIST"; grantId: string }
  | { type: "SET_LOCALE"; locale: UssdLocale };

export interface UssdReply {
  /** "CON …" keeps the session open, "END …" closes it (gateway convention). */
  text: string;
  end: boolean;
  action?: UssdAction;
  /** Normalised path after back-navigation, for logging. */
  path: string[];
}

const rwf = (n: number) => `RWF ${n.toLocaleString("en-US")}`;

const C = {
  rw: {
    hello: (n: string) => `Muraho ${n}`,
    sales: "Ibyo nagurishije",
    payout: "Amafaranga yanjye",
    approve: "Emeza komande",
    assist: "Emerera umuyobozi kumfasha",
    lang: "Ururimi",
    exit: "Sohoka",
    back: "Subira inyuma",
    bye: "Murakoze. Mugire umunsi mwiza!",
    invalid: "Ntibyumvikanye. Ongera ugerageze.",
    salesText: (c: UssdContext) => `Uku kwezi: ${c.sales.monthCount} byagurishijwe, ${rwf(c.sales.monthRwf)}.\nUkwezi gushize: ${c.sales.lastCount}, ${rwf(c.sales.lastRwf)}.`,
    payoutText: (c: UssdContext) => `Koperative izakwishyura ${rwf(c.payout.nextRwf)} ku wa ${c.payout.nextDate}.\nWakiriye ${rwf(c.payout.directRwf)} kuri MoMo yawe uku kwezi.`,
    noOrders: "Nta komande itegereje.",
    orderMenu: (o: UssdOrder) => `${o.code}: ${o.title} (${o.colour}, ${o.size}) ${rwf(o.totalRwf)}\n1. Yemeze\n2. Nyuma`,
    accepted: (o: UssdOrder) => `Wemeje ${o.code}. Umuguzi yamenyeshejwe. Tangira kudoda!`,
    later: "Sawa, nyuma.",
    assistAsk: (a: NonNullable<UssdContext["pendingAssist"]>) => `${a.adminName} arashaka kugufasha gushyiraho imyenda no kwemeza komande iminsi ${a.days}.\n1. Yego, ndamwemereye\n2. Oya`,
    assistOk: (a: NonNullable<UssdContext["pendingAssist"]>) => `Murakoze. ${a.adminName} yemerewe kugufasha iminsi ${a.days}. Ushobora kubihagarika igihe cyose.`,
    assistNo: "Sawa, ntibyemewe.",
    noAssist: "Nta busabe bw'ubufasha buhari.",
    langDone: "Ururimi rwahinduwe.",
  },
  en: {
    hello: (n: string) => `Hello ${n}`,
    sales: "My sales",
    payout: "My next payout",
    approve: "Approve an order",
    assist: "Allow admin to help me",
    lang: "Language",
    exit: "Exit",
    back: "Back",
    bye: "Thank you. Have a good day!",
    invalid: "Invalid choice. Try again.",
    salesText: (c: UssdContext) => `This month: ${c.sales.monthCount} sold, ${rwf(c.sales.monthRwf)}.\nLast month: ${c.sales.lastCount}, ${rwf(c.sales.lastRwf)}.`,
    payoutText: (c: UssdContext) => `Your cooperative pays you ${rwf(c.payout.nextRwf)} on ${c.payout.nextDate}.\nReceived directly on your MoMo this month: ${rwf(c.payout.directRwf)}.`,
    noOrders: "No orders waiting.",
    orderMenu: (o: UssdOrder) => `${o.code}: ${o.title} (${o.colour}, ${o.size}) ${rwf(o.totalRwf)}\n1. Accept\n2. Not now`,
    accepted: (o: UssdOrder) => `You accepted ${o.code}. The buyer has been told. Start sewing!`,
    later: "OK, later.",
    assistAsk: (a: NonNullable<UssdContext["pendingAssist"]>) => `${a.adminName} wants to help you add products and accept orders for ${a.days} days.\n1. Yes, allow\n2. No`,
    assistOk: (a: NonNullable<UssdContext["pendingAssist"]>) => `Thank you. ${a.adminName} may help you for ${a.days} days. You can stop it any time.`,
    assistNo: "OK, not allowed.",
    noAssist: "No help request waiting.",
    langDone: "Language changed.",
  },
  fr: {
    hello: (n: string) => `Bonjour ${n}`,
    sales: "Mes ventes",
    payout: "Mon prochain paiement",
    approve: "Accepter une commande",
    assist: "Autoriser l'aide de l'admin",
    lang: "Langue",
    exit: "Quitter",
    back: "Retour",
    bye: "Merci. Bonne journée !",
    invalid: "Choix invalide. Réessayez.",
    salesText: (c: UssdContext) => `Ce mois : ${c.sales.monthCount} vendus, ${rwf(c.sales.monthRwf)}.\nMois dernier : ${c.sales.lastCount}, ${rwf(c.sales.lastRwf)}.`,
    payoutText: (c: UssdContext) => `La coopérative vous paie ${rwf(c.payout.nextRwf)} le ${c.payout.nextDate}.\nReçu directement sur votre MoMo ce mois : ${rwf(c.payout.directRwf)}.`,
    noOrders: "Aucune commande en attente.",
    orderMenu: (o: UssdOrder) => `${o.code} : ${o.title} (${o.colour}, ${o.size}) ${rwf(o.totalRwf)}\n1. Accepter\n2. Plus tard`,
    accepted: (o: UssdOrder) => `Commande ${o.code} acceptée. L'acheteur est prévenu. À vos aiguilles !`,
    later: "D'accord, plus tard.",
    assistAsk: (a: NonNullable<UssdContext["pendingAssist"]>) => `${a.adminName} veut vous aider à ajouter des produits et accepter des commandes pendant ${a.days} jours.\n1. Oui, j'autorise\n2. Non`,
    assistOk: (a: NonNullable<UssdContext["pendingAssist"]>) => `Merci. ${a.adminName} peut vous aider pendant ${a.days} jours. Vous pouvez arrêter à tout moment.`,
    assistNo: "D'accord, non autorisé.",
    noAssist: "Aucune demande d'aide.",
    langDone: "Langue modifiée.",
  },
} as const;

/** Apply "0 = back" to the raw path. Returns null when the user exits at the root. */
export function normalisePath(text: string): string[] | null {
  const tokens = text.split("*").map((t) => t.trim()).filter((t) => t.length > 0);
  const out: string[] = [];
  for (const t of tokens) {
    if (t === "0") {
      if (!out.length) return null;
      out.pop();
    } else out.push(t);
  }
  return out;
}

const con = (text: string, path: string[], action?: UssdAction): UssdReply => ({ text: `CON ${text}`, end: false, path, action });
const end = (text: string, path: string[], action?: UssdAction): UssdReply => ({ text: `END ${text}`, end: true, path, action });

export function rootMenu(c: UssdContext) {
  const t = C[c.locale];
  const lines = [
    `${t.hello(c.makerName.split(" ")[0])} · Nyambika`,
    `1. ${t.sales}`,
    `2. ${t.payout}`,
    `3. ${t.approve}${c.orders.length ? ` (${c.orders.length})` : ""}`,
    ...(c.pendingAssist ? [`4. ${t.assist} (!)`] : []),
    `5. ${t.lang}`,
    `0. ${t.exit}`,
  ];
  return lines.join("\n");
}

/** The USSD state machine. Pure: same context + input → same reply. */
export function ussdStep(c: UssdContext, text: string): UssdReply {
  const t = C[c.locale];
  const path = normalisePath(text ?? "");
  if (path === null) return end(t.bye, []);
  const [a, b, d, ...rest] = path;
  const invalid = (at: string[]) => con(`${t.invalid}\n${at.length ? "" : rootMenu(c)}`.trim(), at);
  if (rest.length) return invalid([]);
  if (!a) return con(rootMenu(c), []);
  switch (a) {
    case "1":
      return b ? invalid([]) : end(t.salesText(c), path);
    case "2":
      return b ? invalid([]) : end(t.payoutText(c), path);
    case "3": {
      if (!c.orders.length) return end(t.noOrders, path);
      const list = () => con([...c.orders.slice(0, 5).map((o, i) => `${i + 1}. ${o.code} ${o.title} ${rwf(o.totalRwf)}`), `0. ${t.back}`].join("\n"), ["3"]);
      if (!b) return list();
      const o = c.orders.slice(0, 5)[Number(b) - 1];
      if (!o || !/^\d+$/.test(b)) return con(`${t.invalid}\n${list().text.slice(4)}`, ["3"]);
      if (!d) return con(`${t.orderMenu(o)}\n0. ${t.back}`, ["3", b]);
      if (d === "1") return end(t.accepted(o), path, { type: "ACCEPT_ORDER", orderId: o.id });
      if (d === "2") return end(t.later, path);
      return con(`${t.invalid}\n${t.orderMenu(o)}`, ["3", b]);
    }
    case "4": {
      const g = c.pendingAssist;
      if (!g) return end(t.noAssist, path);
      if (!b) return con(`${t.assistAsk(g)}\n0. ${t.back}`, ["4"]);
      if (d) return invalid([]);
      if (b === "1") return end(t.assistOk(g), path, { type: "GRANT_ASSIST", grantId: g.id });
      if (b === "2") return end(t.assistNo, path, { type: "DENY_ASSIST", grantId: g.id });
      return con(`${t.invalid}\n${t.assistAsk(g)}`, ["4"]);
    }
    case "5": {
      if (!b) return con(`1. Kinyarwanda\n2. English\n3. Français\n0. ${t.back}`, ["5"]);
      const locale = ({ "1": "rw", "2": "en", "3": "fr" } as const)[b as "1" | "2" | "3"];
      if (!locale || d) return invalid([]);
      return end(C[locale].langDone, path, { type: "SET_LOCALE", locale });
    }
    default:
      return invalid([]);
  }
}
