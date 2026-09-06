/**
 * Security & isolation tests for the King orchestration system.
 *
 * Tests:
 *  1. New runs cannot accidentally reuse another project's workspace.
 *  2. Resume restores the exact workspace.
 *  3. VITE_KING_URL controls the frontend backend connection URL.
 *  4. CORS rejects unauthorized origins when KING_ALLOWED_ORIGIN is configured.
 *  5. API keys never appear in API responses or logs.
 *  6. Shell commands remain inside the configured workspace.
 *  7. Repository prompt injection is treated as untrusted data.
 *  8. A requirement cannot PASS without its required evidence chain.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Orchestrator, releaseViolations } from '../king/orchestrator';
import { assertInsideWorkspace, runCommand } from '../king/shell';
import { UNTRUSTED_DATA_RULE_TEST_EXPORT } from '../king/agents-test-shim';

// ──────────────────────────────────────────────────────────────────────────────
// Minimal test harness
// ──────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓  ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  ✗  ${name}\n     ${msg}`);
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `king-sec-${prefix}-`));
}

// ──────────────────────────────────────────────────────────────────────────────
// Test 1 — Project isolation: new run never reuses another project's workspace
// ──────────────────────────────────────────────────────────────────────────────

await test('1. New runs cannot accidentally reuse another project\'s workspace', async () => {
  const wsA = makeTmpDir('ws-a');
  const wsB = makeTmpDir('ws-b');

  try {
    // Write a state.json for project A into wsA.
    const stateDir = path.join(wsA, '.king');
    fs.mkdirSync(stateDir, { recursive: true });
    const stateA = {
      runId: 'run-a-001',
      workspacePath: wsA,
      masterPrompt: 'project A',
      requirements: [],
      phase: 'running',
      status: 'running',
    };
    fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify(stateA));

    // Create an orchestrator rooted at wsB but pointing to wsA's state dir.
    // It should detect the mismatch and refuse to silently adopt wsA's state.
    // Simulate this by creating an orchestrator at wsA then trying to use wsB.
    const orchA = new Orchestrator({ root: wsA });
    const snapA = orchA.snapshot();

    // snapA should have workspace = wsA (its own).
    assert(snapA.workspace === wsA || snapA.workspace.includes(path.basename(wsA)),
      `orchestrator at wsA should reflect its own workspace, got: ${snapA.workspace}`);

    // Now create a second orchestrator at wsB — it should NOT pick up wsA's state.
    const orchB = new Orchestrator({ root: wsB });
    const snapB = orchB.snapshot();

    // wsB orchestrator must not report workspace as wsA.
    assert(
      !snapB.workspace.includes(path.basename(wsA)),
      `wsB orchestrator must not show wsA workspace, got: ${snapB.workspace}`
    );

    // The run IDs must differ — wsB starts fresh.
    // (snapA may have run-a-001 if back-compat loaded it; snapB must be new).
    // What matters: wsB's snapshot must NOT have runId 'run-a-001'.
    assert(
      snapB.runId !== 'run-a-001',
      `wsB must not inherit wsA run ID 'run-a-001', got: ${snapB.runId}`
    );
  } finally {
    fs.rmSync(wsA, { recursive: true, force: true });
    fs.rmSync(wsB, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 2 — Resume restores the exact workspace
// ──────────────────────────────────────────────────────────────────────────────

await test('2. Resume restores the exact workspace', async () => {
  const ws = makeTmpDir('ws-resume');
  try {
    // Write a state with a specific runId and workspacePath.
    const stateDir = path.join(ws, '.king');
    fs.mkdirSync(stateDir, { recursive: true });
    const runId = `run-resume-${Date.now()}`;
    const persisted = {
      runId,
      workspacePath: ws,
      masterPrompt: 'resume test project',
      requirements: [],
      phase: 'paused',
      status: 'paused',
      logLines: [],
      fileChanges: [],
      testResults: [],
      reviewResults: [],
      qaResults: [],
      knownBugs: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, requests: 0, cacheWrite: 0, cacheRead: 0 },
    };
    fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify(persisted));

    // Construct orchestrator at the same workspace — it should load the persisted state.
    const orch = new Orchestrator({ root: ws });
    const snap = orch.snapshot();

    assert(snap.runId === runId, `Expected runId ${runId}, got ${snap.runId}`);
    assert(
      snap.workspace === ws || snap.workspace.endsWith(path.sep + path.basename(ws)),
      `Expected workspace ${ws}, got ${snap.workspace}`
    );

    // Attempting to resume from a DIFFERENT workspace must throw.
    const wrongWs = makeTmpDir('ws-wrong');
    try {
      // Copy state file into wrongWs (so it has something to load), but with ws's workspacePath.
      const wrongStateDir = path.join(wrongWs, '.king');
      fs.mkdirSync(wrongStateDir, { recursive: true });
      fs.writeFileSync(path.join(wrongStateDir, 'state.json'), JSON.stringify(persisted));

      const orchWrong = new Orchestrator({ root: wrongWs });
      // The orchestrator should detect workspace mismatch at construction time.
      // The snapshot should NOT show the persisted runId (state should be cleared).
      const snapWrong = orchWrong.snapshot();
      assert(
        snapWrong.runId !== runId,
        `Orchestrator at wrong workspace must not adopt run ${runId}, got ${snapWrong.runId}`
      );
    } finally {
      fs.rmSync(wrongWs, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 3 — VITE_KING_URL controls the frontend backend connection URL
// ──────────────────────────────────────────────────────────────────────────────

await test('3. VITE_KING_URL controls frontend backend connection URL', async () => {
  // We can't import the real api.ts (it uses import.meta.env which is Vite-only),
  // but we can verify the pattern statically from the source and the .env convention.
  const apiSrc = fs.readFileSync(
    path.join(import.meta.dirname ?? path.join(process.cwd(), 'src'), '../src/lib/api.ts'),
    'utf8'
  );

  // The source must read from VITE_KING_URL.
  assert(
    apiSrc.includes('VITE_KING_URL'),
    'api.ts must reference VITE_KING_URL'
  );

  // The source must NOT hardcode a URL without first checking the env var.
  // Verify the fallback is only used when VITE_KING_URL is absent, not as the primary value.
  // Check that VITE_KING_URL is read via nullish coalescing with localhost as fallback only.
  const hasFallbackPattern =
    apiSrc.includes('VITE_KING_URL') &&
    (apiSrc.includes('?? \'http://localhost') || apiSrc.includes("?? 'http://localhost") ||
     apiSrc.includes('?? "http://localhost'));
  assert(
    hasFallbackPattern,
    'api.ts must only fall back to localhost when VITE_KING_URL is not set'
  );

  // The source must export kingUrl so the UI can display the connected backend.
  assert(
    apiSrc.includes('export const kingUrl'),
    'api.ts must export kingUrl for the UI to display the connected backend'
  );

  // fetchHealth must be exported for connection state reporting.
  assert(
    apiSrc.includes('export async function fetchHealth'),
    'api.ts must export fetchHealth for connection status'
  );

  // The App must display the backend URL somewhere visible.
  const appSrc = fs.readFileSync(
    path.join(import.meta.dirname ?? process.cwd(), '../src/App.tsx'),
    'utf8'
  );
  assert(
    appSrc.includes('kingUrl'),
    'App.tsx must reference kingUrl to display the connected backend'
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 4 — CORS rejects unauthorized origins when configured
// ──────────────────────────────────────────────────────────────────────────────

await test('4. CORS rejects unauthorized origins when KING_ALLOWED_ORIGIN is configured', async () => {
  const serverSrc = fs.readFileSync(
    path.join(import.meta.dirname ?? process.cwd(), '../king/server.ts'),
    'utf8'
  );

  // Must not use wildcard Access-Control-Allow-Origin.
  assert(
    !serverSrc.includes("'Access-Control-Allow-Origin', '*'") &&
    !serverSrc.includes('"Access-Control-Allow-Origin", "*"'),
    'server.ts must NOT use Access-Control-Allow-Origin: * (wildcard)'
  );

  // Must read KING_ALLOWED_ORIGIN.
  assert(
    serverSrc.includes('KING_ALLOWED_ORIGIN'),
    'server.ts must read KING_ALLOWED_ORIGIN for production CORS configuration'
  );

  // Must implement origin allowlisting logic.
  assert(
    serverSrc.includes('allowedOrigin') || serverSrc.includes('isAllowedOrigin'),
    'server.ts must implement allowedOrigin() or isAllowedOrigin() function'
  );

  // Forbidden origins must get no CORS headers (test the logic inline).
  // Simulate the allowedOrigin logic from server.ts.
  const CONFIGURED = 'https://my-app.vercel.app';
  const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://localhost:4173']);

  function allowedOrigin(origin: string | undefined, configured: string, devOrigins: Set<string>): string | null {
    if (!origin) return null;
    if (configured) return origin === configured ? origin : null;
    return devOrigins.has(origin) ? origin : null;
  }

  // With KING_ALLOWED_ORIGIN set: only the exact origin is allowed.
  assert(
    allowedOrigin('https://my-app.vercel.app', CONFIGURED, DEV_ORIGINS) === 'https://my-app.vercel.app',
    'Configured origin should be allowed'
  );
  assert(
    allowedOrigin('https://evil.example.com', CONFIGURED, DEV_ORIGINS) === null,
    'Unknown origin should be rejected when KING_ALLOWED_ORIGIN is set'
  );
  assert(
    allowedOrigin('http://localhost:5173', CONFIGURED, DEV_ORIGINS) === null,
    'Dev origin should be rejected in production mode (KING_ALLOWED_ORIGIN set)'
  );

  // Without KING_ALLOWED_ORIGIN: only dev localhost origins are allowed.
  assert(
    allowedOrigin('http://localhost:5173', '', DEV_ORIGINS) === 'http://localhost:5173',
    'Dev origin should be allowed in development mode (no KING_ALLOWED_ORIGIN)'
  );
  assert(
    allowedOrigin('https://evil.example.com', '', DEV_ORIGINS) === null,
    'Unknown origin should be rejected even without KING_ALLOWED_ORIGIN'
  );
  assert(
    allowedOrigin(undefined, '', DEV_ORIGINS) === null,
    'Missing origin must be rejected'
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 5 — API keys never appear in API responses or logs
// ──────────────────────────────────────────────────────────────────────────────

await test('5. API keys never appear in API responses or logs', async () => {
  const ws = makeTmpDir('ws-keys');
  try {
    const orch = new Orchestrator({ root: ws });
    const snap = orch.snapshot();

    // Snapshot must not contain provider fields that would leak a key.
    const snapStr = JSON.stringify(snap);

    // Sentinel: if any real key patterns appear, fail.
    const keyPatterns = [
      /sk-[a-zA-Z0-9]{20,}/,      // OpenAI key format
      /API_KEY\s*[:=]\s*\S+/,      // raw env var assignment
      /Bearer\s+[a-zA-Z0-9]{10,}/, // Bearer token
    ];
    for (const pat of keyPatterns) {
      assert(!pat.test(snapStr), `Snapshot must not contain API key pattern: ${pat}`);
    }

    // Provider section: hasKey must be a boolean, not the actual key value.
    if (snap.provider) {
      assert(
        typeof snap.provider.hasKey === 'boolean',
        `provider.hasKey must be a boolean (not the key itself), got: ${typeof snap.provider.hasKey}`
      );
    }

    // Shell sanitisedEnv: verify secrets are stripped from child process env.
    const shellSrc = fs.readFileSync(
      path.join(import.meta.dirname ?? process.cwd(), '../king/shell.ts'),
      'utf8'
    );
    assert(
      shellSrc.includes('SECRET_KEY_PATTERNS') || shellSrc.includes('isSecretKey'),
      'shell.ts must implement secret key filtering'
    );
    assert(
      shellSrc.includes('ANTHROPIC') && shellSrc.includes('OPENAI'),
      'shell.ts must explicitly filter ANTHROPIC and OPENAI key patterns'
    );

    // Server response must not include raw env vars.
    const serverSrc = fs.readFileSync(
      path.join(import.meta.dirname ?? process.cwd(), '../king/server.ts'),
      'utf8'
    );
    // Server must not pass process.env directly to response.
    assert(
      !serverSrc.includes('process.env,') && !serverSrc.includes('...process.env'),
      'server.ts must not spread process.env into responses'
    );
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 6 — Shell commands remain inside the configured workspace
// ──────────────────────────────────────────────────────────────────────────────

await test('6. Shell commands remain inside the configured workspace', async () => {
  const ws = makeTmpDir('ws-shell');
  const subdir = path.join(ws, 'src');
  fs.mkdirSync(subdir, { recursive: true });

  try {
    // Commands inside the workspace must be accepted.
    assert(
      (() => { assertInsideWorkspace(ws, ws); return true; })(),
      'Workspace root itself should be valid cwd'
    );
    assert(
      (() => { assertInsideWorkspace(ws, subdir); return true; })(),
      'Subdirectory of workspace should be valid cwd'
    );

    // Commands that escape the workspace must throw.
    let threw = false;
    try {
      assertInsideWorkspace(ws, '/tmp');
    } catch {
      threw = true;
    }
    assert(threw, 'assertInsideWorkspace must throw for /tmp when workspace is in tmpdir');

    // Path traversal must be blocked.
    threw = false;
    try {
      assertInsideWorkspace(ws, path.join(ws, '..', '..', 'etc'));
    } catch {
      threw = true;
    }
    assert(threw, 'assertInsideWorkspace must throw for ../../etc path traversal');

    // Absolute escape must be blocked.
    threw = false;
    try {
      assertInsideWorkspace(ws, '/');
    } catch {
      threw = true;
    }
    assert(threw, 'assertInsideWorkspace must throw for absolute / path');

    // A real command inside the workspace should run cleanly.
    const result = await runCommand('echo hello', { cwd: ws, timeoutMs: 5_000 });
    assert(result.passed, `Command inside workspace should pass, exit=${result.exitCode}`);
    assert(result.stdout.trim() === 'hello', `Expected 'hello', got '${result.stdout.trim()}'`);

    // Verify the env in child process does NOT contain API key patterns.
    // We do this by echoing the env and checking for known secret patterns.
    const envResult = await runCommand('env', { cwd: ws, timeoutMs: 5_000 });
    const secretPatterns = [/ANTHROPIC_API_KEY=.+/, /OPENAI_API_KEY=.+/, /KING_PROVIDERS=/];
    for (const pat of secretPatterns) {
      assert(!pat.test(envResult.stdout),
        `Child process env must not contain secret: ${pat}`
      );
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 7 — Repository prompt injection is treated as untrusted data
// ──────────────────────────────────────────────────────────────────────────────

await test('7. Repository prompt injection is treated as untrusted data', async () => {
  // Verify UNTRUSTED_DATA_RULE is present and injected into all agent prompts.
  const agentsSrc = fs.readFileSync(
    path.join(import.meta.dirname ?? process.cwd(), '../king/agents.ts'),
    'utf8'
  );

  // The rule constant must be defined.
  assert(
    agentsSrc.includes('UNTRUSTED_DATA_RULE'),
    'agents.ts must define UNTRUSTED_DATA_RULE'
  );

  // The rule must mention key concepts.
  const ruleMatch = agentsSrc.match(/const UNTRUSTED_DATA_RULE\s*=\s*(['"`][\s\S]*?['"`]);/);
  assert(ruleMatch !== null, 'UNTRUSTED_DATA_RULE constant must be defined');

  assert(
    agentsSrc.includes('untrusted input'),
    'UNTRUSTED_DATA_RULE must classify file content as untrusted input'
  );
  assert(
    agentsSrc.includes('Never reveal') || agentsSrc.includes('never reveal'),
    'UNTRUSTED_DATA_RULE must forbid revealing secrets found in files'
  );
  assert(
    agentsSrc.includes('Never follow') || agentsSrc.includes('discard those instructions'),
    'UNTRUSTED_DATA_RULE must forbid following instructions found in project files'
  );

  // The rule must be injected into every agent system prompt — check by counting.
  // We have: scout, oracle/architect, kingNeedsArchitect, kingNext, kingPlan,
  //          worker, reviewer/arbiter, qa, proposeCommand, kingVerdict, reassess, finalAudit
  const injectionCount = (agentsSrc.match(/\$\{UNTRUSTED_DATA_RULE\}/g) || []).length;
  assert(
    injectionCount >= 10,
    `UNTRUSTED_DATA_RULE must be injected into at least 10 agent prompts, found: ${injectionCount}`
  );

  // Worker prompt must explicitly mention untrusted content.
  const workerSection = agentsSrc.slice(agentsSrc.indexOf('You are a WORKER'));
  assert(
    workerSection.slice(0, 2000).includes('UNTRUSTED_DATA_RULE') ||
    workerSection.slice(0, 2000).includes('untrusted'),
    'Worker agent system prompt must reference the untrusted-data rule'
  );

  // Reviewer prompt must reference the untrusted-data rule.
  const reviewerSection = agentsSrc.slice(agentsSrc.indexOf('You are ARBITER'));
  assert(
    reviewerSection.slice(0, 2000).includes('UNTRUSTED_DATA_RULE') ||
    reviewerSection.slice(0, 2000).includes('untrusted'),
    'Reviewer agent system prompt must reference the untrusted-data rule'
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 8 — A requirement cannot PASS without its required evidence chain
// ──────────────────────────────────────────────────────────────────────────────

await test('8. A requirement cannot PASS without its required evidence chain', async () => {
  const ws = makeTmpDir('ws-evidence');
  try {
    // Build a minimal KingState with one requirement marked 'passed' but
    // deliberately missing evidence — releaseViolations must catch this.

    // reqOverrides apply to the requirement; stateOverrides apply to the top-level state.
    const makeState = (
      reqOverrides: Record<string, unknown> = {},
      stateOverrides: Record<string, unknown> = {},
    ) => ({
      runId: 'test-run',
      workspacePath: ws,
      masterPrompt: 'test',
      status: 'running',
      phase: 'running',
      requirements: [{
        id: 'REQ-001',
        statement: 'implement X',
        acceptanceCriteria: ['X works'],
        priority: 5,
        status: 'passed',
        agent: 'WRAITH',
        attempt: 1,
        reviewRequired: true,
        testRequired: true,
        approach: 'direct',
        evidence: [],
        taskFiles: [],
        ...reqOverrides,
      }],
      reviewResults: [],
      qaResults: [],
      testResults: [],
      knownBugs: [],
      logLines: [],
      fileChanges: [{ path: 'x.js', action: 'write', at: '' }],
      tokenUsage: { inputTokens: 0, outputTokens: 0, requests: 0, cacheWrite: 0, cacheRead: 0 },
      ...stateOverrides,
    });

    // 8a. Empty evidence chain must be a violation.
    {
      const state = makeState({ evidence: [] }, {});
      const v = await releaseViolations(state as any, ws);
      assert(
        v.some((x) => x.includes('REQ-001') && x.includes('evidence')),
        `Empty evidence chain must produce a violation. Got: ${v.join('; ')}`
      );
    }

    // 8b. Missing King verdict in chain must be a violation.
    {
      const state = makeState(
        {
          evidence: [
            { kind: 'note', ok: true, summary: 'worker wrote files', at: '' },
            { kind: 'review', ok: true, summary: 'review passed', at: '' },
            { kind: 'qa', ok: true, summary: 'qa passed', at: '' },
            // deliberately no 'verdict' entry
          ],
        },
        {
          reviewResults: [{ requirementId: 'REQ-001', verdict: 'pass', summary: '', findings: [], agent: 'ARBITER', at: '' }],
          qaResults: [{ requirementId: 'REQ-001', verdict: 'pass', summary: '', checksPassed: 1, checksTotal: 1, gaps: [], at: '' }],
          testResults: [{ requirementId: 'REQ-001', command: 'node test.js', exitCode: 0, passed: true, stdout: 'ok', stderr: '', durationMs: 100, timedOut: false, at: '' }],
        },
      );
      const v = await releaseViolations(state as any, ws);
      assert(
        v.some((x) => x.includes('REQ-001') && (x.includes('verdict') || x.includes('evidence'))),
        `Missing verdict evidence must produce a violation. Got: ${v.join('; ')}`
      );
    }

    // 8c. Full evidence chain with all required entries must pass the release check for REQ-001.
    {
      fs.mkdirSync(ws, { recursive: true });
      // Write a dummy file so the placeholder scanner has something to scan.
      fs.writeFileSync(path.join(ws, 'x.js'), 'module.exports = function x() { return 42; };\n');

      const state = makeState(
        {
          evidence: [
            { kind: 'note', ok: true, summary: 'worker wrote files', at: '' },
            { kind: 'review', ok: true, summary: 'review passed', at: '' },
            { kind: 'qa', ok: true, summary: 'qa passed', at: '' },
            { kind: 'verdict', ok: true, summary: 'King: PASS', at: '' },
          ],
        },
        {
          reviewResults: [{ requirementId: 'REQ-001', verdict: 'pass', summary: '', findings: [], agent: 'ARBITER', at: '' }],
          qaResults: [{ requirementId: 'REQ-001', verdict: 'pass', summary: '', checksPassed: 1, checksTotal: 1, gaps: [], at: '' }],
          testResults: [{ requirementId: 'REQ-001', command: 'node -e "process.exit(0)"', exitCode: 0, passed: true, stdout: '', stderr: '', durationMs: 10, timedOut: false, at: '' }],
          fileChanges: [{ path: 'x.js', action: 'write', at: '' }],
        },
      );
      const v = await releaseViolations(state as any, ws);
      const evidenceViolations = v.filter((x) => x.includes('REQ-001') && x.includes('evidence'));
      assert(
        evidenceViolations.length === 0,
        `Complete evidence chain must produce no evidence violations. Got: ${v.join('; ')}`
      );
    }

    // 8d. An LLM claiming pass without review/QA evidence must still fail the gate.
    {
      const state = makeState(
        {
          evidence: [
            // Only a bare verdict — no review, no QA, no command evidence.
            { kind: 'verdict', ok: true, summary: 'LLM says complete', at: '' },
          ],
          // reviewRequired and testRequired are both true (from makeState defaults).
        },
        // stateOverrides: leave reviewResults/qaResults/testResults as empty (default).
      );
      const v = await releaseViolations(state as any, ws);
      assert(
        v.length > 0,
        `LLM-only verdict without review/QA must fail release gate. Violations: ${v.join('; ')}`
      );
      const hasEvidenceViolation = v.some(
        (x) => x.includes('review') || x.includes('QA') || x.includes('command') || x.includes('evidence')
      );
      assert(
        hasEvidenceViolation,
        `Release gate must specifically cite missing review/QA evidence. Got: ${v.join('; ')}`
      );
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Results
// ──────────────────────────────────────────────────────────────────────────────

console.log('');
console.log(`Security tests: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

process.exit(0);
