export type Phase =
  | 'idle'
  | 'understanding'
  | 'architecting'
  | 'executing'
  | 'final_audit'
  | 'complete'
  | 'error';

export type RunStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error';

export type RequirementStatus =
  | 'pending'
  | 'in_progress'
  | 'awaiting_review'
  | 'awaiting_qa'
  | 'fix_required'
  | 'passed'
  | 'failed'
  | 'skipped';

export interface Evidence {
  kind: 'note' | 'review' | 'qa' | 'build' | 'verdict';
  ok: boolean;
  summary: string;
  at: string;
}

export interface Requirement {
  id: string;
  statement: string;
  acceptanceCriteria: string[];
  priority: number;
  status: RequirementStatus;
  agent: string | null;
  files: string[];
  approach: string | null;
  reviewRequired: boolean;
  testRequired: boolean;
  attempts: number;
  fixCount: number;
  evidence: Evidence[];
  lastError: string | null;
  modelOverride: string | null;
}

export interface ReviewFinding {
  severity: 'blocker' | 'major' | 'minor';
  file: string;
  message: string;
}

export interface ReviewResult {
  requirementId: string;
  agent: string;
  verdict: 'pass' | 'fail';
  summary: string;
  findings: ReviewFinding[];
  at: string;
}

export interface TestResult {
  requirementId: string | null;
  command: string;
  exitCode: number | null;
  passed: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  at: string;
}

export interface QaResult {
  requirementId: string;
  verdict: 'pass' | 'fail';
  summary: string;
  checksPassed: number;
  checksTotal: number;
  gaps: string[];
  at: string;
}

export interface FileChange {
  path: string;
  action: 'create' | 'write' | 'delete';
  bytes: number;
  at: string;
}

export interface TreeEntry {
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

export interface Architecture {
  summary: string;
  modules: { name: string; responsibility: string }[];
  suggestedFiles: string[];
  buildCommand: string;
  testCommand: string;
  risks: string[];
  at: string;
}

export interface KnownBug {
  id: string;
  requirementId: string;
  description: string;
  severity: 'blocker' | 'major' | 'minor';
  status: 'open' | 'resolved';
  openedAt: string;
  resolvedAt: string | null;
}

export interface LogLine {
  id: number;
  tick: number;
  at: string;
  level: 'sys' | 'info' | 'ok' | 'warn' | 'err';
  agent: string;
  text: string;
}

export interface RoleUsage {
  prompt: number;
  completion: number;
  calls: number;
  provider: string;
  model: string;
  fallbacks: number;
}

export interface TelemetrySample {
  t: number;
  tokens: number;
  passRate: number;
  coverage: number;
  ratio: number;
}

export interface KingState {
  runId: string;
  /** Absolute path of the workspace this run owns. Persisted so resume always opens the right workspace. */
  workspacePath: string;
  masterPrompt: string;
  phase: Phase;
  status: RunStatus;
  activity: 'plan' | 'work' | 'review' | 'qa' | 'audit' | null;
  iteration: number;
  currentTask: string | null;
  taskQueue: string[];
  requirements: Requirement[];
  files: TreeEntry[];
  architecture: Architecture | null;
  reviewResults: ReviewResult[];
  testResults: TestResult[];
  qaResults: QaResult[];
  fileChanges: FileChange[];
  knownBugs: KnownBug[];
  completedTasks: string[];
  failedTasks: string[];
  commands: { build: string; test: string };
  logs: LogLine[];
  telemetry: TelemetrySample[];
  tokens: { prompt: number; completion: number };
  usageByRole: Record<string, RoleUsage>;
  modelSwitches: number;
  error: string | null;
  startedAt: string | null;
  checkpointAt: string | null;
  completedAt: string | null;
}

export interface Derived {
  total: number;
  passed: number;
  open: number;
  ratio: number;
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
}

export interface KingSnapshot extends KingState {
  derived: Derived;
  provider: { label: string; model: string; strongModel: string; hasKey: boolean };
  routing: { role: string; provider: string; model: string }[];
  workspace: string;
  running: boolean;
}
