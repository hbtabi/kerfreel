// Builds the static demo bundle used by GitHub Pages: a synthetic sample video, its real
// analysis and a few clips rendered by the real pipeline. Output goes to web/public/demo (gitignored).
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const core = await import(join(root, 'dist/core/index.js')).catch(() => {
  console.error('Run `npm run build:node` first.');
  process.exit(1);
});

const out = join(root, 'web/public/demo');
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'exports'), { recursive: true });

const video = join(out, 'sample.mp4');
const { srt } = await core.generateSample(video, { width: 960, height: 540 });
const analysis = await core.analyzeMedia(video, {
  options: { minClip: 6, targetClip: 10, maxClip: 16, count: 5, keywords: ['secret', 'captions'] },
  transcribe: { provider: 'srt', srtPath: srt },
});
analysis.media.path = 'sample.mp4';
await writeFile(join(out, 'analysis.json'), JSON.stringify(analysis));
await rm(srt, { force: true });

const picks = analysis.highlights.slice(0, 3);
const results = await core.exportBatch(
  { input: video, media: analysis.media, keep: analysis.keep, motion: analysis.motion, transcript: analysis.transcript },
  picks.map((h) => ({ start: h.start, end: h.end, title: h.title })),
  { ...core.DEFAULT_EXPORT_OPTIONS, presets: ['shorts', 'youtube'], scale: 0.5 },
  join(out, 'exports'),
);
const manifest = {
  exports: await Promise.all(
    results.map(async (r, i) => ({
      file: r.file.split(/[\\/]/).pop(),
      size: (await stat(r.file)).size,
      preset: r.preset,
      highlight: Math.floor(i / 2),
    })),
  ),
};
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`demo assets: ${analysis.highlights.length} highlights, ${results.length} clips → ${out}`);
