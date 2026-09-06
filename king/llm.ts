import { loadRouteConfig, resolveRoute, describeRoutes, type AgentRole, type RouteConfig } from './routes';

export interface LLMConfig {
  /** Default provider — also the fallback when a role-specific route fails. */
  baseUrl: string;
  apiKey: string;
  model: string;
  strongModel: string;
  temperature: number;
  /** Optional multi-model routing table. When absent every role uses the default provider. */
  routes?: RouteConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd?: string): LLMConfig {
  const routes = loadRouteConfig(env, cwd);
  const fallback = routes.providers.default;
  return {
    baseUrl: fallback.baseUrl,
    apiKey: fallback.apiKey,
    model: env.KING_MODEL || 'gpt-4o-mini',
    strongModel: env.KING_STRONG_MODEL || env.KING_MODEL || 'gpt-4o-mini',
    temperature: Number(env.KING_TEMPERATURE ?? 0.2),
    routes,
  };
}

export function providerLabel(cfg: LLMConfig, role?: AgentRole): string {
  const base = role && cfg.routes ? resolveRoute(cfg.routes, role).baseUrl : cfg.baseUrl;
  try {
    return new URL(base).hostname;
  } catch {
    return base;
  }
}

/** Routing table for logs/UI. Never includes an API key. */
export function routingTable(cfg: LLMConfig): { role: string; provider: string; model: string }[] {
  return cfg.routes ? describeRoutes(cfg.routes) : [];
}

export class ConfigError extends Error {}

export interface Usage {
  prompt: number;
  completion: number;
}

interface ChatResult {
  data: any;
  usage: Usage;
  /** Which provider/model actually served the call (may be the fallback). */
  served: { provider: string; model: string; fallback: boolean; role: AgentRole };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function extractJson(text: string): any {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through to bracket scan */
  }
  const startObj = candidate.indexOf('{');
  const startArr = candidate.indexOf('[');
  const start = startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr);
  if (start === -1) throw new Error(`model returned no JSON: ${trimmed.slice(0, 180)}`);
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  if (end <= start) throw new Error(`model returned unbalanced JSON: ${trimmed.slice(0, 180)}`);
  return JSON.parse(candidate.slice(start, end + 1));
}

interface Endpoint {
  baseUrl: string;
  apiKey: string;
}

async function post(
  endpoint: Endpoint,
  model: string,
  messages: unknown[],
  jsonMode: boolean,
  maxTokens: number,
  temperature: number,
) {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.apiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok && jsonMode && (res.status === 400 || res.status === 422)) {
    // Provider does not support response_format — retry without it (the prompt still demands JSON).
    return post(endpoint, model, messages, false, maxTokens, temperature);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ConfigError(`model provider rejected the API key (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    const err = new Error(`model provider HTTP ${res.status}: ${detail}`) as Error & { retryable?: boolean };
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  const payload = (await res.json()) as any;
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('model provider returned an empty completion');
  return {
    text,
    usage: {
      prompt: Number(payload?.usage?.prompt_tokens ?? 0),
      completion: Number(payload?.usage?.completion_tokens ?? 0),
    },
  };
}

/** Call one endpoint with retries. Returns null on retryable failure so the caller can fall back. */
async function callWithRetry(
  endpoint: Endpoint,
  model: string,
  messages: unknown[],
  maxTokens: number,
  temperature: number,
): Promise<{ text: string; usage: Usage } | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await post(endpoint, model, messages, true, maxTokens, temperature);
    } catch (err) {
      lastError = err;
      if (err instanceof ConfigError) throw err;
      const retryable = (err as { retryable?: boolean }).retryable !== false;
      if (!retryable) throw err;
      await sleep(700 * (attempt + 1));
    }
  }
  // Retryable exhaustion: signal fallback rather than killing the run.
  void lastError;
  return null;
}

/**
 * Perform a JSON chat call for one agent role.
 * Routing: role → provider/model from the routing table, else the default provider.
 * On repeated transient failure of a role route, falls back to the default provider once.
 */
export async function chatJSON(
  cfg: LLMConfig,
  opts: { role?: AgentRole; model?: string; system: string; user: string; maxTokens?: number },
): Promise<ChatResult> {
  if (!cfg.apiKey) throw new ConfigError('KING_API_KEY is not set — the King cannot reason without a model');

  const role: AgentRole = opts.role ?? 'king';
  const messages = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ];
  const maxTokens = opts.maxTokens ?? 4096;

  const resolved = cfg.routes ? resolveRoute(cfg.routes, role) : null;
  const endpoint: Endpoint = resolved ? { baseUrl: resolved.baseUrl, apiKey: resolved.apiKey } : { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey };
  const model = opts.model || resolved?.model || cfg.model;

  if (!endpoint.apiKey) {
    // Route points at a provider with no key — degrade to the default provider instead of dying.
    if (endpoint.baseUrl !== cfg.baseUrl) {
      const result = await callWithRetry({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey }, model, messages, maxTokens, cfg.temperature);
      if (result) {
        return { data: extractJson(result.text), usage: result.usage, served: { provider: 'default', model, fallback: true, role } };
      }
    }
    throw new ConfigError(`provider for role "${role}" has no API key — configure it in king.config.json or KING_PROVIDERS`);
  }

  const result = await callWithRetry(endpoint, model, messages, maxTokens, cfg.temperature);
  if (result) {
    return { data: extractJson(result.text), usage: result.usage, served: { provider: resolved?.provider ?? 'default', model, fallback: false, role } };
  }

  // Role route is unhealthy — one shot on the default provider so the run continues.
  const isDefault = endpoint.baseUrl === cfg.baseUrl && endpoint.apiKey === cfg.apiKey;
  if (!isDefault && cfg.apiKey) {
    const fallbackModel = role === 'king' ? cfg.strongModel : cfg.model;
    const fallback = await callWithRetry({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey }, fallbackModel, messages, maxTokens, cfg.temperature);
    if (fallback) {
      return { data: extractJson(fallback.text), usage: fallback.usage, served: { provider: 'default', model: fallbackModel, fallback: true, role } };
    }
  }

  throw new Error(`model call for role "${role}" failed after retries and fallback`);
}
