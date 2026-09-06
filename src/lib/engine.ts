// UI-side view model over the real Supervisor King service.
// Nothing here simulates: every field is derived from an orchestrator snapshot.

export const TICK_MS = 150;
export const STAGE_COUNT = 12;
export const CONCURRENCY = 1; // the King serialises work; agents run one task at a time

export type Lane = 'queued' | 'executing' | 'review' | 'retest' | 'shipped';
export type LogLevel = 'sys' | 'info' | 'ok' | 'warn' | 'err';

export const LANES: { key: Lane; label: string; hint: string }[] = [
  { key: 'queued', label: 'Queued', hint: 'Awaiting the King' },
  { key: 'executing', label: 'Executing', hint: 'Worker writing files' },
  { key: 'review', label: 'In Review', hint: 'Arbiter / QA verdict' },
  { key: 'retest', label: 'Rework', hint: 'Defect · fix · re-verify' },
  { key: 'shipped', label: 'Shipped', hint: 'Evidence accepted' },
];

export interface TaskView {
  id: string;
  code: string;
  title: string;
  agent: string;
  stage: number;
  lane: Lane;
  progress: number;
  attempts: number;
  status: string;
  criteria: string[];
  files: string[];
  evidence: string;
}

export interface RequirementView {
  id: string;
  statement: string;
  criteria: string[];
  status: string;
  agent: string | null;
  attempts: number;
  fixCount: number;
  files: string[];
  lastError: string | null;
  evidence: { kind: string; ok: boolean; summary: string }[];
}

export interface LogEntry {
  id: number;
  tick: number;
  at: string;
  level: LogLevel;
  agent: string;
  text: string;
}

export interface Sample {
  tick: number;
  tokens: number;
  passRate: number;
  coverage: number;
  ratio: number;
}

export interface KingSnapshot {
  runId: string;
  masterPrompt: string;
  phase: string;
  status: string;
  activity: string | null;
  iteration: number;
  currentTask: string | null;
  workspace: string;
  running: boolean;
  error: string | null;
  checkpointAt: string | null;
  completedAt: string | null;
  startedAt: string | null;
  tokens: { prompt: number; completion: number };
  commands: { build: string; test: string };
  provider: { label: string; model: string; strongModel: string; hasKey: boolean };
  routing: { role: string; provider: string; model: string }[];
  usageByRole?: Record<string, { prompt: number; completion: number; calls: number; provider: string; model: string; fallbacks: number }>;
  architecture: { summary: string; modules: { name: string; responsibility: string }[] } | null;
  requirements: {
    id: string;
    statement: string;
    acceptanceCriteria: string[];
    status: string;
    agent: string | null;
    files: string[];
    attempts: number;
    fixCount: number;
    lastError: string | null;
    evidence: { kind: string; ok: boolean; summary: string }[];
  }[];
  knownBugs: { id: string; requirementId: string; description: string; severity: string; status: string }[];
  reviewResults: { requirementId: string; verdict: string; summary: string; findings: { severity: string; file: string; message: string }[] }[];
  testResults: { command: string; exitCode: number | null; passed: boolean; stdout: string; stderr: string; durationMs: number }[];
  qaResults: { requirementId: string; verdict: string; summary: string; checksPassed: number; checksTotal: number }[];
  fileChanges: { path: string; action: string }[];
  files: { path: string; type: string; size?: number }[];
  logs: LogEntry[];
  telemetry: { t: number; tokens: number; passRate: number; coverage: number; ratio: number }[];
  derived: {
    total: number;
    passed: number;
    open: number;
    passRate: number;
    coverage: number;
    testsPassed: number;
    testsTotal: number;
    defectsFound: number;
    defectsCaught: number;
    reworkCycles: number;
    reviewsPassed: number;
    overall: number;
    stageIndex: number;
    audit: Record<string, boolean>;
  };
}

