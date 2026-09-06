import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FileChange, TreeEntry } from './types';

const IGNORED = new Set(['node_modules', '.git', 'dist', '.king', '.DS_Store']);
const MAX_FILE_BYTES = 200_000;
const MAX_OPS = 30;
const MAX_TREE = 600;

export interface FileOp {
  path: string;
  action: 'create' | 'write' | 'delete';
  content?: string;
}

export async function ensureWorkspace(root: string) {
  await fsp.mkdir(root, { recursive: true });
  try {
    await fsp.access(path.join(root, 'README.md'));
  } catch {
    await fsp.writeFile(
      path.join(root, 'README.md'),
      '# King workspace\n\nThis directory is owned by the Supervisor King worker agents.\nFiles here are created, modified and deleted by real model-driven file operations.\n',
      'utf8',
    );
  }
}

export async function buildTree(root: string, dir = '', depth = 0): Promise<TreeEntry[]> {
  if (depth > 6) return [];
  const entries = await fsp.readdir(path.join(root, dir), { withFileTypes: true });
  const out: TreeEntry[] = [];
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    if (out.length >= MAX_TREE) return out;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push({ path: rel, type: 'dir' });
      out.push(...(await buildTree(root, rel, depth + 1)));
    } else if (entry.isFile()) {
      const stat = await fsp.stat(path.join(root, rel));
      out.push({ path: rel, type: 'file', size: stat.size });
    }
  }
  return out;
}

