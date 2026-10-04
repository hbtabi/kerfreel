import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { centreAt, formatTime, planCropPath, type Analysis, type CaptionLine, type CaptionStyleId, type Range, type ReframeMode } from '../lib/shared';
import { skipTarget } from '../lib/clips';
import { CaptionOverlay } from './CaptionOverlay';
import { Loop, Monitor, Pause, Phone, Play, Scissors } from './Icons';

export interface PlayerHandle {
  seek: (t: number) => void;
  play: () => void;
}

interface Props {
  src: string;
  analysis: Analysis | null;
  selection: Range | null;
  lines: CaptionLine[];
  captionStyle: CaptionStyleId;
  uppercase: boolean;
  reframe: ReframeMode;
  onTime: (t: number) => void;
}

export const Player = forwardRef<PlayerHandle, Props>(function Player({ src, analysis, selection, lines, captionStyle, uppercase, reframe, onTime }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [vertical, setVertical] = useState(true);
  const [skipPauses, setSkipPauses] = useState(true);
  const [loop, setLoop] = useState(true);
  const pendingSeek = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    seek: (t) => {
      const v = video.current;
      if (v && v.readyState >= 1) v.currentTime = t;
      else pendingSeek.current = t;
      setTime(t);
    },
    play: () => void video.current?.play(),
  }));

  const crop = useMemo(() => {
    if (!analysis || !selection) return null;
    return planCropPath(analysis.motion, selection);
  }, [analysis, selection]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        let t = v.currentTime;
        if (!v.paused && analysis) {
          if (skipPauses) {
            const jump = skipTarget(analysis.keep, t);
            if (jump !== null) {
              v.currentTime = jump;
              t = jump;
            }
          }
          if (loop && selection && (t >= selection.end || t < selection.start - 0.5)) {
            v.currentTime = selection.start;
            t = selection.start;
          }
        }
        setTime(t);
        onTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analysis, skipPauses, loop, selection, onTime]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (selection && (v.currentTime < selection.start || v.currentTime >= selection.end)) v.currentTime = selection.start;
      void v.play();
    } else v.pause();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const media = analysis?.media;
  const srcAspect = media && media.width && media.height ? media.width / media.height : 16 / 9;
  const cx = crop ? centreAt(crop, time) : 0.5;
  const cropMode = reframe === 'motion' || reframe === 'center';
  const centre = reframe === 'motion' ? cx : 0.5;
  // In 9:16 crop modes the video is scaled to the frame height and shifted so the crop centre is in view.
  const videoWidthPct = (srcAspect / (9 / 16)) * 100;
  const left = Math.min(0, Math.max(100 - videoWidthPct, 50 - centre * videoWidthPct));

  return (
    <div className="player">
      <div className={`stage ${vertical ? 'is-vertical' : 'is-wide'}`}>
        <div className={`frame ${vertical ? `vertical reframe-${reframe}` : 'wide'}`} onClick={toggle}>
          {vertical && !cropMode && <div className="frame-backdrop" />}
          <video
            ref={video}
            src={src}
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              if (pendingSeek.current !== null) e.currentTarget.currentTime = pendingSeek.current;
              pendingSeek.current = null;
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            style={vertical && cropMode ? { width: `${videoWidthPct}%`, height: '100%', left: `${left}%` } : undefined}
          />
          <CaptionOverlay lines={lines} time={time} style={captionStyle} uppercase={uppercase} vertical={vertical} />
          {!playing && (
            <button className="big-play" aria-label="Play">
              <Play width={30} height={30} />
            </button>
          )}
        </div>
        {!vertical && selection && cropMode && media && (
          <div
            className="crop-guide"
            style={{
              width: `${(9 / 16 / srcAspect) * 100}%`,
              left: `${Math.min(100 - (9 / 16 / srcAspect) * 100, Math.max(0, centre * 100 - (9 / 16 / srcAspect) * 50))}%`,
            }}
          />
        )}
      </div>
      <div className="transport">
        <button className="icon-btn primary" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause /> : <Play />}
        </button>
        <span className="tc">
          {formatTime(time)} <span className="dim">/ {formatTime(media?.duration ?? 0)}</span>
        </span>
        <span className="spacer" />
        <button className={`chip ${skipPauses ? 'on' : ''}`} onClick={() => setSkipPauses((s) => !s)} title="Jump over detected pauses while previewing">
          <Scissors width={14} height={14} /> Skip pauses
        </button>
        <button className={`chip ${loop ? 'on' : ''}`} onClick={() => setLoop((s) => !s)} title="Loop the selected clip">
          <Loop width={14} height={14} /> Loop clip
        </button>
        <div className="seg">
          <button className={vertical ? 'on' : ''} onClick={() => setVertical(true)} title="Preview 9:16">
            <Phone width={14} height={14} /> 9:16
          </button>
          <button className={!vertical ? 'on' : ''} onClick={() => setVertical(false)} title="Preview source frame">
            <Monitor width={14} height={14} /> 16:9
          </button>
        </div>
      </div>
    </div>
  );
});
