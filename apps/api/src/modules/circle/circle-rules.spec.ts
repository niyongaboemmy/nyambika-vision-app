import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { hashId, issueDevice, MemoryCounterStore, overLimit, pollState, readDevice, VOTE_LIMITS } from "./guards";
import { labelBox, ogCard, SHARE_MAX_HEIGHT, watermark } from "./watermark";

describe("device cookie", () => {
  it("round-trips a signed id and rejects tampering or another secret", () => {
    const c = issueDevice("s1");
    const id = readDevice("s1", c);
    expect(id).toBeTruthy();
    expect(readDevice("s2", c)).toBeNull();
    expect(readDevice("s1", `${id}x.${c.split(".")[1]}`)).toBeNull();
    expect(readDevice("s1", "garbage")).toBeNull();
    expect(readDevice("s1", undefined)).toBeNull();
  });

  it("stores only salted hashes", () => {
    expect(hashId("s", "ip", "1.2.3.4")).not.toContain("1.2.3.4");
    expect(hashId("s", "ip", "1.2.3.4")).toBe(hashId("s", "ip", "1.2.3.4"));
    expect(hashId("s", "ip", "1.2.3.4")).not.toBe(hashId("s", "device", "1.2.3.4"));
  });
});

describe("rate limiting", () => {
  it("allows a burst up to the limit per device, then blocks until the window resets", async () => {
    let t = 0;
    const store = new MemoryCounterStore(() => t);
    const limits = VOTE_LIMITS("poll", "ip", "dev");
    for (let i = 0; i < 6; i++) expect(await overLimit(store, limits)).toBeNull();
    expect((await overLimit(store, limits))?.key).toBe("vote:dev:poll:dev");
    t += 601_000;
    expect(await overLimit(store, limits)).toBeNull();
  });

  it("caps one connection voting from many devices", async () => {
    const store = new MemoryCounterStore();
    let blocked = 0;
    for (let i = 0; i < 40; i++) if (await overLimit(store, VOTE_LIMITS("poll", "same-ip", `dev${i}`))) blocked++;
    expect(blocked).toBe(10); // 30 per IP per poll per 10 minutes
  });
});

describe("poll state", () => {
  const now = new Date("2026-11-11T10:00:00Z");
  it("is open until it expires, and revocation wins", () => {
    expect(pollState({ expiresAt: new Date(now.getTime() + 1000), revokedAt: null }, now)).toBe("OPEN");
    expect(pollState({ expiresAt: now, revokedAt: null }, now)).toBe("EXPIRED");
    expect(pollState({ expiresAt: new Date(now.getTime() + 1000), revokedAt: now }, now)).toBe("REVOKED");
  });
});

describe("watermark", () => {
  const plain = () => sharp({ create: { width: 720, height: 1280, channels: 3, background: { r: 60, g: 140, b: 200 } } }).png().toBuffer();

  it("draws a visible label and mark on a downscaled copy and leaves the original untouched", async () => {
    const original = await plain();
    const before = Buffer.from(original);
    const out = await watermark(original);
    expect(original.equals(before)).toBe(true);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.height).toBe(SHARE_MAX_HEIGHT);
    expect(meta.width).toBe(540);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const box = labelBox(info.width, info.height);
    // Inside the label: dark pill, far from the source blue; the top-left corner stays untouched.
    let changed = 0;
    let total = 0;
    for (let y = box.y + 2; y < box.y + box.h - 2; y += 3)
      for (let x = box.x + 2; x < box.x + box.w - 2; x += 3) {
        total++;
        const [r, g, b] = px(x, y);
        if (Math.abs(r - 60) + Math.abs(g - 140) + Math.abs(b - 200) > 60) changed++;
      }
    expect(changed / total).toBeGreaterThan(0.9);
    const [r, g, b] = px(10, 10);
    expect(Math.abs(r - 60) + Math.abs(g - 140) + Math.abs(b - 200)).toBeLessThan(12);
    // Some label pixels are near-white text.
    let white = 0;
    for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) if (px(x, y).every((c) => c > 200)) white++;
    expect(white).toBeGreaterThan(20);
    // Nyambika mark: bottom-right corner is changed too.
    const [mr, mg, mb] = px(info.width - Math.round(30 * box.s), info.height - Math.round(5 * box.s) - Math.round(box.h / 2));
    expect(Math.abs(mr - 60) + Math.abs(mg - 140) + Math.abs(mb - 200)).toBeGreaterThan(40);
  });

  it("builds a 1200×630 preview card for WhatsApp", async () => {
    const looks = [await watermark(await plain()), await watermark(await plain())];
    const og = await ogCard('Which one for Saturday? <script>"', looks);
    const meta = await sharp(og).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1200, 630]);
  });
});