export function safeResolve(root: string, relPath: string): string {
  const clean = String(relPath || '').trim().replace(/^\.\//, '');
  if (!clean || path.isAbsolute(clean) || clean.includes('\0')) throw new Error(`unsafe path: ${relPath}`);
  const resolved = path.resolve(root, clean);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path escapes workspace: ${relPath}`);
  if (rel.split(path.sep)[0] === '.king') throw new Error(`.king is reserved by the orchestrator: ${relPath}`);
  return resolved;
}

export async function readFileSafe(root: string, relPath: string): Promise<string | null> {
  try {
    const abs = safeResolve(root, relPath);
    const stat = await fsp.stat(abs);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return await fsp.readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

export async function applyOps(root: string, ops: FileOp[]): Promise<FileChange[]> {
  if (!Array.isArray(ops)) throw new Error('worker returned no operations array');
  if (ops.length > MAX_OPS) throw new Error(`worker attempted ${ops.length} file operations (max ${MAX_OPS})`);

  const changes: FileChange[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    const rel = String(op?.path || '').trim().replace(/^\.\//, '');
    if (!rel) continue;
    if (seen.has(rel)) throw new Error(`duplicate file operation for ${rel}`);
    seen.add(rel);
    const abs = safeResolve(root, rel);

    if (op.action === 'delete') {
      await fsp.rm(abs, { force: true });
      changes.push({ path: rel, action: 'delete', bytes: 0, at: new Date().toISOString() });
      continue;
    }
    const content = typeof op.content === 'string' ? op.content : '';
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      throw new Error(`${rel} exceeds the ${MAX_FILE_BYTES} byte limit`);
    }
    const existed = await fsp
      .access(abs)
      .then(() => true)
      .catch(() => false);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
    changes.push({
      path: rel,
      action: existed ? 'write' : 'create',
      bytes: Buffer.byteLength(content, 'utf8'),
      at: new Date().toISOString(),
    });
  }
  if (changes.length === 0) throw new Error('worker produced zero effective file operations');
  return changes;
}

export async function readFiles(
  root: string,
  relPaths: string[],
  limit = 8,
  charsPerFile = 6000,
): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = [];
  for (const rel of relPaths.slice(0, limit)) {
    const content = await readFileSafe(root, rel);
    if (content !== null) {
      out.push({
        path: rel,
        content: content.length > charsPerFile ? `${content.slice(0, charsPerFile)}\n…[truncated]` : content,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- context

export interface ContextFile {
  path: string;
  content: string;
  truncated: boolean;
  bytes: number;
}

export interface ContextBudget {
  /** Hard cap on how many files a single agent call may receive. */
  maxFiles: number;
  /** Hard cap on total characters across all files in one call. */
  maxTotalChars: number;
  /** Per-file cap. Target files get a higher cap so overwrites stay complete. */
  maxCharsPerFile: number;
  /** Per-file cap for non-target (dependency / config / test) files. */
  maxCharsPerDependency: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxFiles: 14,
  maxTotalChars: 60_000,
  maxCharsPerFile: 40_000,
  maxCharsPerDependency: 8_000,
};

/** Synchronous tree walk, used when reconciling a checkpoint against the real workspace. */
export function buildTreeSync(root: string, dir = '', depth = 0, out: TreeEntry[] = []): TreeEntry[] {
  if (depth > 6) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    if (out.length >= MAX_TREE) return out;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push({ path: rel, type: 'dir' });
      buildTreeSync(root, rel, depth + 1, out);
    } else if (entry.isFile()) {
      try {
        out.push({ path: rel, type: 'file', size: fs.statSync(path.join(root, rel)).size });
      } catch {
        /* file vanished mid-walk — skip */
      }
    }
  }
  return out;
}

const IMPORT_RE = /(?:require\(\s*|from\s+|import\(\s*|import\s+)['"]([^'"]+)['"]/g;
const EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json'];
const RELATED_RE = /(^|\/)(types?|interfaces?|config|constants?|utils?|helpers?)(\.[a-z]+)?$|\.d\.ts$|(^|\/)(package|tsconfig|jsconfig|vitest|jest)\.json$/i;
const TEST_RE = /\.(test|spec)\.[a-z]+$|(^|\/)(test|tests|__tests__)\//i;

/** Pull local module specifiers out of a source file. */
export function extractDependencies(importerPath: string, content: string): string[] {
  const dir = path.posix.dirname(importerPath === '.' ? '' : importerPath);
  const tree = new Set<string>();
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const spec = m[1];
    if (!spec) continue;
    if (!spec.startsWith('.')) {
      tree.add(`bare:${spec}`);
      continue;
    }
    const base = path.posix.normalize(dir === '.' ? spec : `${dir}/${spec}`);
    const candidates = EXTENSIONS.map((ext) => `${base}${ext}`);
    candidates.push(`${base}/index.js`, `${base}/index.ts`);
    for (const c of candidates) found.add(c.replace(/^\.\//, ''));
  }
  return [...found];
}

/**
 * Build a dependency-aware context bundle for one agent call.
 * Priority: target files → their imports → related types/config → relevant tests.
 * Everything is budgeted; target files use the higher per-file cap so a worker
 * that overwrites one is working from the complete file whenever it fits.
 */
export async function buildTaskContext(
  root: string,
  opts: {
    targets: string[];
    tree: TreeEntry[];
    budget?: Partial<ContextBudget>;
    includeTests?: boolean;
    extra?: string[];
  },
): Promise<{ files: ContextFile[]; deps: string[]; notes: string[] }> {
  const budget: ContextBudget = { ...DEFAULT_CONTEXT_BUDGET, ...opts.budget };
  const notes: string[] = [];
  const known = new Set(opts.tree.filter((t) => t.type === 'file').map((t) => t.path));

  const targets = Array.from(new Set(opts.targets.map((p) => p.trim().replace(/^\.\//, '')).filter(Boolean)));
  const extras = Array.from(new Set((opts.extra ?? []).map((p) => p.trim().replace(/^\.\//, '')).filter(Boolean)));

  const readOne = async (rel: string, cap: number): Promise<ContextFile | null> => {
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    let bytes: number;
    let raw: string | null;
    try {
      const abs = safeResolve(root, rel);
      bytes = fs.statSync(abs).size;
      if (bytes > MAX_FILE_BYTES) {
        notes.push(`${rel}: skipped (${bytes} bytes exceeds ${MAX_FILE_BYTES})`);
        return null;
      }
      raw = fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
    const truncated = raw.length > cap;
    if (truncated) notes.push(`${rel}: truncated to ${cap} of ${raw.length} chars — do not blind-overwrite`);
    return { path: rel, content: truncated ? `${raw.slice(0, cap)}\n…[TRUNCATED at ${cap} of ${raw.length} chars]` : raw, truncated, bytes };
  };

  const files: ContextFile[] = [];
  const seen = new Set<string>();
  let spent = 0;
  const deps: string[] = [];

  const push = async (rel: string, cap: number) => {
    if (seen.has(rel) || files.length >= budget.maxFiles || spent >= budget.maxTotalChars) return;
    seen.add(rel);
    const file = await readOne(rel, cap);
    if (!file) return;
    if (spent + file.content.length > budget.maxTotalChars) {
      notes.push(`${rel}: skipped — context budget exhausted (${budget.maxTotalChars} chars)`);
      return;
    }
    spent += file.content.length;
    files.push(file);
  };

  // 1. target files (full content where it fits)
  for (const rel of targets) await push(rel, budget.maxCharsPerFile);
  // 1b. explicit extras (e.g. files the plan named)
  for (const rel of extras) await push(rel, budget.maxCharsPerFile);

  // 2. direct imports of whatever we already loaded
  const depCandidates: string[] = [];
  for (const file of [...files]) {
    for (const dep of extractDependencies(file.path, file.content)) {
      if (!seen.has(dep) && (known.has(dep) || fs.existsSync(path.join(root, dep)))) depCandidates.push(dep);
    }
  }
  for (const rel of Array.from(new Set(depCandidates))) {
    deps.push(rel);
    await push(rel, budget.maxCharsPerDependency);
  }

  // 3. related types / interfaces / config
  if (files.length < budget.maxFiles) {
    for (const entry of opts.tree) {
      if (entry.type !== 'file' || seen.has(entry.path)) continue;
      if (!RELATED_RE.test(entry.path)) continue;
      await push(entry.path, budget.maxCharsPerDependency);
      if (files.length >= budget.maxFiles) break;
    }
  }

  // 4. tests that touch the targets
  if (opts.includeTests && files.length < budget.maxFiles) {
    const stems = targets.map((t) => path.posix.basename(t).replace(/\.[a-z]+$/i, ''));
    for (const entry of opts.tree) {
      if (entry.type !== 'file' || seen.has(entry.path) || !TEST_RE.test(entry.path)) continue;
      const related = stems.some((s) => s.length > 2 && entry.path.includes(s));
      if (!related) continue;
      await push(entry.path, budget.maxCharsPerDependency);
      if (files.length >= budget.maxFiles) break;
    }
  }

  return { files, deps, notes };
}

const PLACEHOLDER_RE = /\b(TODO|FIXME|XXX|HACK)\b|not implemented|placeholder|<your |lorem ipsum|\bcoming soon\b/i;

/** Scan worker-written files for placeholder / stub markers. Returns "path: match" pairs. */
export async function scanForPlaceholders(root: string, relPaths: string[]): Promise<string[]> {
  const hits: string[] = [];
  for (const rel of relPaths) {
    const content = await readFileSafe(root, rel);
    if (content === null) continue;
    const match = content.match(PLACEHOLDER_RE);
    if (match) hits.push(`${rel}: "${match[0]}"`);
  }
  return hits;
}
