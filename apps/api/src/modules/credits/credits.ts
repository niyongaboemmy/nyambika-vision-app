/** Pure helpers for image credits and product copy (unit-tested in credits.spec.ts). */

export interface CreditRow {
  path: string;
  assetKey: string;
  sourceIds: string[];
  title: string;
  author: string;
  sourceUrl: string;
  licence: string;
  licenceUrl: string;
  shareAlike: boolean;
  changes: string[];
  illustration: boolean;
}

/** `/api/files/public/media/x.jpg?v=1` → `public/media/x.jpg`. Only public media paths are accepted. */
export function mediaPath(src: string): string | null {
  let p = src.trim();
  try {
    if (/^https?:\/\//.test(p)) p = new URL(p).pathname;
  } catch {
    return null;
  }
  p = p.split(/[?#]/)[0].replace(/^\/?api\/files\//, "").replace(/^\/+/, "");
  if (!p.startsWith("public/") || p.includes("..")) return null;
  return p;
}

/** One entry per source set (a photo and all its cut-outs/recolours), with every change made to it. */
export function creditGroups(rows: CreditRow[]) {
  const groups = new Map<string, CreditRow & { images: number; licences: Set<string> }>();
  for (const r of rows) {
    const key = r.sourceIds.join("+");
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { ...r, changes: [...r.changes], images: 1, licences: new Set([r.licence]) });
    } else {
      g.images += 1;
      g.licences.add(r.licence);
      for (const c of r.changes) if (!g.changes.includes(c)) g.changes.push(c);
      g.illustration ||= r.illustration;
      g.shareAlike ||= r.shareAlike;
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      title: g.title,
      author: g.author,
      sourceUrl: g.sourceUrl,
      licence: g.licence,
      licenceUrl: g.licenceUrl,
      shareAlike: g.shareAlike,
      illustration: g.illustration,
      changes: g.changes,
      images: g.images,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function pickCopy<T extends { locale: string; title: string; description: string; needsReview: boolean }>(rows: T[], locale: string) {
  const want = ["rw", "en", "fr"].includes(locale) ? locale : "en";
  const row = rows.find((r) => r.locale === want) ?? rows.find((r) => r.locale === "en");
  return row ? { locale: row.locale, title: row.title, description: row.description, needsReview: row.needsReview } : null;
}
