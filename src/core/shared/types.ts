/** Shared, dependency-free types used by the engine, the server and the web UI. */

export interface Range {
  start: number;
  end: number;
}

export interface MediaInfo {
  path: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  sizeBytes: number;
  videoCodec?: string;
  audioCodec?: string;
}

/** Loudness envelope sampled every `hop` seconds (values in dBFS, floor -90). */
export interface EnergyTrack {
  hop: number;
  db: number[];
}

/** Horizontal motion centroid (0..1 of frame width) and motion amount (0..1) every `hop` seconds. */
export interface MotionTrack {
  hop: number;
  cx: number[];
  amount: number[];
}

export interface Word {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: Word[];
}

export type TranscriptSource = 'openai' | 'whisper-local' | 'srt' | 'none';

export interface Transcript {
  source: TranscriptSource;
  language?: string;
  segments: TranscriptSegment[];
}

export interface ScoreBreakdown {
  loudness: number;
  dynamics: number;
  speech: number;
  keywords: number;
  motion: number;
  hook: number;
  llm?: number;
}

export interface Highlight {
  id: string;
  start: number;
  end: number;
  /** 0..100 */
  score: number;
  breakdown: ScoreBreakdown;
  title: string;
  reason?: string;
  keywordHits?: string[];
}

export interface AnalysisOptions {
  noiseDb: number;
  minSilence: number;
  padding: number;
  minClip: number;
  maxClip: number;
  targetClip: number;
  count: number;
  keywords: string[];
}

export interface Analysis {
  version: 1;
  createdAt: string;
  media: MediaInfo;
  options: AnalysisOptions;
  silences: Range[];
  keep: Range[];
  energy: EnergyTrack;
  motion?: MotionTrack;
  transcript?: Transcript;
  highlights: Highlight[];
  stats: {
    silenceSeconds: number;
    keptSeconds: number;
    analysisMs: number;
  };
}

export type CaptionStyleId = 'pop' | 'karaoke' | 'glow' | 'bounce' | 'minimal' | 'none';
export type ReframeMode = 'center' | 'motion' | 'blur-pad' | 'fit';
export type PresetId = 'shorts' | 'tiktok' | 'reels' | 'youtube' | 'square' | 'original';

export interface ClipRequest {
  start: number;
  end: number;
  title?: string;
}

export interface ExportOptions {
  presets: PresetId[];
  captionStyle: CaptionStyleId;
  reframe: ReframeMode;
  removeSilence: boolean;
  normalizeAudio: boolean;
  uppercase: boolean;
  /** 1 = full resolution. Smaller values render quick drafts. */
  scale: number;
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  noiseDb: -35,
  minSilence: 0.6,
  padding: 0.12,
  minClip: 12,
  maxClip: 45,
  targetClip: 28,
  count: 6,
  keywords: [],
};

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  presets: ['shorts'],
  captionStyle: 'pop',
  reframe: 'motion',
  removeSilence: true,
  normalizeAudio: true,
  uppercase: false,
  scale: 1,
};
