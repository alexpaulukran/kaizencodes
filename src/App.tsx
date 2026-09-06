import { useCallback, useEffect, useState } from 'react';
import TopBar from './components/TopBar';
import Hero from './components/Hero';
import StageRail from './components/StageRail';
import AgentRoster from './components/AgentRoster';
import ModelRouting from './components/ModelRouting';
import TaskBoard from './components/TaskBoard';
import RequirementLedger from './components/RequirementLedger';
import Console from './components/Console';
import Telemetry from './components/Telemetry';
import Charter from './components/Charter';
import ReleaseGate from './components/ReleaseGate';
import CrownMark from './components/CrownMark';
import { Eyebrow, Panel } from './components/ui';
import { adapt, idleState, metrics, type KingSnapshot, type SimState } from './lib/engine';
import {
  fetchHealth,
  fetchState,
  kingUrl,
  pauseRun,
  resetRun,
  resumeRun,
  startRun,
  type ConnectionStatus,
  type HealthResult,
} from './lib/api';

// ──────────────────────────────────────────────────────────────────────────────
// Connection status banner
// ──────────────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected:  'Connected',
  offline:    'Unreachable',
  timeout:    'Timed out',
  error:      'Error',
};

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connecting: 'text-inkdim',
  connected:  'text-emerald',
  offline:    'text-amber',
  timeout:    'text-amber',
  error:      'text-crimson',
};

function ConnectionBadge({ health }: { health: HealthResult }) {
  const label = STATUS_LABEL[health.status];
  const color = STATUS_COLOR[health.status];
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${color}`}>
      {label}
    </span>
  );
}

function SetupBanner({ health }: { health: HealthResult }) {
  const isTimeout = health.status === 'timeout';
  const headline = isTimeout
    ? 'King service timed out'
    : health.status === 'error'
      ? 'King service error'
      : 'King service unreachable';

  return (
    <Panel className="mt-6 border-amber/40">
      <div className="p-5 sm:p-6">
        <Eyebrow tone="gold">
          {headline} · <ConnectionBadge health={health} />
        </Eyebrow>
        <h2 className="mt-1 font-display text-lg font-semibold tracking-wide text-ink">
          Start the orchestrator to run real agents
        </h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-inkdim">
          This deck is the front end for the Supervisor King service, which runs on your machine and
          holds the real model key, the workspace filesystem and the shell. Nothing is simulated —
          without the service there is nothing to display.
        </p>
        {health.message && (
          <p className="mt-2 font-mono text-[11px] text-amber">
            {health.message}
          </p>
        )}
        <pre className="mt-4 overflow-x-auto rounded border border-line bg-void/70 p-4 font-mono text-[11px] leading-relaxed text-inkdim">
{`# Backend URL is controlled by VITE_KING_URL (currently: ${kingUrl})
export KING_API_KEY=sk-...               # any OpenAI-compatible key
export KING_API_BASE=https://api.openai.com/v1   # optional
export KING_MODEL=gpt-4o-mini            # optional
export KING_WORKSPACE=./my-project       # optional
export KING_ALLOWED_ORIGIN=http://localhost:5173  # set for production
npm run king                             # starts the service`}
        </pre>
      </div>
    </Panel>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// App
// ──────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [snap, setSnap]       = useState<KingSnapshot | null>(null);
  const [health, setHealth]   = useState<HealthResult>({ ok: false, status: 'connecting' });
  const [notice, setNotice]   = useState<string | null>(null);
  const [speed, setSpeed]     = useState(1);
  const [busy, setBusy]       = useState(false);

  // ── polling ────────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    // Only probe health while offline to avoid double requests when connected.
    if (!health.ok) {
      const h = await fetchHealth();
      setHealth(h);
      if (!h.ok) return;
    }
    try {
      const s = await fetchState();
      setSnap(s);
      if (!health.ok) setHealth({ ok: true, status: 'connected', backendUrl: kingUrl });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof DOMException && (err as DOMException).name === 'AbortError';
      setHealth({
        ok: false,
        status: isTimeout ? 'timeout' : 'error',
        message: msg,
      });
    }
  }, [health.ok]);

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), Math.round(1600 / speed));
    return () => window.clearInterval(id);
  }, [speed, refresh]);

  // ── actions ────────────────────────────────────────────────────────────────

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      const s = await fetchState();
      setSnap(s);
      setHealth({ ok: true, status: 'connected', backendUrl: kingUrl });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const onStart  = (prompt: string, build: string, test: string) =>
    act(() => startRun({ masterPrompt: prompt, buildCommand: build, testCommand: test }));
  const onToggle = () => act(() => (state.running ? pauseRun() : resumeRun()));
  const onResume = () => act(() => resumeRun());
  const onReset  = () => act(() => resetRun());

  // ── keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.code === 'Space') { e.preventDefault(); onToggle(); }
      else if (e.key === 'r' || e.key === 'R') { onReset(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── render ─────────────────────────────────────────────────────────────────

  const state: SimState = snap ? adapt(snap, speed) : idleState(speed);
  const m = metrics(state);
  const offline = !health.ok;

  return (
    <div className="relative min-h-screen">
      <div aria-hidden className="grid-etch pointer-events-none fixed inset-0 z-0 opacity-60" />

      <div className="relative z-10">
        <TopBar state={state} overall={m.overall} />

        <main className="mx-auto max-w-[1440px] px-4 pb-20 sm:px-6">

          {/* Connection problem banner */}
          {offline && <SetupBanner health={health} />}

          {/* Action error notice */}
          {!offline && notice && (
            <Panel className="mt-6 border-crimson/40">
              <p className="px-5 py-4 font-mono text-[12px] text-crimson">{notice}</p>
            </Panel>
          )}

          <Hero
            state={state}
            overall={m.overall}
            offline={offline}
            busy={busy}
            onStart={onStart}
            onToggle={onToggle}
            onReset={onReset}
            onSpeed={setSpeed}
          />
          <StageRail state={state} stageProgress={m.stageProgress} />
          <AgentRoster state={state} load={m.byAgent} />
          <ModelRouting state={state} />
          <TaskBoard state={state} />
          <RequirementLedger state={state} onResume={onResume} />
          <Console state={state} />
          <Telemetry state={state} />
          <Charter />
          <ReleaseGate state={state} onResume={onResume} onReset={onReset} />

          <footer className="mt-10 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CrownMark size={20} />
              <div>
                <div className="font-display text-[13px] font-semibold tracking-[0.14em] text-inkdim">
                  SUPERVISOR KING
                </div>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-inkfaint">
                  <span>Mission Control · real orchestration</span>
                  <span className="text-inkfaint/40">·</span>
                  {/* Show the configured backend URL */}
                  <span className="text-inkfaint/60" title={`VITE_KING_URL = ${kingUrl}`}>
                    {kingUrl}
                  </span>
                  <ConnectionBadge health={health} />
                </div>
              </div>
            </div>
            <p className="max-w-md font-mono text-[10px] leading-relaxed text-inkfaint/80">
              Every status here is derived from the orchestrator: real model calls, real file
              operations, real command output. No completion is reported on a worker's say-so.
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
