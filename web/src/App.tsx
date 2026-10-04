import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Health, type Project, type ProjectDetail } from './api';
import { useJob } from './lib/useJob';
import { mergeClips, type ClipItem } from './lib/clips';
import { allWords, DEFAULT_EXPORT_OPTIONS, formatDuration, layoutCaptions, type ExportOptions, type Range } from './lib/shared';
import { Library } from './components/Library';
import { Player, type PlayerHandle } from './components/Player';
import { Timeline } from './components/Timeline';
import { HighlightList } from './components/HighlightList';
import { ExportPanel } from './components/ExportPanel';
import { AnalysePanel } from './components/AnalysePanel';
import { Logo } from './components/Icons';

type Tab = 'highlights' | 'export' | 'analyse';

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('highlights');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Range | null>(null);
  const [trims, setTrims] = useState<Record<string, Range>>({});
  const [custom, setCustom] = useState<ClipItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [time, setTime] = useState(0);
  const player = useRef<PlayerHandle>(null);

  const project = detail?.project ?? null;
  const analysis = detail?.analysis ?? null;

  const refreshProjects = useCallback(
    () =>
      api
        .listProjects()
        .then(setProjects)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  const open = useCallback(async (id: string) => {
    try {
      const d = await api.getProject(id);
      setDetail(d);
      setTrims({});
      setCustom([]);
      const hs = d.analysis?.highlights ?? [];
      setChecked(new Set(hs.slice(0, 3).map((h) => h.id)));
      const first = hs[0];
      setActiveId(first?.id ?? null);
      setSelection(first ? { start: first.start, end: first.end } : null);
      setTab(d.analysis ? 'highlights' : 'analyse');
      if (first) setTimeout(() => player.current?.seek(first.start), 50);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!project) return;
    const d = await api.getProject(project.id);
    setDetail(d);
    return d;
  }, [project]);

  const [analyzeJob, setAnalyzeJob] = useJob(async (job) => {
    if (job.status === 'done' && project) {
      await open(project.id);
      void refreshProjects();
    }
  });
  const [exportJob, setExportJob] = useJob(async () => {
    await reload();
  });

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
    void refreshProjects().then(async () => {
      const list = await api.listProjects();
      if (list[0]) void open(list[0].id);
    });
  }, [refreshProjects, open]);

  const clips = useMemo(() => mergeClips(analysis?.highlights ?? [], trims, custom), [analysis, trims, custom]);
  const lines = useMemo(() => layoutCaptions(allWords(analysis?.transcript), { maxWords: 3, maxChars: 18 }), [analysis]);

  const pick = (id: string) => {
    const c = clips.find((x) => x.id === id);
    if (!c) return;
    setActiveId(id);
    setSelection({ start: c.start, end: c.end });
    player.current?.seek(c.start);
  };

  const changeSelection = (r: Range) => {
    setSelection(r);
    if (activeId) setTrims((t) => ({ ...t, [activeId]: r }));
  };

  const upload = async (file: File) => {
    setError(null);
    try {
      setBusy('Uploading… 0%');
      const p = await api.upload(file, (x) => setBusy(`Uploading… ${Math.round(x * 100)}%`));
      await refreshProjects();
      await open(p.id);
      setAnalyzeJob(await api.analyze(p.id, { transcribe: 'auto' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sample = async () => {
    setError(null);
    try {
      setBusy('Rendering sample…');
      const p = await api.createSample();
      await refreshProjects();
      await open(p.id);
      if (!api.demo)
        setAnalyzeJob(await api.analyze(p.id, { options: { minClip: 6, targetClip: 10, maxClip: 16, count: 5, keywords: ['secret', 'captions'] } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doExport = async () => {
    if (!project) return;
    setError(null);
    const chosen = clips.filter((c) => checked.has(c.id));
    try {
      setExportJob(
        await api.exportClips(
          project.id,
          chosen.map((c) => ({ start: c.start, end: c.end, title: c.title })),
          exportOptions,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addSelection = () => {
    if (!selection) return;
    const id = `custom-${Date.now()}`;
    setCustom((c) => [...c, { id, start: selection.start, end: selection.end, title: `Custom clip ${c.length + 1}`, custom: true }]);
    setChecked((s) => new Set(s).add(id));
    setActiveId(id);
  };

  const onTime = useCallback((t: number) => setTime(t), []);
  const stats = analysis?.stats;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span>kerfreel</span>
          <em>clip studio</em>
        </div>
        {project && <div className="crumb">{project.name}</div>}
        <span className="spacer" />
        {health?.demo && <span className="pill lime">Live demo · read-only</span>}
        {health && !health.demo && <span className={`pill ${health.ffmpeg ? '' : 'bad'}`}>ffmpeg {health.ffmpeg ?? 'missing'}</span>}
        {health && !health.demo && <span className="pill">{health.openai ? 'API captions ✓' : health.whisperLocal ? 'local whisper ✓' : 'SRT captions'}</span>}
        <a className="pill link" href="https://github.com/hbtabi/kerfreel" target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </header>

      {error && (
        <div className="toast" onClick={() => setError(null)}>
          {error} <span className="dim">· dismiss</span>
        </div>
      )}

      <main className="layout">
        <Library
          projects={projects}
          currentId={project?.id ?? null}
          demo={!!health?.demo}
          busy={busy}
          onOpen={open}
          onUpload={upload}
          onSample={sample}
          onDelete={async (id) => {
            await api.deleteProject(id);
            if (project?.id === id) setDetail(null);
            void refreshProjects();
          }}
        />

        <section className="center">
          {project ? (
            <>
              <Player
                ref={player}
                src={api.mediaUrl(project.id)}
                analysis={analysis}
                selection={selection}
                lines={lines}
                captionStyle={exportOptions.captionStyle}
                uppercase={exportOptions.uppercase}
                reframe={exportOptions.reframe}
                onTime={onTime}
              />
              {analysis ? (
                <>
                  <div className="stats">
                    <div>
                      <b>{formatDuration(analysis.media.duration)}</b>
                      <span>source</span>
                    </div>
                    <div>
                      <b>{analysis.silences.length}</b>
                      <span>pauses found</span>
                    </div>
                    <div>
                      <b className="lime">−{formatDuration(stats?.silenceSeconds ?? 0)}</b>
                      <span>dead air</span>
                    </div>
                    <div>
                      <b>{analysis.highlights.length}</b>
                      <span>highlights</span>
                    </div>
                    <div>
                      <b>{analysis.transcript ? analysis.transcript.source.toUpperCase() : '—'}</b>
                      <span>captions</span>
                    </div>
                    <div>
                      <b>
                        {analysis.media.width}×{analysis.media.height}
                      </b>
                      <span>{analysis.media.fps} fps</span>
                    </div>
                  </div>
                  <Timeline
                    analysis={analysis}
                    time={time}
                    selection={selection}
                    clips={clips}
                    activeClipId={activeId}
                    onSeek={(t) => player.current?.seek(t)}
                    onSelectionChange={changeSelection}
                    onPickClip={pick}
                  />
                </>
              ) : (
                <div className="placeholder">
                  Not analysed yet — open the <b>Analyse</b> tab to find pauses and highlights.
                </div>
              )}
            </>
          ) : (
            <div className="hero">
              <h1>
                Long video in.
                <br />
                <span className="lime">Scroll-stopping clips</span> out.
              </h1>
              <p>
                Import a stream, podcast or vlog. kerfreel cuts the dead air, ranks the best moments, burns animated captions and exports Shorts, TikToks, Reels
                and 16:9 — all on your machine.
              </p>
              <button className="btn primary big" onClick={sample}>
                Try it with a synthetic sample
              </button>
            </div>
          )}
        </section>

        <aside className="side panel">
          <nav className="tabs">
            {(['highlights', 'export', 'analyse'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} disabled={!project}>
                {t === 'highlights'
                  ? `Highlights${clips.length ? ` · ${clips.length}` : ''}`
                  : t === 'export'
                    ? `Export${checked.size ? ` · ${checked.size}` : ''}`
                    : 'Analyse'}
              </button>
            ))}
          </nav>
          <div className="tab-body">
            {project &&
              tab === 'highlights' &&
              (analysis ? (
                <HighlightList
                  clips={clips}
                  activeId={activeId}
                  checked={checked}
                  hasTranscript={!!analysis.transcript}
                  onPick={pick}
                  onToggle={(id) =>
                    setChecked((s) => {
                      const n = new Set(s);
                      if (n.has(id)) n.delete(id);
                      else n.add(id);
                      return n;
                    })
                  }
                  onAddSelection={addSelection}
                  onRemoveCustom={(id) => setCustom((c) => c.filter((x) => x.id !== id))}
                  canAdd={!!selection}
                />
              ) : (
                <p className="muted">Run an analysis first.</p>
              ))}
            {project && tab === 'export' && (
              <ExportPanel
                options={exportOptions}
                onChange={setExportOptions}
                selectedCount={clips.filter((c) => checked.has(c.id)).length}
                onExport={doExport}
                job={exportJob}
                exports={detail?.exports ?? []}
                exportUrl={(f, dl) => api.exportUrl(project.id, f, dl)}
                onDeleteExport={async (f) => {
                  await api.deleteExport(project.id, f);
                  void reload();
                }}
                demo={api.demo}
                hasTranscript={!!analysis?.transcript}
              />
            )}
            {project && tab === 'analyse' && (
              <AnalysePanel
                key={project.id}
                initial={analysis?.options}
                health={health}
                job={analyzeJob}
                hasSubtitles={project.hasSubtitles}
                onAnalyze={async (req) => {
                  try {
                    setAnalyzeJob(await api.analyze(project.id, req));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
                onSubtitles={async (text) => {
                  try {
                    await api.uploadSubtitles(project.id, text);
                    await open(project.id);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
