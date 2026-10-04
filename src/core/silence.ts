import { FFMPEG, run } from './ffmpeg.js';
import type { Range } from './shared/types.js';

/** Parses ffmpeg `silencedetect` log lines into silence ranges. */
export function parseSilenceLog(log: string, duration?: number): Range[] {
  const re = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g;
  const out: Range[] = [];
  let open: number | null = null;
  for (const m of log.matchAll(re)) {
    const t = Math.max(0, Number(m[2]));
    if (m[1] === 'start') open = t;
    else if (open !== null) {
      if (t > open) out.push({ start: open, end: t });
      open = null;
    }
  }
  if (open !== null && duration !== undefined && duration > open) out.push({ start: open, end: duration });
  return out;
}

export interface SilenceOptions {
  noiseDb?: number;
  minSilence?: number;
  signal?: AbortSignal;
}

export async function detectSilences(file: string, duration: number, opts: SilenceOptions = {}): Promise<Range[]> {
  const n = opts.noiseDb ?? -35;
  const d = opts.minSilence ?? 0.6;
  const { stderr } = await run(
    FFMPEG,
    ['-hide_banner', '-nostats', '-i', file, '-vn', '-sn', '-dn', '-af', `silencedetect=noise=${n}dB:duration=${d}`, '-f', 'null', '-'],
    { signal: opts.signal },
  );
  return parseSilenceLog(stderr, duration);
}
