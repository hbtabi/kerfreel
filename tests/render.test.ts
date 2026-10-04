import { describe, expect, it } from 'vitest';
import { buildRenderArgs, reframeFilter } from '../src/core/render.js';
import { parseSilenceLog } from '../src/core/silence.js';
import { escapeFilterPath, parseProbe, parseProgressChunk } from '../src/core/ffmpeg.js';
import { PRESETS, outputSize } from '../src/core/shared/presets.js';
import { clipFileName } from '../src/core/exporter.js';
import type { MediaInfo } from '../src/core/shared/types.js';

const media: MediaInfo = { path: 'in.mp4', duration: 120, width: 1920, height: 1080, fps: 29.97, hasAudio: true, hasVideo: true, sizeBytes: 1 };

describe('ffmpeg helpers', () => {
  it('parses silencedetect output, closing a trailing silence at the end', () => {
    const log = `
[silencedetect @ 0x1] silence_start: 1.5
[silencedetect @ 0x1] silence_end: 3.25 | silence_duration: 1.75
[silencedetect @ 0x1] silence_start: -0.01
[silencedetect @ 0x1] silence_end: 0.4 | silence_duration: 0.41
[silencedetect @ 0x1] silence_start: 9`;
    expect(parseSilenceLog(log, 10)).toEqual([
      { start: 1.5, end: 3.25 },
      { start: 0, end: 0.4 },
      { start: 9, end: 10 },
    ]);
  });

  it('parses ffprobe JSON including rotation', () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001', side_data_list: [{ rotation: -90 }] },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: { duration: '61.5', size: '1000' },
    });
    const info = parseProbe(json, 'x.mp4');
    expect(info).toMatchObject({ width: 1080, height: 1920, fps: 29.97, duration: 61.5, hasAudio: true, videoCodec: 'h264' });
  });

  it('parses -progress output', () => {
    expect(parseProgressChunk('frame=10\nout_time_us=2500000\nprogress=continue\n')).toEqual({ seconds: 2.5, done: false });
    expect(parseProgressChunk('progress=end\n').done).toBe(true);
  });

  it('escapes filter paths', () => {
    expect(escapeFilterPath("C:\\tmp\\it's.ass")).toBe("C\\:/tmp/it\\'s.ass");
  });
});

describe('render planning', () => {
  it('computes even output sizes and honours draft scale', () => {
    expect(outputSize(PRESETS.shorts, media)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(PRESETS.shorts, media, 0.25)).toEqual({ width: 270, height: 480 });
    expect(outputSize(PRESETS.original, { width: 1279, height: 721 })).toEqual({ width: 1280, height: 722 });
  });

  it('builds a single-piece graph without concat', () => {
    const args = buildRenderArgs({ input: 'in.mp4', output: 'out.mp4', media, range: { start: 10, end: 20 }, preset: PRESETS.youtube, reframe: 'center' });
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).not.toContain('concat');
    expect(graph).toContain('[0:v]trim=start=0:end=10');
    expect(graph).toContain('scale=1920:1080');
    expect(graph).toContain('loudnorm');
    expect(args).toContain('-ss');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('splits, trims and concats kept pieces for pause removal', () => {
    const args = buildRenderArgs({
      input: 'in.mp4',
      output: 'out.mp4',
      media,
      range: { start: 10, end: 20 },
      keep: [
        { start: 10, end: 12 },
        { start: 14, end: 20 },
      ],
      preset: PRESETS.shorts,
      reframe: 'motion',
      crop: [
        { t: 0, cx: 0.3 },
        { t: 4, cx: 0.7 },
      ],
      assPath: '/tmp/a b/captions.ass',
    });
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('split=2');
    expect(graph).toContain('asplit=2');
    expect(graph).toContain('concat=n=2:v=1:a=1');
    expect(graph).toContain('trim=start=4:end=10');
    expect(graph).toContain("x='clip(iw*(");
    expect(graph).toContain("ass=filename='/tmp/a b/captions.ass'");
  });

  it('supports blur-pad, letterbox and audio-less inputs', () => {
    const silent = { ...media, hasAudio: false };
    expect(reframeFilter({ media, preset: PRESETS.shorts, reframe: 'blur-pad' }, 'a', 'b')).toContain('boxblur');
    expect(reframeFilter({ media, preset: PRESETS.shorts, reframe: 'fit' }, 'a', 'b')).toContain('pad=1080:1920');
    const args = buildRenderArgs({ input: 'in.mp4', output: 'o.mp4', media: silent, range: { start: 0, end: 5 }, preset: PRESETS.square, reframe: 'center' });
    expect(args.join(' ')).not.toContain('[aout]');
    expect(args).not.toContain('-c:a');
  });

  it('names export files predictably', () => {
    expect(clipFileName({ start: 0, end: 1, title: 'Here is the SECRET!' }, 'tiktok', 2)).toBe('03-here-is-the-secret-tiktok.mp4');
  });
});