export interface SimState {
  runId: string;
  tick: number;
  running: boolean;
  complete: boolean;
  paused: boolean;
  errored: boolean;
  speed: number;
  stage: number;
  phase: string;
  activity: string | null;
  iteration: number;
  currentTask: string | null;
  taskList: TaskView[];
  requirements: RequirementView[];
  logs: LogEntry[];
  history: Sample[];
  audit: Record<string, boolean>;
  tokens: number;
  passRate: number;
  coverage: number;
  testTotal: number;
  testsPassed: number;
  defectsFound: number;
  defectsCaught: number;
  reworkCycles: number;
  reviewsPassed: number;
  openBugs: number;
  providerLabel: string;
  model: string;
  hasKey: boolean;
  routing: { role: string; provider: string; model: string }[];
  usageByRole: Record<string, { prompt: number; completion: number; calls: number; provider: string; model: string; fallbacks: number }>;
  workspace: string;
  commands: { build: string; test: string };
  architecture: { summary: string; modules: { name: string; responsibility: string }[] } | null;
  knownBugs: { id: string; requirementId: string; description: string; severity: string; status: string }[];
  reviewResults: { requirementId: string; verdict: string; summary: string }[];
  testResults: { command: string; exitCode: number | null; passed: boolean; stdout: string; stderr: string }[];
  fileChanges: { path: string; action: string }[];
  files: { path: string; type: string }[];
  masterPrompt: string;
  checkpointAt: string | null;
  error: string | null;
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, '0');
}

