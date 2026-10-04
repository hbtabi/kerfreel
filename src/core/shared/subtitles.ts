import type { Range, Transcript, TranscriptSegment, Word } from './types.js';
import type { TimeMap } from './ranges.js';

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const TS = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})|(\d{1,2}):(\d{2})[,.](\d{1,3})/;

function parseTimestamp(raw: string): number | null {
  const m = TS.exec(raw.trim());
  if (!m) return null;
  if (m[1] !== undefined) {
    const ms = Number((m[4] ?? '0').padEnd(3, '0'));
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
  }
  const ms = Number((m[7] ?? '0').padEnd(3, '0'));
  return Number(m[5]) * 60 + Number(m[6]) + ms / 1000;
}

/** Parses SRT and WebVTT. Tolerates missing indices, CRLF, BOMs and inline tags. */
export function parseSubtitles(input: string): Cue[] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) continue;
    const [a, b] = (lines[arrowIdx] ?? '').split('-->');
    const start = parseTimestamp(a ?? '');
    const end = parseTimestamp((b ?? '').trim().split(/\s+/)[0] ?? '');
    if (start === null || end === null || end <= start) continue;
    const body = lines
      .slice(arrowIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

function srtTime(t: number): string {
  const ms = Math.round(Math.max(0, t) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

/**
 * Splits a cue into words and spreads the cue's time across them, weighted by word length.
 * Good enough for word-by-word highlighting when the source has no word timestamps.
 */
export function distributeWords(cue: Cue): Word[] {
  const tokens = cue.text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const weights = tokens.map((t) => Math.max(2, t.replace(/[^\p{L}\p{N}]/gu, '').length + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = cue.end - cue.start;
  let cursor = cue.start;
  return tokens.map((text, i) => {
    const dur = (span * (weights[i] ?? 1)) / total;
    const w = { start: cursor, end: cursor + dur, text };
    cursor += dur;
    return w;
  });
}

export function cuesToTranscript(cues: Cue[]): Transcript {
  return {
    source: 'srt',
    segments: cues.map((c) => ({ start: c.start, end: c.end, text: c.text, words: distributeWords(c) })),
  };
}

export function allWords(transcript: Transcript | undefined): Word[] {
  if (!transcript) return [];
  return transcript.segments.flatMap((s) => (s.words.length ? s.words : distributeWords(s)));
}

export function transcriptText(transcript: Transcript | undefined, range?: Range): string {
  if (!transcript) return '';
  return allWords(transcript)
    .filter((w) => !range || (w.start >= range.start - 0.05 && w.end <= range.end + 0.05))
    .map((w) => w.text)
    .join(' ');
}

/**
 * Words inside `range`, re-timed onto the exported clip's timeline.
 * Words that fall entirely inside removed pauses are dropped.
 */
export function wordsForClip(transcript: Transcript | undefined, range: Range, map: TimeMap): Word[] {
  const out: Word[] = [];
  for (const w of allWords(transcript)) {
    const mid = (w.start + w.end) / 2;
    if (mid < range.start || mid > range.end) continue;
    const start = map.toOutput(Math.max(w.start, range.start));
    const end = map.toOutput(Math.min(w.end, range.end));
    const s = start ?? map.toOutputSnapped(w.start);
    const e = end ?? map.toOutputSnapped(w.end);
    if (start === null && end === null && map.toOutput(mid) === null) continue;
    out.push({ start: s, end: Math.max(e, s + 0.08), text: w.text });
  }
  return out;
}

export function segmentsInRange(transcript: Transcript | undefined, range: Range): TranscriptSegment[] {
  if (!transcript) return [];
  return transcript.segments.filter((s) => s.end > range.start && s.start < range.end);
}
