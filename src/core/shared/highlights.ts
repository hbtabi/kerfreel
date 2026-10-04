import type { EnergyTrack, Highlight, MotionTrack, Range, ScoreBreakdown, Transcript, Word } from './types.js';
import { allWords } from './subtitles.js';
import { clamp, overlap } from './ranges.js';
import { formatTime } from './format.js';

export interface HighlightInput {
  duration: number;
  energy: EnergyTrack;
  keep: Range[];
  motion?: MotionTrack;
  transcript?: Transcript;
}

export type Weights = Record<keyof Omit<ScoreBreakdown, 'llm'>, number>;

export const DEFAULT_WEIGHTS: Weights = {
  loudness: 0.22,
  dynamics: 0.14,
  speech: 0.22,
  keywords: 0.18,
  motion: 0.1,
  hook: 0.14,
};

export interface HighlightOptions {
  minClip: number;
  maxClip: number;
  targetClip: number;
  count: number;
  keywords: string[];
  weights?: Partial<Weights>;
  /** Maximum allowed overlap between picked clips, as a fraction of the shorter clip. */
  maxOverlap?: number;
}

/** Words that tend to open or anchor a good short-form moment. Lightly weighted. */
export const HOOK_LEXICON = [
  'secret',
  'mistake',
  'never',
  'always',
  'best',
  'worst',
  'why',
  'how',
  'crazy',
  'insane',
  'wow',
  'actually',
  'truth',
  'nobody',
  'everyone',
  'stop',
  'listen',
  'watch',
  'finally',
  'huge',
  'wait',
];

