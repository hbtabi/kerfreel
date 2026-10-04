import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { analyzeMedia, exportBatch, ffmpegVersion, generateSample, probe, renderClip, DEFAULT_EXPORT_OPTIONS, type Analysis } from '../src/core/index.js';
import { startServer } from '../src/server/index.js';
import type { JobQueue } from '../src/server/jobs.js';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('end-to-end with ffmpeg', () => {
  let dir: string;
  let video: string;
  let srt: string;
  let analysis: Analysis;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kerfreel-test-'));
    const res = await generateSample(join(dir, 'sample.mp4'), { duration: 21, width: 640, height: 360, fps: 24 });
    video = res.video;
    srt = res.srt;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports an ffmpeg version', async () => {
    expect(await ffmpegVersion()).toBeTruthy();
  });

  it('generates a synthetic sample with audio, video and captions', async () => {
    const info = await probe(video);
    expect(info.width).toBe(640);
    expect(info.height).toBe(360);
    expect(info.hasAudio).toBe(true);
    expect(info.duration).toBeGreaterThan(20);
    expect(await readFile(srt, 'utf8')).toContain('-->');
  });

  it('finds the scripted pauses, a transcript and ranked highlights', async () => {
    analysis = await analyzeMedia(video, {
      options: { minClip: 3, targetClip: 5, maxClip: 8, count: 3, keywords: ['secret'] },
      transcribe: { provider: 'srt', srtPath: srt },
    });
    // The 21s script has 8 lines separated by 7 gaps, several longer than the 0.6s threshold.
    expect(analysis.silences.length).toBeGreaterThanOrEqual(3);
    expect(analysis.stats.silenceSeconds).toBeGreaterThan(2);
    expect(analysis.transcript?.source).toBe('srt');
    expect(analysis.motion?.cx.length).toBeGreaterThan(10);
    expect(analysis.highlights.length).toBeGreaterThan(0);
    // The loud "secret" line (5.7s-7.6s at this length) should land in the top pick.
    const top = analysis.highlights[0]!;
    expect(top.start).toBeLessThan(7.6);
    expect(top.end).toBeGreaterThan(5.7);
  });

  it('exports a vertical clip with captions and a widescreen clip', async () => {
    const top = analysis.highlights[0]!;
    const out = join(dir, 'exports');
    const results = await exportBatch(
      { input: video, media: analysis.media, keep: analysis.keep, motion: analysis.motion, transcript: analysis.transcript },
      [{ start: top.start, end: top.end, title: top.title }],
      { ...DEFAULT_EXPORT_OPTIONS, presets: ['shorts', 'youtube'], scale: 0.25 },
      out,
    );
    expect(results).toHaveLength(2);
    const vertical = await probe(results[0]!.file);
    expect([vertical.width, vertical.height]).toEqual([270, 480]);
    expect(vertical.hasAudio).toBe(true);
    const wide = await probe(results[1]!.file);
    expect([wide.width, wide.height]).toEqual([480, 270]);
  });

  it('removes pauses from a whole video (jump cut)', async () => {
    const res = await renderClip(
      { input: video, media: analysis.media, keep: analysis.keep },
      { start: 0, end: analysis.media.duration },
      'original',
      { ...DEFAULT_EXPORT_OPTIONS, captionStyle: 'none', scale: 0.5, normalizeAudio: false },
      join(dir, 'cut.mp4'),
    );
    const info = await probe(res.file);
    expect(info.duration).toBeLessThan(analysis.media.duration - 2);
    expect(Math.abs(info.duration - analysis.stats.keptSeconds)).toBeLessThan(0.6);
  });

  describe('HTTP API', () => {
    let server: Server;
    let url: string;
    let jobs: JobQueue;

    beforeAll(async () => {
      const s = await startServer({ port: 0, dataDir: join(dir, 'data') });
      server = s.server;
      url = s.url;
      jobs = s.jobs;
    });

    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it('serves health, creates a sample project, analyses and exports it', async () => {
      const health = (await (await fetch(`${url}/api/health`)).json()) as { ok: boolean; ffmpeg: string };
      expect(health.ok).toBe(true);

      const p = (await (await fetch(`${url}/api/projects/sample?duration=14`, { method: 'POST' })).json()) as { id: string; hasSubtitles: boolean };
      expect(p.hasSubtitles).toBe(true);

      const media = await fetch(`${url}/api/projects/${p.id}/media`, { headers: { Range: 'bytes=0-99' } });
      expect(media.status).toBe(206);

      const aj = (await (
        await fetch(`${url}/api/projects/${p.id}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ options: { minClip: 3, targetClip: 4, maxClip: 6, count: 2 } }),
        })
      ).json()) as { id: string };
      await jobs.idle();
      const aDone = (await (await fetch(`${url}/api/jobs/${aj.id}`)).json()) as { status: string; error?: string };
      expect(aDone.error).toBeUndefined();
      expect(aDone.status).toBe('done');

      const detail = (await (await fetch(`${url}/api/projects/${p.id}`)).json()) as { analysis: Analysis };
      const h = detail.analysis.highlights[0]!;
      const ej = (await (
        await fetch(`${url}/api/projects/${p.id}/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clips: [{ start: h.start, end: h.end, title: 'api clip' }],
            options: { presets: ['square'], scale: 0.2, captionStyle: 'karaoke' },
          }),
        })
      ).json()) as { id: string };
      await jobs.idle();
      const eDone = (await (await fetch(`${url}/api/jobs/${ej.id}`)).json()) as { status: string; error?: string; result: { file: string }[] };
      expect(eDone.error).toBeUndefined();
      expect(eDone.result[0]!.file).toBe('01-api-clip-square.mp4');
      const dl = await fetch(`${url}/api/projects/${p.id}/exports/01-api-clip-square.mp4`);
      expect(dl.status).toBe(200);
      expect(Number(dl.headers.get('content-length'))).toBeGreaterThan(1000);
    });

    it('rejects bad input', async () => {
      expect((await fetch(`${url}/api/projects/..%2F..%2Fetc`)).status).toBe(400);
      expect((await fetch(`${url}/api/projects/abcdef-123456`)).status).toBe(404);
      const bad = await fetch(`${url}/api/projects/upload?name=evil.exe`, { method: 'POST', body: 'x' });
      expect(bad.status).toBe(415);
    });
  });
});
