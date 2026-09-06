import { CheckCircle2, CircleDashed, FileText, GitBranch } from 'lucide-react';
import type { SimState } from '../lib/engine';
import { Eyebrow, Panel, PanelHead } from './ui';

const STATUS_TONE: Record<string, string> = {
  pending: 'border-line text-inkfaint',
  in_progress: 'border-cyan/40 text-cyan',
  awaiting_review: 'border-amber/40 text-amber',
  awaiting_qa: 'border-amber/40 text-amber',
  fix_required: 'border-crimson/40 text-crimson',
  passed: 'border-mint/40 text-mint',
  failed: 'border-crimson/50 text-crimson',
  skipped: 'border-line text-inkdim',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'QUEUED',
  in_progress: 'IMPLEMENTING',
  awaiting_review: 'REVIEW',
  awaiting_qa: 'QA',
  fix_required: 'FIX REQUIRED',
  passed: 'PASS',
  failed: 'ESCALATED',
  skipped: 'SKIPPED',
};

export default function RequirementLedger({ state, onResume }: { state: SimState; onResume: () => void }) {
  const passed = state.requirements.filter((r) => r.status === 'passed').length;

  return (
    <>
      <Panel id="ledger" className="mt-6 overflow-hidden">
        <PanelHead
          eyebrow="Requirement ledger · REQ → implementation → validation → evidence"
          title="The Audit Trail"
          right={
            <span className="font-mono text-[11px] text-inkfaint">
              <span className="text-mint">{passed}</span> / {state.requirements.length} PASS
            </span>
          }
        />

        {state.requirements.length === 0 ? (
          <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <GitBranch size={20} className="text-inkfaint" />
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-inkfaint">Ledger empty</p>
            <p className="max-w-md text-[13px] text-inkdim">
              Every requirement the King registers gets an ID, an owner, real file changes, an independent verdict and
              captured command output — all of it recorded here.
            </p>
          </div>
        ) : (
          <div className="rail-scroll max-h-[460px] overflow-y-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-panel/95 backdrop-blur">
                <tr className="border-b border-linesoft font-mono text-[9px] uppercase tracking-[0.2em] text-inkfaint">
                  <th className="px-5 py-2.5 font-medium">ID</th>
                  <th className="px-3 py-2.5 font-medium">Requirement</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Owner</th>
                  <th className="px-3 py-2.5 font-medium">Evidence</th>
                  <th className="px-5 py-2.5 text-right font-medium">Files / RW</th>
                </tr>
              </thead>
              <tbody>
                {state.requirements.map((r) => {
                  const review = r.evidence.filter((e) => e.kind === 'review').slice(-1)[0];
                  const qa = r.evidence.filter((e) => e.kind === 'qa').slice(-1)[0];
                  const verdict = r.evidence.filter((e) => e.kind === 'verdict').slice(-1)[0];
                  return (
                    <tr key={r.id} className="border-b border-linesoft/70 align-top transition-colors hover:bg-panel2/60">
                      <td className="px-5 py-3 font-mono text-[11px] text-gold">{r.id}</td>
                      <td className="max-w-[360px] px-3 py-3">
                        <p className="text-[12.5px] leading-snug text-ink">{r.statement}</p>
                        <ul className="mt-1.5 space-y-0.5">
                          {r.criteria.slice(0, 3).map((c, i) => (
                            <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-inkfaint">
                              <span className="text-golddim">·</span>
                              <span className="line-clamp-1">{c}</span>
                            </li>
                          ))}
                        </ul>
                        {r.lastError && (
                          <p className="mt-1.5 line-clamp-2 font-mono text-[10px] leading-snug text-crimson/90">
                            last failure: {r.lastError}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[9px] tracking-[0.14em] ${
                            STATUS_TONE[r.status] ?? 'border-line text-inkfaint'
                          }`}
                        >
                          {STATUS_LABEL[r.status] ?? r.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-inkdim">{r.agent ?? '—'}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            { key: 'review', data: review },
                            { key: 'qa', data: qa },
                            { key: 'verdict', data: verdict },
                          ].map(({ key, data }) => (
                            <span
                              key={key}
                              title={data?.summary ?? 'not yet run'}
                              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] ${
                                !data
                                  ? 'border-line/70 text-inkfaint/60'
                                  : data.ok
                                    ? 'border-mint/40 text-mint'
                                    : 'border-crimson/40 text-crimson'
                              }`}
                            >
                              {data?.ok ? <CheckCircle2 size={9} /> : <CircleDashed size={9} />}
                              {key.toUpperCase()}
                            </span>
                          ))}
                        </div>
                        {verdict && (
                          <p className="mt-1.5 line-clamp-2 max-w-[240px] text-[10.5px] leading-snug text-inkfaint">
                            {verdict.summary}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-[11px] tabular-nums text-inkdim">
                        <span className="inline-flex items-center gap-1.5">
                          <FileText size={11} className="text-inkfaint" />
                          {r.files.length}
                        </span>
                        <span className="ml-2 text-crimson/90">{r.fixCount > 0 ? `+${r.fixCount}` : ''}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="mt-6">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <div>
            <Eyebrow>Checkpoint</Eyebrow>
            <p className="mt-1 font-mono text-[11px] text-inkdim">
              {state.checkpointAt ? new Date(state.checkpointAt).toLocaleString() : 'no checkpoint yet'}
            </p>
          </div>
          <div>
            <Eyebrow>Phase</Eyebrow>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-cyan">{state.phase}</p>
          </div>
          <div>
            <Eyebrow>Iteration</Eyebrow>
            <p className="mt-1 font-mono text-[11px] tabular-nums text-inkdim">{state.iteration}</p>
          </div>
          <div className="min-w-0 flex-1">
            <Eyebrow>Workspace</Eyebrow>
            <p className="mt-1 truncate font-mono text-[11px] text-inkdim">{state.workspace}</p>
          </div>
          <div className="min-w-[180px]">
            <Eyebrow>Commands</Eyebrow>
            <p className="mt-1 truncate font-mono text-[11px] text-inkfaint">
              build: {state.commands.build || '—'} · test: {state.commands.test || '—'}
            </p>
          </div>
          {state.paused && (
            <button
              onClick={onResume}
              className="rounded-md bg-gold px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-void transition hover:bg-goldhi"
            >
              Resume from checkpoint
            </button>
          )}
        </div>
      </Panel>
    </>
  );
}
