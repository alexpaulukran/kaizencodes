import { useId } from 'react';
import { formatNumber, type SimState } from '../lib/engine';
import { Eyebrow, Meter, Panel, PanelHead } from './ui';

interface Props {
  state: SimState;
}

function Tile({ label, value, sub, tone = 'text-ink' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-panel/70 px-4 py-3.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-inkfaint">{label}</div>
      <div className={`mt-1.5 font-mono text-[19px] leading-none tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-1.5 font-mono text-[10px] leading-snug text-inkfaint">{sub}</div>}
    </div>
  );
}

function pathFor(values: number[], w: number, h: number, min: number, max: number) {
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${Math.max(0, Math.min(h, y)).toFixed(1)}`;
    })
    .join(' ');
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[132px] items-center justify-center rounded border border-dashed border-line px-4 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-inkfaint/60">
      {label}
    </div>
  );
}

export default function Telemetry({ state }: Props) {
  const uid = useId().replace(/:/g, '');
  const samples = state.history;
  const tokens = samples.map((s) => s.tokens);
  const tokenMax = tokens.length ? Math.max(...tokens) * 1.08 : 1;

  return (
    <Panel id="telemetry" className="mt-6 overflow-hidden">
      <PanelHead
        eyebrow="Telemetry · from the live orchestrator"
        title="Evidence, Not Vibes"
        right={
          <span className="font-mono text-[11px] text-inkfaint">
            SAMPLES <span className="text-cyan">{String(samples.length).padStart(2, '0')}</span>
          </span>
        }
      />

      <div className="grid gap-px bg-linesoft sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label="Tokens burned" value={formatNumber(state.tokens)} sub={`${state.providerLabel} · ${state.model}`} />
        <Tile
          label="Requirements passed"
          value={`${state.passRate.toFixed(1)}%`}
          sub={`${state.taskList.filter((t) => t.lane === 'shipped').length} / ${state.taskList.length} accepted`}
          tone="text-mint"
        />
        <Tile label="QA checks" value={formatNumber(state.testTotal)} sub={`${formatNumber(state.testsPassed)} verified by command output`} tone="text-cyan" />
        <Tile label="Defects caught" value={String(state.defectsFound)} sub="review findings + failed command runs" tone="text-amber" />
        <Tile label="Repair cycles" value={String(state.reworkCycles)} sub="fix → re-review → re-test" tone="text-crimson" />
        <Tile
          label="Open bugs"
          value={String(state.openBugs)}
          sub={state.openBugs === 0 ? 'gate held' : 'escalated, not hidden'}
          tone={state.openBugs === 0 ? 'text-mint' : 'text-crimson'}
        />
      </div>

      <div className="grid gap-px border-t border-linesoft bg-linesoft lg:grid-cols-2">
        <div className="bg-panel/70 p-5">
          <div className="flex items-baseline justify-between">
            <Eyebrow>Token consumption</Eyebrow>
            <span className="font-mono text-[11px] tabular-nums text-inkdim">{formatNumber(tokenMax)}</span>
          </div>
          <div className="mt-4 h-[132px]">
            {samples.length < 2 ? (
              <EmptyChart label="awaiting samples" />
            ) : (
              <svg viewBox="0 0 300 132" preserveAspectRatio="none" className="h-full w-full">
                <defs>
                  <linearGradient id={`tok-${uid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e9b949" stopOpacity="0.34" />
                    <stop offset="100%" stopColor="#e9b949" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0.25, 0.5, 0.75].map((g) => (
                  <line key={g} x1="0" y1={132 * g} x2="300" y2={132 * g} stroke="#1c2942" strokeWidth="1" />
                ))}
                <path d={`${pathFor(tokens, 300, 132, 0, tokenMax)} L300,132 L0,132 Z`} fill={`url(#tok-${uid})`} />
                <path d={pathFor(tokens, 300, 132, 0, tokenMax)} fill="none" stroke="#e9b949" strokeWidth="1.6" />
              </svg>
            )}
          </div>
        </div>

        <div className="bg-panel/70 p-5">
          <div className="flex items-baseline justify-between">
            <Eyebrow>Pass rate &amp; coverage</Eyebrow>
            <div className="flex items-center gap-3 font-mono text-[9px] tracking-[0.14em]">
              <span className="flex items-center gap-1.5 text-cyan">
                <span className="h-0.5 w-3 bg-cyan" /> PASS RATE
              </span>
              <span className="flex items-center gap-1.5 text-mint">
                <span className="h-0.5 w-3 bg-mint" /> COVERAGE
              </span>
            </div>
          </div>
          <div className="mt-4 h-[132px]">
            {samples.length < 2 ? (
              <EmptyChart label="awaiting samples" />
            ) : (
              <svg viewBox="0 0 300 132" preserveAspectRatio="none" className="h-full w-full">
                {[0, 0.5, 1].map((g) => (
                  <line key={g} x1="0" y1={132 * g} x2="300" y2={132 * g} stroke="#1c2942" strokeWidth="1" />
                ))}
                <line x1="0" y1={132 * 0.1} x2="300" y2={132 * 0.1} stroke="#47c98a" strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />
                <path d={pathFor(samples.map((s) => s.coverage), 300, 132, 0, 100)} fill="none" stroke="#47c98a" strokeWidth="1.6" />
                <path d={pathFor(samples.map((s) => s.passRate), 300, 132, 0, 100)} fill="none" stroke="#59d8e6" strokeWidth="1.6" />
              </svg>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-linesoft px-5 py-4">
        <div className="flex items-center justify-between">
          <Eyebrow>Requirement acceptance</Eyebrow>
          <span className="font-mono text-[11px] tabular-nums text-cyan">{state.passRate.toFixed(1)}%</span>
        </div>
        <div className="relative mt-3">
          <Meter value={state.passRate / 100} tone="#59d8e6" height={6} />
          <span className="absolute -top-1 h-[14px] w-px bg-mint" style={{ left: '90%' }} />
        </div>
      </div>

      {state.testResults.length > 0 && (
        <div className="border-t border-linesoft px-5 py-4">
          <Eyebrow>Command evidence · last runs</Eyebrow>
          <ul className="mt-3 space-y-1.5">
            {state.testResults.slice(-4).map((r, i) => (
              <li key={i} className="flex items-center gap-3 font-mono text-[11px]">
                <span className={r.passed ? 'text-mint' : 'text-crimson'}>{r.passed ? 'PASS' : 'FAIL'}</span>
                <span className="text-inkfaint">exit {r.exitCode ?? '—'}</span>
                <span className="truncate text-inkdim">$ {r.command}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
