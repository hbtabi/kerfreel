import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FFMPEG, run } from './ffmpeg.js';
import { cuesToTranscript, distributeWords, parseSubtitles } from './shared/subtitles.js';
import type { Transcript, TranscriptSegment, Word } from './shared/types.js';

export type TranscribeProvider = 'auto' | 'openai' | 'local' | 'srt' | 'none';

export interface TranscribeOptions {
  provider?: TranscribeProvider;
  srtPath?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  localModel?: string;
  language?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

const here = dirname(fileURLToPath(import.meta.url));
export const WHISPER_SCRIPT = resolve(here, '..', '..', 'scripts', 'whisper_local.py');
const PYTHON = process.env.KERFREEL_PYTHON || 'python3';

export async function loadSubtitleFile(path: string): Promise<Transcript> {
  const cues = parseSubtitles(await readFile(path, 'utf8'));
  if (cues.length === 0) throw new Error(`No cues found in ${path}`);
  return cuesToTranscript(cues);
}

interface VerboseJson {
  language?: string;
  text?: string;
  segments?: { start: number; end: number; text: string; words?: { start: number; end: number; word: string }[] }[];
  words?: { start: number; end: number; word: string }[];
}

/** Normalises OpenAI-style `verbose_json` (also produced by our local whisper script). */
export function parseVerboseJson(data: VerboseJson, source: Transcript['source']): Transcript {
  const topWords: Word[] = (data.words ?? []).map((w) => ({ start: w.start, end: w.end, text: w.word.trim() })).filter((w) => w.text);
  const segments: TranscriptSegment[] = (data.segments ?? []).map((s) => {
    const own = (s.words ?? []).map((w) => ({ start: w.start, end: w.end, text: w.word.trim() })).filter((w) => w.text);
    const words = own.length ? own : topWords.filter((w) => w.start >= s.start - 0.01 && w.start < s.end);
    const text = s.text.trim();
    return { start: s.start, end: s.end, text, words: words.length ? words : distributeWords({ start: s.start, end: s.end, text }) };
  });
  if (segments.length === 0 && topWords.length) {
    segments.push({ start: topWords[0]!.start, end: topWords[topWords.length - 1]!.end, text: topWords.map((w) => w.text).join(' '), words: topWords });
  }
  return { source, language: data.language, segments };
}

async function extractSpeechAudio(input: string, dir: string, signal?: AbortSignal): Promise<string> {
  const out = join(dir, 'speech.mp3');
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', out], { signal });
  return out;
}

export async function transcribeOpenAI(input: string, opts: TranscribeOptions): Promise<Transcript> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = opts.model ?? process.env.KERFREEL_TRANSCRIBE_MODEL ?? 'whisper-1';
  const doFetch = opts.fetchImpl ?? fetch;
  const dir = await mkdtemp(join(tmpdir(), 'kerfreel-asr-'));
  try {
    const audio = await extractSpeechAudio(input, dir, opts.signal);
    const form = new FormData();
    form.append('file', new Blob([await readFile(audio)], { type: 'audio/mpeg' }), 'speech.mp3');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (opts.language) form.append('language', opts.language);
    const res = await doFetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`Transcription API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return parseVerboseJson((await res.json()) as VerboseJson, 'openai');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function localWhisperAvailable(): Promise<boolean> {
  try {
    await run(PYTHON, [
      '-c',
      'import importlib.util,sys; sys.exit(0 if (importlib.util.find_spec("faster_whisper") or importlib.util.find_spec("whisper")) else 1)',
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function transcribeLocal(input: string, opts: TranscribeOptions): Promise<Transcript> {
  const args = [WHISPER_SCRIPT, input, '--model', opts.localModel ?? process.env.KERFREEL_WHISPER_MODEL ?? 'base'];
  if (opts.language) args.push('--language', opts.language);
  const { stdout } = await run(PYTHON, args, { signal: opts.signal });
  return parseVerboseJson(JSON.parse(stdout) as VerboseJson, 'whisper-local');
}

/**
 * Picks the best available transcription route:
 * an explicit subtitle file, then an OpenAI-compatible API, then local whisper, else none.
 */
export async function transcribe(input: string, opts: TranscribeOptions = {}): Promise<Transcript | undefined> {
  const provider = opts.provider ?? 'auto';
  const log = opts.log ?? (() => {});
  if (opts.srtPath && (provider === 'auto' || provider === 'srt')) return loadSubtitleFile(opts.srtPath);
  if (provider === 'srt') throw new Error('provider "srt" needs a subtitle file');
  if (provider === 'none') return undefined;
  if (provider === 'openai') return transcribeOpenAI(input, opts);
  if (provider === 'local') return transcribeLocal(input, opts);
  if (opts.apiKey ?? process.env.OPENAI_API_KEY) {
    try {
      return await transcribeOpenAI(input, opts);
    } catch (err) {
      log(`API transcription failed, trying local whisper: ${(err as Error).message}`);
    }
  }
  if (await localWhisperAvailable()) {
    try {
      return await transcribeLocal(input, opts);
    } catch (err) {
      log(`Local whisper failed: ${(err as Error).message}`);
    }
  }
  return undefined;
}
