import type { Word } from './types.js';

export interface CaptionLine {
  start: number;
  end: number;
  words: Word[];
}

export interface LayoutOptions {
  maxWords?: number;
  maxChars?: number;
  /** A pause longer than this starts a new line. */
  maxGap?: number;
  /** Lines linger a little after the last word, but never overlap the next line. */
  linger?: number;
}

/** Groups timed words into short, punchy caption lines. */
export function layoutCaptions(words: Word[], opts: LayoutOptions = {}): CaptionLine[] {
  const maxWords = opts.maxWords ?? 4;
  const maxChars = opts.maxChars ?? 22;
  const maxGap = opts.maxGap ?? 0.7;
  const linger = opts.linger ?? 0.35;
  const lines: CaptionLine[] = [];
  let current: Word[] = [];

  const flush = () => {
    const first = current[0];
    const last = current[current.length - 1];
    if (first && last) lines.push({ start: first.start, end: last.end, words: current });
    current = [];
  };

  for (const w of words) {
    const prev = current[current.length - 1];
    const chars = current.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    const gap = prev ? w.start - prev.end : 0;
    const endsSentence = prev ? /[.!?…]$/.test(prev.text) : false;
    if (current.length > 0 && (current.length >= maxWords || chars > maxChars || gap > maxGap || endsSentence)) {
      flush();
    }
    current.push(w);
  }
  flush();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    const target = line.end + linger;
    line.end = next ? Math.min(target, next.start) : target;
  }
  return lines;
}

/** Index of the word being spoken at time t inside a line (-1 before the first word). */
export function activeWordIndex(line: CaptionLine, t: number): number {
  let idx = -1;
  line.words.forEach((w, i) => {
    if (t >= w.start) idx = i;
  });
  return idx;
}

export function lineAt(lines: CaptionLine[], t: number): CaptionLine | undefined {
  return lines.find((l) => t >= l.start && t < l.end);
}
