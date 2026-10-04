import type { CaptionStyleId, PresetId, ReframeMode } from './types.js';

export interface Preset {
  id: PresetId;
  label: string;
  platform: string;
  width: number;
  height: number;
  /** Platform clip length limit in seconds (undefined = no practical limit). */
  maxDuration?: number;
  aspect: '9:16' | '16:9' | '1:1' | 'source';
}

export const PRESETS: Record<PresetId, Preset> = {
  shorts: { id: 'shorts', label: 'YouTube Shorts', platform: 'YouTube', width: 1080, height: 1920, maxDuration: 180, aspect: '9:16' },
  tiktok: { id: 'tiktok', label: 'TikTok', platform: 'TikTok', width: 1080, height: 1920, maxDuration: 600, aspect: '9:16' },
  reels: { id: 'reels', label: 'Instagram Reels', platform: 'Instagram', width: 1080, height: 1920, maxDuration: 180, aspect: '9:16' },
  youtube: { id: 'youtube', label: 'YouTube 16:9', platform: 'YouTube', width: 1920, height: 1080, aspect: '16:9' },
  square: { id: 'square', label: 'Square 1:1', platform: 'Feeds', width: 1080, height: 1080, aspect: '1:1' },
  original: { id: 'original', label: 'Original frame', platform: 'Any', width: 0, height: 0, aspect: 'source' },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export const CAPTION_STYLES: { id: CaptionStyleId; label: string; description: string }[] = [
  { id: 'pop', label: 'Pop', description: 'Active word turns lime and pops up' },
  { id: 'karaoke', label: 'Karaoke', description: 'Smooth left-to-right colour fill' },
  { id: 'glow', label: 'Glow', description: 'Active word gets a purple halo' },
  { id: 'bounce', label: 'Bounce', description: 'Words land one at a time' },
  { id: 'minimal', label: 'Minimal', description: 'Clean lower-third subtitles' },
  { id: 'none', label: 'No captions', description: 'Export without burned-in text' },
];

export const REFRAME_MODES: { id: ReframeMode; label: string; description: string }[] = [
  { id: 'motion', label: 'Smart (motion)', description: 'Crop follows where things move' },
  { id: 'center', label: 'Centre crop', description: 'Fixed centre crop' },
  { id: 'blur-pad', label: 'Blur fill', description: 'Whole frame over a blurred backdrop' },
  { id: 'fit', label: 'Letterbox', description: 'Whole frame on an ink background' },
];

export function outputSize(preset: Preset, src: { width: number; height: number }, scale = 1): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const w = preset.width || src.width || 1280;
  const h = preset.height || src.height || 720;
  return { width: even(w * scale), height: even(h * scale) };
}
