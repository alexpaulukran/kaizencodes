# Supervisor King · Mission Control

The operations deck for an autonomous multi-agent software engineering system: nine specialised
agents, twelve gated stages, and one supervisor who signs for all of it.

Press **Initiate Run** (or `Space`) and the deterministic simulation drives a full software
delivery cycle — Understand → Architect → Plan → Delegate → Implement → Review → Test → Fix →
Re-test → Polish → Final Audit → Release — while the deck reports exactly what happened.

## What's on the deck

| Surface | What it does |
| --- | --- |
| Command deck (hero) | Run transport: initiate / hold / resume, reset, 1×–4× scheduler rate, overall completion |
| Stage gate rail | All 12 stages with per-stage completion and the active stage's brief |
| Agent roster | 9 agents with live status, current task code, utilisation and throughput |
| Work board | 32 tasks across five lanes (Queued · Executing · In Review · Rework · Shipped), with an active-stage signal filter |
| Live console | Streaming agent bus with level filters (SYS/INFO/PASS/WARN/FAIL), copy-to-clipboard, stick-to-bottom that yields to user scroll |
| Telemetry | Tokens, pass rate, coverage, defects caught, rework cycles, escaped defects — plus SVG charts sampled every 6 ticks |
| Charter | The six doctrine clauses the supervisor enforces on itself |
| Release gate | Eight audit checks; `PROJECT_COMPLETE` is declared only when every gate clears and the deploy is verified |

Keyboard: `Space` run/hold · `R` reset.

## Architecture

```
src/lib/data.ts     domain content: stages, agents, 32 tasks with deps/effort/defect odds, audit, doctrine
src/lib/engine.ts   pure simulation core — reducer + seeded RNG, no side effects, no module state
src/components/     deck surfaces (all read from SimState; none own domain logic)
scripts/            headless verification suites
```

The engine is intentionally pure: `reducer(state, action)` returns the next state, and randomness
comes from an explicit seeded PRNG stored in state. That makes runs reproducible, testable
headlessly, and impossible to desynchronise from the UI.

Notable behaviours modelled honestly rather than faked:

- **Stage gating** — no task starts ahead of its stage, and a task never starts before its dependencies ship.
- **Concurrency ceiling** — at most 3 agents execute at once.
- **Defect & rework loop** — the arbiter reproduces a defect, the owning agent fixes it, and re-test
  must verify it before the task can close. Defect odds are per-task and seeded.
- **Audit gates** — each stage completion ticks a specific audit claim; the release declaration stays
  locked until all eight clear.

## Verification

```bash
npm run test          # both suites
npm run test:sim      # 36 headless engine checks
npm run test:render   # SSR smoke + completed-state frame checks
```

The engine suite proves termination within budget, determinism per seed, unique log ids across
replays, correct pause/resume/reset semantics, and zero stage-gate, dependency or concurrency
violations across a full run. The render suite renders the deck server-side in both idle and
completed states.

## Stack

Vite · React 19 · TypeScript (strict) · Tailwind CSS v4 · framer-motion · lucide-react
