import { AnimatePresence, motion } from 'framer-motion';
import { Check, Lock } from 'lucide-react';
import { AUDIT } from '../lib/data';
import { formatClock, formatNumber, type SimState } from '../lib/engine';
import CrownMark from './CrownMark';
import { Eyebrow, Meter, Panel, PanelHead } from './ui';

interface Props {
  state: SimState;
  onResume: () => void;
  onReset: () => void;
}

export default function ReleaseGate({ state, onResume, onReset }: Props) {
  const cleared = AUDIT.filter((a) => state.audit[a.id]).length;
  const allClear = cleared === AUDIT.length;

  const summary: [string, string][] = [
    ['Run', state.runId],
    ['Wall clock', formatClock(state.tick)],
    ['Tokens', formatNumber(state.tokens)],
    ['QA checks', `${formatNumber(state.testsPassed)} / ${formatNumber(state.testTotal)}`],
    ['Requirements', `${state.taskList.filter((t) => t.lane === 'shipped').length} / ${state.taskList.length}`],
    ['Defects caught', `${state.defectsFound} · ${state.openBugs} open`],
    ['Repair cycles', String(state.reworkCycles)],
    ['File operations', String(state.fileChanges.length)],
  ];

  return (
    <Panel id="release" className="mt-6 overflow-hidden">
      <PanelHead
        eyebrow="Final audit · release authority"
        title="The Gate Before The Words"
        right={
          <span className={`font-mono text-[11px] tracking-[0.16em] ${allClear ? 'text-gold' : 'text-inkfaint'}`}>
            {cleared} / {AUDIT.length} CLEARED
          </span>
        }
      />

      <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
        <ul className="divide-y divide-linesoft border-b border-linesoft lg:border-b-0 lg:border-r">
          {AUDIT.map((item) => {
            const on = state.audit[item.id];
            return (
              <li key={item.id} className="flex items-center gap-4 px-5 py-3.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border transition-colors ${
                    on ? 'border-gold bg-gold text-void' : 'border-line bg-panel text-inkfaint/60'
                  }`}
                >
                  {on ? <Check size={13} strokeWidth={3} /> : <Lock size={11} />}
                </span>
                <span className={`text-[13px] leading-snug ${on ? 'text-ink' : 'text-inkfaint'}`}>{item.label}</span>
                <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-inkfaint/70">
                  ST {String(item.stage + 1).padStart(2, '0')}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="relative p-6 sm:p-8">
          <Meter value={cleared / AUDIT.length} tone="#e9b949" height={5} />

          <AnimatePresence mode="wait">
            {state.complete ? (
              <motion.div
                key="complete"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="mt-6"
              >
                <div className="rounded-lg border border-gold/50 bg-gradient-to-b from-gold/12 to-transparent p-6 text-center shadow-[0_0_60px_-20px_rgba(233,185,73,0.7)]">
                  <div className="flex justify-center">
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.1, type: 'spring', stiffness: 140, damping: 12 }}
                    >
                      <CrownMark size={44} />
                    </motion.div>
                  </div>
                  <h3 className="mt-4 font-display text-2xl font-bold tracking-[0.16em] text-goldhi">
                    PROJECT_COMPLETE
                  </h3>
                  <p className="mx-auto mt-2 max-w-sm text-[12.5px] leading-relaxed text-inkdim">
                    Every requirement passed its independent review and its real command runs. The King's final audit
                    accepted the evidence — declared by the supervisor, never by a worker.
                  </p>
                  <button
                    onClick={onReset}
                    className="mt-5 inline-flex items-center gap-2 rounded-md bg-gold px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-void transition hover:bg-goldhi"
                  >
                    Clear The Deck
                  </button>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-linesoft sm:grid-cols-4 lg:grid-cols-2">
                  {summary.map(([k, v]) => (
                    <div key={k} className="bg-panel/80 px-3 py-2.5">
                      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-inkfaint">{k}</dt>
                      <dd className="mt-1 font-mono text-[12px] tabular-nums text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
              </motion.div>
            ) : (
              <motion.div
                key="pending"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-6"
              >
                <Eyebrow>
                  {state.errored ? 'Run halted' : state.paused ? 'Run held at checkpoint' : 'Release authority withheld'}
                </Eyebrow>
                <h3 className="mt-2 font-display text-xl font-semibold tracking-wide text-ink">
                  {state.requirements.length === 0
                    ? 'No run in flight'
                    : state.errored
                      ? 'The orchestrator stopped on an error'
                      : `${AUDIT.length - cleared} gate${AUDIT.length - cleared === 1 ? '' : 's'} still open`}
                </h3>
                <p className="mt-3 max-w-md text-[13px] leading-relaxed text-inkdim">
                  {state.error
                    ? state.error
                    : state.requirements.length === 0
                      ? 'Authorise a run from the command deck. The King will decompose your master prompt, assign real work, and refuse to certify anything it has not verified.'
                      : 'The declaration stays locked until every requirement carries evidence: an independent review, captured command output, and the King’s own verdict.'}
                </p>
                {state.paused && (
                  <button
                    onClick={onResume}
                    className="mt-4 inline-flex items-center gap-2 rounded-md bg-gold px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-void transition hover:bg-goldhi"
                  >
                    Resume From Checkpoint
                  </button>
                )}
                <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-linesoft sm:grid-cols-4">
                  {summary.slice(0, 4).map(([k, v]) => (
                    <div key={k} className="bg-panel/80 px-3 py-2.5">
                      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-inkfaint">{k}</dt>
                      <dd className="mt-1 font-mono text-[12px] tabular-nums text-inkdim">{v}</dd>
                    </div>
                  ))}
                </dl>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Panel>
  );
}
