export interface StageDef {
  id: number;
  key: string;
  label: string;
  short: string;
  blurb: string;
}

export const STAGES: StageDef[] = [
  { id: 0, key: 'UNDERSTAND', label: 'Understand', short: 'UND', blurb: 'Scout decomposes the master prompt into REQ-001… with acceptance criteria. Assumptions recorded, nothing invented.' },
  { id: 1, key: 'ARCHITECT', label: 'Architect', short: 'ARC', blurb: 'Oracle designs the module layout, the files to touch, and the exact build/test commands the workspace will run.' },
  { id: 2, key: 'PLAN', label: 'Plan', short: 'PLN', blurb: 'The King assigns each requirement an owning agent, a file set, acceptance criteria and whether review and QA are required.' },
  { id: 3, key: 'DELEGATE', label: 'Delegate', short: 'DEL', blurb: 'Tasks are handed to Wraith, Forge or Lumen with constraints attached. The King writes no code itself.' },
  { id: 4, key: 'IMPLEMENT', label: 'Implement', short: 'IMP', blurb: 'Workers issue real create/write/delete operations against the workspace file tree. No placeholders, no stubs.' },
  { id: 5, key: 'REVIEW', label: 'Review', short: 'REV', blurb: 'Arbiter reads the actual file contents back off disk and judges them against the acceptance criteria.' },
  { id: 6, key: 'TEST', label: 'Test', short: 'TST', blurb: 'Herald executes the build and test commands; stdout, stderr and exit codes are captured as evidence.' },
  { id: 7, key: 'FIX', label: 'Fix', short: 'FIX', blurb: 'A failed verdict opens a BUG-id and returns the requirement to its owner with the failure context attached.' },
  { id: 8, key: 'RE-TEST', label: 'Re-test', short: 'RTS', blurb: 'The repair must clear review and QA again. Unverified work never closes.' },
  { id: 9, key: 'POLISH', label: 'Polish', short: 'PLS', blurb: 'Second-attempt requirements get a reassessed approach; a third failure escalates the model and strategy.' },
  { id: 10, key: 'FINAL AUDIT', label: 'Final Audit', short: 'AUD', blurb: 'The King traces every requirement to its evidence. No outstanding requirement, no open bug — or the declaration is withheld.' },
  { id: 11, key: 'RELEASE', label: 'Release', short: 'REL', blurb: 'State is checkpointed to disk and the run is sealed. Then — and only then — PROJECT_COMPLETE may be spoken.' },
];

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  domain: string;
  monogram: string;
  hue: string;
  rate: number;
  flavor: string[];
}

export const AGENTS: AgentDef[] = [
  {
    id: 'SUPREMUS',
    name: 'Supremus',
    role: 'Supervisor King',
    domain: 'Final authority & accountability',
    monogram: 'SK',
    hue: '#e9b949',
    rate: 1,
    flavor: [],
  },
  {
    id: 'SCOUT',
    name: 'Scout',
    role: 'Requirements Intelligence',
    domain: 'Master prompt → REQ-ids',
    monogram: 'SC',
    hue: '#93a5c6',
    rate: 1.18,
    flavor: [],
  },
  {
    id: 'ORACLE',
    name: 'Oracle',
    role: 'System Architect',
    domain: 'Modules, files, build & test commands',
    monogram: 'OR',
    hue: '#a78bfa',
    rate: 0.92,
    flavor: [],
  },
  {
    id: 'FOREMAN',
    name: 'Foreman',
    role: 'Planner & Delegator',
    domain: 'Assignment, criteria, repair routing',
    monogram: 'FO',
    hue: '#f0a93b',
    rate: 1.05,
    flavor: [],
  },
  {
    id: 'WRAITH',
    name: 'Wraith',
    role: 'Worker Agent · Core',
    domain: 'Services, CLI, core logic files',
    monogram: 'WR',
    hue: '#59d8e6',
    rate: 1.12,
    flavor: [],
  },
  {
    id: 'FORGE',
    name: 'Forge',
    role: 'Worker Agent · Interface',
    domain: 'Output, formats, docs, UX code',
    monogram: 'FG',
    hue: '#eb6f92',
    rate: 1.08,
    flavor: [],
  },
  {
    id: 'LUMEN',
    name: 'Lumen',
    role: 'Worker Agent · Data',
    domain: 'Data, scripts, tests, build wiring',
    monogram: 'LU',
    hue: '#47c98a',
    rate: 1.02,
    flavor: [],
  },
  {
    id: 'ARBITER',
    name: 'Arbiter',
    role: 'Reviewer & QA Lead',
    domain: 'Independent review & evidence checks',
    monogram: 'AR',
    hue: '#7aa2f7',
    rate: 0.96,
    flavor: [],
  },
  {
    id: 'HERALD',
    name: 'Herald',
    role: 'Release & Test Runner',
    domain: 'Executes build/test, captures output',
    monogram: 'HE',
    hue: '#e9b949',
    rate: 1,
    flavor: [],
  },
];

export const AGENT_MAP: Record<string, AgentDef> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a]),
);

export interface AuditItem {
  id: string;
  label: string;
  stage: number;
}

export const AUDIT: AuditItem[] = [
  { id: 'AU1', label: 'Master prompt decomposed into REQ-ids with acceptance criteria', stage: 0 },
  { id: 'AU2', label: 'Architecture and implementation plan produced by Oracle', stage: 1 },
  { id: 'AU3', label: 'Every requirement implemented, passed, or explicitly escalated', stage: 10 },
  { id: 'AU4', label: 'Every defect recorded with a reproduction description', stage: 7 },
  { id: 'AU5', label: 'Independent review verdict captured for each implemented requirement', stage: 5 },
  { id: 'AU6', label: 'Build & test commands executed with exit codes captured', stage: 6 },
  { id: 'AU7', label: 'No open bugs — failed work escalated, never hidden', stage: 8 },
  { id: 'AU8', label: "King's final audit declares the project complete", stage: 11 },
];

export interface DoctrineEntry {
  n: string;
  title: string;
  body: string;
}

export const DOCTRINE: DoctrineEntry[] = [
  {
    n: 'I',
    title: 'Quality over speed',
    body: 'The supervisor absorbs rework so the system never ships a claim it cannot defend. A slower green beats a fast guess, every single cycle.',
  },
  {
    n: 'II',
    title: 'Never trust the worker',
    body: 'Agents report completion; the arbiter verifies it against the actual files on disk and the actual command output — not against the author’s summary.',
  },
  {
    n: 'III',
    title: 'Never declare early',
    body: 'PROJECT_COMPLETE is a release artefact, not a mood. It is emitted once — after every requirement has evidence and the final audit agrees.',
  },
  {
    n: 'IV',
    title: 'Understand before writing',
    body: 'Ambiguity is resolved by requirement decomposition, recorded as REQ-ids with acceptance criteria. Nothing is invented to make progress.',
  },
  {
    n: 'V',
    title: 'Every claim carries evidence',
    body: 'A review verdict, a captured exit code, a QA summary. Work without evidence stays open on the board and visible to everyone.',
  },
  {
    n: 'VI',
    title: 'Failure changes the strategy',
    body: 'Two failures force a reassessment of the approach. Three failures escalate the model. Five failures escalate to the operator — never silence.',
  },
];
