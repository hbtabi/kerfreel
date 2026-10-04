import { describe, expect, it } from 'vitest';
import { cuesToTranscript, distributeWords, parseSubtitles, toSrt, wordsForClip } from '../src/core/shared/subtitles.js';
import { layoutCaptions, activeWordIndex } from '../src/core/shared/captionLayout.js';
import { TimeMap } from '../src/core/shared/ranges.js';

const SRT = `\uFEFF1
00:00:01,000 --> 00:00:03,500
Hello <i>there</i> world

2
00:00:05,000 --> 00:00:07,000
Second line here.
`;

const VTT = `WEBVTT

00:01.000 --> 00:02.000 align:start
First cue

00:00:03.250 --> 00:00:04.000
Second cue
`;

describe('subtitle parsing', () => {
  it('parses SRT with BOM and inline tags', () => {
    const cues = parseSubtitles(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 3.5, text: 'Hello there world' });
  });

  it('parses WebVTT short timestamps and settings', () => {
    const cues = parseSubtitles(VTT);
    expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [1, 2, 'First cue'],
      [3.25, 4, 'Second cue'],
    ]);
  });

  it('round-trips through toSrt', () => {
    const cues = parseSubtitles(SRT);
    expect(parseSubtitles(toSrt(cues))).toEqual(cues);
  });

  it('spreads cue time across words by length', () => {
    const words = distributeWords({ start: 0, end: 3, text: 'a longword b' });
    expect(words).toHaveLength(3);
    expect(words[0]!.start).toBe(0);
    expect(words[2]!.end).toBeCloseTo(3);
    expect(words[1]!.end - words[1]!.start).toBeGreaterThan(words[0]!.end - words[0]!.start);
  });

  it('retimes words onto a clip with pauses removed', () => {
    const t = cuesToTranscript(parseSubtitles(SRT));
    const map = new TimeMap([
      { start: 0.5, end: 3.6 },
      { start: 4.9, end: 7.2 },
    ]);
    const words = wordsForClip(t, { start: 0.5, end: 7.2 }, map);
    expect(words).toHaveLength(6);
    expect(words[0]!.start).toBeCloseTo(0.5);
    // "Second" starts at 5.0 in the source -> 3.1 (first piece) + 0.1
    expect(words[3]!.start).toBeCloseTo(3.2);
  });
});

describe('caption layout', () => {
  const words = [
    { start: 0, end: 0.3, text: 'one' },
    { start: 0.3, end: 0.6, text: 'two' },
    { start: 0.6, end: 0.9, text: 'three.' },
    { start: 0.9, end: 1.2, text: 'four' },
    { start: 3, end: 3.3, text: 'five' },
  ];

  it('breaks lines on sentence ends, word count and long gaps', () => {
    const lines = layoutCaptions(words, { maxWords: 4 });
    expect(lines.map((l) => l.words.map((w) => w.text).join(' '))).toEqual(['one two three.', 'four', 'five']);
    expect(lines[0]!.end).toBeLessThanOrEqual(lines[1]!.start);
  });

  it('finds the active word', () => {
    const [line] = layoutCaptions(words);
    expect(activeWordIndex(line!, 0.45)).toBe(1);
    expect(activeWordIndex(line!, -1)).toBe(-1);
  });
});
