import { AGENTS } from '../lib/data';
import type { SimState } from '../lib/engine';
import { formatNumber } from '../lib/engine';
import { Panel, PanelHead, Eyebrow } from './ui';

/** Maps roster agents to their routing role. FOREMAN plans under the King's banner. */
const ROLE_OF_AGENT: Record<string, string> = {
  SUPREMUS: 'king',
  SCOUT: 'scout',
  ORACLE: 'architect',
  FOREMAN: 'king',
  WRAITH: 'worker',
  FORGE: 'worker',
  LUMEN: 'worker',
  ARBITER: 'reviewer',
  HERALD: 'qa',
};

const ROLE_LABEL: Record<string, string> = {
  king: 'King · strongest reasoning',
  scout: 'Scout · efficient extraction',
  architect: 'Architect · strong reasoning',
  worker: 'Worker · best coding model',
  reviewer: 'Reviewer · independent judgement',
  qa: 'QA · efficient verification',
};

export default function ModelRouting({ state }: { state: SimState }) {
  const rows = state.routing.length
    ? state.routing
    : Object.keys(ROLE_LABEL).map((role) => ({ role, provider: '—', model: '—' }));

  const agentsByRole = AGENTS.reduce<Record<string, string[]>>((acc, a) => {
    const role = ROLE_OF_AGENT[a.id] ?? 'king';
    (acc[role] ??= []).push(a.name);
    return acc;
  }, {});

  const totalCalls = Object.values(state.usageByRole).reduce((s, u) => s + u.calls, 0);
  const fallbacks = Object.values(state.usageByRole).reduce((s, u) => s + u.fallbacks, 0);

  return (
    <Panel id="routing" className="mt-6 overflow-hidden">
      <PanelHead
        eyebrow="Model routing · one provider per role"
        title="Who Runs On What"
        right={
          <span className="font-mono text-[11px] text-inkfaint">
            CALLS <span className="text-cyan">{totalCalls}</span>
            {fallbacks > 0 && (
              <>
                {' '}
                · FAILOVER <span className="text-amber">{fallbacks}</span>
              </>
            )}
          </span>
        }
      />

      <div className="rail-scroll overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-linesoft font-mono text-[9px] uppercase tracking-[0.2em] text-inkfaint">
              <th className="px-5 py-2.5 font-medium">Role</th>
              <th className="px-3 py-2.5 font-medium">Provider</th>
              <th className="px-3 py-2.5 font-medium">Model</th>
              <th className="px-3 py-2.5 font-medium">Agents</th>
              <th className="px-5 py-2.5 text-right font-medium">Tokens / Calls</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const usage = state.usageByRole[r.role];
              const idle = !usage;
              return (
                <tr key={r.role} className="border-b border-linesoft/70 transition-colors hover:bg-panel2/60">
                  <td className="px-5 py-3">
                    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-gold">{r.role}</div>
                    <div className="mt-0.5 text-[11px] text-inkfaint">{ROLE_LABEL[r.role]}</div>
                  </td>
                  <td className="px-3 py-3 font-mono text-[11.5px] text-inkdim">{r.provider}</td>
                  <td className="px-3 py-3">
                    <span className="rounded border border-line bg-panel px-2 py-0.5 font-mono text-[11px] text-ink">
                      {r.model}
                    </span>
                    {usage && usage.fallbacks > 0 && (
                      <span className="ml-2 rounded border border-amber/40 bg-amber/10 px-1.5 py-0.5 font-mono text-[9px] text-amber">
                        {`${usage.fallbacks} FAILOVER`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[11.5px] text-inkdim">
                    {(agentsByRole[r.role] ?? []).join(', ') || '—'}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[11px] tabular-nums">
                    {idle ? (
                      <span className="text-inkfaint/60">idle</span>
                    ) : (
                      <>
                        <span className="text-ink">{formatNumber(usage!.prompt + usage!.completion)}</span>
                        <span className="ml-2 text-inkfaint">{usage!.calls}</span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-linesoft px-5 py-3">
        <Eyebrow>
          {state.hasKey
            ? 'Configure via king.config.json or KING_ROUTES / KING_PROVIDERS — failed routes fail over to the default provider automatically'
            : 'No API key configured — set KING_API_KEY or add providers in king.config.json'}
        </Eyebrow>
      </div>
    </Panel>
  );
}
