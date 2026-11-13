/**
 * Twin follow-through (navigation & workflow pass): after a shopper makes a twin and comes back to a Looks
 * session, the looks already rendered on an AI model re-render on the twin. The look on screen goes first, then
 * its neighbours, nearest first and forward before backward. Looks the shopper never reached stay unrendered:
 * progressive generation renders them on the twin when they are reached. Pure, so it is unit-tested.
 */
export const RETWIN_WINDOW = { behind: 1, ahead: 2 } as const;

export interface RetwinCandidate {
  id: string;
  /** Position in the session (rank order). */
  index: number;
  /** The look has a generation (it was rendered, on a model or an older twin). */
  rendered: boolean;
  /** That generation's cache key starts with the current twin key. */
  onCurrentTwin: boolean;
}

/** The stale looks to re-render around `index`, in the order they should be queued. */
export function retwinOrder(looks: RetwinCandidate[], index: number, window: { behind: number; ahead: number } = RETWIN_WINDOW): string[] {
  const at = Math.max(0, Math.floor(index));
  return looks
    .filter((l) => l.rendered && !l.onCurrentTwin && l.index >= at - window.behind && l.index <= at + window.ahead)
    .map((l) => ({ id: l.id, d: l.index - at }))
    // 0, +1, -1, +2, -2…: on screen first, then the next look the shopper will swipe to.
    .sort((a, b) => Math.abs(a.d) - Math.abs(b.d) || b.d - a.d)
    .map((l) => l.id);
}

/** Cache-key prefix of the shopper's current twin (generation.service.ts builds `${twin.id}:v${version}|…`). */
export function twinKeyPrefix(twin: { id: string; version: number } | null): string | null {
  return twin ? `${twin.id}:v${twin.version}|` : null;
}
