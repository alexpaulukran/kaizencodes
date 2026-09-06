import CrownMark from './CrownMark';
import { formatClock, STAGE_COUNT, type SimState } from '../lib/engine';
import { STAGES } from '../lib/data';

interface Props {
  state: SimState;
  overall: number;
}

export default function TopBar({ state, overall }: Props) {
  const status = state.complete
    ? { label: 'PROJECT_COMPLETE', tone: 'text-goldhi', dot: 'bg-gold' }
    : state.running
      ? { label: 'EXECUTING', tone: 'text-mint', dot: 'bg-mint' }
      : state.tick > 0
        ? { label: 'HELD', tone: 'text-amber', dot: 'bg-amber' }
        : { label: 'STANDBY', tone: 'text-inkdim', dot: 'bg-inkfaint' };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-hull/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <CrownMark size={26} />
          <div className="min-w-0 leading-none">
            <div className="font-display text-[13px] font-bold tracking-[0.12em] text-goldhi sm:text-[15px] sm:tracking-[0.14em]">
              SUPERVISOR KING
            </div>
            <div className="mt-1 hidden font-mono text-[10px] uppercase tracking-[0.3em] text-inkfaint sm:block">
              Mission Control
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 rounded border border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-inkdim md:flex">
            <span className="text-inkfaint">RUN</span>
            <span className="text-ink">{state.runId}</span>
          </div>

          <div className="hidden items-center gap-2 rounded border border-line bg-panel px-3 py-1.5 font-mono text-[11px] sm:flex">
            <span className="text-inkfaint">STAGE</span>
            <span className="text-cyan">
              {String(Math.min(state.stage + 1, STAGE_COUNT)).padStart(2, '0')}/{STAGE_COUNT}
            </span>
            <span className="hidden text-inkdim lg:inline">· {STAGES[state.stage].key}</span>
          </div>

          <div className="flex items-center gap-2 rounded border border-line bg-panel px-3 py-1.5 font-mono text-[11px]">
            <span className="text-inkfaint">T+</span>
            <span className="tabular-nums text-ink">{formatClock(state.tick)}</span>
          </div>

          <div className="flex items-center gap-2 rounded border border-gold/30 bg-gold/8 px-2.5 py-1.5 sm:px-3">
            <span className={`pulse-dot inline-block h-1.5 w-1.5 rounded-full ${status.dot}`} />
            <span className={`hidden font-mono text-[11px] tracking-wider sm:inline ${status.tone}`}>
              {status.label}
            </span>
            <span className={`font-mono text-[11px] tracking-wider sm:hidden ${status.tone}`}>
              {state.complete ? 'DONE' : state.running ? 'LIVE' : state.tick > 0 ? 'HELD' : 'IDLE'}
            </span>
          </div>

          <div className="hidden w-24 items-center gap-2 lg:flex">
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/8">
              <div className="h-full bg-gold transition-[width] duration-300" style={{ width: `${overall}%` }} />
            </div>
            <span className="font-mono text-[10px] tabular-nums text-inkdim">{overall}%</span>
          </div>
        </div>
      </div>
    </header>
  );
}