const FLOOR_DB = -90;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = clamp(Math.round((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[idx]!;
}

class Prefix {
  private readonly sum: Float64Array;
  private readonly sq: Float64Array;
  constructor(values: number[]) {
    this.sum = new Float64Array(values.length + 1);
    this.sq = new Float64Array(values.length + 1);
    values.forEach((v, i) => {
      this.sum[i + 1] = this.sum[i]! + v;
      this.sq[i + 1] = this.sq[i]! + v * v;
    });
  }
  stats(i0: number, i1: number): { mean: number; std: number; n: number } {
    const a = clamp(i0, 0, this.sum.length - 1);
    const b = clamp(i1, a, this.sum.length - 1);
    const n = b - a;
    if (n <= 0) return { mean: 0, std: 0, n: 0 };
    const mean = (this.sum[b]! - this.sum[a]!) / n;
    const variance = Math.max(0, (this.sq[b]! - this.sq[a]!) / n - mean * mean);
    return { mean, std: Math.sqrt(variance), n };
  }
}

function normWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

interface Candidate extends Range {
  /** Starts on a speech/sentence boundary rather than a grid point. */
  clean: boolean;
}

function candidateWindows(input: HighlightInput, opts: HighlightOptions, words: Word[]): Candidate[] {
  const { duration } = input;
  const starts = new Set<number>();
  const clean = new Set<number>();
  const ends: number[] = [];
  for (const r of input.keep) {
    starts.add(Math.round(r.start * 10) / 10);
    ends.push(r.end);
  }
  for (const s of input.transcript?.segments ?? []) {
    starts.add(Math.round(s.start * 10) / 10);
    ends.push(s.end);
  }
  // Sentence-ish boundaries from words ending with punctuation.
  words.forEach((w, i) => {
    if (/[.!?]$/.test(w.text)) {
      ends.push(w.end);
      const next = words[i + 1];
      if (next) starts.add(Math.round(next.start * 10) / 10);
    }
  });
  starts.forEach((s) => clean.add(s));
  // A coarse grid guarantees coverage for music-only or monologue sources.
  const grid = Math.max(2, opts.targetClip / 4);
  for (let t = 0; t < duration - opts.minClip; t += grid) starts.add(Math.round(t * 10) / 10);
  ends.sort((a, b) => a - b);

  let startList = [...starts].filter((s) => s >= 0 && s <= duration - Math.min(opts.minClip, duration)).sort((a, b) => a - b);
  const MAX_CANDIDATES = 1500;
  if (startList.length > MAX_CANDIDATES) {
    const stride = startList.length / MAX_CANDIDATES;
    startList = Array.from({ length: MAX_CANDIDATES }, (_, i) => startList[Math.floor(i * stride)]!);
  }

  const windows: Candidate[] = [];
  for (const s of startList) {
    const lo = s + opts.minClip;
    const hi = Math.min(duration, s + opts.maxClip);
    const target = s + opts.targetClip;
    let best: number | null = null;
    for (const e of ends) {
      if (e < lo) continue;
      if (e > hi) break;
      if (best === null || Math.abs(e - target) < Math.abs(best - target)) best = e;
    }
    const end = best ?? Math.min(duration, target);
    if (end - s >= Math.min(opts.minClip, duration) - 1e-6) windows.push({ start: s, end, clean: clean.has(s) });
  }
  return windows;
}

/**
 * Scores candidate windows by loudness, dynamics, speech density, keyword hits, motion and
 * the strength of the opening seconds, then keeps the best non-overlapping set.
 */
export function detectHighlights(input: HighlightInput, opts: HighlightOptions): Highlight[] {
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const { energy } = input;
  const hop = energy.hop || 0.25;
  const db = energy.db.length ? energy.db : [FLOOR_DB];
  const audible = db.filter((v) => v > FLOOR_DB + 1).sort((a, b) => a - b);
  const lo = percentile(audible, 0.1);
  const hi = Math.max(lo + 1, percentile(audible, 0.95));
  const ePrefix = new Prefix(db.map((v) => Math.max(v, lo - 6)));
  const motionPrefix = input.motion ? new Prefix(input.motion.amount) : null;
  const motionSorted = input.motion ? [...input.motion.amount].sort((a, b) => a - b) : [];
  const motionHi = Math.max(1e-4, percentile(motionSorted, 0.95));
  const words = allWords(input.transcript);
  const hasTranscript = words.length > 0;
  const keywords = opts.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean);
  const useKeywords = hasTranscript;
  const useMotion = !!input.motion && motionHi > 1e-3;

  const windows = candidateWindows(input, opts, words);
  const scored: Highlight[] = windows.map((w) => {
    const i0 = Math.floor(w.start / hop);
    const i1 = Math.ceil(w.end / hop);
    const e = ePrefix.stats(i0, i1);
    const loudness = clamp((e.mean - lo) / (hi - lo), 0, 1);
    const dynamics = clamp(e.std / 10, 0, 1);
    const len = w.end - w.start;
    const spoken = input.keep.reduce((acc, r) => acc + overlap(r, w), 0);
    let speech = clamp(spoken / len, 0, 1);
    const inWords = hasTranscript ? words.filter((x) => x.start >= w.start && x.end <= w.end) : [];
    if (hasTranscript) {
      const wps = inWords.length / len;
      speech = 0.5 * speech + 0.5 * clamp(wps / 2.6, 0, 1);
    }

    const hits: string[] = [];
    let hookWords = 0;
    if (useKeywords) {
      const text = ' ' + inWords.map((x) => normWord(x.text)).join(' ') + ' ';
      for (const k of keywords) {
        const needle = ' ' + k.split(/\s+/).map(normWord).join(' ') + ' ';
        let idx = text.indexOf(needle);
        while (idx !== -1) {
          hits.push(k);
          idx = text.indexOf(needle, idx + 1);
        }
      }
      const opening = inWords.slice(0, Math.max(4, Math.ceil(inWords.length * 0.25)));
      hookWords = opening.filter((x) => HOOK_LEXICON.includes(normWord(x.text)) || /[?!]$/.test(x.text)).length;
    }
    const keywordScore = keywords.length ? 1 - Math.exp(-hits.length / 1.5) : clamp(hookWords / 3, 0, 1);

    const open = ePrefix.stats(i0, Math.min(i1, i0 + Math.round(3 / hop)));
    const openLoud = clamp((open.mean - lo) / (hi - lo), 0, 1);
    const hook = hasTranscript ? 0.6 * openLoud + 0.4 * clamp(hookWords / 2, 0, 1) : openLoud;

    let motion = 0;
    if (useMotion && motionPrefix && input.motion) {
      const m = motionPrefix.stats(Math.floor(w.start / input.motion.hop), Math.ceil(w.end / input.motion.hop));
      motion = clamp(m.mean / motionHi, 0, 1);
    }

    const breakdown: ScoreBreakdown = { loudness, dynamics, speech, keywords: keywordScore, motion, hook };
    let num = 0;
    let den = 0;
    for (const key of Object.keys(weights) as (keyof Weights)[]) {
      if (key === 'keywords' && !useKeywords) continue;
      if (key === 'motion' && !useMotion) continue;
      num += weights[key] * breakdown[key];
      den += weights[key];
    }
    // Clips that open mid-sentence feel broken, so grid-aligned starts are nudged down.
    const cleanFactor = w.clean ? 1 : hasTranscript ? 0.88 : 0.97;
    const score = den > 0 ? (100 * num * cleanFactor) / den : 0;
    return {
      id: `h${Math.round(w.start * 10)}-${Math.round(w.end * 10)}`,
      start: Number(w.start.toFixed(3)),
      end: Number(w.end.toFixed(3)),
      score: Number(score.toFixed(1)),
      breakdown,
      title: '',
      keywordHits: [...new Set(hits)],
    };
  });

  scored.sort((a, b) => b.score - a.score || a.start - b.start);
  const maxOverlap = opts.maxOverlap ?? 0.25;
  const picked: Highlight[] = [];
  for (const c of scored) {
    if (picked.length >= opts.count) break;
    const clash = picked.some((p) => overlap(p, c) > maxOverlap * Math.min(p.end - p.start, c.end - c.start));
    if (!clash) picked.push(c);
  }
  return picked.map((h) => ({ ...h, title: titleFor(h, words) }));
}

function titleFor(h: Highlight, words: Word[]): string {
  const inside = words.filter((w) => w.start >= h.start && w.end <= h.end);
  if (inside.length) {
    const t = inside
      .slice(0, 7)
      .map((w) => w.text)
      .join(' ')
      .replace(/[,;:.!?]+$/, '');
    return inside.length > 7 ? `${t}…` : t;
  }
  const b = h.breakdown;
  const top = (
    Object.entries({ 'Loud peak': b.loudness, 'Big swings': b.dynamics, 'Non-stop talk': b.speech, 'High motion': b.motion }) as [string, number][]
  ).sort((x, y) => y[1] - x[1])[0]![0];
  return `${top} @ ${formatTime(h.start, 0)}`;
}
