/**
 * Glyphs not drawn by the core routes at load (see icons.tsx). Loaded on demand by <LazyIcon> and prefetched after
 * the load event, so they cost nothing on sign in, Maker Space or Looks. Same SF-like style: 1.75 px, round caps.
 */
import { corePath } from "./icons";

export const EXTRA_PATHS = {
  more: "M5 12h.01M12 12h.01M19 12h.01",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2",
  download: "M12 3v12M7 10l5 5 5-5M4 21h16",
  flag: "M4 21V4M4 4h12l-2 4 2 4H4",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  truck: "M3 6h11v10H3zM14 9h4l3 3v4h-7M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3",
  logout: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3",
  upload: "M12 21V9M7 14l5-5 5 5M4 3h16",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M21 21l-4.3-4.3",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  call: "M5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5 5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5.5a2 2 0 0 1 2-2",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  link: "M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  thumbsUp: "M7 10v10H4V10zM7 10l4-7a2 2 0 0 1 2.5 2.2L13 9h5.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.1 20H7",
  thumbsDown: "M7 14V4H4v10zM7 14l4 7a2 2 0 0 0 2.5-2.2L13 15h5.5a2 2 0 0 0 2-2.4l-1.4-7A2 2 0 0 0 17.1 4H7",
  fire: "M12 21a6.5 6.5 0 0 0 6.5-6.5c0-4-3-6-4-9.5-2.5 1.5-3.5 4-3.5 6-1-.5-2-1.5-2-3-2 1.5-3.5 4-3.5 6.5A6.5 6.5 0 0 0 12 21",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3",
  wrench: "M15 4a5 5 0 0 0-4.6 6.9l-6.9 6.9a1.8 1.8 0 0 0 2.6 2.6l6.9-6.9A5 5 0 0 0 20 9l-3 3-3-1-1-3 3-3a5 5 0 0 0-1-1",
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  minus: "M5 12h14",
  smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01",
  clap: "M8 12.5 5 9.5a1.4 1.4 0 0 1 2-2l4 4M9.5 8 7 5.5a1.4 1.4 0 0 1 2-2l5.5 5.5M13 6.5l-1-1a1.4 1.4 0 0 1 2-2l4.5 4.5a6 6 0 0 1 0 8.5l-1 1a6 6 0 0 1-8.5 0L4.5 13a1.4 1.4 0 0 1 2-2L9 13.5M18.5 2.5l1-1M21 5.5l1.5-.5",
  wand: "M4 20 15 9M15 9l2-2M18 3v2M21 6h-2M20.5 3.5l-1.3 1.3M13 4v1.5M20 11h-1.5",
  leaf: "M5 19C5 10 10 5 20 4c-1 10-6 15-15 15M5 19l7-7",
  filter: "M4 6h16M7 12h10M10 18h4",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4",
} as const;

export type ExtraIconName = keyof typeof EXTRA_PATHS;

/** Path data for any glyph, core or extra (canvas/WebGL drawing, e.g. VR reaction sprites). */
export const anyIconPath = (name: string): string => corePath(name) ?? (EXTRA_PATHS as Record<string, string>)[name] ?? "";
