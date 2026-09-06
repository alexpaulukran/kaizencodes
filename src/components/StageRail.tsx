import { Check } from 'lucide-react';
import { STAGES } from '../lib/data';
import type { SimState } from '../lib/engine';
import { Eyebrow, Panel } from './ui';

interface Props {
  state: SimState;
  stageProgress: number;
}

export default function StageRail({ state, stageProgress }: Props) {
  const active = STAGES[state.stage];

  return (
    <Panel className="mt-6 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-linesoft px-5 py-4">
        <div>
          <Eyebrow>Pipeline · 12 gated stages</Eyebrow>
          <h2 className="mt-1 font-display text-lg font-semibold tracking-wide text-ink">Stage Gate Rail</h2>
        </div>
        <p className="max-w-md text-right text-[12px] leading-relaxed text-inkfaint">
          {active.blurb}
        </p>
      </div>

      <div className="rail-scroll overflow-x-auto px-5 py-6">
        <ol className="flex min-w-[900px] items-start">
          {STAGES.map((stage, i) => {
            const done = state.complete || i < state.stage;
            const current = !state.complete && i === state.stage;
            const progress = done ? 1 : current ? stageProgress : 0;

            return (
              <li key={stage.id} className="flex flex-1 flex-col items-center">
                <div className="flex w-full items-center">
                  <div className="h-px flex-1 bg-line" />
                  <div className="relative flex h-11 w-11 shrink-0 items-center justify-center">
                    {current && (
                      <span className="pulse-dot absolute inset-0 rounded-full border border-gold/60" />
                    )}
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full border font-mono text-[11px] transition-colors ${
                        done
                          ? 'border-gold bg-gold text-void'
                          : current
                            ? 'border-gold bg-gold/15 text-goldhi'
                            : 'border-line bg-panel text-inkfaint'
                      }`}
                    >
                      {done ? <Check size={15} strokeWidth={3} /> : String(stage.id + 1).padStart(2, '0')}
                    </div>
                  </div>
                  <div className="h-px flex-1 bg-line">
                    <div
                      className="h-px bg-gold transition-[width] duration-500"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                </div>

                <div className="mt-3 text-center">
                  <div
                    className={`font-mono text-[10px] uppercase tracking-[0.16em] ${
                      done ? 'text-gold' : current ? 'text-ink' : 'text-inkfaint'
                    }`}
                  >
                    {stage.short}
                  </div>
                  <div
                    className={`mt-1 max-w-[74px] text-[10px] leading-tight ${
                      done ? 'text-inkdim' : current ? 'text-inkdim' : 'text-inkfaint/70'
                    }`}
                  >
                    {stage.label}
                  </div>
                  {current && (
                    <div className="mx-auto mt-2 h-0.5 w-6 rounded-full bg-gold transition-[width] duration-500" style={{ width: `${24 * progress}px` }} />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}
