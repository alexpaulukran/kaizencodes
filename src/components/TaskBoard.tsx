import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import { AGENT_MAP } from '../lib/data';
import { LANES, type Lane, type SimState } from '../lib/engine';
import { Meter, Panel, PanelHead } from './ui';

interface Props {
  state: SimState;
}

const LANE_TONE: Record<Lane, { bar: string; text: string; border: string }> = {
  queued: { bar: '#5b6d8f', text: 'text-inkfaint', border: 'border-line' },
  executing: { bar: '#59d8e6', text: 'text-cyan', border: 'border-cyan/30' },
  review: { bar: '#f0a93b', text: 'text-amber', border: 'border-amber/30' },
  retest: { bar: '#e5484d', text: 'text-crimson', border: 'border-crimson/40' },
  shipped: { bar: '#47c98a', text: 'text-mint', border: 'border-mint/25' },
};

export default function TaskBoard({ state }: Props) {
  const [focus, setFocus] = useState(true);
  const show = (lane: Lane) => !focus || lane !== 'queued' || state.taskList.length < 24;

  return (
    <Panel id="board" className="mt-6 overflow-hidden">
      <PanelHead
        eyebrow="Work board · live requirements"
        title="Where The Work Sits"
        right={
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-inkfaint">
              ITER <span className="text-cyan">{state.iteration}</span>
            </span>
            <button
              onClick={() => setFocus((f) => !f)}
              className={`rounded border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition ${
                focus ? 'border-gold/50 bg-gold/10 text-gold' : 'border-line bg-panel text-inkfaint hover:text-inkdim'
              }`}
            >
              {focus ? 'Signal: on deck' : 'Signal: full queue'}
            </button>
          </div>
        }
      />

      {state.taskList.length === 0 ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <CircleDashed size={22} className="text-inkfaint" />
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-inkfaint">No requirements yet</p>
          <p className="max-w-md text-[13px] text-inkdim">
            Engage the King with a master prompt. Scout will decompose it into REQ-ids, and every card below becomes a
            real unit of work against the workspace file tree.
          </p>
        </div>
      ) : (
        <div className="grid gap-px bg-linesoft lg:grid-cols-5">
          {LANES.map((lane) => {
            const items = state.taskList.filter((t) => t.lane === lane.key && show(lane.key));
            const tone = LANE_TONE[lane.key];

            return (
              <div key={lane.key} className="flex min-h-[280px] flex-col bg-panel/60">
                <div className="flex items-center justify-between border-b border-linesoft px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.bar }} />
                    <span className={`font-mono text-[11px] uppercase tracking-[0.18em] ${tone.text}`}>{lane.label}</span>
                  </div>
                  <span className="rounded bg-white/5 px-2 py-0.5 font-mono text-[10px] tabular-nums text-inkfaint">
                    {String(items.length).padStart(2, '0')}
                  </span>
                </div>
                <p className="px-4 pt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-inkfaint/70">{lane.hint}</p>

                <div className="rail-scroll max-h-[430px] flex-1 space-y-2 overflow-y-auto p-3">
                  <AnimatePresence initial={false} mode="popLayout">
                    {items.map((task) => {
                      const agent = AGENT_MAP[task.agent];
                      return (
                        <motion.article
                          key={task.id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: 0.22, ease: 'easeOut' }}
                          className={`rounded border bg-panel2/80 p-3 ${tone.border} ${
                            state.currentTask === task.id ? 'shadow-[0_0_0_1px_rgba(233,185,73,0.45)]' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] tracking-[0.1em]" style={{ color: agent?.hue ?? '#93a5c6' }}>
                              {task.code}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {task.attempts > 0 && (
                                <span className="rounded bg-crimson/15 px-1.5 py-0.5 font-mono text-[9px] text-crimson">
                                  RW{task.attempts}
                                </span>
                              )}
                              {task.status === 'failed' && (
                                <span className="rounded bg-crimson/25 px-1.5 py-0.5 font-mono text-[9px] text-crimson">
                                  ESC
                                </span>
                              )}
                              {lane.key === 'shipped' && <CheckCircle2 size={13} className="text-mint" />}
                              {lane.key === 'retest' && <AlertTriangle size={13} className="text-crimson" />}
                              {lane.key === 'queued' && <CircleDashed size={13} className="text-inkfaint" />}
                            </div>
                          </div>

                          <p className="mt-1.5 text-[12px] leading-snug text-ink">{task.title}</p>

                          {task.evidence && lane.key !== 'queued' && (
                            <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-inkfaint">{task.evidence}</p>
                          )}

                          <div className="mt-2.5 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-inkfaint">
                            <span>{agent?.name ?? task.agent}</span>
                            <span>{task.files.length} file{task.files.length === 1 ? '' : 's'}</span>
                          </div>

                          {lane.key !== 'queued' && (
                            <div className="mt-2">
                              <Meter value={task.progress} tone={tone.bar} height={3} />
                            </div>
                          )}
                        </motion.article>
                      );
                    })}
                  </AnimatePresence>

                  {items.length === 0 && (
                    <div className="flex h-24 items-center justify-center rounded border border-dashed border-line/80 px-3 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-inkfaint/60">
                      lane clear
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
