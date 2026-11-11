import sharp from "sharp";

/** Longest edge of a shared copy: light enough for a cheap Android on mobile data. */
export const SHARE_MAX_HEIGHT = 960;

export const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Geometry of the visible label, exposed so tests can check those pixels really changed. */
export function labelBox(width: number, height: number) {
  // Sized and placed to fully cover the gateway's own small "AI preview" tag (8px inset, 78x18 at 512px).
  const s = height / 512;
  const w = Math.round(108 * s);
  const h = Math.round(28 * s);
  const x = Math.round(5 * s);
  const y = height - h - Math.round(5 * s);
  return { x, y, w, h, s, width };
}

function overlaySvg(width: number, height: number) {
  const { x, y, w, h, s } = labelBox(width, height);
  const r = Math.round(9 * s);
  const fs = Math.max(10, Math.round(13 * s));
  const markR = Math.round(8 * s);
  const markFs = Math.max(9, Math.round(11 * s));
  const markW = Math.round(82 * s);
  const markX = width - Math.round(6 * s) - markW;
  const markY = y;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="o" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#E0703F"/><stop offset=".5" stop-color="#F2B84B"/><stop offset="1" stop-color="#8B5CF6"/>
        </linearGradient>
      </defs>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#0B0A0F" fill-opacity=".9" stroke="#fff" stroke-opacity=".35"/>
      <text x="${x + Math.round(9 * s)}" y="${y + h / 2 + fs * 0.36}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${fs}" fill="#fff">✦ AI preview</text>
      <rect x="${markX}" y="${markY}" width="${markW}" height="${h}" rx="${r}" fill="#000" fill-opacity=".5"/>
      <circle cx="${markX + Math.round(12 * s)}" cy="${markY + h / 2}" r="${markR}" fill="url(#o)"/>
      <text x="${markX + Math.round(23 * s)}" y="${markY + h / 2 + markFs * 0.36}" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="${markFs}" fill="#fff" fill-opacity=".92">Nyambika</text>
    </svg>`,
  );
}

/**
 * Watermark a copy of a look for sharing (FR-SOC-01): visible "AI preview" label + small Nyambika mark,
 * downscaled and stripped of metadata. The original never leaves private storage.
 */
export async function watermark(original: Buffer): Promise<Buffer> {
  const base = sharp(original).rotate().resize({ height: SHARE_MAX_HEIGHT, withoutEnlargement: true }).flatten({ background: "#15131b" });
  const { data, info } = await base.png().toBuffer({ resolveWithObject: true });
  return sharp(data)
    .composite([{ input: overlaySvg(info.width, info.height), left: 0, top: 0 }])
    .webp({ quality: 80 })
    .toBuffer();
}

/** WhatsApp / social preview card: dark aurora, the question and the watermarked looks side by side. */
export async function ogCard(question: string, looks: Buffer[]): Promise<Buffer> {
  const W = 1200;
  const H = 630;
  const n = Math.max(1, looks.length);
  const gap = 22;
  const cardH = 440;
  const cardW = Math.min(250, Math.floor((W - 120 - gap * (n - 1)) / n));
  const total = n * cardW + (n - 1) * gap;
  const left0 = Math.round((W - total) / 2);
  const top = 150;
  const q = question.length > 60 ? `${question.slice(0, 57)}…` : question;
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <radialGradient id="a" cx=".15" cy=".1" r=".6"><stop offset="0" stop-color="#E0703F" stop-opacity=".55"/><stop offset="1" stop-color="#E0703F" stop-opacity="0"/></radialGradient>
        <radialGradient id="b" cx=".9" cy=".5" r=".6"><stop offset="0" stop-color="#8B5CF6" stop-opacity=".5"/><stop offset="1" stop-color="#8B5CF6" stop-opacity="0"/></radialGradient>
        <radialGradient id="c" cx=".5" cy="1" r=".5"><stop offset="0" stop-color="#F2B84B" stop-opacity=".3"/><stop offset="1" stop-color="#F2B84B" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="#0B0A0F"/>
      <rect width="${W}" height="${H}" fill="url(#a)"/><rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${H}" fill="url(#c)"/>
      <text x="${W / 2}" y="70" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="900" font-size="44" fill="#fff">Ask your circle</text>
      <text x="${W / 2}" y="118" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#F5EFE8">“${escapeXml(q)}”</text>
      ${Array.from({ length: n }, (_, i) => `<rect x="${left0 + i * (cardW + gap) - 2}" y="${top - 2}" width="${cardW + 4}" height="${cardH + 4}" rx="30" fill="#fff" fill-opacity=".12"/>`).join("")}
      <text x="${W / 2}" y="${H - 14}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#A79E96">Tap to vote · AI previews · Nyambika</text>
    </svg>`,
  );
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}"><rect width="${cardW}" height="${cardH}" rx="28" fill="#fff"/></svg>`);
  const cards = await Promise.all(
    looks.map(async (img, i) => ({
      input: await sharp(img)
        .resize({ width: cardW, height: cardH, fit: "cover", position: "top" })
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toBuffer(),
      left: left0 + i * (cardW + gap),
      top,
    })),
  );
  return sharp(bg).composite(cards).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}
