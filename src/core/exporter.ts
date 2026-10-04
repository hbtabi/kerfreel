import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FFMPEG, parseProgressChunk, run } from './ffmpeg.js';
import { buildRenderArgs } from './render.js';
import { buildAss } from './shared/ass.js';
import { planCropPath, remapKeyframes } from './shared/crop.js';
import { slugify } from './shared/format.js';
import { PRESETS, outputSize } from './shared/presets.js';
import { intersectRanges, TimeMap } from './shared/ranges.js';
import { wordsForClip } from './shared/subtitles.js';
import type { ClipRequest, ExportOptions, MediaInfo, MotionTrack, PresetId, Range, Transcript } from './shared/types.js';

export interface ExportContext {
  input: string;
  media: MediaInfo;
  keep?: Range[];
  motion?: MotionTrack;
  transcript?: Transcript;
  fontsDir?: string;
}

export interface ExportResult {
  file: string;
  preset: PresetId;
  duration: number;
  width: number;
  height: number;
  clip: ClipRequest;
}

export interface ExportProgress {
  clipIndex: number;
  clipCount: number;
  preset: PresetId;
  /** 0..1 for the current render. */
  progress: number;
  /** 0..1 across the whole batch. */
  overall: number;
}

export function clipFileName(clip: ClipRequest, preset: PresetId, index: number): string {
  const base = slugify(clip.title || `clip-${index + 1}`, 40);
  return `${String(index + 1).padStart(2, '0')}-${base}-${preset}.mp4`;
}

/** Renders one clip for one preset. */
export async function renderClip(
  ctx: ExportContext,
  clip: ClipRequest,
  presetId: PresetId,
  options: ExportOptions,
  output: string,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const preset = PRESETS[presetId];
  const range = { start: Math.max(0, clip.start), end: Math.min(ctx.media.duration || clip.end, clip.end) };
  if (range.end - range.start < 0.2) throw new Error('Clip is too short to export');
  let keep = options.removeSilence && ctx.keep ? intersectRanges(ctx.keep, range) : [range];
  if (keep.length === 0) keep = [range];
  const map = new TimeMap(keep);
  const size = outputSize(preset, ctx.media, options.scale);

  const tmp = await mkdtemp(join(tmpdir(), 'kerfreel-render-'));
  try {
    let assPath: string | undefined;
    if (options.captionStyle !== 'none' && ctx.transcript) {
      const words = wordsForClip(ctx.transcript, range, map);
      if (words.length) {
        assPath = join(tmp, 'captions.ass');
        await writeFile(
          assPath,
          buildAss(words, { width: size.width, height: size.height, style: options.captionStyle, uppercase: options.uppercase }),
          'utf8',
        );
      }
    }
    const crop = options.reframe === 'motion' ? remapKeyframes(planCropPath(ctx.motion, range), map) : undefined;
    const args = buildRenderArgs({
      input: ctx.input,
      output,
      media: ctx.media,
      range,
      keep,
      preset,
      reframe: options.reframe,
      crop,
      assPath,
      fontsDir: ctx.fontsDir,
      scale: options.scale,
      normalizeAudio: options.normalizeAudio,
      x264Preset: 'veryfast',
    });
    const total = map.duration;
    await run(FFMPEG, args, {
      signal,
      onStdout: (c) => {
        const { seconds, done } = parseProgressChunk(c.toString('utf8'));
        if (done) onProgress?.(1);
        else if (seconds !== undefined && total > 0) onProgress?.(Math.min(0.999, seconds / total));
      },
    });
    onProgress?.(1);
    return { file: output, preset: presetId, duration: total, width: size.width, height: size.height, clip };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Renders every clip in every requested preset, sequentially, reporting overall progress. */
export async function exportBatch(
  ctx: ExportContext,
  clips: ClipRequest[],
  options: ExportOptions,
  outDir: string,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<ExportResult[]> {
  await mkdir(outDir, { recursive: true });
  const jobs = clips.flatMap((clip, i) => options.presets.map((preset) => ({ clip, i, preset })));
  const results: ExportResult[] = [];
  for (const [j, job] of jobs.entries()) {
    const file = join(outDir, clipFileName(job.clip, job.preset, job.i));
    const res = await renderClip(
      ctx,
      job.clip,
      job.preset,
      options,
      file,
      (p) => onProgress?.({ clipIndex: job.i, clipCount: clips.length, preset: job.preset, progress: p, overall: (j + p) / jobs.length }),
      signal,
    );
    results.push(res);
  }
  return results;
}
