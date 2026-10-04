import type { Range } from './types.js';

const EPS = 1e-6;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function rangeLength(r: Range): number {
  return Math.max(0, r.end - r.start);
}

export function totalLength(ranges: Range[]): number {
  return ranges.reduce((acc, r) => acc + rangeLength(r), 0);
}

/** Sort and merge ranges that overlap or sit closer than `gap` seconds. */
export function mergeRanges(ranges: Range[], gap = 0): Range[] {
  const sorted = ranges
    .filter((r) => r.end - r.start > EPS)
    .map((r) => ({ ...r }))
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + gap) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push(r);
    }
  }
  return out;
}

/** Complement of `ranges` inside [0, duration]. */
export function invertRanges(ranges: Range[], duration: number): Range[] {
  const merged = mergeRanges(ranges);
  const out: Range[] = [];
  let cursor = 0;
  for (const r of merged) {
    const s = clamp(r.start, 0, duration);
    const e = clamp(r.end, 0, duration);
    if (s > cursor + EPS) out.push({ start: cursor, end: s });
    cursor = Math.max(cursor, e);
  }
  if (duration > cursor + EPS) out.push({ start: cursor, end: duration });
  return out;
}

export interface KeepOptions {
  /** Seconds of breathing room kept on each side of speech. */
  padding?: number;
  /** Speech islands shorter than this are dropped (clicks, coughs). */
  minKeep?: number;
  /** Gaps shorter than this between kept ranges are bridged. */
  mergeGap?: number;
}

/**
 * Turn detected silences into the ranges worth keeping.
 * Padding is borrowed from the neighbouring silence so cuts never feel clipped.
 */
export function keepRanges(silences: Range[], duration: number, opts: KeepOptions = {}): Range[] {
  const padding = opts.padding ?? 0.12;
  const minKeep = opts.minKeep ?? 0.25;
  const mergeGap = opts.mergeGap ?? 0.15;
  const speech = invertRanges(silences, duration);
  const padded = speech.map((r) => ({
    start: clamp(r.start - padding, 0, duration),
    end: clamp(r.end + padding, 0, duration),
  }));
  return mergeRanges(padded, mergeGap).filter((r) => rangeLength(r) >= minKeep);
}

/** Parts of `ranges` that fall inside `window`. */
export function intersectRanges(ranges: Range[], window: Range): Range[] {
  const out: Range[] = [];
  for (const r of ranges) {
    const s = Math.max(r.start, window.start);
    const e = Math.min(r.end, window.end);
    if (e - s > EPS) out.push({ start: s, end: e });
  }
  return out;
}

export function overlap(a: Range, b: Range): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/**
 * Maps source time to output time after the gaps between `keep` ranges are removed.
 */
export class TimeMap {
  readonly pieces: { start: number; end: number; offset: number }[];
  readonly duration: number;

  constructor(keep: Range[]) {
    let acc = 0;
    this.pieces = mergeRanges(keep).map((r) => {
      const piece = { start: r.start, end: r.end, offset: acc };
      acc += r.end - r.start;
      return piece;
    });
    this.duration = acc;
  }

  /** Output time for a source time, or null when that instant was cut. */
  toOutput(t: number): number | null {
    for (const p of this.pieces) {
      if (t >= p.start - EPS && t <= p.end + EPS) return p.offset + clamp(t - p.start, 0, p.end - p.start);
    }
    return null;
  }

  /** Output time for a source time, snapping cut instants to the next kept piece. */
  toOutputSnapped(t: number): number {
    for (const p of this.pieces) {
      if (t <= p.end + EPS) return p.offset + clamp(t - p.start, 0, p.end - p.start);
    }
    return this.duration;
  }

  toSource(o: number): number {
    for (const p of this.pieces) {
      const len = p.end - p.start;
      if (o <= p.offset + len + EPS) return p.start + clamp(o - p.offset, 0, len);
    }
    const last = this.pieces[this.pieces.length - 1];
    return last ? last.end : 0;
  }
}
