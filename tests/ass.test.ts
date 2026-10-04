import { describe, expect, it } from 'vitest';
import { ASS_COLOURS, buildAss, escapeAssText } from '../src/core/shared/ass.js';

const words = [
  { start: 0, end: 0.4, text: 'Make' },
  { start: 0.4, end: 0.8, text: 'it' },
  { start: 0.8, end: 1.4, text: 'pop!' },
];

describe('ASS caption builder', () => {
  it('writes a valid header sized to the output', () => {
    const ass = buildAss(words, { width: 1080, height: 1920, style: 'pop' });
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toMatch(/^Style: Main,Arial,\d+,/m);
  });

  it('pop style emits one event per word with the lime highlight', () => {
    const ass = buildAss(words, { width: 1080, height: 1920, style: 'pop' });
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(events).toHaveLength(3);
    expect(events[1]).toContain(`\\c${ASS_COLOURS.lime}&`);
    expect(events[1]).toContain('Make');
    expect(events[1]).toContain('pop!');
  });

  it('karaoke style uses \\kf timing in centiseconds', () => {
    const ass = buildAss(words, { width: 1920, height: 1080, style: 'karaoke' });
    expect(ass).toContain('{\\kf40}Make');
    expect(ass).toContain('{\\kf60}pop!');
  });

  it('bounce style reveals words cumulatively', () => {
    const ass = buildAss(words, { width: 1080, height: 1920, style: 'bounce' });
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(events[0]).not.toContain('it');
    expect(events[2]).toContain('Make it');
  });

  it('supports uppercase, escaping and the none style', () => {
    expect(buildAss(words, { width: 100, height: 100, style: 'minimal', uppercase: true })).toContain('MAKE IT POP!');
    expect(buildAss(words, { width: 100, height: 100, style: 'none' })).not.toContain('Dialogue:');
    expect(escapeAssText('a{b}\\c')).toBe('a(b)/c');
  });
});
