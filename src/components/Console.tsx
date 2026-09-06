import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Check, Copy } from 'lucide-react';
import { AGENT_MAP } from '../lib/data';
import { formatClock, type LogLevel, type SimState } from '../lib/engine';
import { Panel, PanelHead } from './ui';

const LEVELS: { key: LogLevel; label: string; chip: string; text: string; glyph: string }[] = [
  { key: 'sys', label: 'SYS', chip: 'border-cyan/40 text-cyan', text: 'text-cyan/90', glyph: '»' },
  { key: 'info', label: 'INFO', chip: 'border-line text-inkdim', text: 'text-inkdim', glyph: '·' },
  { key: 'ok', label: 'PASS', chip: 'border-mint/40 text-mint', text: 'text-mint', glyph: '✓' },
  { key: 'warn', label: 'WARN', chip: 'border-amber/40 text-amber', text: 'text-amber', glyph: '!' },
  { key: 'err', label: 'FAIL', chip: 'border-crimson/40 text-crimson', text: 'text-crimson', glyph: '✕' },
];

const LEVEL_MAP = Object.fromEntries(LEVELS.map((l) => [l.key, l])) as Record<LogLevel, (typeof LEVELS)[number]>;

export default function Console({ state }: { state: SimState }) {
  const [active, setActive] = useState<LogLevel[]>(['sys', 'info', 'ok', 'warn', 'err']);
  const [copied, setCopied] = useState(false);
  const [stuck, setStuck] = useState(true);
  const stick = useRef(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const filtered = state.logs.filter((l) => active.includes(l.level));

  useEffect(() => {
    if (!stick.current || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [filtered.length]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const next = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stick.current = next;
    setStuck((prev) => (prev === next ? prev : next));
  };

  const jump = () => {
    stick.current = true;
    setStuck(true);
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const toggle = (key: LogLevel) => {
    setActive((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const copy = () => {
    const text = state.logs
      .map((l) => `T+${formatClock(l.tick)}  ${l.agent.padEnd(8)} ${LEVEL_MAP[l.level].glyph} ${l.text}`)
      .join('\n');
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <Panel id="console" className="mt-6 overflow-hidden">
      <PanelHead
        eyebrow="Agent bus · unedited transcript"
        title="Live Console"
        right={
          <div className="flex flex-wrap items-center gap-1.5">
            {LEVELS.map((lvl) => {
              const on = active.includes(lvl.key);
              return (
                <button
                  key={lvl.key}
                  onClick={() => toggle(lvl.key)}
                  aria-pressed={on}
                  className={`rounded border px-2 py-1 font-mono text-[9px] tracking-[0.14em] transition ${
                    on ? lvl.chip : 'border-line/60 text-inkfaint/50 hover:text-inkfaint'
                  }`}
                >
                  {lvl.label}
                </button>
              );
            })}
            <button
              onClick={copy}
              className="ml-1 inline-flex items-center gap-1.5 rounded border border-line px-2 py-1 font-mono text-[9px] tracking-[0.14em] text-inkfaint transition hover:border-gold/40 hover:text-gold"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'COPIED' : 'COPY'}
            </button>
          </div>
        }
      />

      <div className="relative bg-void/60">
        <div
          ref={bodyRef}
          onScroll={onScroll}
          className="rail-scroll h-[340px] overflow-y-auto px-4 py-3 font-mono text-[11.5px] leading-[1.75] sm:px-5"
        >
          {filtered.length === 0 && (
            <div className="flex h-full items-center justify-center text-center text-[11px] uppercase tracking-[0.2em] text-inkfaint/60">
              all channels muted
            </div>
          )}
          {filtered.map((l) => {
            const meta = LEVEL_MAP[l.level];
            const agent = AGENT_MAP[l.agent];
            return (
              <div key={l.id} className="flex gap-2.5 rounded px-1 transition-colors hover:bg-white/4 sm:gap-3">
                <span className="shrink-0 tabular-nums text-inkfaint/60">T+{formatClock(l.tick)}</span>
                <span className="w-[62px] shrink-0 truncate tracking-[0.06em]" style={{ color: agent?.hue ?? '#93a5c6' }}>
                  {l.agent}
                </span>
                <span className={`min-w-0 break-words ${meta.text}`}>
                  <span className="mr-2 opacity-60">{meta.glyph}</span>
                  {l.text}
                </span>
              </div>
            );
          })}
        </div>

        {!stuck && (
          <button
            onClick={jump}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-gold/40 bg-hull/95 px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] text-gold shadow-lg transition hover:bg-gold/15"
          >
            <ArrowDown size={11} /> NEW LINES
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-linesoft px-5 py-2.5 font-mono text-[10px] text-inkfaint">
        <span>
          BUFFER <span className="text-inkdim">{state.logs.length}</span> · SHOWING{' '}
          <span className="text-inkdim">{filtered.length}</span>
        </span>
        <span className="hidden sm:inline">SPACE run/hold · R reset</span>
      </div>
    </Panel>
  );
}
