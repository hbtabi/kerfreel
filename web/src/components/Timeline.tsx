import { useCallback, useEffect, useRef, useState } from 'react';
import { clamp, formatTime, type Analysis, type Range } from '../lib/shared';
import type { ClipItem } from '../lib/clips';

interface Props {
  analysis: Analysis;
  time: number;
  selection: Range | null;
  clips: ClipItem[];
  activeClipId: string | null;
  onSeek: (t: number) => void;
  onSelectionChange: (r: Range) => void;
  onPickClip: (id: string) => void;
}

const C = {
  ink: '#1a1714',
  panel: '#221e1a',
  grid: 'rgba(253,249,243,0.06)',
  wave: 'rgba(253,249,243,0.55)',
  waveCut: 'rgba(253,249,243,0.16)',
  silence: 'rgba(123,92,255,0.16)',
  clip: 'rgba(123,92,255,0.55)',
  clipActive: '#7b5cff',
  lime: '#c8ff3d',
  cream: '#fdf9f3',
};

type Drag = { kind: 'start' | 'end' | 'move' | 'seek'; offset: number } | null;

export function Timeline({ analysis, time, selection, clips, activeClipId, onSeek, onSelectionChange, onPickClip }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const duration = analysis.media.duration || 1;
  const [view, setView] = useState<Range>({ start: 0, end: duration });
  const drag = useRef<Drag>(null);
  const HEIGHT = 148;
  const LANE = 26;

  useEffect(() => setView({ start: 0, end: duration }), [duration]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toX = useCallback((t: number) => ((t - view.start) / (view.end - view.start)) * width, [view, width]);
  const toT = useCallback((x: number) => view.start + (x / width) * (view.end - view.start), [view, width]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr;
    cv.height = HEIGHT * dpr;
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, HEIGHT);
    const waveTop = 22;
    const waveH = HEIGHT - waveTop - LANE - 8;
    const mid = waveTop + waveH / 2;

    // Ruler
    const span = view.end - view.start;
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
    const step = steps.find((s) => (s / span) * width > 70) ?? 3600;
    g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillStyle = 'rgba(253,249,243,0.45)';
    for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) {
      const x = toX(t);
      g.fillRect(x, 14, 1, 6);
      g.fillStyle = C.grid;
      g.fillRect(x, waveTop, 1, waveH);
      g.fillStyle = 'rgba(253,249,243,0.45)';
      g.fillText(formatTime(t, step < 1 ? 1 : 0), x + 3, 11);
    }

    // Silences
    g.fillStyle = C.silence;
    for (const s of analysis.silences) {
      if (s.end < view.start || s.start > view.end) continue;
      g.fillRect(toX(s.start), waveTop, Math.max(1, toX(s.end) - toX(s.start)), waveH);
    }

    // Loudness envelope
    const { hop, db } = analysis.energy;
    const cols = Math.min(width, 2000);
    const keep = analysis.keep;
    let ki = 0;
    for (let c = 0; c < cols; c++) {
      const t0 = toT((c / cols) * width);
      const t1 = toT(((c + 1) / cols) * width);
      const i0 = Math.max(0, Math.floor(t0 / hop));
      const i1 = Math.min(db.length - 1, Math.max(i0, Math.ceil(t1 / hop)));
      let peak = -90;
      for (let i = i0; i <= i1; i++) peak = Math.max(peak, db[i] ?? -90);
      const amp = clamp((peak + 60) / 60, 0, 1);
      const tm = (t0 + t1) / 2;
      while (ki < keep.length - 1 && keep[ki]!.end < tm) ki++;
      const kept = keep.length === 0 || (keep[ki]!.start <= tm && keep[ki]!.end >= tm);
      g.fillStyle = kept ? C.wave : C.waveCut;
      const h = Math.max(1, amp * waveH * 0.92);
      g.fillRect((c / cols) * width, mid - h / 2, Math.max(1, width / cols - 0.5), h);
    }

    // Clip lane
    const laneY = HEIGHT - LANE - 2;
    clips.forEach((clip, i) => {
      if (clip.end < view.start || clip.start > view.end) return;
      const x0 = toX(clip.start);
      const x1 = toX(clip.end);
      const active = clip.id === activeClipId;
      g.fillStyle = active ? C.clipActive : C.clip;
      g.beginPath();
      g.roundRect(x0, laneY, Math.max(4, x1 - x0), LANE - 4, 6);
      g.fill();
      g.fillStyle = C.cream;
      g.font = '600 11px Inter, ui-sans-serif, system-ui, sans-serif';
      if (x1 - x0 > 26) g.fillText(clip.custom ? '✂' : `#${i + 1}`, x0 + 7, laneY + 15);
    });

    // Selection
    if (selection) {
      const x0 = toX(selection.start);
      const x1 = toX(selection.end);
      g.fillStyle = 'rgba(200,255,61,0.10)';
      g.fillRect(x0, waveTop, x1 - x0, waveH);
      g.strokeStyle = C.lime;
      g.lineWidth = 1;
      g.strokeRect(x0 + 0.5, waveTop + 0.5, x1 - x0 - 1, waveH - 1);
      for (const x of [x0, x1]) {
        g.fillStyle = C.lime;
        g.beginPath();
        g.roundRect(x - 4, mid - 18, 8, 36, 3);
        g.fill();
        g.fillStyle = C.ink;
        g.fillRect(x - 1, mid - 8, 2, 16);
      }
    }

    // Playhead
    const px = toX(time);
    g.fillStyle = C.cream;
    g.fillRect(px - 0.5, 12, 1.5, HEIGHT - 12);
    g.beginPath();
    g.moveTo(px - 5, 10);
    g.lineTo(px + 5, 10);
    g.lineTo(px, 17);
    g.fill();
  }, [analysis, clips, activeClipId, selection, time, view, width, toX, toT]);

  const pointerT = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return clamp(toT(e.clientX - rect.left), 0, duration);
  };

  const onDown = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const t = pointerT(e);
    (e.target as Element).setPointerCapture(e.pointerId);
    if (y > HEIGHT - LANE - 4) {
      const hit = clips.find((c) => t >= c.start && t <= c.end);
      if (hit) {
        onPickClip(hit.id);
        return;
      }
    }
    if (selection) {
      if (Math.abs(x - toX(selection.start)) < 8) drag.current = { kind: 'start', offset: 0 };
      else if (Math.abs(x - toX(selection.end)) < 8) drag.current = { kind: 'end', offset: 0 };
      else if (t > selection.start && t < selection.end && e.shiftKey) drag.current = { kind: 'move', offset: t - selection.start };
      else drag.current = { kind: 'seek', offset: 0 };
    } else drag.current = { kind: 'seek', offset: 0 };
    if (drag.current.kind === 'seek') onSeek(t);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      const rect = canvas.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const near = selection && (Math.abs(x - toX(selection.start)) < 8 || Math.abs(x - toX(selection.end)) < 8);
      canvas.current!.style.cursor = near ? 'ew-resize' : 'pointer';
      return;
    }
    const t = pointerT(e);
    if (d.kind === 'seek') onSeek(t);
    else if (selection && d.kind === 'start') onSelectionChange({ start: Math.min(t, selection.end - 0.5), end: selection.end });
    else if (selection && d.kind === 'end') onSelectionChange({ start: selection.start, end: Math.max(t, selection.start + 0.5) });
    else if (selection && d.kind === 'move') {
      const len = selection.end - selection.start;
      const s = clamp(t - d.offset, 0, duration - len);
      onSelectionChange({ start: s, end: s + len });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    const anchor = toT(e.clientX - rect.left);
    const span = view.end - view.start;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const shift = ((e.deltaX || e.deltaY) / width) * span;
      const s = clamp(view.start + shift, 0, duration - span);
      setView({ start: s, end: s + span });
      return;
    }
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const next = clamp(span * factor, Math.min(4, duration), duration);
    const ratio = (anchor - view.start) / span;
    const s = clamp(anchor - ratio * next, 0, duration - next);
    setView({ start: s, end: s + next });
  };

  const zoomTo = (r: Range | null) => {
    if (!r) return setView({ start: 0, end: duration });
    const pad = (r.end - r.start) * 0.4;
    setView({ start: Math.max(0, r.start - pad), end: Math.min(duration, r.end + pad) });
  };

  return (
    <div className="timeline" ref={wrap}>
      <div className="timeline-bar">
        <span className="legend">
          <i className="sw wave" /> loudness
        </span>
        <span className="legend">
          <i className="sw silence" /> pause (cut)
        </span>
        <span className="legend">
          <i className="sw clip" /> highlight
        </span>
        <span className="legend">
          <i className="sw sel" /> selection
        </span>
        <span className="spacer" />
        <button className="chip" onClick={() => zoomTo(selection)} disabled={!selection}>
          Zoom to selection
        </button>
        <button className="chip" onClick={() => zoomTo(null)}>
          Fit
        </button>
      </div>
      <canvas
        ref={canvas}
        style={{ width, height: HEIGHT }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onWheel={onWheel}
        aria-label="Timeline"
      />
      <p className="hint">Drag the lime handles to trim · shift-drag inside to move · scroll to zoom · click a highlight block to select it</p>
    </div>
  );
}
