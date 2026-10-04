#!/usr/bin/env node
import { Command, Option } from 'commander';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  analyzeMedia,
  buildAss,
  DEFAULT_ANALYSIS_OPTIONS,
  DEFAULT_EXPORT_OPTIONS,
  exportBatch,
  ffmpegVersion,
  formatDuration,
  formatTime,
  generateSample,
  loadSubtitleFile,
  localWhisperAvailable,
  PRESET_IDS,
  renderClip,
  type Analysis,
  type CaptionStyleId,
  type ExportOptions,
  type PresetId,
  type ReframeMode,
} from '../core/index.js';
import { VERSION } from '../version.js';

// Pick up a local .env (OPENAI_API_KEY etc.) without extra dependencies.
try {
  if (existsSync('.env')) process.loadEnvFile('.env');
} catch {
  /* malformed .env: ignore and rely on the real environment */
}

const program = new Command();
const STYLES: CaptionStyleId[] = ['pop', 'karaoke', 'glow', 'bounce', 'minimal', 'none'];
const REFRAMES: ReframeMode[] = ['motion', 'center', 'blur-pad', 'fit'];

const ink = (s: string) => (process.stdout.isTTY ? `\x1b[38;2;200;255;61m${s}\x1b[0m` : s);
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

function bar(p: number, width = 24): string {
  const filled = Math.round(p * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${(p * 100).toFixed(0).padStart(3)}%`;
}

function progressLine(text: string): void {
  if (process.stderr.isTTY) process.stderr.write(`\r\x1b[2K${text}`);
}

function endProgress(): void {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
}

function list(v: string): string[] {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function presetsOpt(v: string): PresetId[] {
  const ids = list(v);
  for (const id of ids) if (!PRESET_IDS.includes(id as PresetId)) throw new Error(`Unknown preset "${id}". Use: ${PRESET_IDS.join(', ')}`);
  return ids as PresetId[];
}

interface AnalyzeFlags {
  srt?: string;
  transcribe: 'auto' | 'openai' | 'local' | 'none';
  keywords?: string[];
  count: string;
  min: string;
  max: string;
  target: string;
  noise: string;
  minSilence: string;
  padding: string;
  llm?: boolean;
  motion: boolean;
  language?: string;
}

function addAnalyzeFlags(cmd: Command): Command {
  return cmd
    .option('--srt <file>', 'use an existing SRT/VTT for captions and keyword scoring (fully offline)')
    .addOption(new Option('--transcribe <provider>', 'transcription route when no --srt is given').choices(['auto', 'openai', 'local', 'none']).default('auto'))
    .option('--language <code>', 'spoken language hint for transcription, e.g. en')
    .option('-k, --keywords <list>', 'comma-separated keywords that boost a moment', list)
    .option('-n, --count <n>', 'number of highlights to find', String(DEFAULT_ANALYSIS_OPTIONS.count))
    .option('--min <seconds>', 'shortest clip', String(DEFAULT_ANALYSIS_OPTIONS.minClip))
    .option('--max <seconds>', 'longest clip', String(DEFAULT_ANALYSIS_OPTIONS.maxClip))
    .option('--target <seconds>', 'preferred clip length', String(DEFAULT_ANALYSIS_OPTIONS.targetClip))
    .option('--noise <dB>', 'silence threshold in dBFS', String(DEFAULT_ANALYSIS_OPTIONS.noiseDb))
    .option('--min-silence <seconds>', 'shortest pause that gets cut', String(DEFAULT_ANALYSIS_OPTIONS.minSilence))
    .option('--padding <seconds>', 'breathing room kept around speech', String(DEFAULT_ANALYSIS_OPTIONS.padding))
    .option('--llm', 'rerank highlights with an OpenAI-compatible chat model (needs OPENAI_API_KEY)')
    .option('--no-motion', 'skip motion analysis (faster, disables smart crop)');
}

async function runAnalysis(input: string, f: AnalyzeFlags): Promise<Analysis> {
  const started = Date.now();
  const analysis = await analyzeMedia(input, {
    options: {
      count: Number(f.count),
      minClip: Number(f.min),
      maxClip: Number(f.max),
      targetClip: Number(f.target),
      noiseDb: Number(f.noise),
      minSilence: Number(f.minSilence),
      padding: Number(f.padding),
      keywords: f.keywords ?? [],
    },
    transcribe: { provider: f.srt ? 'srt' : f.transcribe, srtPath: f.srt, language: f.language },
    llm: f.llm ? {} : false,
    motion: f.motion,
    onProgress: (stage, p) => progressLine(`${dim('analysing')} ${bar(p)} ${stage}`),
    log: (m) => {
      endProgress();
      console.error(dim(m));
    },
  });
  endProgress();
  console.error(
    `${ink('✓')} analysed ${basename(input)} in ${((Date.now() - started) / 1000).toFixed(1)}s · ${formatDuration(analysis.media.duration)} · ` +
      `${analysis.silences.length} pauses (${formatDuration(analysis.stats.silenceSeconds)} removable) · transcript: ${analysis.transcript?.source ?? 'none'}`,
  );
  return analysis;
}

function printHighlights(a: Analysis): void {
  a.highlights.forEach((h, i) => {
    console.log(`${ink(String(i + 1).padStart(2))}  ${formatTime(h.start)} → ${formatTime(h.end)}  ${dim(`score ${h.score.toFixed(1)}`)}  ${h.title}`);
  });
}

function exportOptions(o: {
  formats: PresetId[];
  style: CaptionStyleId;
  reframe: ReframeMode;
  keepPauses?: boolean;
  normalize: boolean;
  uppercase?: boolean;
  scale: string;
}): ExportOptions {
  return {
    ...DEFAULT_EXPORT_OPTIONS,
    presets: o.formats,
    captionStyle: o.style,
    reframe: o.reframe,
    removeSilence: !o.keepPauses,
    normalizeAudio: o.normalize,
    uppercase: !!o.uppercase,
    scale: Number(o.scale),
  };
}

function addExportFlags(cmd: Command, defaultFormats: string): Command {
  return cmd
    .option('-f, --formats <list>', `presets: ${PRESET_IDS.join(', ')}`, presetsOpt, presetsOpt(defaultFormats))
    .addOption(new Option('-s, --style <style>', 'caption style').choices(STYLES).default('pop'))
    .addOption(new Option('-r, --reframe <mode>', 'how to fit a different aspect ratio').choices(REFRAMES).default('motion'))
    .option('--keep-pauses', 'do not remove pauses inside clips')
    .option('--no-normalize', 'skip loudness normalisation (-14 LUFS)')
    .option('--uppercase', 'UPPERCASE captions')
    .option('--scale <factor>', 'render scale, e.g. 0.5 for quick drafts', '1');
}

program
  .name('kerfreel')
  .description('Local-first clip studio: cut pauses, find highlights, burn animated captions, export vertical and widescreen clips.')
  .version(VERSION);

program
  .command('sample')
  .description('generate a synthetic demo video (tones + brand frames) and a matching SRT')
  .argument('[output]', 'output file', 'kerfreel-sample.mp4')
  .option('-d, --duration <seconds>', 'length (scales the script)', '42')
  .option('--no-text', 'skip on-screen text (if your ffmpeg lacks drawtext)')
  .action(async (output: string, o: { duration: string; text: boolean }) => {
    const res = await generateSample(resolve(output), { duration: Number(o.duration), text: o.text });
    console.log(`${ink('✓')} ${res.video}\n${ink('✓')} ${res.srt}`);
  });

addAnalyzeFlags(
  program
    .command('analyze')
    .description('detect pauses and rank highlight moments; prints a summary and writes analysis JSON')
    .argument('<input>', 'video or audio file')
    .option('-o, --out <file>', 'where to write the analysis JSON'),
).action(async (input: string, o: AnalyzeFlags & { out?: string }) => {
  const a = await runAnalysis(input, o);
  printHighlights(a);
  const out = o.out ?? join(dirname(input), `${basename(input, extname(input))}.kerfreel.json`);
  await writeFile(out, JSON.stringify(a, null, 2));
  console.error(dim(`analysis → ${out}`));
});

addExportFlags(
  addAnalyzeFlags(
    program
      .command('clips')
      .description('find highlights and batch-export them for Shorts, TikTok, Reels and 16:9')
      .argument('<input>', 'video file')
      .option('-a, --analysis <file>', 'reuse an analysis JSON from `kerfreel analyze`')
      .option('-t, --top <n>', 'export only the best N highlights')
      .option('-o, --out <dir>', 'output folder', 'kerfreel-exports'),
  ),
  'shorts',
).action(
  async (
    input: string,
    o: AnalyzeFlags & {
      analysis?: string;
      top?: string;
      out: string;
      formats: PresetId[];
      style: CaptionStyleId;
      reframe: ReframeMode;
      keepPauses?: boolean;
      normalize: boolean;
      uppercase?: boolean;
      scale: string;
    },
  ) => {
    const a: Analysis = o.analysis ? (JSON.parse(await readFile(o.analysis, 'utf8')) as Analysis) : await runAnalysis(input, o);
    if (o.analysis && o.srt) a.transcript = await loadSubtitleFile(o.srt);
    const picks = a.highlights.slice(0, o.top ? Number(o.top) : undefined);
    if (picks.length === 0) {
      console.error('No highlights found. Try a lower --min or a different --noise threshold.');
      process.exitCode = 1;
      return;
    }
    printHighlights({ ...a, highlights: picks });
    const results = await exportBatch(
      { input, media: a.media, keep: a.keep, motion: a.motion, transcript: a.transcript },
      picks.map((h) => ({ start: h.start, end: h.end, title: h.title })),
      exportOptions(o),
      resolve(o.out),
      (p) => progressLine(`${dim('rendering')} ${bar(p.overall)} clip ${p.clipIndex + 1}/${p.clipCount} · ${p.preset}`),
    );
    endProgress();
    for (const r of results) console.log(`${ink('✓')} ${r.file} ${dim(`${r.width}×${r.height} · ${formatDuration(r.duration)}`)}`);
  },
);

addExportFlags(
  program
    .command('cut')
    .description('remove every pause from a whole video (jump-cut edit), optionally with captions')
    .argument('<input>', 'video file')
    .option('-o, --out <file>', 'output file')
    .option('--srt <file>', 'burn these captions in')
    .option('--noise <dB>', 'silence threshold in dBFS', String(DEFAULT_ANALYSIS_OPTIONS.noiseDb))
    .option('--min-silence <seconds>', 'shortest pause that gets cut', String(DEFAULT_ANALYSIS_OPTIONS.minSilence))
    .option('--padding <seconds>', 'breathing room kept around speech', String(DEFAULT_ANALYSIS_OPTIONS.padding)),
  'original',
).action(
  async (
    input: string,
    o: {
      out?: string;
      srt?: string;
      noise: string;
      minSilence: string;
      padding: string;
      formats: PresetId[];
      style: CaptionStyleId;
      reframe: ReframeMode;
      normalize: boolean;
      uppercase?: boolean;
      scale: string;
    },
  ) => {
    const a = await analyzeMedia(input, {
      options: { noiseDb: Number(o.noise), minSilence: Number(o.minSilence), padding: Number(o.padding), count: 0 },
      transcribe: o.srt ? { provider: 'srt', srtPath: o.srt } : undefined,
      motion: o.reframe === 'motion' && o.formats.some((f) => f !== 'original' && f !== 'youtube'),
    });
    const opts = exportOptions({ ...o, keepPauses: false });
    const preset = o.formats[0] ?? 'original';
    const out = resolve(o.out ?? join(dirname(input), `${basename(input, extname(input))}.cut.mp4`));
    const r = await renderClip(
      { input, media: a.media, keep: a.keep, motion: a.motion, transcript: a.transcript },
      { start: 0, end: a.media.duration, title: 'cut' },
      preset,
      { ...opts, captionStyle: a.transcript ? opts.captionStyle : 'none' },
      out,
      (p) => progressLine(`${dim('rendering')} ${bar(p)}`),
    );
    endProgress();
    console.log(
      `${ink('✓')} ${r.file} ${dim(`${formatDuration(a.media.duration)} → ${formatDuration(r.duration)} (−${formatDuration(a.media.duration - r.duration)})`)}`,
    );
  },
);

program
  .command('captions')
  .description('convert an SRT/VTT into an animated .ass caption file')
  .argument('<subtitles>', 'SRT or VTT file')
  .option('-o, --out <file>', 'output .ass file')
  .addOption(new Option('-s, --style <style>', 'caption style').choices(STYLES).default('pop'))
  .option('--width <px>', 'video width', '1080')
  .option('--height <px>', 'video height', '1920')
  .option('--uppercase', 'UPPERCASE captions')
  .action(async (file: string, o: { out?: string; style: CaptionStyleId; width: string; height: string; uppercase?: boolean }) => {
    const t = await loadSubtitleFile(file);
    const ass = buildAss(
      t.segments.flatMap((s) => s.words),
      { width: Number(o.width), height: Number(o.height), style: o.style, uppercase: o.uppercase },
    );
    const out = o.out ?? file.replace(/\.[^.]+$/, '') + `.${o.style}.ass`;
    await writeFile(out, ass);
    console.log(`${ink('✓')} ${out}`);
  });

program
  .command('doctor')
  .description('check ffmpeg, libass and optional transcription backends')
  .action(async () => {
    const ff = await ffmpegVersion();
    console.log(`${ff ? ink('✓') : '✗'} ffmpeg ${ff ?? 'not found — install it from https://ffmpeg.org'}`);
    const { hasFilter } = await import('../core/ffmpeg.js');
    for (const f of ['silencedetect', 'ass', 'loudnorm', 'drawtext']) console.log(`${(await hasFilter(f)) ? ink('✓') : '✗'} filter ${f}`);
    console.log(`${process.env.OPENAI_API_KEY ? ink('✓') : '·'} OPENAI_API_KEY ${process.env.OPENAI_API_KEY ? 'set' : 'not set (optional)'}`);
    console.log(
      `${(await localWhisperAvailable()) ? ink('✓') : '·'} local whisper (faster-whisper / openai-whisper) ${(await localWhisperAvailable()) ? 'available' : 'not installed (optional)'}`,
    );
  });

program
  .command('serve')
  .description('start the local web studio')
  .option('-p, --port <port>', 'port', process.env.PORT ?? '5175')
  .option('--host <host>', 'host to bind', process.env.HOST ?? '127.0.0.1')
  .option('--data <dir>', 'project storage folder', process.env.KERFREEL_DATA ?? '.kerfreel')
  .action(async (o: { port: string; host: string; data: string }) => {
    const { startServer } = await import('../server/index.js');
    const dataDir = resolve(o.data);
    if (!existsSync(dataDir)) await mkdir(dataDir, { recursive: true });
    const { url } = await startServer({ port: Number(o.port), host: o.host, dataDir });
    console.log(`${ink('kerfreel')} studio running at ${url}`);
  });

program.parseAsync().catch((err: Error) => {
  endProgress();
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
