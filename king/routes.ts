import fs from 'node:fs';

export type AgentRole = 'king' | 'scout' | 'architect' | 'worker' | 'reviewer' | 'qa';

export const AGENT_ROLES: readonly AgentRole[] = ['king', 'scout', 'architect', 'worker', 'reviewer', 'qa'] as const;

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ModelRoute {
  provider: string;
  model: string;
}

export interface ResolvedRoute extends ProviderConfig {
  role: AgentRole;
  provider: string;
  model: string;
}

export interface RouteConfig {
  providers: Record<string, ProviderConfig>;
  routes: Partial<Record<AgentRole, ModelRoute>>;
  warnings: string[];
}

export function isAgentRole(value: string): value is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(value);
}

function parseJsonEnv(raw: string | undefined, label: string, warnings: string[]): Record<string, any> | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch (err) {
    warnings.push(`${label} is not valid JSON (${(err as Error).message}) — ignored`);
    return null;
  }
}

function normaliseProvider(name: string, raw: any, warnings: string[]): ProviderConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.replace(/\/$/, '') : '';
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : '';
  if (!baseUrl) {
    warnings.push(`provider "${name}" has no baseUrl — ignored`);
    return null;
  }
  if (!apiKey) warnings.push(`provider "${name}" has no apiKey — calls to it will fail`);
  return { baseUrl, apiKey };
}

/**
 * Load multi-model routing. Precedence (later wins):
 *   1. built-in defaults from KING_API_BASE / KING_API_KEY / KING_MODEL
 *   2. ./king.config.json  { providers: {...}, routes: {...} }
 *   3. KING_PROVIDERS env (JSON) — provider registry override
 *   4. KING_ROUTES env (JSON)    — per-role override
 */
export function loadRouteConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): RouteConfig {
  const warnings: string[] = [];
  const providers: Record<string, ProviderConfig> = {};
  const routes: Partial<Record<AgentRole, ModelRoute>> = {};

  const defaultModel = env.KING_MODEL || 'gpt-4o-mini';
  const defaultProvider: ProviderConfig = {
    baseUrl: (env.KING_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: env.KING_API_KEY || env.OPENAI_API_KEY || '',
  };
  providers.default = defaultProvider;

  // 2. config file
  try {
    const configFile = fs.existsSync(`${cwd}/king.config.json`) ? `${cwd}/king.config.json` : null;
    if (configFile) {
      const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8')) as {
        providers?: Record<string, any>;
        routes?: Record<string, any>;
      };
      for (const [name, raw] of Object.entries(parsed.providers ?? {})) {
        const p = normaliseProvider(name, raw, warnings);
        if (p) providers[name] = p;
      }
      for (const [role, raw] of Object.entries(parsed.routes ?? {})) {
        if (!isAgentRole(role)) {
          warnings.push(`king.config.json: unknown role "${role}" — ignored`);
          continue;
        }
        if (raw && typeof raw === 'object' && typeof raw.model === 'string') {
          routes[role] = { provider: typeof raw.provider === 'string' ? raw.provider : 'default', model: raw.model };
        }
      }
    }
  } catch (err) {
    warnings.push(`king.config.json could not be read (${(err as Error).message}) — ignored`);
  }

  // 3. provider env override
  const envProviders = parseJsonEnv(env.KING_PROVIDERS, 'KING_PROVIDERS', warnings);
  if (envProviders) {
    for (const [name, raw] of Object.entries(envProviders)) {
      const p = normaliseProvider(name, raw, warnings);
      if (p) providers[name] = p;
    }
  }

  // 4. route env override
  const envRoutes = parseJsonEnv(env.KING_ROUTES, 'KING_ROUTES', warnings);
  if (envRoutes) {
    for (const [role, raw] of Object.entries(envRoutes)) {
      if (!isAgentRole(role)) {
        warnings.push(`KING_ROUTES: unknown role "${role}" — ignored`);
        continue;
      }
      if (raw && typeof raw === 'object' && typeof raw.model === 'string') {
        routes[role] = { provider: typeof raw.provider === 'string' ? raw.provider : 'default', model: raw.model };
      }
    }
  }

  // Fill gaps with the default provider so every role always resolves.
  for (const role of AGENT_ROLES) {
    if (!routes[role]) routes[role] = { provider: 'default', model: defaultModel };
    else if (!providers[routes[role]!.provider]) {
      warnings.push(`role "${role}" points at unknown provider "${routes[role]!.provider}" — falling back to default`);
      routes[role] = { provider: 'default', model: routes[role]!.model };
    }
  }

  return { providers, routes, warnings };
}

export function resolveRoute(cfg: RouteConfig, role: AgentRole): ResolvedRoute {
  const route = cfg.routes[role] ?? { provider: 'default', model: 'gpt-4o-mini' };
  const provider = cfg.providers[route.provider] ?? cfg.providers.default;
  return {
    role,
    provider: route.provider,
    model: route.model,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
  };
}

/** Human-readable routing table for logs / UI. Never contains an API key. */
export function describeRoutes(cfg: RouteConfig): { role: string; provider: string; model: string }[] {
  return AGENT_ROLES.map((role) => {
    const r = resolveRoute(cfg, role);
    let host = r.provider;
    try {
      host = new URL(r.baseUrl).hostname;
    } catch {
      /* keep provider name */
    }
    return { role, provider: r.provider === 'default' ? host : `${r.provider} (${host})`, model: r.model };
  });
}
