import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ConfigError, loadConfig, providerLabel, routingTable, type LLMConfig } from './llm';
import { applyOps, buildTaskContext, buildTree, buildTreeSync, ensureWorkspace, readFileSafe, scanForPlaceholders } from './fs-tools';
import { runCommand } from './shell';
import * as agents from './agents';
import type {
  Architecture,
  Derived,
  Evidence,
  KingSnapshot,
  KingState,
  KnownBug,
  Requirement,
  ReviewFinding,
  TestResult,
} from './types';

const TICK_MS = 150;
const MAX_LOGS = 500;
const MAX_ATTEMPTS = 5;

function pad(n: number, w = 2) {
  return String(n).padStart(w, '0');
}

function nowIso() {
  return new Date().toISOString();
}

function newRunId() {
  const d = new Date();
  return `KG-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function emptyState(workspacePath = ''): KingState {
  return {
    runId: newRunId(),
    workspacePath,
    masterPrompt: '',
    phase: 'idle',
    status: 'idle',
    activity: null,
    iteration: 0,
    currentTask: null,
    taskQueue: [],
    requirements: [],
    files: [],
    architecture: null,
    reviewResults: [],
    testResults: [],
    qaResults: [],
    fileChanges: [],
    knownBugs: [],
    completedTasks: [],
    failedTasks: [],
    commands: { build: '', test: '' },
    logs: [],
    telemetry: [],
    tokens: { prompt: 0, completion: 0 },
    usageByRole: {},
    modelSwitches: 0,
    error: null,
    startedAt: null,
    checkpointAt: null,
    completedAt: null,
  };
}

class HaltSignal extends Error {}

/**
 * Local release gates. These run on recorded state and the real workspace — the
 * LLM cannot override them. PROJECT_COMPLETE requires every one to hold.
 */
export async function releaseViolations(state: KingState, root: string): Promise<string[]> {
  const v: string[] = [];
  const reqs = state.requirements;

  if (reqs.length === 0) v.push('no requirements were extracted from the master prompt');

  // 1. Every requirement passed or was explicitly skipped.
  const notPassed = reqs.filter((r) => r.status !== 'passed' && r.status !== 'skipped');
  if (notPassed.length > 0) v.push(`${notPassed.length} requirement(s) not passed: ${notPassed.map((r) => r.id).join(', ')}`);

  for (const r of reqs) {
    if (r.status !== 'passed') continue;
    // 2. Acceptance criteria recorded and non-empty.
    if (r.acceptanceCriteria.length === 0) v.push(`${r.id} passed with no acceptance criteria`);
    // 3. Required reviews actually passed.
    if (r.reviewRequired) {
      const review = state.reviewResults.filter((x) => x.requirementId === r.id).slice(-1)[0];
      if (!review) v.push(`${r.id} passed without any review`);
      else if (review.verdict !== 'pass') v.push(`${r.id} passed with a non-passing review`);
      else if (review.findings.some((f) => f.severity === 'blocker' || f.severity === 'major')) {
        v.push(`${r.id} passed with unresolved blocker/major review findings`);
      }
    }
    // 4. Required QA actually passed with real command evidence.
    if (r.testRequired) {
      const qa = state.qaResults.filter((q) => q.requirementId === r.id).slice(-1)[0];
      if (!qa) v.push(`${r.id} passed without any QA result`);
      else if (qa.verdict !== 'pass') v.push(`${r.id} passed with a failing QA verdict`);
      const runs = state.testResults.filter((t) => t.requirementId === r.id && t.exitCode !== null);
      if (runs.length === 0) v.push(`${r.id} passed with no captured command evidence`);
      else if (!runs.some((t) => t.passed)) v.push(`${r.id} passed but no validation command succeeded`);
    }
    // 5. Complete evidence chain: Req → Task → Files → Review → Tests → QA → Verdict.
    if (r.evidence.length === 0) {
      v.push(`${r.id} passed with an empty evidence chain`);
    } else {
      // A final King verdict must exist in the chain.
      const hasVerdict = r.evidence.some((e) => e.kind === 'verdict');
      if (!hasVerdict) v.push(`${r.id} passed without a King verdict in the evidence chain`);
      // If review was required, a passing review evidence entry must be in the chain.
      if (r.reviewRequired) {
        const hasReviewEvidence = r.evidence.some((e) => e.kind === 'review' && e.ok);
        if (!hasReviewEvidence) v.push(`${r.id} passed but evidence chain lacks a passing review entry`);
      }
      // If testing was required, QA evidence must be in the chain.
      if (r.testRequired) {
        const hasQaEvidence = r.evidence.some((e) => e.kind === 'qa' && e.ok);
        if (!hasQaEvidence) v.push(`${r.id} passed but evidence chain lacks a passing QA entry`);
      }
    }
  }

  // 6. No open blocker/major bugs.
  const openSevere = state.knownBugs.filter((b) => b.status === 'open' && (b.severity === 'blocker' || b.severity === 'major'));
  if (openSevere.length > 0) v.push(`${openSevere.length} open blocker/major bug(s): ${openSevere.map((b) => b.id).join(', ')}`);

  // 7. No fake implementations / placeholders in files the workers wrote.
  const written = state.fileChanges.filter((c) => c.action !== 'delete').map((c) => c.path);
  if (written.length > 0) {
    const hits = await scanForPlaceholders(root, Array.from(new Set(written)));
    if (hits.length > 0) v.push(`placeholder/stub markers found: ${hits.slice(0, 3).join('; ')}`);
  } else {
    v.push('no files were written — nothing was actually implemented');
  }

  // 8. Real build/test evidence exists somewhere in the run.
  const successfulRuns = state.testResults.filter((t) => t.passed && t.exitCode === 0);
  if (successfulRuns.length === 0) v.push('no successful build/test command run was captured');

  return v;
}


export function derive(state: KingState): Derived {
  const reqs = state.requirements;
  const total = reqs.length;
  const passed = reqs.filter((r) => r.status === 'passed').length;
  const open = reqs.filter((r) => r.status !== 'passed' && r.status !== 'failed' && r.status !== 'skipped').length;
  const ratio = total === 0 ? 0 : passed / total;
  const openBugs = state.knownBugs.filter((b) => b.status === 'open').length;

  const qaRuns = state.qaResults;
  const checksTotal = qaRuns.reduce((s, q) => s + Math.max(1, q.checksTotal), 0);
  const checksPassed = qaRuns.reduce((s, q) => s + q.checksPassed, 0);

  const blockerFindings = state.reviewResults.reduce(
    (s, r) => s + r.findings.filter((f) => f.severity === 'blocker' || f.severity === 'major').length,
    0,
  );
  const failedQaRuns = state.testResults.filter((t) => !t.passed).length;
  const defectsFound = blockerFindings + failedQaRuns;

  const cur = reqs.find((r) => r.id === state.currentTask) ?? null;
  let stageIndex = 0;
  if (state.phase === 'architecting') stageIndex = 1;
  else if (state.phase === 'executing') {
    stageIndex = cur?.status === 'awaiting_review' ? 5 : cur?.status === 'awaiting_qa' ? 6 : cur?.status === 'fix_required' ? 7 : 4;
  } else if (state.phase === 'final_audit') stageIndex = 10;
  else if (state.phase === 'complete') stageIndex = 11;
  else if (state.phase === 'error') stageIndex = 10;

  const implemented = reqs.filter((r) => r.files.length > 0);
  const audit: Record<string, boolean> = {
    AU1: total > 0 && reqs.every((r) => r.acceptanceCriteria.length > 0),
    AU2: state.architecture !== null,
    AU3: total > 0 && reqs.every((r) => r.status === 'passed' || r.status === 'failed' || r.status === 'skipped'),
    AU4: state.knownBugs.every((b) => b.description.trim().length > 0),
    AU5: implemented.length > 0 && implemented.every((r) => state.reviewResults.some((v) => v.requirementId === r.id)),
    AU6: state.testResults.length > 0 && state.testResults.every((t) => t.exitCode !== null),
    AU7: openBugs === 0,
    AU8: state.status === 'complete',
  };

  return {
    total,
    passed,
    open,
    ratio,
    passRate: total === 0 ? 0 : (passed / total) * 100,
    coverage: total === 0 ? 0 : (passed / total) * 100,
    testsPassed: checksPassed,
    testsTotal: checksTotal,
    defectsFound,
    defectsCaught: defectsFound,
    reworkCycles: reqs.reduce((s, r) => s + r.fixCount, 0),
    reviewsPassed: state.reviewResults.filter((r) => r.verdict === 'pass').length,
    overall: Math.round(ratio * 100),
    stageIndex,
    audit,
  };
}

export class Orchestrator {
  readonly cfg: LLMConfig;
  readonly root: string;
  private readonly stateFile: string;
  private state: KingState;
  private haltMode: 'pause' | 'reset' | null = null;
  private loop: Promise<void> | null = null;
  private briefCache: { key: string; text: string } | null = null;
  private architectWaived = false;

  constructor(opts: { root?: string; cfg?: LLMConfig } = {}) {
    this.cfg = opts.cfg ?? loadConfig();
    this.root = path.resolve(opts.root ?? process.env.KING_WORKSPACE ?? path.join(process.cwd(), '.king-workspace'));
    this.stateFile = path.join(this.root, '.king', 'state.json');
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    this.state = this.load() ?? emptyState(this.root);

    // Project isolation: verify the persisted workspacePath matches this.root.
    // If they differ, the state file belongs to a different project — refuse to
    // silently reuse it; the operator must reset explicitly.
    if (this.state.workspacePath && this.state.workspacePath !== this.root) {
      const foreign = this.state.workspacePath;
      this.state = emptyState(this.root);
      this.pushLog('err', 'SUPREMUS', `workspace mismatch: state file belongs to "${foreign}" but this instance is rooted at "${this.root}" — state cleared; use the correct workspace or reset explicitly`);
      this.checkpoint();
    }
    // Resume safety: metadata in the checkpoint may be stale. The workspace on disk
    // is the source of truth for the file tree, and any requirement caught mid-flight
    // by the interruption goes back into the repair queue rather than being trusted.
    if (this.state.requirements.length > 0) {
      this.state.files = buildTreeSync(this.root);
      let reconciled = 0;
      for (const r of this.state.requirements) {
        if (r.status === 'in_progress' || r.status === 'awaiting_review' || r.status === 'awaiting_qa') {
          r.status = 'fix_required';
          r.lastError = r.lastError ?? 'interrupted mid-flight — resumed from checkpoint, work re-queued';
          reconciled += 1;
        }
      }
      // A run that was executing when the process died is restored as paused, never auto-resumed.
      if (this.state.status === 'running') {
        this.state.status = 'paused';
        this.state.activity = null;
        this.pushLog('warn', 'SUPREMUS', `restored from checkpoint ${this.state.checkpointAt ?? '(unknown)'} after interruption — resume manually`);
        if (reconciled > 0) this.pushLog('warn', 'FOREMAN', `${reconciled} requirement(s) were mid-flight — re-queued for repair`);
        this.pushLog('sys', 'FOREMAN', `workspace re-scanned: ${this.state.files.filter((f) => f.type === 'file').length} file(s) on disk`);
        this.checkpoint();
      }
    } else if (this.state.status === 'running') {
      this.state.status = 'paused';
      this.state.activity = null;
      this.pushLog('warn', 'SUPREMUS', `restored from checkpoint ${this.state.checkpointAt ?? '(unknown)'} after interruption — resume manually`);
      this.checkpoint();
    }
  }

  // ------------------------------------------------------------------ API

  snapshot(): KingSnapshot {
    return {
      ...this.state,
      derived: derive(this.state),
      provider: {
        label: providerLabel(this.cfg),
        model: this.cfg.model,
        strongModel: this.cfg.strongModel,
        hasKey: Boolean(this.cfg.apiKey),
      },
      routing: routingTable(this.cfg),
      workspace: this.root,
      running: this.loop !== null,
    };
  }

  async start(input: { masterPrompt: string; buildCommand?: string; testCommand?: string }): Promise<void> {
    if (this.loop) throw new Error('a run is already in flight');
    const prompt = String(input.masterPrompt ?? '').trim();
    if (prompt.length < 10) throw new Error('master prompt must be at least 10 characters');

    await ensureWorkspace(this.root);
    this.state = emptyState(this.root);
    this.architectWaived = false;
    this.briefCache = null;
    this.state.masterPrompt = prompt;
    this.state.commands.build = String(input.buildCommand ?? '').trim();
    this.state.commands.test = String(input.testCommand ?? '').trim();
    this.state.startedAt = nowIso();
    this.state.phase = 'understanding';
    this.state.status = 'running';
    this.pushLog('sys', 'SUPREMUS', `run ${this.state.runId} authorised · workspace ${this.root}`);
    this.pushLog('sys', 'SCOUT', 'phase UNDERSTAND — decomposing master prompt into REQ-ids');
    this.checkpoint();
    this.loop = this.run().finally(() => {
      this.loop = null;
    });
  }

  pause(): void {
    if (!this.loop) return;
    this.haltMode = 'pause';
    this.pushLog('warn', 'SUPREMUS', 'pause requested — halting at the next safe checkpoint');
  }

  async resume(): Promise<void> {
    if (this.loop) return;
    if (this.state.status === 'complete') throw new Error('run already complete — start a new run');
    if (this.state.phase === 'idle') throw new Error('no run to resume');
    // Project isolation: resuming must re-open the exact workspace that owns this run.
    if (this.state.workspacePath && this.state.workspacePath !== this.root) {
      throw new Error(`workspace mismatch: this run belongs to "${this.state.workspacePath}" — resume from the correct workspace`);
    }
    this.haltMode = null;
    this.state.status = 'running';
    this.state.error = null;
    this.pushLog('sys', 'SUPREMUS', `resuming from checkpoint · phase ${this.state.phase} · ${this.state.currentTask ?? 'no task in flight'}`);
    this.checkpoint();
    this.loop = this.run().finally(() => {
      this.loop = null;
    });
  }

  async reset(): Promise<void> {
    if (this.loop) {
      this.haltMode = 'reset';
      await this.loop;
    }
    this.state = emptyState();
    this.pushLog('sys', 'SUPREMUS', 'deck cleared · orchestrator idle');
    this.checkpoint();
  }

  // -------------------------------------------------------------- loop

  private async run(): Promise<void> {
    try {
      if (!this.cfg.apiKey) throw new ConfigError('KING_API_KEY is not set — the King cannot reason without a model');
      let auditCycles = 0;
      while (!this.haltMode) {
        this.guard();
        if (this.state.phase === 'understanding') await this.understand();
        else if (this.state.phase === 'architecting') await this.architect();
        else if (this.state.phase === 'executing') await this.executeLoop();
        else if (this.state.phase === 'final_audit') {
          const done = await this.finalAudit();
          if (done) break;
          auditCycles += 1;
          if (auditCycles > 6) {
            throw new Error('final audit still unsatisfied after 6 cycles — halting for the operator instead of spinning');
          }
        } else break;
      }
      if (this.haltMode === 'pause' && this.state.status !== 'complete') {
        this.state.status = 'paused';
        this.state.activity = null;
        this.pushLog('warn', 'SUPREMUS', 'run held by operator — state checkpointed for resume');
        this.checkpoint();
      }
    } catch (err) {
      if (err instanceof HaltSignal) {
        if (this.state.status !== 'complete') this.state.status = 'paused';
        this.checkpoint();
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.state.status = 'error';
      this.state.phase = 'error';
      this.state.error = message;
      this.state.activity = null;
      this.pushLog('err', 'SUPREMUS', `run halted: ${message}`);
      if (err instanceof ConfigError) {
        this.pushLog('warn', 'SUPREMUS', 'set KING_API_KEY (and optionally KING_API_BASE / KING_MODEL), then resume');
      }
      this.checkpoint();
    } finally {
      this.haltMode = null;
    }
  }

  private guard() {
    if (this.haltMode) throw new HaltSignal();
  }

  /**
   * Record real token usage against the role that spent it, plus which
   * provider/model actually served the call (it may be the fallback route).
   */
  private account(
    role: 'king' | 'scout' | 'architect' | 'worker' | 'reviewer' | 'qa',
    usage: { prompt: number; completion: number },
    served: { provider: string; model: string; fallback: boolean },
  ) {
    this.state.tokens.prompt += usage.prompt;
    this.state.tokens.completion += usage.completion;
    const slot = (this.state.usageByRole[role] ??= {
      prompt: 0,
      completion: 0,
      calls: 0,
      provider: served.provider,
      model: served.model,
      fallbacks: 0,
    });
    slot.prompt += usage.prompt;
    slot.completion += usage.completion;
    slot.calls += 1;
    slot.provider = served.provider;
    slot.model = served.model;
    if (served.fallback) {
      slot.fallbacks += 1;
      this.pushLog('warn', 'SUPREMUS', `${role}: route failed over to fallback provider/model (${served.provider}/${served.model})`);
    }
  }

  private async understand() {
    // Resume safety: a checkpoint that already holds requirements must not re-derive them.
    if (this.state.requirements.length > 0) {
      this.pushLog('sys', 'SCOUT', `checkpoint already holds ${this.state.requirements.length} requirements — skipping re-extraction`);
      this.state.phase = this.state.architecture ? 'executing' : 'architecting';
      this.checkpoint();
      return;
    }
    this.state.activity = 'plan';
    this.pushLog('info', 'SCOUT', 'extracting requirements from the master prompt');
    const { requirements, usage, served } = await agents.scout(this.cfg, this.state.masterPrompt);
    this.account('scout', usage, served);
    if (requirements.length === 0) throw new Error('SCOUT produced no requirements — refine the master prompt');
    let n = 1;
    for (const r of requirements) {
      this.state.requirements.push({
        id: `REQ-${pad(n++, 3)}`,
        statement: r.statement,
        acceptanceCriteria: r.acceptanceCriteria.length ? r.acceptanceCriteria : [r.statement],
        priority: r.priority,
        status: 'pending',
        agent: null,
        files: [],
        approach: null,
        reviewRequired: true,
        testRequired: true,
        attempts: 0,
        fixCount: 0,
        evidence: [],
        lastError: null,
        modelOverride: null,
      });
    }
    this.state.taskQueue = this.state.requirements.map((r) => r.id);
    this.pushLog('ok', 'SCOUT', `${this.state.requirements.length} requirements registered: ${this.state.requirements
      .map((r) => r.id)
      .join(', ')}`);

    // Flow: MASTER PROMPT → SCOUT → KING → ARCHITECT (only when the King judges it necessary).
    const need = await agents.kingNeedsArchitect(this.cfg, this.briefing());
    this.account('king', need.usage, need.served);
    this.pushLog('sys', 'SUPREMUS', `architecture pass ${need.needed ? 'REQUIRED' : 'waived'} — ${need.reason.slice(0, 200)}`);
    this.architectWaived = !need.needed;

    this.state.phase = 'architecting';
    this.state.iteration += 1;
    this.sample();
    this.checkpoint();
  }

  private async architect() {
    // Resume safety: never redesign an architecture the checkpoint already holds.
    if (this.state.architecture) {
      this.state.phase = 'executing';
      this.checkpoint();
      return;
    }
    // The King waived the architecture pass — record a minimal plan and move on.
    if (this.architectWaived) {
      this.state.architecture = {
        summary: `Waived by the King: direct implementation of ${this.state.requirements.length} requirement(s) without a separate architecture pass.`,
        modules: [],
        suggestedFiles: [],
        buildCommand: this.state.commands.build,
        testCommand: this.state.commands.test,
        risks: [],
        at: nowIso(),
      };
      this.state.phase = 'executing';
      this.checkpoint();
      return;
    }
    this.state.activity = 'plan';
    this.pushLog('info', 'ORACLE', 'designing architecture and implementation plan');
    const { usage, served, ...arch } = await agents.architect(
      this.cfg,
      this.state.masterPrompt,
      this.state.requirements.map((r) => ({ id: r.id, statement: r.statement })),
    );
    this.account('architect', usage, served);
    const architecture: Architecture = { ...arch, at: nowIso() };
    this.state.architecture = architecture;
    if (architecture.buildCommand && !this.state.commands.build) this.state.commands.build = architecture.buildCommand;
    if (architecture.testCommand && !this.state.commands.test) this.state.commands.test = architecture.testCommand;
    this.pushLog('ok', 'ORACLE', `architecture ready — ${architecture.modules.length} modules, ${architecture.suggestedFiles.length} planned files`);
    this.pushLog('sys', 'FOREMAN', `build: ${this.state.commands.build || '(none)'} · test: ${this.state.commands.test || '(none)'}`);
    this.state.phase = 'executing';
    this.state.iteration += 1;
    this.sample();
    this.checkpoint();
  }

  /**
   * Shared project context handed to every King call. Built once per
   * iteration and memoised so repeated calls inside one iteration do not
   * re-serialise (or re-pay for) the same context.
   */
  private briefing(): string {
    const key = `${this.state.iteration}:${this.state.phase}:${this.state.requirements.length}:${this.state.knownBugs.length}`;
    if (this.briefCache?.key === key) return this.briefCache.text;

    const lines = this.state.requirements.map(
      (r) => `${r.id} [${r.status}] agent=${r.agent ?? '-'} attempts=${r.attempts} :: ${r.statement.slice(0, 140)}`,
    );
    const tree = this.state.files
      .filter((f) => f.type === 'file')
      .slice(0, 60)
      .map((f) => f.path)
      .join(', ');
    const text = [
      `RUN ${this.state.runId} · phase ${this.state.phase} · iteration ${this.state.iteration}`,
      `MASTER PROMPT: ${this.state.masterPrompt.slice(0, 1200)}`,
      `REQUIREMENTS (${this.state.requirements.length}):\n${lines.join('\n')}`,
      `COMPLETED: ${this.state.completedTasks.join(', ') || '(none)'}`,
      `FAILED/ESCALATED: ${this.state.failedTasks.join(', ') || '(none)'}`,
      `OPEN BUGS: ${this.state.knownBugs.filter((b) => b.status === 'open').map((b) => `${b.id}@${b.requirementId}`).join(', ') || '(none)'}`,
      `ARCHITECTURE: ${this.state.architecture?.summary?.slice(0, 600) || '(not designed yet)'}`,
      `FILES IN WORKSPACE (${this.state.files.filter((f) => f.type === 'file').length}): ${tree || '(empty)'}`,
    ].join('\n\n');
    this.briefCache = { key, text };
    return text;
  }

  private async executeLoop() {
    while (!this.haltMode) {
      this.guard();
      const open = this.state.requirements.filter((r) => r.status === 'pending' || r.status === 'fix_required' || r.status === 'in_progress' || r.status === 'awaiting_review' || r.status === 'awaiting_qa');
      if (open.length === 0) {
        this.state.phase = 'final_audit';
        this.state.activity = 'audit';
        this.checkpoint();
        return;
      }

      const decision = await agents.kingNext(this.cfg, this.briefing());
      this.account('king', decision.usage, decision.served);
      this.pushLog('sys', 'SUPREMUS', `decision ${decision.action}${decision.requirementId ? ` → ${decision.requirementId}` : ''}: ${decision.reason}`);
      if (decision.action === 'abort') throw new Error(`King aborted the run: ${decision.reason}`);
      if (decision.action === 'complete') {
        this.state.phase = 'final_audit';
        this.state.activity = 'audit';
        this.checkpoint();
        return;
      }

      const req =
        (decision.requirementId && open.find((r) => r.id === decision.requirementId)) ||
        open.slice().sort((a, b) => a.priority - b.priority)[0];
      if (!req) {
        this.state.phase = 'final_audit';
        return;
      }
      await this.cycle(req);
    }
  }

  private async cycle(req: Requirement) {
    this.state.currentTask = req.id;
    req.status = 'in_progress';
    this.state.activity = 'work';
    this.state.iteration += 1;

    if (!req.approach) {
      const plan = await agents.kingPlan(this.cfg, this.briefing(), req);
      this.account('king', plan.usage, plan.served);
      req.agent = plan.agent;
      req.files = Array.from(new Set([...req.files, ...plan.files]));
      req.acceptanceCriteria = plan.acceptanceCriteria.length ? plan.acceptanceCriteria : req.acceptanceCriteria;
      req.reviewRequired = plan.mustReview;
      req.testRequired = plan.mustTest;
      req.approach = plan.approach;
      this.pushLog('info', 'FOREMAN', `${req.id} assigned to ${req.agent} · files: ${req.files.slice(0, 5).join(', ') || '(worker decides)'}`);
      this.pushLog('info', 'SUPREMUS', `${req.id} approach: ${plan.approach.slice(0, 220)}`);
      this.checkpoint();
    }

    const model = req.modelOverride ?? undefined;
    const tree = this.state.files.map((f) => (f.type === 'dir' ? `${f.path}/` : f.path)).join('\n');
    // Dependency-aware context: target files (full, high cap) → their imports →
    // related types/config → relevant tests. Never the whole repository.
    const targets = Array.from(new Set(req.files));
    const ctx = await buildTaskContext(this.root, {
      targets,
      tree: this.state.files,
      includeTests: true,
    });
    for (const note of ctx.notes) this.pushLog('warn', 'FOREMAN', `${req.id} context: ${note}`);
    const currentFiles = ctx.files.map((f) => ({ path: f.path, content: f.content }));
    const incomplete = ctx.files.filter((f) => f.truncated && targets.includes(f.path));
    if (incomplete.length > 0) {
      this.pushLog(
        'warn',
        'SUPREMUS',
        `${req.id}: full content unavailable for ${incomplete.map((f) => f.path).join(', ')} — worker must not blind-overwrite`,
      );
    }
    this.pushLog(
      'info',
      'FOREMAN',
      `${req.id} context: ${currentFiles.length} file(s) · ${ctx.deps.length} dependency(ies)${ctx.deps.length ? ` [${ctx.deps.slice(0, 4).join(', ')}]` : ''}`,
    );

    this.pushLog('info', req.agent ?? 'WRAITH', `${req.id}: ${req.fixCount > 0 ? 'repair pass' : 'implementation'} — ${req.statement.slice(0, 110)}`);
    let changes: { path: string; action: 'create' | 'write' | 'delete'; bytes: number; at: string }[] = [];
    try {
      const result = await agents.worker(
        this.cfg,
        {
          requirement: req,
          approach: req.approach ?? '',
          architecture: this.state.architecture?.summary ?? '',
          tree,
          currentFiles,
          failureContext: req.lastError,
          incompletePaths: incomplete.map((f) => f.path),
        },
        model,
      );
      this.account('worker', result.usage, result.served);
      changes = await applyOps(this.root, result.operations);
      if (result.notes) this.pushLog('info', req.agent ?? 'WRAITH', `${req.id} notes: ${result.notes.slice(0, 200)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.pushLog('err', req.agent ?? 'WRAITH', `${req.id} file operations failed: ${message}`);
      await this.failReq(req, `worker/file-op failure: ${message}`);
      return;
    }

    this.state.fileChanges.push(...changes);
    this.state.files = await buildTree(this.root);
    req.files = Array.from(new Set([...req.files, ...changes.map((c) => c.path)]));
    this.pushLog('ok', req.agent ?? 'WRAITH', `${req.id}: ${changes.length} file operation(s) applied — ${changes.map((c) => `${c.action}:${c.path}`).slice(0, 4).join(', ')}`);
    req.evidence.push({ kind: 'note', ok: true, summary: `worker applied ${changes.length} file operation(s)`, at: nowIso() } as Evidence);
    this.state.iteration += 1;
    this.sample();
    this.checkpoint();

    // ---- independent review of the actual code, with integration context
    if (req.reviewRequired) {
      this.guard();
      this.state.activity = 'review';
      req.status = 'awaiting_review';
      const written = changes.filter((c) => c.action !== 'delete').map((c) => c.path);
      // Review what actually changed, plus what it depends on, so integration is judged too.
      const reviewCtx = await buildTaskContext(this.root, {
        targets: written,
        tree: this.state.files,
        extra: req.files.filter((f) => !written.includes(f)),
        includeTests: true,
      });
      const priorResults = this.state.testResults
        .filter((t) => t.requirementId === req.id)
        .slice(-4)
        .map((t) => `$ ${t.command} → exit ${t.exitCode}${t.timedOut ? ' (timeout)' : ''}`)
        .join('\n');
      this.pushLog('info', 'ARBITER', `${req.id}: reviewing ${reviewCtx.files.length} file(s) incl. ${reviewCtx.deps.length} dependency(ies)`);
      const review = await agents.reviewer(
        this.cfg,
        req,
        req.acceptanceCriteria,
        reviewCtx.files.map((f) => ({ path: f.path, content: f.content })),
        model,
        {
          architecture: this.state.architecture?.summary ?? '(none)',
          dependencies: reviewCtx.deps,
          priorResults: priorResults || '(no prior command results for this requirement)',
        },
      );
      this.account('reviewer', review.usage, review.served);
      const { usage: revUsage, served: revServed, ...revRecord } = review;
      void revUsage;
      void revServed;
      const full = { ...revRecord, requirementId: req.id, agent: 'ARBITER', at: nowIso() };
      this.state.reviewResults.push(full);
      req.evidence.push({ kind: 'review', ok: review.verdict === 'pass', summary: review.summary, at: nowIso() });
      this.checkpoint();
      if (review.verdict === 'fail') {
        const worst = review.findings.find((f) => f.severity === 'blocker') ?? review.findings[0];
        this.pushLog('err', 'ARBITER', `${req.id} review FAILED — ${review.summary.slice(0, 180)}`);
        if (worst) this.pushLog('err', 'ARBITER', `${worst.severity} in ${worst.file || '(unknown file)'}: ${worst.message.slice(0, 180)}`);
        await this.failReq(req, `review failed: ${review.summary}`, review.findings);
        return;
      }
      this.pushLog('ok', 'ARBITER', `${req.id} review PASSED — ${review.summary.slice(0, 180)}`);
    }

    // ---- real command execution
    if (req.testRequired) {
      this.guard();
      this.state.activity = 'qa';
      req.status = 'awaiting_qa';
      const commands = [this.state.commands.build, this.state.commands.test].filter(Boolean);
      if (commands.length === 0) {
        // Real QA needs real evidence. Ask the King to propose a runnable validation
        // command; probe it before adopting. If nothing runs, QA cannot pass.
        this.pushLog('warn', 'HERALD', `${req.id}: no validation command configured — asking the King for one`);
        const proposal = await agents.proposeCommand(this.cfg, this.briefing(), req, this.state.files.map((f) => f.path));
        this.account('king', proposal.usage, proposal.served);
        const candidate = String(proposal.command ?? '').trim();
        if (!candidate) {
          this.pushLog('err', 'HERALD', `${req.id}: no validation command available — QA cannot pass without evidence`);
          await this.failReq(req, 'no validation command available — QA requires real command evidence');
          return;
        }
        this.pushLog('info', 'SUPREMUS', `${req.id}: proposed validation command \`${candidate}\` — ${proposal.reason.slice(0, 160)}`);
        const probe = await runCommand(candidate, { cwd: this.root, requirementId: req.id });
        if (probe.exitCode === null || probe.timedOut) {
          this.pushLog('err', 'HERALD', `${req.id}: proposed command is not runnable (exit=${probe.exitCode}${probe.timedOut ? ', timeout' : ''})`);
          await this.failReq(req, `proposed validation command is not runnable: \`${candidate}\``);
          return;
        }
        this.state.commands.test = candidate;
        this.pushLog('ok', 'HERALD', `${req.id}: validation command adopted — \`${candidate}\` (exit=${probe.exitCode})`);
        this.checkpoint();
        commands.push(candidate);
      }
      const results: TestResult[] = [];
      for (const command of commands) {
        this.guard();
        this.pushLog('info', 'HERALD', `${req.id}: running \`${command}\``);
        const result = await runCommand(command, { cwd: this.root, requirementId: req.id });
        results.push(result);
        this.state.testResults.push(result);
        const tail = (result.stdout.trim().split('\n').slice(-3).join(' | ') || result.stderr.trim().split('\n').slice(-2).join(' | ')).slice(0, 200);
        this.pushLog(
          result.passed ? 'ok' : 'err',
          'HERALD',
          `${req.id}: \`${command}\` exit=${result.exitCode} (${result.durationMs}ms) — ${tail}`,
        );
      }
      // Hard invariant: QA may never pass on an empty evidence set. This is a local
      // rule, not a model opinion — no LLM call happens without real command output.
      const evidenced = results.filter((r) => r.exitCode !== null);
      if (evidenced.length === 0) {
        this.pushLog('err', 'ARBITER', `${req.id} QA BLOCKED — zero command evidence, PASS is impossible`);
        await this.failReq(req, 'no command evidence captured — QA cannot validate acceptance criteria');
        return;
      }
      const qaVerdict = await agents.qa(this.cfg, req, req.acceptanceCriteria, results, model);
      this.account('qa', qaVerdict.usage, qaVerdict.served);
      const { usage: qaUsage, served: qaServed, ...qaRecord } = qaVerdict;
      void qaUsage;
      void qaServed;
      const verdict: 'pass' | 'fail' = qaVerdict.verdict === 'pass' && evidenced.length > 0 ? 'pass' : 'fail';
      if (verdict === 'fail' && qaVerdict.verdict === 'pass') {
        this.pushLog('warn', 'ARBITER', `${req.id}: QA model claimed pass — overridden locally (evidence incomplete)`);
      }
      this.state.qaResults.push({ ...qaRecord, verdict, requirementId: req.id, at: nowIso() });
      req.evidence.push({ kind: 'qa', ok: verdict === 'pass', summary: qaVerdict.summary, at: nowIso() });
      this.state.iteration += 1;
      this.sample();
      this.checkpoint();
      if (verdict === 'fail') {
        this.pushLog('err', 'ARBITER', `${req.id} QA FAILED — ${qaVerdict.summary.slice(0, 180)}${qaVerdict.gaps.length ? ` · gaps: ${qaVerdict.gaps[0].slice(0, 120)}` : ''}`);
        await this.failReq(req, `QA failed: ${qaVerdict.summary}${qaVerdict.gaps.length ? ` | gaps: ${qaVerdict.gaps.join('; ')}` : ''}`);
        return;
      }
      this.pushLog('ok', 'ARBITER', `${req.id} QA PASSED — ${qaVerdict.checksPassed}/${qaVerdict.checksTotal} checks · ${evidenced.length} command run(s) captured`);
    }

    // ---- the King's verdict
    this.guard();
    this.state.activity = 'audit';
    const verdict = await agents.kingVerdict(this.cfg, this.briefing(), req, model);
    this.account('king', verdict.usage, verdict.served);
    req.evidence.push({ kind: 'verdict', ok: verdict.verdict === 'pass', summary: verdict.reason, at: nowIso() });
    if (verdict.verdict === 'fix') {
      this.pushLog('err', 'SUPREMUS', `${req.id} verdict FIX REQUIRED — ${verdict.reason.slice(0, 200)}`);
      await this.failReq(req, `King verdict: ${verdict.reason}`);
      return;
    }

    req.status = 'passed';
    this.state.completedTasks.push(req.id);
    // Every defect opened against this requirement is closed by its passing evidence.
    for (const bug of this.state.knownBugs) {
      if (bug.requirementId === req.id && bug.status === 'open') {
        bug.status = 'resolved';
        bug.resolvedAt = nowIso();
      }
    }
    this.pushLog('ok', 'SUPREMUS', `${req.id} PASS — ${verdict.reason.slice(0, 180)}`);
    this.state.currentTask = null;
    this.state.activity = null;
    this.state.iteration += 1;
    this.sample();
    this.checkpoint();
  }

  private async failReq(req: Requirement, reason: string, findings: ReviewFinding[] = []) {
    req.attempts += 1;
    req.fixCount += 1;
    req.status = 'fix_required';
    req.lastError = reason;
    this.state.activity = 'work';

    const severity: KnownBug['severity'] = findings.some((f) => f.severity === 'blocker')
      ? 'blocker'
      : findings.some((f) => f.severity === 'major')
        ? 'major'
        : 'minor';
    const bug: KnownBug = {
      id: `BUG-${pad(this.state.knownBugs.length + 1, 3)}`,
      requirementId: req.id,
      description: reason,
      severity,
      status: 'open',
      openedAt: nowIso(),
      resolvedAt: null,
    };
    this.state.knownBugs.push(bug);
    this.pushLog('warn', 'FOREMAN', `${req.id} → repair task ${bug.id} (${severity}) · attempt ${req.attempts}/${MAX_ATTEMPTS}`);

    // Error protection: two failures force a reassessment of the approach.
    if (req.attempts === 2) {
      this.pushLog('warn', 'SUPREMUS', `${req.id}: two failures — reassessing approach before another attempt`);
      const plan = await agents.reassess(
        this.cfg,
        req,
        this.state.knownBugs.filter((b) => b.requirementId === req.id).map((b) => b.description),
      );
      this.account('king', plan.usage, plan.served);
      req.approach = plan.approach;
      if (plan.agent) req.agent = plan.agent;
      this.pushLog('info', 'SUPREMUS', `${req.id}: new approach — ${plan.approach.slice(0, 200)}`);
    }

    // Error protection: three failures change the strategy — escalate to the stronger model.
    if (req.attempts >= 3 && !req.modelOverride) {
      req.modelOverride = this.cfg.strongModel;
      this.state.modelSwitches += 1;
      this.pushLog('warn', 'SUPREMUS', `${req.id}: three failures — switching strategy and escalating to model ${this.cfg.strongModel}`);
    }

    if (req.attempts >= MAX_ATTEMPTS) {
      req.status = 'failed';
      this.state.failedTasks.push(req.id);
      this.pushLog('err', 'SUPREMUS', `${req.id}: abandoned after ${req.attempts} attempts — escalated to the operator, run continues on other requirements`);
    }

    this.state.currentTask = null;
    this.state.iteration += 1;
    this.sample();
    this.checkpoint();
  }

  private async finalAudit(): Promise<boolean> {
    this.state.phase = 'final_audit';
    this.state.activity = 'audit';
    this.state.currentTask = null;
    this.pushLog('sys', 'SUPREMUS', 'phase FINAL AUDIT — tracing requirements to evidence');

    // Rebuild the tree from the real workspace before judging — never trust metadata.
    this.state.files = buildTreeSync(this.root);

    const outstanding = this.state.requirements.filter((r) => r.status !== 'passed' && r.status !== 'skipped');
    const openBugs = this.state.knownBugs.filter((b) => b.status === 'open');
    const evidenceSummary = [
      `Requirements: ${this.state.requirements.map((r) => `${r.id}=${r.status}`).join(', ')}`,
      `Reviews: ${this.state.reviewResults.map((r) => `${r.requirementId}:${r.verdict}`).join(', ') || '(none)'}`,
      `Command runs: ${this.state.testResults.map((t) => `${t.command}→exit ${t.exitCode}`).join(' | ') || '(none)'}`,
      `QA: ${this.state.qaResults.map((q) => `${q.requirementId}:${q.verdict}`).join(', ') || '(none)'}`,
      `Open bugs: ${openBugs.map((b) => `${b.id}@${b.requirementId}`).join(', ') || '(none)'}`,
      `Files written: ${this.state.fileChanges.length}`,
    ].join('\n');

    const audit = await agents.finalAudit(this.cfg, this.briefing(), evidenceSummary);
    this.account('king', audit.usage, audit.served);
    this.sample();

    // Local invariants are checked independently of the model verdict. The LLM
    // alone can never release: every gate below must hold on real recorded state.
    const violations = await releaseViolations(this.state, this.root);
    if (violations.length > 0) {
      for (const v of violations.slice(0, 8)) this.pushLog('warn', 'SUPREMUS', `invariant not met: ${v}`);
    }

    const invariantsOk = violations.length === 0;
    if (audit.verdict === 'complete' && invariantsOk) {
      this.state.phase = 'complete';
      this.state.status = 'complete';
      this.state.completedAt = nowIso();
      this.state.activity = null;
      this.pushLog('ok', 'HERALD', `audit evidence verified · ${this.state.fileChanges.length} file operations · ${this.state.testResults.length} command runs captured`);
      this.pushLog('ok', 'SUPREMUS', 'PROJECT_COMPLETE');
      this.checkpoint();
      return true;
    }

    const reasons =
      violations.length > 0
        ? violations.slice(0, 6)
        : audit.verdict !== 'complete'
          ? audit.reasons
          : [`invariants: ${outstanding.length} requirement(s) outstanding, ${openBugs.length} open bug(s)`];
    this.pushLog('warn', 'SUPREMUS', `declaration withheld — ${reasons.join(' · ').slice(0, 300)}`);
    this.state.phase = 'executing';
    this.state.activity = null;
    this.checkpoint();
    return false;
  }

  // ------------------------------------------------------------ plumbing

  private sample() {
    const d = derive(this.state);
    this.state.telemetry.push({
      t: Date.now(),
      tokens: this.state.tokens.prompt + this.state.tokens.completion,
      passRate: d.passRate,
      coverage: d.coverage,
      ratio: d.ratio,
    });
    if (this.state.telemetry.length > 90) this.state.telemetry = this.state.telemetry.slice(-90);
  }

  private pushLog(level: 'sys' | 'info' | 'ok' | 'warn' | 'err', agent: string, text: string) {
    this.state.logs.push({
      id: this.state.logs.length ? this.state.logs[this.state.logs.length - 1].id + 1 : 1,
      tick: Math.round(Date.now() / TICK_MS) % 1_000_000,
      at: nowIso(),
      level,
      agent,
      text,
    });
    if (this.state.logs.length > MAX_LOGS) this.state.logs = this.state.logs.slice(-MAX_LOGS);
    console.log(`[${new Date().toISOString()}] ${level.toUpperCase().padEnd(4)} ${agent.padEnd(8)} ${text}`);
  }

  private checkpoint() {
    this.state.checkpointAt = nowIso();
    const tmp = `${this.stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, this.stateFile);
  }

  private load(): KingState | null {
    try {
      if (!fs.existsSync(this.stateFile)) return null;
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as KingState;
      if (!raw || typeof raw.runId !== 'string' || !Array.isArray(raw.requirements)) return null;
      // Back-fill workspacePath for state files written before this field existed.
      const state = { ...emptyState(this.root), ...raw };
      if (!state.workspacePath) state.workspacePath = this.root;
      return state;
    } catch {
      return null;
    }
  }
}

export async function readWorkspaceFile(root: string, rel: string): Promise<string | null> {
  return readFileSafe(root, rel);
}

export const __testing = { derive, emptyState, newRunId, releaseViolations };
