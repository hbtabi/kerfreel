import { describe, expect, it } from 'vitest';
import { detectHighlights } from '../src/core/shared/highlights.js';
import { cuesToTranscript } from '../src/core/shared/subtitles.js';
import type { EnergyTrack, Range } from '../src/core/shared/types.js';

/** 60s of audio: quiet talk, one loud dense burst at 30-40s, silence elsewhere. */
function fixture(): { energy: EnergyTrack; keep: Range[] } {
  const hop = 0.25;
  const db: number[] = [];
  for (let i = 0; i < 240; i++) {
    const t = i * hop;
    if (t >= 30 && t < 40) db.push(-12 + 6 * Math.sin(i));
    else if ((t >= 5 && t < 15) || (t >= 45 && t < 55)) db.push(-30 + Math.sin(i));
    else db.push(-90);
  }
  return {
    energy: { hop, db },
    keep: [
      { start: 5, end: 15 },
      { start: 30, end: 40 },
      { start: 45, end: 55 },
    ],
  };
}

const opts = { minClip: 8, maxClip: 14, targetClip: 10, count: 3, keywords: [] as string[] };

describe('highlight detection', () => {
  it('ranks the loud, dense section first', () => {
    const { energy, keep } = fixture();
    const hs = detectHighlights({ duration: 60, energy, keep }, opts);
    expect(hs.length).toBeGreaterThan(0);
    expect(hs[0]!.start).toBeGreaterThanOrEqual(28);
    expect(hs[0]!.end).toBeLessThanOrEqual(44);
    expect(hs[0]!.score).toBeGreaterThan(hs[hs.length - 1]!.score - 1e-9);
  });

  it('never returns overlapping picks and respects length bounds', () => {
    const { energy, keep } = fixture();
    const hs = detectHighlights({ duration: 60, energy, keep }, { ...opts, count: 5 });
    for (const h of hs) {
      expect(h.end - h.start).toBeGreaterThanOrEqual(opts.minClip - 1e-6);
      expect(h.end - h.start).toBeLessThanOrEqual(opts.maxClip + 1e-6);
    }
    for (let i = 0; i < hs.length; i++)
      for (let j = i + 1; j < hs.length; j++) {
        const ov = Math.max(0, Math.min(hs[i]!.end, hs[j]!.end) - Math.max(hs[i]!.start, hs[j]!.start));
        expect(ov).toBeLessThanOrEqual(0.25 * Math.min(hs[i]!.end - hs[i]!.start, hs[j]!.end - hs[j]!.start) + 1e-6);
      }
  });

  it('boosts windows containing keywords when a transcript exists', () => {
    const hop = 0.25;
    const db = Array.from({ length: 240 }, () => -25);
    const keep = [{ start: 0, end: 60 }];
    const transcript = cuesToTranscript([
      { start: 2, end: 8, text: 'just some ordinary chatter about nothing much' },
      { start: 44, end: 50, text: 'and here comes the giveaway everyone wanted' },
    ]);
    const hs = detectHighlights({ duration: 60, energy: { hop, db }, keep, transcript }, { ...opts, count: 1, keywords: ['giveaway'] });
    expect(hs[0]!.keywordHits).toEqual(['giveaway']);
    expect(hs[0]!.start).toBeLessThanOrEqual(44);
    expect(hs[0]!.end).toBeGreaterThanOrEqual(50);
    expect(hs[0]!.title).toMatch(/giveaway|here comes/);
  });

  it('is deterministic', () => {
    const { energy, keep } = fixture();
    expect(detectHighlights({ duration: 60, energy, keep }, opts)).toEqual(detectHighlights({ duration: 60, energy, keep }, opts));
  });
});
