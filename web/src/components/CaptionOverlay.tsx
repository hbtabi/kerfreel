import { activeWordIndex, lineAt, type CaptionLine, type CaptionStyleId } from '../lib/shared';

interface Props {
  lines: CaptionLine[];
  time: number;
  style: CaptionStyleId;
  uppercase: boolean;
  vertical: boolean;
}

/** DOM mirror of the burned-in ASS styles so you can judge captions before rendering. */
export function CaptionOverlay({ lines, time, style, uppercase, vertical }: Props) {
  if (style === 'none') return null;
  const line = lineAt(lines, time);
  if (!line) return null;
  const active = activeWordIndex(line, time);
  const words = style === 'bounce' ? line.words.slice(0, active + 1) : line.words;
  return (
    <div className={`caption-overlay style-${style} ${vertical ? 'vertical' : 'wide'}`} aria-live="off">
      <div className="caption-line">
        {words.map((w, i) => {
          const isActive = i === active;
          const progress = style === 'karaoke' ? Math.min(1, Math.max(0, (time - w.start) / Math.max(0.05, w.end - w.start))) : 0;
          return (
            <span
              key={`${w.start}-${i}`}
              className={`cw ${isActive ? 'active' : ''} ${i < active ? 'past' : ''}`}
              style={style === 'karaoke' ? ({ '--fill': `${progress * 100}%` } as React.CSSProperties) : undefined}
            >
              {uppercase ? w.text.toUpperCase() : w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
