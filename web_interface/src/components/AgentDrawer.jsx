import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileUp,
  PanelRightClose,
  PanelRightOpen,
  Save,
  Trash2,
} from 'lucide-react';
import StatusDot from './StatusDot';

const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'protocol', label: 'Protocol' },
  { id: 'presets', label: 'Presets' },
];

const formatTs = (value) => {
  if (!value) return null;
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return String(value);
  return ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const prettyJson = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
};

const AgentDrawer = ({
  drawerOpen,
  setDrawerOpen,
  trace,
  expandedTraceId,
  setExpandedTraceId,
  runStatus,
  activeRun,
  presets,
  presetsBusy,
  onCreatePreset,
  onDeletePreset,
  onExportPreset,
  onImportPresetFile,
  onLoadPreset,
}) => {
  const [activeTab, setActiveTab] = useState('timeline');
  const [presetName, setPresetName] = useState('');
  const fileInputRef = useRef(null);

  const protocolSteps = useMemo(() => {
    const steps = activeRun?.protocol?.steps;
    return Array.isArray(steps) ? steps : [];
  }, [activeRun?.protocol?.steps]);

  const canCreatePreset = Boolean(activeRun?.id && activeRun?.protocol && !presetsBusy);
  const activeRunArtifacts = Array.isArray(activeRun?.artifacts) ? activeRun.artifacts : [];
  const runError = activeRun?.error ? String(activeRun.error) : '';

  return (
    <aside
      className={`${drawerOpen ? 'flex' : 'hidden'} min-h-[calc(100vh-120px)] flex-col rounded-2xl border border-white/10 bg-[var(--surface-1)]/95 lg:flex`}
      aria-label="Run inspector panel"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Run Inspector</p>
        <button
          onClick={() => setDrawerOpen((open) => !open)}
          className="rounded-lg border border-white/10 bg-[var(--surface-2)] p-1.5 text-[var(--text-muted)] transition hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          aria-label={drawerOpen ? 'Collapse inspector panel' : 'Expand inspector panel'}
        >
          {drawerOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>
      </div>

      <div className="border-b border-white/10 px-2 py-2">
        <div className="grid grid-cols-3 gap-1">
          {TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-2 py-1.5 text-xs transition focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                  selected
                    ? 'bg-cyan-400/15 text-cyan-200'
                    : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                aria-pressed={selected}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 overflow-y-auto px-3 py-3">
        {activeTab === 'timeline' ? (
          <>
            <div className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-3 py-2">
              <p className="text-[11px] text-[var(--text-muted)]">Run status</p>
              <p className="text-sm text-[var(--text-primary)]">{String(runStatus || 'idle')}</p>
            </div>
            {runError ? (
              <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                {runError}
              </div>
            ) : null}

            {trace.map((step) => {
              const isExpanded = expandedTraceId === step.id;
              return (
                <article key={step.id} className="rounded-xl border border-white/10 bg-[var(--surface-2)]/80">
                  <button
                    onClick={() => setExpandedTraceId(isExpanded ? null : step.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                    aria-expanded={isExpanded}
                  >
                    <span className="flex items-center gap-2">
                      <StatusDot status={step.status} />
                      <span className="text-sm text-[var(--text-secondary)]">{step.label}</span>
                    </span>
                    <span className="text-[var(--text-muted)]">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                  </button>
                  {isExpanded ? (
                    <div className="border-t border-white/10 px-3 py-2.5 text-xs leading-5 text-[var(--text-muted)]">
                      <p>{step.detail}</p>
                      <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                        {step.duration ? `Duration: ${step.duration}` : 'Duration: pending'}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                        Started: {formatTs(step.startedAt) || 'pending'}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                        Completed: {formatTs(step.completedAt) || 'pending'}
                      </p>
                    </div>
                  ) : null}
                </article>
              );
            })}

            <section className="rounded-xl border border-white/10 bg-[var(--surface-2)]/80 px-3 py-2.5">
              <p className="text-xs font-medium text-[var(--text-primary)]">Artifacts</p>
              {activeRunArtifacts.length === 0 ? (
                <p className="mt-1 text-xs text-[var(--text-muted)]">No artifacts yet.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {activeRunArtifacts.map((artifact, index) => (
                    <li key={`${artifact.path || artifact.kind || 'artifact'}-${index}`} className="text-xs text-[var(--text-secondary)]">
                      {artifact.kind || 'artifact'}: {artifact.path || artifact.description || 'unnamed'}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}

        {activeTab === 'protocol' ? (
          <section className="space-y-2">
            <div className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-3 py-2">
              <p className="text-xs text-[var(--text-primary)]">Protocol inspector</p>
              <p className="text-[11px] text-[var(--text-muted)]">Raw validated payload by step.</p>
            </div>
            {protocolSteps.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-muted)]">
                No protocol payload available yet.
              </div>
            ) : (
              protocolSteps.map((step, index) => (
                <article
                  key={String(step.id || `step-${index}`)}
                  className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-3 py-2"
                >
                  <p className="text-xs font-medium text-[var(--text-primary)]">
                    {String(step.id || `step_${index + 1}`)} ({String(step.type || 'unknown')})
                  </p>
                  <pre className="mt-2 max-h-56 overflow-auto rounded bg-black/30 p-2 text-[11px] leading-5 text-[var(--text-secondary)]">
                    {prettyJson(step)}
                  </pre>
                </article>
              ))
            )}
          </section>
        ) : null}

        {activeTab === 'presets' ? (
          <section className="space-y-2">
            <div className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-3 py-2">
              <p className="text-xs font-medium text-[var(--text-primary)]">Preset manager</p>
              <p className="text-[11px] text-[var(--text-muted)]">Save, load, import, and export protocol presets.</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-3 py-2">
              <label htmlFor="preset-name" className="text-[11px] text-[var(--text-secondary)]">
                New preset name
              </label>
              <input
                id="preset-name"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder="Example: Geo scatter v1"
                className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={!canCreatePreset}
                  onClick={() => {
                    onCreatePreset?.(presetName.trim());
                    setPresetName('');
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Save className="h-3.5 w-3.5" /> Save
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                >
                  <FileUp className="h-3.5 w-3.5" /> Import
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onImportPresetFile?.(file);
                    event.target.value = '';
                  }}
                />
              </div>
              {!canCreatePreset ? (
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                  Run must include protocol data before saving a preset.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              {Array.isArray(presets) && presets.length > 0 ? (
                presets.map((preset) => (
                  <article key={preset.id} className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-3 py-2">
                    <p className="text-xs font-medium text-[var(--text-primary)]">{preset.name}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {preset.updatedAt ? `Updated ${new Date(preset.updatedAt).toLocaleString()}` : 'No timestamp'}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onLoadPreset?.(preset.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                      >
                        <Copy className="h-3.5 w-3.5" /> Load
                      </button>
                      <button
                        type="button"
                        onClick={() => onExportPreset?.(preset.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                      >
                        <Download className="h-3.5 w-3.5" /> Export
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeletePreset?.(preset.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-200 transition hover:text-red-100 focus-visible:ring-2 focus-visible:ring-red-400/60"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-lg border border-white/10 bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-muted)]">
                  No presets saved yet.
                </div>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
};

export default AgentDrawer;
