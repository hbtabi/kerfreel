import type { Highlight, Range } from './shared';

export interface ClipItem {
  id: string;
  start: number;
  end: number;
  title: string;
  score?: number;
  highlight?: Highlight;
  custom?: boolean;
}

/** Highlights plus user overrides (trims) and custom ranges, in display order. */
export function mergeClips(highlights: Highlight[], trims: Record<string, Range>, custom: ClipItem[]): ClipItem[] {
  const fromHighlights = highlights.map<ClipItem>((h) => ({
    id: h.id,
    start: trims[h.id]?.start ?? h.start,
    end: trims[h.id]?.end ?? h.end,
    title: h.title,
    score: h.score,
    highlight: h,
  }));
  const customItems = custom.map((c) => ({ ...c, start: trims[c.id]?.start ?? c.start, end: trims[c.id]?.end ?? c.end }));
  return [...fromHighlights, ...customItems];
}

/** Next kept instant at or after t, for live "skip pauses" preview. Returns null when t is already kept. */
export function skipTarget(keep: Range[], t: number): number | null {
  for (const r of keep) {
    if (t < r.start - 0.03) return r.start;
    if (t <= r.end) return null;
  }
  return null;
}
