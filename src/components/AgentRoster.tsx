import { AGENTS } from '../lib/data';
import type { SimState } from '../lib/engine';
import { Eyebrow, Meter, Panel, PanelHead } from './ui';

interface Props {
  state: SimState;
  load: Record<string, { active: boolean; reviewing: boolean }>;
}

export default function AgentRoster({ state, load }: Props) {
  return (
    <Panel id="roster">
      <PanelHead
        eyebrow="Roster · model-backed agents"
        title="Who Is Doing What"
        right={
          <span className="font-mono text-[11px] text-inkfaint">
            PROVIDER <span className="text-cyan">{state.providerLabel}</span> · {state.model}
          </span>
        }
      />

      <div className="grid gap-px bg-linesoft sm:grid-cols-2 xl:grid-cols-3">
        {AGENTS.map((agent) => {
          const owned = state.taskList.filter((t) => t.agent === agent.id);
          const shippedCount = owned.filter((t) => t.lane === 'shipped').length;
          const l = load[agent.id] ?? { active: false, reviewing: false };
          const status = state.complete
            ? { label: 'STANDBY', tone: 'text-inkfaint', bg: 'bg-white/5' }
            : state.running && agent.id === 'SUPREMUS'
              ? { label: 'COMMAND', tone: 'text-gold', bg: 'bg-gold/10' }
              : l.active
                ? { label: 'EXECUTING', tone: 'text-cyan', bg: 'bg-cyan/10' }
                : l.reviewing
                  ? { label: 'IN REVIEW', tone: 'text-amber', bg: 'bg-amber/10' }
                  : state.running || state.paused
                    ? { label: 'AVAILABLE', tone: 'text-mint', bg: 'bg-mint/10' }
                    : { label: 'IDLE', tone: 'text-inkfaint', bg: 'bg-white/5' };
          const util = owned.length === 0 ? 0 : shippedCount / owned.length;
          const current = owned.find((t) => t.lane === 'executing' || t.lane === 'review');

          return (
            <article key={agent.id} className="group bg-panel/70 p-5 transition-colors hover:bg-panel2/70">
              <div className="flex items-start gap-4">
                <div className="relative shrink-0">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full border font-mono text-[13px] font-bold"
                    style={{
                      borderColor: agent.hue,
                      color: agent.hue,
                      background: `${agent.hue}14`,
                      boxShadow: l.active ? `0 0 22px -6px ${agent.hue}` : 'none',
                    }}
                  >
                    {agent.monogram}
                  </div>
                  {l.active && (
                    <span
                      className="pulse-dot absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel"
                      style={{ background: agent.hue }}
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-[15px] font-semibold tracking-wide text-ink">{agent.name}</h3>
                    <span className={`shrink-0 rounded px-2 py-0.5 font-mono text-[9px] tracking-[0.14em] ${status.bg} ${status.tone}`}>
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-inkdim">{agent.role}</p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-inkfaint">{agent.domain}</p>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2 font-mono text-[10px]">
                <div>
                  <dt className="uppercase tracking-[0.14em] text-inkfaint">Tasks</dt>
                  <dd className="mt-0.5 text-inkdim">
                    {shippedCount}/{owned.length}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.14em] text-inkfaint">Calls</dt>
                  <dd className="mt-0.5 text-inkdim">{owned.reduce((s, t) => s + t.attempts + 1, 0)}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.14em] text-inkfaint">Now</dt>
                  <dd className="mt-0.5" style={{ color: agent.hue }}>
                    {current ? current.code : '—'}
                  </dd>
                </div>
              </dl>

              <div className="mt-4">
                <Meter value={util} tone={agent.hue} />
              </div>
            </article>
          );
        })}
      </div>

      <div className="border-t border-linesoft px-5 py-3">
        <Eyebrow>
          {state.complete
            ? 'All agents parked · run sealed'
            : state.running
              ? `Agent bus live · ${state.activity ?? 'orchestrating'} · iteration ${state.iteration}`
              : state.paused
                ? 'Run held · state checkpointed, resume when ready'
                : 'Bus idle · awaiting a master prompt'}
        </Eyebrow>
      </div>
    </Panel>
  );
}