export function formatClock(tick: number) {
  const total = Math.floor((tick * TICK_MS) / 1000);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function formatNumber(n: number) {
  return Math.round(n).toLocaleString('en-US');
}

export function laneFor(status: string): Lane {
  switch (status) {
    case 'in_progress':
      return 'executing';
    case 'awaiting_review':
    case 'awaiting_qa':
      return 'review';
    case 'fix_required':
    case 'failed':
      return 'retest';
    case 'passed':
    case 'skipped':
      return 'shipped';
    default:
      return 'queued';
  }
}

function progressFor(status: string): number {
  switch (status) {
    case 'in_progress':
      return 0.5;
    case 'awaiting_review':
    case 'awaiting_qa':
    case 'passed':
    case 'skipped':
      return 1;
    case 'fix_required':
      return 0.25;
    case 'failed':
      return 1;
    default:
      return 0;
  }
}

export function adapt(snap: KingSnapshot, speed: number): SimState {
  const stage = snap.derived.stageIndex;
  const taskList: TaskView[] = snap.requirements.map((r) => {
    const review = snap.reviewResults.filter((v) => v.requirementId === r.id).slice(-1)[0];
    const qa = snap.qaResults.filter((v) => v.requirementId === r.id).slice(-1)[0];
    const last = r.evidence[r.evidence.length - 1];
    return {
      id: r.id,
      code: r.id,
      title: r.statement,
      agent: r.agent ?? 'SUPREMUS',
      stage,
      lane: laneFor(r.status),
      progress: progressFor(r.status),
      attempts: r.fixCount,
      status: r.status,
      criteria: r.acceptanceCriteria,
      files: r.files,
      evidence: last
        ? last.summary
        : review
          ? `review: ${review.verdict}`
          : qa
            ? `qa: ${qa.verdict}`
            : '',
    };
  });

  return {
    runId: snap.runId,
    tick: snap.status === 'idle' ? 0 : Math.round((Date.now() - (Date.parse(snap.startedAt ?? '') || Date.now())) / TICK_MS),
    running: snap.running,
    complete: snap.status === 'complete',
    paused: snap.status === 'paused',
    errored: snap.status === 'error',
    speed,
    stage,
    phase: snap.phase,
    activity: snap.activity,
    iteration: snap.iteration,
    currentTask: snap.currentTask,
    taskList,
    requirements: snap.requirements.map((r) => ({
      id: r.id,
      statement: r.statement,
      criteria: r.acceptanceCriteria,
      status: r.status,
      agent: r.agent,
      files: r.files,
      attempts: r.attempts,
      fixCount: r.fixCount,
      lastError: r.lastError,
      evidence: r.evidence,
    })),
    logs: snap.logs,
    history: snap.telemetry.map((s, i) => ({
      tick: i,
      tokens: s.tokens,
      passRate: s.passRate,
      coverage: s.coverage,
      ratio: s.ratio,
    })),
    audit: snap.derived.audit,
    tokens: snap.tokens.prompt + snap.tokens.completion,
    passRate: snap.derived.passRate,
    coverage: snap.derived.coverage,
    testTotal: snap.derived.testsTotal,
    testsPassed: snap.derived.testsPassed,
    defectsFound: snap.derived.defectsFound,
    defectsCaught: snap.derived.defectsCaught,
    reworkCycles: snap.derived.reworkCycles,
    reviewsPassed: snap.derived.reviewsPassed,
    openBugs: snap.knownBugs.filter((b) => b.status === 'open').length,
    providerLabel: snap.provider.label,
    model: snap.provider.model,
    hasKey: snap.provider.hasKey,
    routing: snap.routing ?? [],
    usageByRole: snap.usageByRole ?? {},
    workspace: snap.workspace,
    commands: snap.commands,
    architecture: snap.architecture,
    knownBugs: snap.knownBugs,
    reviewResults: snap.reviewResults,
    testResults: snap.testResults,
    fileChanges: snap.fileChanges,
    files: snap.files,
    masterPrompt: snap.masterPrompt,
    checkpointAt: snap.checkpointAt,
    error: snap.error,
  };
}

export function idleState(speed: number): SimState {
  return {
    runId: '—',
    tick: 0,
    running: false,
    complete: false,
    paused: false,
    errored: false,
    speed,
    stage: 0,
    phase: 'idle',
    activity: null,
    iteration: 0,
    currentTask: null,
    taskList: [],
    requirements: [],
    logs: [],
    history: [],
    audit: {},
    tokens: 0,
    passRate: 0,
    coverage: 0,
    testTotal: 0,
    testsPassed: 0,
    defectsFound: 0,
    defectsCaught: 0,
    reworkCycles: 0,
    reviewsPassed: 0,
    openBugs: 0,
    providerLabel: '—',
    model: '—',
    hasKey: false,
    routing: [],
    usageByRole: {},
    workspace: '—',
    commands: { build: '', test: '' },
    architecture: null,
    knownBugs: [],
    reviewResults: [],
    testResults: [],
    fileChanges: [],
    files: [],
    masterPrompt: '',
    checkpointAt: null,
    error: null,
  };
}

export function metrics(s: SimState) {
  const total = s.taskList.length;
  const shipped = s.taskList.filter((t) => t.lane === 'shipped').length;
  const byAgent: Record<string, { active: boolean; reviewing: boolean }> = {};
  const agents = ['SUPREMUS', 'SCOUT', 'ORACLE', 'FOREMAN', 'WRAITH', 'FORGE', 'LUMEN', 'ARBITER', 'HERALD'];
  for (const id of agents) byAgent[id] = { active: false, reviewing: false };
  for (const t of s.taskList) {
    if (!byAgent[t.agent]) byAgent[t.agent] = { active: false, reviewing: false };
    if (t.lane === 'executing') byAgent[t.agent].active = true;
    if (t.lane === 'review') byAgent[t.agent].reviewing = true;
  }
  return {
    total,
    shipped,
    ratio: total === 0 ? 0 : shipped / total,
    overall: total === 0 ? 0 : Math.round((shipped / total) * 100),
    stageProgress: s.requirements.length === 0 ? 0 : s.requirements.filter((r) => r.status === 'passed').length / s.requirements.length,
    byAgent,
  };
}
