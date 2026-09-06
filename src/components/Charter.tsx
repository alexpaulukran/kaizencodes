import { DOCTRINE } from '../lib/data';
import { Eyebrow, Panel } from './ui';

export default function Charter() {
  return (
    <Panel id="charter" className="mt-6 overflow-hidden">
      <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
        <div className="relative min-h-[300px] border-b border-linesoft lg:border-b-0 lg:border-r">
          <img
            src="/images/crown-plate.png"
            alt="Engraved gold crown emblem inlaid in brushed dark steel"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-void via-void/45 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-6">
            <Eyebrow tone="gold">The standing order</Eyebrow>
            <p className="mt-2 max-w-sm font-display text-xl leading-snug text-ink">
              “A worker’s claim is a hypothesis. My signature is the evidence.”
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-inkfaint">
              Supremus · Supervisor King
            </p>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <Eyebrow>Doctrine · six clauses</Eyebrow>
          <h2 className="mt-1 font-display text-lg font-semibold tracking-wide text-ink">
            The Rules I Enforce On Myself
          </h2>
          <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-inkdim">
            Authority in this system is not a privilege — it is an accountability surface. These are the clauses
            every stage is measured against, and the reason no agent gets to declare its own work finished.
          </p>

          <ol className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {DOCTRINE.map((d) => (
              <li key={d.n} className="border-l border-gold/30 pl-4">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-[11px] tracking-[0.14em] text-gold">{d.n}</span>
                  <h3 className="font-display text-[14px] font-semibold tracking-wide text-ink">{d.title}</h3>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-inkdim">{d.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Panel>
  );
}
