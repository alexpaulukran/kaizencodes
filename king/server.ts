import http from 'node:http';
import { Orchestrator } from './orchestrator';

const PORT = Number(process.env.KING_PORT || 8787);

// ──────────────────────────────────────────────────────────────────────────────
// CORS policy
//
// KING_ALLOWED_ORIGIN — set this to the exact frontend origin in production.
//   Example: KING_ALLOWED_ORIGIN=https://your-app.vercel.app
//
// If KING_ALLOWED_ORIGIN is NOT set, only known localhost origins are allowed
// (convenient for local development).
//
// Access-Control-Allow-Origin: * is NEVER used — not even in development.
// That header disables the browser's credential protection entirely.
// ──────────────────────────────────────────────────────────────────────────────

const CONFIGURED_ORIGIN = (process.env.KING_ALLOWED_ORIGIN || '').trim();

/** Origins always permitted in development (when no KING_ALLOWED_ORIGIN is set). */
const DEV_ORIGINS = new Set([
  'http://localhost:5173',   // Vite dev server default
  'http://localhost:4173',   // Vite preview
  'http://localhost:3000',   // CRA / Next dev
  `http://localhost:${PORT}`, // Same port as the API
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:3000',
  `http://127.0.0.1:${PORT}`,
]);

function allowedOrigin(requestOrigin: string | undefined): string | null {
  if (!requestOrigin) return null;
  if (CONFIGURED_ORIGIN) {
    // Production: only the explicitly configured origin.
    return requestOrigin === CONFIGURED_ORIGIN ? requestOrigin : null;
  }
  // Development: allow known localhost origins.
  return DEV_ORIGINS.has(requestOrigin) ? requestOrigin : null;
}

function corsHeaders(requestOrigin: string | undefined): Record<string, string> {
  const origin = allowedOrigin(requestOrigin);
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Vary': 'Origin',
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// HTTP plumbing
// ──────────────────────────────────────────────────────────────────────────────

const orch = new Orchestrator();

function send(res: http.ServerResponse, code: number, body: unknown, extraHeaders?: Record<string, string>) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += String(chunk);
      if (data.length > 2_000_000) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    // Preflight: respond with CORS headers only if origin is allowed.
    if (Object.keys(cors).length > 0) {
      res.writeHead(204, cors);
    } else {
      res.writeHead(403);
    }
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/api/health') {
      const snap = orch.snapshot();
      // Never include API keys in the response.
      return send(res, 200, {
        ok: true,
        provider: snap.provider,
        routing: snap.routing,
        workspace: snap.workspace,
        status: snap.status,
        phase: snap.phase,
        // Include the backend URL so the UI can display it clearly.
        backendUrl: `http://localhost:${PORT}`,
      }, cors);
    }
    if (url.pathname === '/api/state') {
      return send(res, 200, orch.snapshot(), cors);
    }
    if (url.pathname === '/api/run' && req.method === 'POST') {
      const body = await readBody(req);
      await orch.start(body);
      return send(res, 200, { ok: true, status: 'running' }, cors);
    }
    if (url.pathname === '/api/pause' && req.method === 'POST') {
      orch.pause();
      return send(res, 200, { ok: true }, cors);
    }
    if (url.pathname === '/api/resume' && req.method === 'POST') {
      await orch.resume();
      return send(res, 200, { ok: true, status: 'running' }, cors);
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') {
      await orch.reset();
      return send(res, 200, { ok: true, status: 'idle' }, cors);
    }
    send(res, 404, { ok: false, error: `no route: ${req.method} ${url.pathname}` }, cors);
  } catch (err) {
    send(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) }, cors);
  }
});

server.listen(PORT, () => {
  const snap = orch.snapshot();
  console.log(`[king] mission control service on http://localhost:${PORT}`);
  console.log(`[king] workspace: ${snap.workspace}`);
  console.log(`[king] provider: ${snap.provider.label} · model: ${snap.provider.model}${snap.provider.hasKey ? '' : ' · NO API KEY SET'}`);
  if (CONFIGURED_ORIGIN) {
    console.log(`[king] CORS: production mode — allowed origin: ${CONFIGURED_ORIGIN}`);
  } else {
    console.log(`[king] CORS: development mode — localhost origins allowed`);
    console.log(`[king] TIP: set KING_ALLOWED_ORIGIN=<your-frontend-url> for production`);
  }
});
