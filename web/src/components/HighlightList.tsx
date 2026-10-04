import { formatTime, type ScoreBreakdown } from '../lib/shared';
import type { ClipItem } from '../lib/clips';
import { Plus, Trash } from './Icons';

interface Props {
  clips: ClipItem[];
  activeId: string | null;
  checked: Set<string>;
  hasTranscript: boolean;
  onPick: (id: string) => void;
  onToggle: (id: string) => void;
  onAddSelection: () => void;
  onRemoveCustom: (id: string) => void;
  canAdd: boolean;
}

const LABELS: [keyof ScoreBreakdown, string][] = [
  ['loudness', 'Energy'],
  ['dynamics', 'Dynamics'],
  ['speech', 'Speech'],
  ['keywords', 'Keywords'],
  ['motion', 'Motion'],
  ['hook', 'Hook'],
  ['llm', 'LLM'],
];

function Ring({ score }: { score: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" width="44" height="44" viewBox="0 0 44 44" aria-label={`score ${score}`}>
      <circle cx="22" cy="22" r={r} stroke="rgba(253,249,243,0.1)" strokeWidth="4" fill="none" />
      <circle
        cx="22"
        cy="22"
        r={r}
        stroke="#c8ff3d"
        strokeWidth="4"
        fill="none"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 22 22)"
      />
      <text x="22" y="26" textAnchor="middle">
        {Math.round(score)}
      </text>
    </svg>
  );
}

export function HighlightList({ clips, activeId, checked, hasTranscript, onPick, onToggle, onAddSelection, onRemoveCustom, canAdd }: Props) {
  return (
    <div className="highlights">
      <div className="row between">
        <p className="muted small">Ranked by audio energy, speech density{hasTranscript ? ', keywords' : ''} and motion. Tick the ones to export.</p>
        <button className="chip" onClick={onAddSelection} disabled={!canAdd} title="Add the current selection as a custom clip">
          <Plus width={14} height={14} /> Selection
        </button>
      </div>
      <ul className="hl-list">
        {clips.map((c, i) => (
          <li key={c.id} className={`hl ${c.id === activeId ? 'active' : ''}`} onClick={() => onPick(c.id)}>
            <label className="check" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={checked.has(c.id)} onChange={() => onToggle(c.id)} />
              <span />
            </label>
            {c.score !== undefined ? <Ring score={c.score} /> : <div className="ring custom">✂</div>}
            <div className="hl-body">
              <div className="hl-title">
                <span className="rank">#{i + 1}</span> {c.title || 'Custom clip'}
              </div>
              <div className="hl-meta">
                {formatTime(c.start)} → {formatTime(c.end)} · {(c.end - c.start).toFixed(1)}s
                {c.highlight?.keywordHits?.length ? <span className="kw"> · {c.highlight.keywordHits.join(', ')}</span> : null}
              </div>
              {c.highlight && (
                <div className="bars">
                  {LABELS.filter(([k]) => c.highlight!.breakdown[k] !== undefined).map(([k, label]) => (
                    <div key={k} className="bar" title={`${label}: ${Math.round((c.highlight!.breakdown[k] ?? 0) * 100)}%`}>
                      <i style={{ height: `${Math.max(6, (c.highlight!.breakdown[k] ?? 0) * 100)}%` }} />
                      <span>{label.slice(0, 3)}</span>
                    </div>
                  ))}
                </div>
              )}
              {c.highlight?.reason && <p className="reason">{c.highlight.reason}</p>}
            </div>
            {c.custom && (
              <button
                className="icon-btn subtle"
                title="Remove clip"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveCustom(c.id);
                }}
              >
                <Trash width={14} height={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
