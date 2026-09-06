/* SSR smoke test: renders the deck from real orchestrator-shaped snapshots. */
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import App from '../src/App';
import ReleaseGate from '../src/components/ReleaseGate';
import Telemetry from '../src/components/Telemetry';
import TaskBoard from '../src/components/TaskBoard';
import RequirementLedger from '../src/components/RequirementLedger';
import AgentRoster from '../src/components/AgentRoster';
import ModelRouting from '../src/components/ModelRouting';
import { adapt, metrics, type KingSnapshot } from '../src/lib/engine';
import { derive, __testing } from '../king/orchestrator';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures += 1;
}

function baseSnapshot(overrides: Record<string, unknown>): KingSnapshot {
  const state = {
    ...__testing.emptyState(),
    runId: 'KG-TEST-001',
    masterPrompt: 'Build a greeter.',
    commands: { build: 'node -e "1"', test: 'node test.js' },
    tokens: { prompt: 12_000, completion: 5_400 },
    ...overrides,
  } as ReturnType<typeof __testing.emptyState>;
  return {
    ...state,
    derived: derive(state),
    provider: { label: 'api.openai.com', model: 'gpt-4o-mini', strongModel: 'gpt-4o', hasKey: true },
    routing: [
      { role: 'king', provider: 'api.openai.com', model: 'gpt-4o' },
      { role: 'scout', provider: 'api.openai.com', model: 'gpt-4o-mini' },
      { role: 'architect', provider: 'api.openai.com', model: 'gpt-4o' },
      { role: 'worker', provider: 'api.deepseek.com', model: 'deepseek-coder' },
      { role: 'reviewer', provider: 'api.openai.com', model: 'gpt-4o' },
      { role: 'qa', provider: 'localhost', model: 'llama3.1' },
    ],
    usageByRole: {
      king: { prompt: 4_200, completion: 1_100, calls: 5, provider: 'api.openai.com', model: 'gpt-4o', fallbacks: 0 },
      worker: { prompt: 6_900, completion: 3_400, calls: 3, provider: 'api.deepseek.com', model: 'deepseek-coder', fallbacks: 1 },
    },
    workspace: '/tmp/king-workspace',
    running: state.status === 'running',
  };
}

const req = (id: string, status: string, agent: string, fixCount = 0) => ({
  id,
  statement: `Requirement ${id}: greeter must validate input`,
  acceptanceCriteria: ['returns hello <name>', 'throws on empty input'],
  priority: 1,
  status: status as any,
  agent,
  files: ['src/implementation.js'],
  approach: 'validated module',
  reviewRequired: true,
  testRequired: true,
  attempts: fixCount,
  fixCount,
  evidence: [
    { kind: 'review' as const, ok: true, summary: 'criteria hold', at: 'now' },
    { kind: 'qa' as const, ok: status !== 'fix_required', summary: '2 assertions verified', at: 'now' },
  ],
  lastError: status === 'fix_required' ? 'review failed: missing type guard' : null,
  modelOverride: null,
});

const completeSnap = baseSnapshot({
  status: 'complete',
  phase: 'complete',
  requirements: [req('REQ-001', 'passed', 'WRAITH'), req('REQ-002', 'passed', 'LUMEN')],
  completedTasks: ['REQ-001', 'REQ-002'],
  reviewResults: [
    { requirementId: 'REQ-001', agent: 'ARBITER', verdict: 'pass', summary: 'ok', findings: [], at: 'now' },
    { requirementId: 'REQ-002', agent: 'ARBITER', verdict: 'pass', summary: 'ok', findings: [], at: 'now' },
  ],
  testResults: [{ requirementId: 'REQ-001', command: 'node test.js', exitCode: 0, passed: true, stdout: '2 passing', stderr: '', durationMs: 42, timedOut: false, at: 'now' }],
  qaResults: [
    { requirementId: 'REQ-001', verdict: 'pass', summary: 'green', checksPassed: 2, checksTotal: 2, gaps: [], at: 'now' },
    { requirementId: 'REQ-002', verdict: 'pass', summary: 'green', checksPassed: 2, checksTotal: 2, gaps: [], at: 'now' },
  ],
  telemetry: [
    { t: 1, tokens: 100, passRate: 0, coverage: 0, ratio: 0 },
    { t: 2, tokens: 14_000, passRate: 50, coverage: 50, ratio: 0.5 },
    { t: 3, tokens: 17_400, passRate: 100, coverage: 100, ratio: 1 },
  ],
  checkpointAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
});

