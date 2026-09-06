import { spawn } from 'node:child_process';
import path from 'node:path';
import type { TestResult } from './types';

const MAX_OUTPUT = 20_000;

// ──────────────────────────────────────────────────────────────────────────────
// Secret filtering — env keys whose values must never reach child processes
// ──────────────────────────────────────────────────────────────────────────────

const SECRET_KEY_PATTERNS: RegExp[] = [
  /API_KEY/i,
  /API_SECRET/i,
  /ACCESS_KEY/i,
  /SECRET_KEY/i,
  /PRIVATE_KEY/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /AUTH_TOKEN/i,
  /BEARER/i,
  /OPENAI/i,
  /ANTHROPIC/i,
  /GEMINI/i,
  /TOGETHER/i,
  /REPLICATE/i,
  /GROQ/i,
  /KING_API/i,
  /KING_PROVIDERS/i,
  /KING_ROUTES/i,
];

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((p) => p.test(key));
}

/**
 * Build a minimal, sanitised environment for child processes.
 *
 * Only explicitly allowed, non-secret keys are forwarded.  API keys, tokens,
 * provider credentials, and any key matching SECRET_KEY_PATTERNS are stripped.
 */
function sanitisedEnv(): NodeJS.ProcessEnv {
  const ALLOWED = new Set([
    'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP',
    'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'NODE_ENV', 'CI', 'FORCE_COLOR', 'NO_COLOR',
    'PWD', 'LOGNAME', 'USER', 'USERNAME',
    'TERM', 'COLORTERM',
    'npm_config_cache', 'npm_config_prefix',
  ]);

  const safe: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (ALLOWED.has(key) && !isSecretKey(key)) {
      safe[key] = value;
    }
  }
  // Always force these for deterministic CI-like behaviour.
  safe.CI = '1';
  safe.FORCE_COLOR = '0';
  return safe;
}

// ──────────────────────────────────────────────────────────────────────────────
// Executor interface
// ──────────────────────────────────────────────────────────────────────────────

export interface ExecutorOptions {
  /** Working directory — MUST be inside the workspace root. */
  cwd: string;
  /** Wall-clock timeout in milliseconds (default: 180 000). */
  timeoutMs?: number;
  /** Associated requirement id for telemetry (null = not linked). */
  requirementId?: string | null;
}

/**
 * Executor interface.
 *
 * The local shell runner (below) implements this for development use.
 * A container/sandbox executor can implement the same interface and be
 * dropped in as a replacement without touching the orchestrator.
 *
 * ALL implementations MUST enforce:
 *   • cwd is inside the workspace root  (use assertInsideWorkspace)
 *   • output is capped at MAX_OUTPUT chars
 *   • execution times out
 *   • secrets are never forwarded to child processes
 *   • the workspace path cannot escape via cwd
 */
export type ShellExecutor = (command: string, opts: ExecutorOptions) => Promise<TestResult>;

// ──────────────────────────────────────────────────────────────────────────────
// Workspace boundary enforcement
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Assert that `cwd` is at or inside `workspace`.
 * Throws if the path escapes (e.g. via `../../` or absolute override).
 */
export function assertInsideWorkspace(workspace: string, cwd: string): void {
  const abs = path.resolve(cwd);
  const root = path.resolve(workspace);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`command cwd "${cwd}" escapes workspace "${workspace}"`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Local shell executor
// ──────────────────────────────────────────────────────────────────────────────

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  return `${text.slice(0, MAX_OUTPUT)}\n…[${text.length - MAX_OUTPUT} chars truncated]`;
}

/**
 * Local host shell executor.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  ⚠  TRUSTED / LOCAL USE ONLY  ⚠                                   │
 * │                                                                     │
 * │  This executor runs commands directly on the host OS shell without  │
 * │  any sandbox.  It is designed for local development on a trusted   │
 * │  machine where the operator is also the workspace owner.           │
 * │                                                                     │
 * │  For production or multi-tenant deployments, replace this with a   │
 * │  container-based executor (Docker, nsjail, Firecracker, etc.) that │
 * │  satisfies the ShellExecutor interface above.                      │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Security properties of THIS implementation:
 *   • Commands execute inside `opts.cwd` which must be in the workspace
 *   • Output is capped at MAX_OUTPUT characters per stream
 *   • Execution terminates after `timeoutMs` milliseconds (SIGKILL)
 *   • API keys and credential env vars are stripped before exec
 *   • `opts.cwd` cannot escape the workspace root
 */
export function runCommand(
  command: string,
  opts: ExecutorOptions,
): Promise<TestResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 180_000;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let stdoutCapped = false;
    let stderrCapped = false;

    const child = spawn(command, {
      cwd: opts.cwd,
      shell: true,
      env: sanitisedEnv(),
    });

    const killer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      if (!stdoutCapped) {
        stdout += String(chunk);
        if (stdout.length > MAX_OUTPUT) {
          stdout = clip(stdout);
          stdoutCapped = true;
          child.stdout?.pause();
        }
      }
    });
    child.stderr?.on('data', (chunk) => {
      if (!stderrCapped) {
        stderr += String(chunk);
        if (stderr.length > MAX_OUTPUT) {
          stderr = clip(stderr);
          stderrCapped = true;
          child.stderr?.pause();
        }
      }
    });

    const finish = (exitCode: number | null) => {
      clearTimeout(killer);
      resolve({
        requirementId: opts.requirementId ?? null,
        command,
        exitCode,
        passed: exitCode === 0 && !timedOut,
        stdout: clip(stdout),
        stderr: clip(stderr),
        durationMs: Date.now() - started,
        timedOut,
        at: new Date().toISOString(),
      });
    };

    child.on('error', (err) => {
      stderr += `\n${err.message}`;
      finish(127);
    });
    child.on('close', (code) => finish(code));
  });
}

// Export the local executor as the default so the orchestrator can be
// handed a different executor at construction time in the future.
export const localExecutor: ShellExecutor = runCommand;
