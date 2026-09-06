import type { ReactNode } from 'react';

export function Panel({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`relative scroll-mt-20 rounded-lg border border-line bg-panel/70 hairline backdrop-blur-sm ${className}`}
    >
      {children}
    </section>
  );
}

export function Eyebrow({ children, tone = 'dim' }: { children: ReactNode; tone?: 'dim' | 'gold' }) {
  return (
    <span
      className={`font-mono text-[10px] uppercase tracking-[0.28em] ${tone === 'gold' ? 'text-gold' : 'text-inkfaint'}`}
    >
      {children}
    </span>
  );
}

export function PanelHead({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-linesoft px-5 py-4">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-1 font-display text-lg font-semibold tracking-wide text-ink">{title}</h2>
      </div>
      {right}
    </header>
  );
}

export function Meter({ value, tone = '#e9b949', height = 4 }: { value: number; tone?: string; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-white/6" style={{ height }}>
      <div
        className="h-full rounded-full transition-[width] duration-300 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, background: tone }}
      />
    </div>
  );
}