const runningSnap = baseSnapshot({
  status: 'running',
  phase: 'executing',
  activity: 'review',
  currentTask: 'REQ-003',
  requirements: [req('REQ-001', 'passed', 'WRAITH'), req('REQ-002', 'fix_required', 'FORGE', 1), req('REQ-003', 'awaiting_review', 'LUMEN')],
  knownBugs: [{ id: 'BUG-001', requirementId: 'REQ-002', description: 'missing guard', severity: 'major', status: 'open', openedAt: 'now', resolvedAt: null }],
  telemetry: [
    { t: 1, tokens: 100, passRate: 33, coverage: 33, ratio: 0.33 },
    { t: 2, tokens: 9_000, passRate: 33, coverage: 33, ratio: 0.33 },
  ],
});

console.log('── Idle deck ──');
const idleHtml = renderToString(h(App));
check('renders without throwing', idleHtml.length > 5000);
check('branding present', idleHtml.includes('SUPERVISOR KING'));
check('mission brief input present', idleHtml.includes('What should the system build?'));
check('empty board state present', idleHtml.includes('No requirements yet'));
check('empty ledger state present', idleHtml.includes('Ledger empty'));
check('all 12 stages on the rail', ['Understand', 'Architect', 'Plan', 'Delegate', 'Implement', 'Review', 'Test', 'Fix', 'Re-test', 'Polish', 'Final Audit', 'Release'].every((s) => idleHtml.includes(s)));
check('all 9 agents on the roster', ['Supremus', 'Scout', 'Oracle', 'Foreman', 'Wraith', 'Forge', 'Lumen', 'Arbiter', 'Herald'].every((a) => idleHtml.includes(a)));
check('release gate mounted', idleHtml.includes('The Gate Before The Words'));
check('hero image referenced', idleHtml.includes('/images/bridge.png'));

console.log('\n── Live run frames ──');
const runView = adapt(runningSnap, 1);
const runMetrics = metrics(runView);
check('board shows all five lanes', ['Queued', 'Executing', 'In Review', 'Rework', 'Shipped'].every((l) => renderToString(h(TaskBoard, { state: runView })).includes(l)));
check('ledger lists requirement ids', ['REQ-001', 'REQ-002', 'REQ-003'].every((id) => renderToString(h(RequirementLedger, { state: runView, onResume: () => {} })).includes(id)));
check('ledger marks fix required', renderToString(h(RequirementLedger, { state: runView, onResume: () => {} })).includes('FIX REQUIRED'));
check('checkpoint strip renders', renderToString(h(RequirementLedger, { state: runView, onResume: () => {} })).includes('Checkpoint'));
check('roster shows real model', renderToString(h(AgentRoster, { state: runView, load: runMetrics.byAgent })).includes('gpt-4o-mini'));
check('routing panel lists every role', ['king', 'scout', 'architect', 'worker', 'reviewer', 'qa'].every((r) => renderToString(h(ModelRouting, { state: runView })).includes(r)));
check('routing panel shows per-role models', ['gpt-4o', 'deepseek-coder', 'llama3.1'].every((m) => renderToString(h(ModelRouting, { state: runView })).includes(m)));
check('routing panel surfaces failover count', renderToString(h(ModelRouting, { state: runView })).includes('1 FAILOVER'));
check('telemetry draws charts from samples', renderToString(h(Telemetry, { state: runView })).includes('<path'));

console.log('\n── Completed frames ──');
const doneView = adapt(completeSnap, 1);
const doneMetrics = metrics(doneView);
check('PROJECT_COMPLETE declaration renders', renderToString(h(ReleaseGate, { state: doneView, onResume: () => {}, onReset: () => {} })).includes('PROJECT_COMPLETE'));
check('release summary shows run id', renderToString(h(ReleaseGate, { state: doneView, onResume: () => {}, onReset: () => {} })).includes('KG-TEST-001'));
check('audit flags derived from real state', Object.values(doneView.audit).filter(Boolean).length >= 6, `${Object.values(doneView.audit).filter(Boolean).length}/8`);
check('telemetry reports 100% acceptance', doneView.passRate === 100);
check('hero offers a new run after completion', renderToString(h(App)).includes('Engage the King'));
check('metrics compute from requirements', doneMetrics.overall === 100);

console.log(`\n${failures === 0 ? 'RENDER SMOKE TEST PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
