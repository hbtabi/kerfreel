import { probe } from './ffmpeg.js';
import { detectSilences } from './silence.js';
import { measureEnergy } from './energy.js';
import { measureMotion } from './motion.js';
import { transcribe, type TranscribeOptions } from './transcribe.js';
import { rankWithLlm, type LlmOptions } from './llm.js';
import { detectHighlights } from './shared/highlights.js';
import { keepRanges, totalLength } from './shared/ranges.js';
import { DEFAULT_ANALYSIS_OPTIONS, type Analysis, type AnalysisOptions, type Transcript } from './shared/types.js';

export interface AnalyzeParams {
  options?: Partial<AnalysisOptions>;
  transcribe?: TranscribeOptions;
  /** Use a transcript you already have instead of transcribing. */
  transcript?: Transcript;
  llm?: LlmOptions | false;
  motion?: boolean;
  onProgress?: (stage: string, progress: number) => void;
  log?: (msg: string) => void;
  signal?: AbortSignal;
}

/** Runs the full analysis: probe, pauses, loudness, motion, transcript and highlight ranking. */
export async function analyzeMedia(file: string, params: AnalyzeParams = {}): Promise<Analysis> {
  const t0 = Date.now();
  const options: AnalysisOptions = { ...DEFAULT_ANALYSIS_OPTIONS, ...params.options };
  const report = params.onProgress ?? (() => {});
  const log = params.log ?? (() => {});
  const signal = params.signal;

  report('probe', 0.02);
  const media = await probe(file);
  if (!media.duration) throw new Error('Could not read media duration');

  report('signal', 0.08);
  const [silences, energy, motion] = await Promise.all([
    media.hasAudio ? detectSilences(file, media.duration, { noiseDb: options.noiseDb, minSilence: options.minSilence, signal }) : Promise.resolve([]),
    media.hasAudio ? measureEnergy(file, { signal }) : Promise.resolve({ hop: 0.25, db: [] }),
    media.hasVideo && params.motion !== false ? measureMotion(file, { signal }) : Promise.resolve(undefined),
  ]);
  const keep = keepRanges(silences, media.duration, { padding: options.padding });

  report('transcript', 0.55);
  let transcript = params.transcript;
  if (!transcript && params.transcribe) {
    try {
      transcript = await transcribe(file, { ...params.transcribe, log, signal });
    } catch (err) {
      log(`Transcription skipped: ${(err as Error).message}`);
    }
  }

  report('highlights', 0.85);
  let highlights = detectHighlights({ duration: media.duration, energy, keep, motion, transcript }, options);
  if (params.llm) {
    try {
      highlights = await rankWithLlm(highlights, transcript, { ...params.llm, signal });
    } catch (err) {
      log(`LLM ranking skipped: ${(err as Error).message}`);
    }
  }
  report('done', 1);
  const kept = totalLength(keep);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    media,
    options,
    silences,
    keep,
    energy,
    motion,
    transcript,
    highlights,
    stats: { silenceSeconds: Number((media.duration - kept).toFixed(2)), keptSeconds: Number(kept.toFixed(2)), analysisMs: Date.now() - t0 },
  };
}
