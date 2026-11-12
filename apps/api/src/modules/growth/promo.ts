import sharp, { type OverlayOptions } from "sharp";
import { escapeXml } from "../circle/watermark";
import { encodeQr } from "./qr";

/** Social kit cards (FR-PHO-07): story 1080×1920 and square 1080×1080, server-rendered with sharp. */
export const PROMO_FORMATS = { story: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 } } as const;
export type PromoFormat = keyof typeof PROMO_FORMATS;
export type PromoLocale = "rw" | "en" | "fr";

export const PROMO_COPY: Record<PromoLocale, { cta: string; scan: string; madeToOrder: string; offer: (s: string) => string; newIn: string }> = {
  rw: { cta: "Yigerageze kuri wowe ✨", scan: "Sikana ugerageze", madeToOrder: "Idodwa ku gipimo cyawe", offer: (s) => `Igabanuka: ${s}`, newIn: "Bishya" },
  en: { cta: "Try it on you ✨", scan: "Scan to try it on", madeToOrder: "Made to your measure", offer: (s) => `Offer: ${s}`, newIn: "New in" },
  fr: { cta: "Essayez-la sur vous ✨", scan: "Scannez pour essayer", madeToOrder: "Sur mesure", offer: (s) => `Offre : ${s}`, newIn: "Nouveauté" },
};

const THEME: Record<string, [string, string, string]> = {
  terra: ["#E0703F", "#F2B84B", "#3a2140"],
  indigo: ["#2B4EA2", "#38BDF8", "#1b1838"],
  forest: ["#1F7A4D", "#34D399", "#14241f"],
  violet: ["#6D28D9", "#C084FC", "#22163a"],
};

export interface PromoInput {
  format: PromoFormat;
  locale: PromoLocale;
  theme: string;
  pageName: string;
  title: string;
  priceRwf: number;
  madeToOrder: boolean;
  /** Original product photo (any size); null draws a fabric placeholder. */
  photo: Buffer | null;
  /** Maker Space URL with source tags, encoded in the QR. */
  url: string;
  /** Display-only address under the QR, e.g. nyambika.rw/m/umurage-wear */
  shortUrl: string;
  offer?: string | null;
}

const FONT = "Helvetica, Arial, sans-serif";
const rwf = (n: number) => `RWF ${n.toLocaleString("en-US")}`;

export function wrap(text: string, max: number, lines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = kept[lines - 1].replace(/.{0,2}$/, "") + "…";
    return kept;
  }
  return out;
}

function qrSvg(url: string, size: number) {
  const m = encodeQr(url);
  const n = m.length + 8;
  let d = "";
  m.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x + 4},${y + 4}h1v1h-1z`)));
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#1d1814"/></svg>`,
  );
}

async function photoTile(photo: Buffer | null, w: number, h: number, r: number, accent: string) {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
  let img: Buffer;
  if (photo) {
    // Catalogue photos are flat-lays on a light background: contain on warm paper keeps the whole garment visible.
    // Trim the photo's own plain backdrop so the garment sits on the card's paper.
    const trimmed = await sharp(photo).trim({ threshold: 18 }).toBuffer().catch(() => photo);
    img = await sharp(trimmed)
      .resize(w - 80, h - 80, { fit: "contain", background: { r: 251, g: 247, b: 242, alpha: 1 } })
      .extend({ top: 40, bottom: 40, left: 40, right: 40, background: { r: 251, g: 247, b: 242, alpha: 1 } })
      .flatten({ background: "#fbf7f2" })
      .png()
      .toBuffer();
  } else {
    img = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fbf7f2"/><g stroke="${accent}" stroke-opacity=".25" stroke-width="10">${Array.from({ length: 30 }, (_, i) => `<line x1="${i * 60 - h}" y1="0" x2="${i * 60}" y2="${h}"/>`).join("")}</g></svg>`,
      ),
    )
      .png()
      .toBuffer();
  }
  return sharp(img).resize(w, h).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

