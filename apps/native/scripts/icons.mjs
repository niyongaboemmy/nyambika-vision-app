// Generates app icons and splash screens for iOS and Android from docs/nyambika_icon.png.
// Run from apps/native: `pnpm icons` (after `npx cap add`). Idempotent.
// NOTE: the source PNG is 390×362; ship a vector/1024px master before store submission (docs/native-release.md).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "../../docs/nyambika_icon.png");
const INK = { r: 11, g: 10, b: 15, alpha: 1 };
// The logo is drawn on white (its "N" stroke is white and touches the edge), so icons use a white tile.
const PAPER = { r: 255, g: 255, b: 255, alpha: 1 };

async function logo(size) {
  return sharp(SRC).resize(size, size, { fit: "contain", background: PAPER, kernel: "lanczos3" }).png().toBuffer();
}

/** Square canvas in brand ink with the logo centred at `scale` of the side. */
async function onInk(side, scale, { round = false, transparent = false } = {}) {
  const inner = Math.round(side * scale);
  const base = sharp({ create: { width: side, height: side, channels: 4, background: transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : PAPER } });
  let img = base.composite([{ input: await logo(inner), gravity: "centre" }]);
  if (round) {
    const mask = Buffer.from(`<svg width="${side}" height="${side}"><circle cx="${side / 2}" cy="${side / 2}" r="${side / 2}" fill="#fff"/></svg>`);
    img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: "dest-in" }]);
  }
  return img.png().toBuffer();
}

function out(rel, buf) {
  const p = resolve(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
}

// iOS: single 1024 icon (Xcode 14+), no alpha allowed for the App Store icon.
const ios1024 = await sharp(await onInk(1024, 0.74)).flatten({ background: PAPER }).removeAlpha().png().toBuffer();
out("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", ios1024);
const splash = await splashRect(2732, 2732);
for (const n of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) out(`ios/App/App/Assets.xcassets/Splash.imageset/${n}`, splash);

// Android launcher icons (legacy + round) and adaptive foreground (108dp canvas, 66dp safe zone).
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENS)) {
  out(`android/app/src/main/res/mipmap-${d}/ic_launcher.png`, await onInk(Math.round(48 * k), 0.78));
  out(`android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`, await onInk(Math.round(48 * k), 0.7, { round: true }));
  out(`android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, await onInk(Math.round(108 * k), 0.58, { transparent: true }));
}
out("android/app/src/main/res/values/ic_launcher_background.xml", Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n'));

async function splashRect(w, h) {
  const t = Math.round(Math.min(w, h) * (w > 2000 ? 0.16 : 0.32));
  return sharp({ create: { width: w, height: h, channels: 4, background: INK } }).composite([{ input: await tile(t), gravity: "centre" }]).png().toBuffer();
}

// Android splash (legacy drawables; Android 12+ uses the launcher icon on the windowBackground colour).
const SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
async function tile(side) {
  const r = Math.round(side * 0.23);
  const mask = Buffer.from(`<svg width="${side}" height="${side}"><rect width="${side}" height="${side}" rx="${r}" fill="#fff"/></svg>`);
  const img = await sharp({ create: { width: side, height: side, channels: 4, background: PAPER } }).composite([{ input: await logo(Math.round(side * 0.8)), gravity: "centre" }]).png().toBuffer();
  return sharp(img).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}
for (const [d, [w, h]] of Object.entries(SPLASH)) {
  out(`android/app/src/main/res/drawable-port-${d}/splash.png`, await splashRect(w, h));
  out(`android/app/src/main/res/drawable-land-${d}/splash.png`, await splashRect(h, w));
}
out("android/app/src/main/res/drawable/splash.png", await splashRect(480, 800));
console.log("icons + splash written for iOS and Android");
