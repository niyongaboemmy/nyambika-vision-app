/**
 * Line icon set shared by shopper, studio and admin screens (24 px grid, currentColor stroke).
 * Kept free of other imports so any route can use <Icon> without pulling a component kit along.
 * iOS-style pass: SF Symbols-like, rounded caps/joins, 1.75 px stroke, `.fill` variants; replaces every emoji icon.
 */

import { LazyIcon } from "./icons-lazy";
import type { ExtraIconName } from "./icons-extra";

const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  hanger: "M12 7a2 2 0 1 1 2-2M12 7v1.5L3.6 15a1.5 1.5 0 0 0 .9 2.7h15a1.5 1.5 0 0 0 .9-2.7L12 8.5",
  inbox: "M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z",
  users: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15 4.15a3.5 3.5 0 0 1 0 6.7",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1",
  plus: "M12 5v14M5 12h14",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0",
  camera: "M3 8a2 2 0 0 1 2-2h2l2-3h6l2 3h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10M9 12l2 2 4-4",
  wallet: "M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7M16 14h.01",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  swap: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  store: "M4 9.5V20h16V9.5M3 4h18l-1.5 5.5a2.5 2.5 0 0 1-4.75.5 2.5 2.5 0 0 1-4.75 0 2.5 2.5 0 0 1-4.75-.5zM10 20v-5h4v5",
  palette: "M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-4 3.5h-1.5a1.5 1.5 0 0 0-1 2.6A1.7 1.7 0 0 1 12 21M7.5 11h.01M10.5 7h.01M15 7.5h.01",
  copy: "M8 8h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1zM16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3",
  server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  layers: "M12 3 2 8l10 5 10-5zM2 13l10 5 10-5",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  // UI/UX modernisation: shared with shopper screens (controls use SVG icons; emoji stay as expressive content).
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1.5v2M12 20.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M1.5 12h2M20.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4",
  moon: "M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  mic: "M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3M19 11a7 7 0 0 1-14 0M12 18v3",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  menu: "M4 7h16M4 12h16M4 17h16",
  volume: "M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  mute: "M4 9v6h4l5 4V5L8 9zM17 9l5 5M22 9l-5 5",
  heart: "M12 20s-7.5-4.6-9.3-9.1A5 5 0 0 1 12 6a5 5 0 0 1 9.3 4.9C19.5 15.4 12 20 12 20",
  bag: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
  ruler: "M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2",
  cube: "M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10",
  mirror: "M12 3c3.9 0 7 3.6 7 8s-3.1 8-7 8-7-3.6-7-8 3.1-8 7-8M12 19v3M8 22h8",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 8h.01",
  needle: "M20 4 9 15M7 17l-3 3M14 4h6v6M9 15l-2 2 1 1",
  // iOS-style pass: glyphs that replace every emoji used as an icon (SF Symbols-like, rounded, 1.75 px stroke).
  play: "M7.5 4.8v14.4a.9.9 0 0 0 1.4.8l11.2-7.2a.9.9 0 0 0 0-1.6L8.9 4a.9.9 0 0 0-1.4.8",
  pause: "M8 5v14M16 5v14",
  phone: "M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5M11 18.5h2",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  chat: "M20 11.5a8 7.5 0 0 1-11.6 6.7L4 19.5l1.3-3.8A7.5 7.5 0 1 1 20 11.5",
  pin: "M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  key: "M14.5 14a5 5 0 1 0-4.6-3L3 17.9V21h3v-2h2v-2h2l1.9-1.9a5 5 0 0 0 2.6.9M16.5 7.5h.01",
  hand: "M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10.5v-5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3.5 15a1.5 1.5 0 0 1 2.3-1.9L8 15",
  headset: "M3 9.5A2.5 2.5 0 0 1 5.5 7h13A2.5 2.5 0 0 1 21 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-3l-2-2.5h-3L8.5 17h-3A2.5 2.5 0 0 1 3 14.5z",
  dress: "M9 3l1 3h4l1-3M10 6l-1 5h6l-1-5M9 11l-4 10h14l-4-10",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4.5 20.5a7.5 7.5 0 0 1 15 0",
  person: "M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4M9.5 21v-6.5L8 13.5V10a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3.5l-1.5 1V21",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01",
  video: "M3 6.5A1.5 1.5 0 0 1 4.5 5h9A1.5 1.5 0 0 1 15 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 17.5zM15 10.5 21 7v10l-6-3.5",
  ring: "M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12M9.5 9.5 8 5l2-2h4l2 2-1.5 4.5",
  gift: "M4 10h16v4H4zM5.5 14h13v7h-13zM12 10v11M12 10S10.5 5 8 5.5 7 9 12 10M12 10s1.5-5 4-4.5S17 9 12 10",
  crown: "M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z",
  hourglass: "M6 3h12M6 21h12M7 3c0 4 5 5.5 5 9s-5 5-5 9M17 3c0 4-5 5.5-5 9s5 5 5 9",
  ticket: "M3 6h18v3.5a2.5 2.5 0 0 0 0 5V18H3v-3.5a2.5 2.5 0 0 0 0-5zM14.5 6v12",
  signal: "M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01",
  sunrise: "M3 18h18M7 18a5 5 0 0 1 10 0M12 4v4M5 9.5 6.5 11M19 9.5 17.5 11M2 14h2M20 14h2",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8 12.5l2.7 2.7L16 9.5",
  eyeOff: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  moto: "M2.5 17.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M16.5 17.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M5 15h4.5l3-5h3l3.5 7.5M14 5.5h2.5l1 4.5",
  rotate: "M3 12a9 9 0 0 1 15.5-6.2M21 12a9 9 0 0 1-15.5 6.2M18.5 2.5v3.3h-3.3M5.5 21.5v-3.3h3.3",
  move: "M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5",
  tag: "M3 12V4h8l10 10-8 8zM7.5 8.5h.01",
  cash: "M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 10v.01M18 14v.01",
  send: "M21 3 10 14M21 3l-7 18-4-7-7-4z",
} as const;

type CoreName = keyof typeof PATHS;
export type IconName = CoreName | ExtraIconName;

/** Core glyphs are inline (everything the core routes draw at load); the rest live in icons-extra.ts and load on
 *  demand (prefetched after the load event by DeferredGlobals), keeping sign in, Maker Space and Looks ≤ budget. */
const isCore = (n: IconName): n is CoreName => n in PATHS;

/** Raw path data of a core glyph (canvas/WebGL); for any glyph use `anyIconPath` from icons-extra.ts. */
export const corePath = (name: string): string | undefined => (PATHS as Record<string, string>)[name];

/** Glyphs that look right filled (SF "fill" variants for selected tabs, saved hearts, ratings). */
const FILLABLE = new Set<IconName>(["heart", "star", "home", "bell", "bag", "play", "user", "chat", "pin", "bulb", "thumbsUp", "fire", "tag", "headset"]);

/** One icon system for shopper, studio and admin: SF Symbols-like, rounded caps/joins, 1.75 px stroke.
 *  `filled` gives the SF ".fill" look on glyphs that support it (selected tab, saved heart). */
export function Icon({ name, className = "size-5", filled = false }: { name: IconName; className?: string; filled?: boolean }) {
  const fill = filled && FILLABLE.has(name);
  if (!isCore(name)) return <LazyIcon name={name} className={className} fill={fill} />;
  return (
    <svg viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}
