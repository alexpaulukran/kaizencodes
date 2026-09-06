import { useState } from 'react';
import { motion } from 'framer-motion';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { AGENTS } from '../lib/data';
import { formatNumber, type SimState } from '../lib/engine';
import { Eyebrow } from './ui';

interface Props {
  state: SimState;
  overall: number;
  offline: boolean;
  busy: boolean;
  onStart: (prompt: string, build: string, test: string) => void;
  onToggle: () => void;
  onReset: () => void;
  onSpeed: (v: number) => void;
}

const SAMPLE_PROMPT =
  'Build a command-line TODO manager in plain Node.js with zero external dependencies. It must add, list, complete and delete tasks persisted to todos.json, print a clear error on a missing task id, ship a README with usage examples, and include a test script that exercises add/complete/delete and exits non-zero if any assertion fails.';

export default function Hero({ state, overall, offline, busy, onStart, onToggle, onReset, onSpeed }: Props) {
  const [prompt, setPrompt] = useState(SAMPLE_PROMPT);
  const [buildCmd, setBuildCmd] = useState('');
  const [testCmd, setTestCmd] = useState('');

  const primary = state.running
    ? { label: 'Hold Run', icon: <Pause size={15} />, action: onToggle, disabled: offline }
    : state.complete
      ? { label: 'New Run', icon: <RotateCcw size={15} />, action: onReset, disabled: offline }
      : state.paused || state.errored
        ? { label: 'Resume Run', icon: <Play size={15} />, action: onToggle, disabled: offline || busy }
        : { label: 'Engage the King', icon: <Play size={15} />, action: () => onStart(prompt, buildCmd, testCmd), disabled: offline || busy };

  return (
    <section className="relative pt-8">
      <div className="relative overflow-hidden rounded-xl border border-line">
        <img
          src="/images/bridge.png"
          alt="Darkened command bridge lined with glowing amber consoles"
          className="absolute inset-0 h-full w-full object-cover object-center opacity-45"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-void via-void/90 to-void/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-void via-transparent to-void/70" />

        <div className="relative grid gap-10 p-6 sm:p-10 lg:grid-cols-[1.15fr_0.85fr] lg:p-14">
          <div>
            <div className="flex items-center gap-3">
              <span className="h-px w-10 bg-gold/70" />
              <Eyebrow tone="gold">Autonomous multi-agent coding system · live</Eyebrow>
            </div>

            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="mt-5 font-display text-[clamp(2.1rem,6vw,4.2rem)] font-bold leading-[1.04] tracking-[0.02em] text-ink"
            >
              HOLD THE LINE
              <span className="block text-goldhi">UNTIL IT SHIPS</span>
            </motion.h1>

            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-inkdim">
              Your master prompt goes in. Real model calls decompose it into requirements, real workers write real
              files, an independent reviewer reads them back off disk, and QA runs the actual build and test
              commands. The King declares completion only when the evidence supports it.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={primary.action}
                disabled={primary.disabled}
                className={`group inline-flex items-center gap-2.5 rounded-md px-6 py-3 font-mono text-[12px] font-bold uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  state.running
                    ? 'bg-amber/90 text-void hover:bg-amber'
                    : 'bg-gold text-void shadow-[0_0_32px_-8px_rgba(233,185,73,0.8)] hover:bg-goldhi'
                }`}
              >
                {primary.icon}
                {primary.label}
              </button>

              <button
                onClick={onReset}
                disabled={offline || busy}
                className="inline-flex items-center gap-2 rounded-md border border-line bg-panel/80 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.18em] text-inkdim transition hover:border-gold/50 hover:text-goldhi disabled:opacity-40"
              >
                <RotateCcw size={14} /> Reset
              </button>

              <div className="flex items-center overflow-hidden rounded-md border border-line bg-panel/80">
                <span className="px-3 font-mono text-[10px] uppercase tracking-[0.2em] text-inkfaint">Rate</span>
                {[1, 2, 4].map((v) => (
                  <button
                    key={v}
                    onClick={() => onSpeed(v)}
                    className={`border-l border-line px-3.5 py-3 font-mono text-[12px] transition ${
                      state.speed === v ? 'bg-gold/15 text-gold' : 'text-inkfaint hover:text-inkdim'
                    }`}
                  >
                    {v}×
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[11px] text-inkfaint">
              <span>
                AGENTS <span className="text-inkdim">{AGENTS.length}</span>
              </span>
              <span>
                REQUIREMENTS <span className="text-inkdim">{state.taskList.length}</span>
              </span>
              <span>
                MODEL <span className="text-inkdim">{state.model}</span>
              </span>
              <span>
                OPEN BUGS{' '}
                <span className={state.openBugs === 0 ? 'text-mint' : 'text-crimson'}>{state.openBugs}</span>
              </span>
            </div>

            <div className="mt-7 max-w-xl">
              <div className="mb-2 flex items-baseline justify-between font-mono text-[11px]">
                <span className="uppercase tracking-[0.22em] text-inkfaint">Requirements passed</span>
                <span className="tabular-nums text-gold">{overall}%</span>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/6">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-golddim via-gold to-goldhi transition-[width] duration-500"
                  style={{ width: `${overall}%` }}
                />
              </div>

              {state.complete && (
                <a
                  href="#release"
                  className="mt-4 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-gold underline-offset-4 transition hover:text-goldhi hover:underline"
                >
                  Declaration issued · read the release gate ↓
                </a>
              )}
            </div>
          </div>

          <motion.aside
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
            className="self-end rounded-lg border border-gold/25 bg-hull/85 p-5 backdrop-blur-md sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-linesoft pb-3">
              <Eyebrow tone="gold">Master prompt · input</Eyebrow>
              <span className="font-mono text-[10px] text-inkfaint">{state.providerLabel}</span>
            </div>

            <label className="mt-4 block">
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-inkfaint">What should the system build?</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={7}
                spellCheck={false}
                className="mt-2 w-full resize-y rounded border border-line bg-panel/80 p-3 font-mono text-[11.5px] leading-relaxed text-ink outline-none transition focus:border-gold/50"
              />
            </label>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label>
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-inkfaint">Build command</span>
                <input
                  value={buildCmd}
                  onChange={(e) => setBuildCmd(e.target.value)}
                  placeholder="auto (from Oracle)"
                  spellCheck={false}
                  className="mt-1.5 w-full rounded border border-line bg-panel/80 px-2.5 py-2 font-mono text-[11px] text-ink outline-none transition focus:border-gold/50 placeholder:text-inkfaint/60"
                />
              </label>
              <label>
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-inkfaint">Test command</span>
                <input
                  value={testCmd}
                  onChange={(e) => setTestCmd(e.target.value)}
                  placeholder="auto (from Oracle)"
                  spellCheck={false}
                  className="mt-1.5 w-full rounded border border-line bg-panel/80 px-2.5 py-2 font-mono text-[11px] text-ink outline-none transition focus:border-gold/50 placeholder:text-inkfaint/60"
                />
              </label>
            </div>

            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-linesoft pt-4 font-mono text-[10px]">
              <div className="rounded border border-line bg-panel/70 px-3 py-2">
                <dt className="uppercase tracking-[0.2em] text-inkfaint">Tokens</dt>
                <dd className="mt-1 text-[12px] tabular-nums text-ink">{formatNumber(state.tokens)}</dd>
              </div>
              <div className="rounded border border-line bg-panel/70 px-3 py-2">
                <dt className="uppercase tracking-[0.2em] text-inkfaint">Reviews</dt>
                <dd className="mt-1 text-[12px] tabular-nums text-ink">{state.reviewsPassed}</dd>
              </div>
              <div className="rounded border border-line bg-panel/70 px-3 py-2">
                <dt className="uppercase tracking-[0.2em] text-inkfaint">Rework</dt>
                <dd className="mt-1 text-[12px] tabular-nums text-ink">{state.reworkCycles}</dd>
              </div>
            </dl>
          </motion.aside>
        </div>
      </div>
    </section>
  );
}
