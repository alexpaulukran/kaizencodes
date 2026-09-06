import type { KingSnapshot } from './engine';

// ──────────────────────────────────────────────────────────────────────────────
// Backend URL configuration
//
// VITE_KING_URL controls which backend this frontend connects to.
// Set it in your .env or deployment environment:
//
//   VITE_KING_URL=http://localhost:8787          # local dev (default)
//   VITE_KING_URL=https://your-backend.example.com   # production
//
// Never set this to a URL that exposes API keys — the backend handles all
// LLM communication. The frontend never sends or receives API key values.
// ──────────────────────────────────────────────────────────────────────────────

// `import.meta.env` is Vite-injected at build time; guard it so the module
// also evaluates cleanly when bundled for Node (SSR smoke tests, tooling).
const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const RAW = metaEnv.VITE_KING_URL ?? 'http://localhost:8787';

/** The backend base URL, with any trailing slash removed. */
export const kingUrl = RAW.replace(/\/$/, '');

// ──────────────────────────────────────────────────────────────────────────────
// Connection state types
// ──────────────────────────────────────────────────────────────────────────────

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'timeout'
  | 'error';

export interface HealthResult {
  ok: boolean;
  status: ConnectionStatus;
  /** Friendly error message when not connected. */
  message?: string;
  /** The backend URL that responded (echoed from the server). */
  backendUrl?: string;
  provider?: { label: string; model: string; hasKey: boolean };
  workspace?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Core request helper
// ──────────────────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 8_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${kingUrl}${path}`, {
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      ...init,
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: text.slice(0, 200) };
    }
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Health / connection probe
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Probe the backend and return a structured connection result.
 * Never throws — all errors are encoded in the returned HealthResult.
 */
export async function fetchHealth(): Promise<HealthResult> {
  try {
    const data = await request<any>('/api/health');
    return {
      ok: true,
      status: 'connected',
      backendUrl: data.backendUrl ?? kingUrl,
      provider: data.provider,
      workspace: data.workspace,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout =
      err instanceof DOMException && err.name === 'AbortError';
    const isOffline =
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('ECONNREFUSED');
    return {
      ok: false,
      status: isTimeout ? 'timeout' : isOffline ? 'offline' : 'error',
      message: isTimeout
        ? `Backend at ${kingUrl} did not respond within ${FETCH_TIMEOUT_MS / 1000}s`
        : isOffline
          ? `Cannot reach backend at ${kingUrl} — is the King server running?`
          : msg,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// API calls
// ──────────────────────────────────────────────────────────────────────────────

export function fetchState(): Promise<KingSnapshot> {
  return request<KingSnapshot>('/api/state');
}

export function startRun(body: {
  masterPrompt: string;
  buildCommand?: string;
  testCommand?: string;
}) {
  return request<{ ok: boolean }>('/api/run', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function pauseRun() {
  return request<{ ok: boolean }>('/api/pause', { method: 'POST', body: '{}' });
}

export function resumeRun() {
  return request<{ ok: boolean }>('/api/resume', { method: 'POST', body: '{}' });
}

export function resetRun() {
  return request<{ ok: boolean }>('/api/reset', { method: 'POST', body: '{}' });
}