/** Render one promo card as PNG. Pure apart from sharp; deterministic for the same input. */
export async function renderPromo(p: PromoInput): Promise<Buffer> {
  const { w: W, h: H } = PROMO_FORMATS[p.format];
  const [c1, c2, c3] = THEME[p.theme] ?? THEME.terra;
  const copy = PROMO_COPY[p.locale];
  const story = p.format === "story";
  const x = (s: string) => escapeXml(s);

  // Geometry per format (story: photo on top, text + QR below; square: photo left, text column right).
  const L = story
    ? {
        photo: { x: 80, y: 250, w: 920, h: 960, r: 56 },
        textX: 80,
        brandY: 130,
        nameY: 205,
        nameSize: 60,
        title: wrap(p.title, 22, 2),
        titleY: 1310,
        tSize: 72,
        pill: { w: 420, h: 84, fs: 52 },
        cta: { w: 600, h: 110, fs: 44 },
        qrSize: 250,
      }
    : {
        photo: { x: 56, y: 56, w: 560, h: 968, r: 44 },
        textX: 664,
        brandY: 110,
        nameY: 158,
        nameSize: 34,
        title: wrap(p.title, 13, 3),
        titleY: 240,
        tSize: 48,
        pill: { w: 330, h: 64, fs: 38 },
        cta: { w: 360, h: 84, fs: 27 },
        qrSize: 200,
      };
  const lineH = L.tSize + 10;
  const priceY = L.titleY + (L.title.length - 1) * lineH + (story ? 112 : 92);
  const mtoY = priceY + (story ? 62 : 52);
  const offerY = (p.madeToOrder ? mtoY : priceY) + (story ? 40 : 30);
  const ctaY = story ? 1600 : (p.offer ? offerY + 64 : p.madeToOrder ? mtoY + 34 : priceY + 52);
  const boxPad = 22;
  const boxW = L.qrSize + boxPad * 2;
  const boxH = L.qrSize + boxPad * 2 + (story ? 52 : 0);
  const boxX = W - (story ? 80 : 56) - boxW;
  const boxY = H - (story ? 70 : 56) - boxH;
  const name = p.pageName.length > 28 ? p.pageName.slice(0, 27) + "…" : p.pageName;

  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".5" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
    <pattern id="k" width="52" height="52" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="52" fill="#fff" fill-opacity=".10"/></pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#k)"/>
  <rect y="${H * 0.4}" width="100%" height="${H * 0.6}" fill="url(#s)"/>
  <text x="${L.textX}" y="${L.brandY}" font-family="${FONT}" font-weight="900" font-size="${story ? 38 : 20}" letter-spacing="${story ? 6 : 3}" fill="#fff" fill-opacity=".92">NYAMBIKA · MAKER SPACE</text>
  <text x="${L.textX}" y="${L.nameY}" font-family="${FONT}" font-weight="900" font-size="${L.nameSize}" fill="#fff">${x(story ? name : (wrap(p.pageName, 17, 1)[0] ?? ""))}</text>
  ${L.title.map((l, i) => `<text x="${L.textX}" y="${L.titleY + i * lineH}" font-family="${FONT}" font-weight="900" font-size="${L.tSize}" fill="#fff">${x(l)}</text>`).join("")}
  <rect x="${L.textX}" y="${priceY - L.pill.h + (story ? 20 : 16)}" rx="${L.pill.h / 2}" width="${L.pill.w}" height="${L.pill.h}" fill="#fff"/>
  <text x="${L.textX + 30}" y="${priceY}" font-family="${FONT}" font-weight="900" font-size="${L.pill.fs}" fill="#1d1814">${rwf(p.priceRwf)}</text>
  ${p.madeToOrder ? `<text x="${L.textX}" y="${mtoY}" font-family="${FONT}" font-weight="700" font-size="${story ? 34 : 26}" fill="#fff" fill-opacity=".95">✂ ${x(copy.madeToOrder)}</text>` : ""}
  ${
    p.offer
      ? story
        ? ""
        : `<rect x="${L.textX}" y="${offerY - 4}" rx="24" width="360" height="52" fill="#1d1814"/><text x="${L.textX + 20}" y="${offerY + 31}" font-family="${FONT}" font-weight="900" font-size="26" fill="#F2B84B">${x(copy.offer(p.offer))}</text>`
      : ""
  }
  <rect x="${L.textX}" y="${ctaY}" rx="${L.cta.h / 2}" width="${L.cta.w}" height="${L.cta.h}" fill="#1d1814"/>
  <text x="${L.textX + L.cta.w / 2}" y="${ctaY + L.cta.h / 2 + L.cta.fs * 0.36}" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="${L.cta.fs}" fill="#fff">${x(copy.cta)}</text>
  <rect x="${boxX}" y="${boxY}" rx="34" width="${boxW}" height="${boxH}" fill="#fff"/>
  ${story ? `<text x="${boxX + boxW / 2}" y="${boxY + boxPad + L.qrSize + 40}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="28" fill="#1d1814">${x(copy.scan)}</text>` : `<text x="${L.textX}" y="${ctaY + L.cta.h + 50}" font-family="${FONT}" font-weight="800" font-size="24" fill="#fff">${x(copy.scan)} →</text>`}
  <text x="${story ? L.textX : 56 + 24}" y="${story ? H - 100 : H - 80}" font-family="${FONT}" font-weight="700" font-size="${story ? 32 : 22}" fill="${story ? "#fff" : "#1d1814"}" fill-opacity=".9">${x(p.shortUrl)}</text>
</svg>`);

  const tile = await photoTile(p.photo, L.photo.w, L.photo.h, L.photo.r, c1);
  const qrImg = await sharp(qrSvg(p.url, L.qrSize)).png().toBuffer();
  const layers: OverlayOptions[] = [
    { input: tile, left: L.photo.x, top: L.photo.y },
    { input: qrImg, left: boxX + boxPad, top: boxY + boxPad },
  ];
  if (story && p.offer)
    layers.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="76"><rect x="0" y="6" rx="32" width="380" height="64" fill="#1d1814"/><text x="190" y="50" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="32" fill="#F2B84B">${x(copy.offer(p.offer))}</text></svg>`,
      ),
      left: L.photo.x + L.photo.w - 410,
      top: L.photo.y + 24,
    });
  // Square: the short URL sits on the photo's bottom edge, so redraw it over the tile.
  if (!story)
    layers.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${L.photo.w}" height="60"><rect x="12" y="6" rx="22" width="${Math.min(L.photo.w - 24, 24 + p.shortUrl.length * 12)}" height="44" fill="#fff" fill-opacity=".92"/><text x="30" y="36" font-family="${FONT}" font-weight="700" font-size="22" fill="#1d1814">${x(p.shortUrl)}</text></svg>`,
      ),
      left: L.photo.x,
      top: L.photo.y + L.photo.h - 72,
    });
  return sharp(bg).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}
