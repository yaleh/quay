// workflow-replay.ts — golden replay runner for milestone-workflow lifecycle (DIR-124-A2 M2)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION, validateEvent, VALID_STAGES } from "./workflow-event-schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "workflow-replay");

interface Timing { queuedAtMs: number; startedAtMs: number; endedAtMs?: number | null; }
interface StageEvent {
  schemaVersion: string; runId: string; candidateId: string; taskId: string;
  stage: string; attempt: number; timing: Timing;
  agentLabel?: string | null; executionCwd?: string; worktreePath?: string | null;
  commandIdentity?: string | null; baseCommit?: string | null; candidateCommit?: string | null;
  outcome?: string | null; waitReason?: string | null; resourceClaim?: string | null;
  observedWrites?: string[]; isolationMode?: string | null; dispatchMode?: string | null;
}
interface StateVector {
  phaseSequence: string[]; agentCounts: Record<string, number>;
  outcome: { outcome: string | null; reason?: string | null; phase?: string | null };
  sharedStateMutations: string[]; schedulingDecisions: string[];
}
interface CheckSpec { predicate: string; args: Record<string, unknown>; }
interface Assertion {
  id: string; description: string;
  classification: "normative" | "compatibility-only" | "known-defect";
  internalCategory: "normative" | "compatibility-only" | "observed-but-undesired" | "explicitly-open-defect";
  mappingNote?: string; check: CheckSpec; expected: unknown;
}
interface ExpectationManifest { meta?: Record<string, unknown>; assertions: Assertion[]; }
interface AssertionResult {
  assertionId: string; description: string; classification: string;
  internalCategory: string; passed: boolean; expected: unknown; actual: unknown; detail: string;
}
interface ReplayResult {
  ok: boolean; caseName: string; verdict: string; exitCode: number;
  assertionResults: AssertionResult[]; stateVector: StateVector | null; errors: string[];
}

const VALID_CLASSIFICATIONS = ["normative","compatibility-only","known-defect"];
const VALID_INTERNAL_CATEGORIES = ["normative","compatibility-only","observed-but-undesired","explicitly-open-defect"];

type PredicateFn = (events: StageEvent[], args: Record<string, unknown>) => unknown;
const PREDICATES: Record<string, PredicateFn> = {
  stageOrderedBefore(events, args) {
    const a = String(args.A), b = String(args.B);
    const iA = events.findIndex(e => e.stage === a), iB = events.findIndex(e => e.stage === b);
    if (iA === -1) return `stage "${a}" not found`;
    if (iB === -1) return `stage "${b}" not found`;
    return iA < iB;
  },
  agentCountForStage(events, args) {
    const stage = String(args.stage), count = args.count as number;
    const labels = new Set(events.filter(e => e.stage === stage && e.agentLabel).map(e => e.agentLabel!));
    return labels.size === count ? true : labels.size;
  },
  fieldEquals(events, args) {
    const stage = String(args.stage), field = String(args.field), expected = args.expectedValue;
    // Look for last event of this stage with a non-null value for the field
    const evt = [...events].reverse().find(e => e.stage === stage && (e as Record<string, unknown>)[field] != null);
    if (!evt) {
      // Fall back to first event if no event has a non-null value for this field
      const first = events.find(e => e.stage === stage);
      if (!first) return `stage "${stage}" not found`;
      const v = (first as Record<string, unknown>)[field];
      return JSON.stringify(v) === JSON.stringify(expected) ? true : v;
    }
    const val = (evt as Record<string, unknown>)[field];
    return JSON.stringify(val) === JSON.stringify(expected) ? true : val;
  },
  outcomeMatches(events, args) {
    const expected = args.expectedOutcome as string;
    const terminal = [...events].reverse().find(e => e.outcome != null);
    if (!terminal) return "no terminal outcome";
    return terminal.outcome === expected ? true : terminal.outcome;
  },
  hasStage(events, args) {
    const stage = String(args.stage);
    return events.some(e => e.stage === stage) ? true : `stage "${stage}" not found`;
  },
  stageSkipped(events, args) {
    const stage = String(args.stage);
    return !events.some(e => e.stage === stage) ? true : `stage "${stage}" was present but should be skipped`;
  },
  worktreeFieldsPopulated(events, args) {
    const stage = String(args.stage);
    const evts = events.filter(e => e.stage === stage);
    if (evts.length === 0) return `stage "${stage}" not found`;
    return evts.every(e => e.worktreePath != null && e.worktreePath !== "" && e.isolationMode === "worktree") ? true : false;
  },
  phaseSequenceEquals(events, args) {
    const expected = args.sequence as string[];
    const seen = new Set<string>(); const actual: string[] = [];
    for (const e of events) { if (!seen.has(e.stage)) { seen.add(e.stage); actual.push(e.stage); } }
    return JSON.stringify(actual) === JSON.stringify(expected) ? true : actual;
  },
  dispatchModeEquals(events, args) {
    const expected = args.expectedMode as string;
    const evt = events.find(e => e.dispatchMode != null);
    if (!evt) return "no dispatchMode found";
    return evt.dispatchMode === expected ? true : evt.dispatchMode;
  },
  isolationModeEquals(events, args) {
    const expected = args.expectedMode;
    // When expected is null, check that ALL events have null isolationMode
    if (expected === null || expected === "null") {
      const hasNonNull = events.some(e => e.isolationMode != null);
      return !hasNonNull ? true : "isolationMode is non-null";
    }
    const evt = events.find(e => e.isolationMode != null);
    if (!evt) return "no isolationMode found";
    return evt.isolationMode === expected ? true : evt.isolationMode;
  },
  outcomePhaseEquals(events, args) {
    const expected = args.expectedPhase as string;
    const terminal = [...events].reverse().find(e => e.outcome != null);
    if (!terminal) return "no terminal outcome";
    return terminal.stage === expected ? true : terminal.stage;
  },
  landMergeOccurs(events, _args) {
    const landEnd = events.find(e => e.stage === "land" && e.outcome != null);
    if (!landEnd) return "no land end event";
    return landEnd.outcome === "done" && landEnd.candidateCommit != null ? true : `outcome=${landEnd.outcome}, commit=${landEnd.candidateCommit}`;
  },
  reconcilePhaseExists(events, _args) {
    return events.some(e => e.stage === "reconcile") ? true : "reconcile phase not found";
  },
  worktreeCreatedInBuild(events, _args) {
    const evt = events.find(e => e.stage === "build" && e.worktreePath != null);
    return evt != null ? true : "no build event with worktreePath";
  },
  gateFailureBlocksReconcileLand(events, _args) {
    const gf = events.find(e => e.stage === "gate" && e.outcome === "needs-human");
    if (!gf) return "no gate failure";
    const idx = events.indexOf(gf);
    const hasR = events.slice(idx+1).some(e => e.stage === "reconcile");
    const hasL = events.slice(idx+1).some(e => e.stage === "land");
    return !hasR && !hasL ? true : `reconcile=${hasR}, land=${hasL}`;
  },
  landLockHeld(events, _args) {
    const evts = events.filter(e => e.stage === "land");
    return evts.length >= 2 ? true : `only ${evts.length} land events`;
  },
  survivorMilestoneCounterAdvanced(events, _args) {
    return events.some(e => e.stage === "land" && e.outcome === "done") ? true : "no done land event";
  },
  buildPhaseHasNoAgentOutcome(events, _args) {
    const bld = events.filter(e => e.stage === "build");
    return bld.some(e => e.outcome == null) && bld.some(e => e.outcome != null) ? true : `build events=${bld.length}`;
  },
  auditAfterNullBuild(events, _args) {
    const bIdx = events.findIndex(e => e.stage === "build"), aIdx = events.findIndex(e => e.stage === "audit");
    if (bIdx === -1) return "no build"; if (aIdx === -1) return "no audit";
    return aIdx > bIdx ? true : "audit not after build";
  },
  verifyBeforePrepared(events, _args) {
    const vIdx = events.findIndex(e => e.stage === "verify"), pIdx = events.findIndex(e => e.stage === "prepared");
    if (vIdx === -1) return "no verify"; if (pIdx === -1) return "no prepared";
    return vIdx < pIdx ? true : "verify not before prepared";
  },
  verifyHasAgentDispatches(events, args) {
    const min = args.min as number;
    const n = events.filter(e => e.stage === "verify" && e.agentLabel).length;
    return n >= min ? true : `expected >=${min}, got ${n}`;
  },
  preparedOutcomeEquals(events, args) {
    const expected = args.expectedOutcome as string;
    const evt = events.find(e => e.stage === "prepared" && e.outcome != null);
    if (!evt) return "no prepared end event";
    return evt.outcome === expected ? true : evt.outcome;
  },
  noBuildAfterPreparedFailure(events, _args) {
    const idx = events.findIndex(e => e.stage === "prepared" && e.outcome === "revision-needed");
    if (idx === -1) return "no prepared failure";
    return !events.slice(idx+1).some(e => e.stage === "build") ? true : "build after prepared failure";
  },
  auditCompletesBeforeLand(events, _args) {
    const aIdx = events.findIndex(e => e.stage === "audit"), lIdx = events.findIndex(e => e.stage === "land");
    if (aIdx === -1) return "no audit"; if (lIdx === -1) return "no land";
    return aIdx < lIdx ? true : "audit not before land";
  },
  gateRunsAfterAudit(events, _args) {
    const aIdx = events.findIndex(e => e.stage === "audit"), gIdx = events.findIndex(e => e.stage === "gate");
    if (aIdx === -1) return "no audit"; if (gIdx === -1) return "no gate";
    return gIdx > aIdx ? true : "gate not after audit";
  },
  stageEndsWithOutcome(events, args) {
    const stage = String(args.stage);
    const expected = args.expectedOutcome as string;
    const last = [...events].reverse().find(e => e.stage === stage && e.outcome != null);
    if (!last) return `stage "${stage}" has no outcome event`;
    return last.outcome === expected ? true : last.outcome;
  },
  fieldValueEquals(events, args) {
    const stage = String(args.stage);
    const field = String(args.field);
    const expected = args.value;
    const last = [...events].reverse().find(e => e.stage === stage && (e as Record<string, unknown>)[field] != null);
    if (!last) return `stage "${stage}" has no value for "${field}"`;
    const val = (last as Record<string, unknown>)[field];
    return JSON.stringify(val) === JSON.stringify(expected) ? true : val;
  },
};

function buildStateVector(events: StageEvent[]): StateVector {
  const phaseSequence: string[] = [], seen = new Set<string>();
  const agentLabelsPerStage = new Map<string, Set<string>>();
  for (const e of events) {
    if (!seen.has(e.stage)) { seen.add(e.stage); phaseSequence.push(e.stage); }
    if (e.agentLabel) {
      if (!agentLabelsPerStage.has(e.stage)) agentLabelsPerStage.set(e.stage, new Set());
      agentLabelsPerStage.get(e.stage)!.add(e.agentLabel);
    }
  }
  const agentCounts: Record<string, number> = {};
  for (const [s, ls] of agentLabelsPerStage) agentCounts[s] = ls.size;
  const terminal = [...events].reverse().find(e => e.outcome != null);
  const outcome = { outcome: terminal?.outcome ?? null, reason: terminal ? ((terminal as Record<string,unknown>).reason ?? null) as string|null : null, phase: terminal?.stage ?? null };
  const allWrites = new Set<string>();
  for (const e of events) { if (e.observedWrites) for (const w of e.observedWrites) allWrites.add(w); }
  const scheduling = new Set<string>();
  for (const e of events) { if (e.agentLabel) scheduling.add(e.agentLabel); }
  return { phaseSequence, agentCounts, outcome, sharedStateMutations: [...allWrites].sort(), schedulingDecisions: [...scheduling].sort() };
}

function validateExpectations(manifest: ExpectationManifest): string[] {
  const errors: string[] = [];
  if (!manifest.assertions || !Array.isArray(manifest.assertions)) { errors.push("missing assertions array"); return errors; }
  for (const a of manifest.assertions) {
    if (!a.id) errors.push("assertion missing id");
    if (!VALID_CLASSIFICATIONS.includes(a.classification)) errors.push(`assertion ${a.id}: unknown classification "${a.classification}"`);
    if (!VALID_INTERNAL_CATEGORIES.includes(a.internalCategory)) errors.push(`assertion ${a.id}: unknown internalCategory "${a.internalCategory}"`);
    if (a.classification === "normative" && a.internalCategory !== "normative") errors.push(`assertion ${a.id}: normative requires internalCategory "normative"`);
    if (a.classification === "compatibility-only" && !["compatibility-only","explicitly-open-defect"].includes(a.internalCategory)) errors.push(`assertion ${a.id}: compatibility-only internalCategory mismatch`);
    if (a.classification === "known-defect") {
      if (!["observed-but-undesired","explicitly-open-defect","compatibility-only"].includes(a.internalCategory)) errors.push(`assertion ${a.id}: known-defect internalCategory mismatch`);
      if (!a.mappingNote) errors.push(`assertion ${a.id}: known-defect requires mappingNote`);
    }
    if (!a.check || !a.check.predicate) errors.push(`assertion ${a.id}: missing check.predicate`);
    else if (!PREDICATES[a.check.predicate]) errors.push(`assertion ${a.id}: unknown predicate "${a.check.predicate}"`);
    if (a.classification === "normative" && ["buildPhaseHasNoAgentOutcome","auditAfterNullBuild"].includes(a.check.predicate)) {
      errors.push(`assertion ${a.id}: normative asserts defect predicate "${a.check.predicate}"`);
    }
  }
  return errors;
}

function evaluateAssertion(assertion: Assertion, events: StageEvent[]): AssertionResult {
  const predicate = PREDICATES[assertion.check.predicate];
  let actual: unknown, detail = "";
  try { actual = predicate(events, assertion.check.args); } catch (err) { actual = `error: ${(err as Error).message}`; detail = (err as Error).message; }
  const passed = actual === true;
  if (!passed && !detail) detail = `expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(actual)}`;
  return { assertionId: assertion.id, description: assertion.description, classification: assertion.classification, internalCategory: assertion.internalCategory, passed, expected: assertion.expected, actual, detail };
}

function loadEvents(fixturePath: string): { events: StageEvent[] | null; errors: string[] } {
  const errors: string[] = [];
  const ep = path.join(fixturePath, "events.jsonl"), xp = path.join(fixturePath, "expectations.json");
  if (!fs.existsSync(ep)) { errors.push(`events.jsonl not found`); return { events: null, errors }; }
  if (!fs.existsSync(xp)) { errors.push(`expectations.json not found`); return { events: null, errors }; }
  const raw = fs.readFileSync(ep, "utf8"); const lines = raw.trim().split("\n").filter(l => l.trim());
  const events: StageEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    let evt: StageEvent;
    try { evt = JSON.parse(lines[i]); } catch { errors.push(`line ${i+1}: invalid JSON`); continue; }
    const v = validateEvent(evt);
    if (!v.ok) { errors.push(`line ${i+1}: ${(v.errors||["unknown"]).join("; ")}`); continue; }
    events.push(evt);
  }
  if (events.length === 0 && errors.length === 0) errors.push("events.jsonl is empty");
  return { events: errors.length === 0 ? events : null, errors };
}

function loadExpectations(fixturePath: string): { manifest: ExpectationManifest | null; errors: string[] } {
  const xp = path.join(fixturePath, "expectations.json");
  let manifest: ExpectationManifest;
  try { manifest = JSON.parse(fs.readFileSync(xp, "utf8")); } catch { return { manifest: null, errors: [`invalid JSON`] }; }
  const errors = validateExpectations(manifest);
  return { manifest: errors.length === 0 ? manifest : null, errors };
}

export function runWorkflowReplay(casePath: string, opts: { strict?: boolean } = {}): ReplayResult {
  const caseName = path.basename(casePath);
  const results: AssertionResult[] = [], errs: string[] = [];
  const { events, errors: le } = loadEvents(casePath); errs.push(...le);
  if (!events) return { ok: false, caseName, verdict: "load-failed", exitCode: 1, assertionResults: [], stateVector: null, errors: errs };
  const { manifest, errors: xe } = loadExpectations(casePath); errs.push(...xe);
  if (!manifest) return { ok: false, caseName, verdict: "expectations-invalid", exitCode: 1, assertionResults: [], stateVector: null, errors: errs };
  const sv = buildStateVector(events);
  for (const a of manifest.assertions) results.push(evaluateAssertion(a, events));
  let hasNorm = false, hasCompat = false;
  const resolved: AssertionResult[] = [];
  for (const r of results) {
    if (r.classification === "normative" && !r.passed) hasNorm = true;
    if (r.classification === "compatibility-only" && !r.passed) hasCompat = true;
    if (r.classification === "known-defect" && !r.passed) resolved.push(r);
  }
  const strict = opts.strict === true;
  let ec: number, v: string;
  if (errs.length > 0) { ec = 1; v = "load-failed"; }
  else if (hasNorm) { ec = 1; v = "normative-invariant-violated"; }
  else if (hasCompat && strict) { ec = 1; v = "strict-mode-compatibility-failure"; }
  else if (hasCompat) { ec = 2; v = "compatibility-warning"; }
  else if (resolved.length > 0) { ec = 0; v = `defect-resolved: ${resolved.map(r=>r.assertionId).join(",")}`; }
  else { ec = 0; v = "all-pass"; }
  return { ok: ec === 0, caseName, verdict: v, exitCode: ec, assertionResults: results, stateVector: sv, errors: errs };
}

export function runAllWorkflowReplays(fixturesDir: string, opts: { strict?: boolean; negativeControls?: boolean } = {}): ReplayResult[] {
  const resolved = path.resolve(fixturesDir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return [{ ok: false, caseName: "<fixtures-dir>", verdict: "no-fixtures-found", exitCode: 1, assertionResults: [], stateVector: null, errors: [`not found: ${resolved}`] }];
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const caseDirs = entries.filter(e => e.isDirectory()).map(e => path.join(resolved, e.name)).sort();
  if (caseDirs.length === 0) return [{ ok: true, caseName: "<fixtures-dir>", verdict: "no-fixtures-found", exitCode: 0, assertionResults: [], stateVector: null, errors: [] }];
  const nc = ["legacy-singleton-success-tampered","m192-defect-as-normative"];
  let filtered = caseDirs;
  if (opts.negativeControls) filtered = caseDirs.filter(d => nc.includes(path.basename(d)));
  else filtered = caseDirs.filter(d => !nc.includes(path.basename(d)));
  return filtered.map(d => runWorkflowReplay(d, { strict: opts.strict }));
}

function printResult(r: ReplayResult): void {
  console.log(`\n=== ${r.caseName} (${r.verdict}) ===`);
  for (const a of r.assertionResults) {
    console.log(`  ${a.passed ? "PASS" : "FAIL"} [${a.classification}] ${a.assertionId}: ${a.description}`);
    if (!a.passed) console.log(`       detail: ${a.detail}`);
  }
  for (const e of r.errors) console.log(`  ERROR: ${e}`);
}

export async function main(): Promise<number> {
  const args = process.argv.slice(2);
  let fd = FIXTURES_DIR, mode: string = "all", caseName: string | null = null, strict = false;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--all": mode = "all"; break;
      case "--case": if (i+1<args.length) { caseName = args[++i]; mode = "case"; } else { console.error("--case requires name"); return 2; } break;
      case "--negative-controls": mode = "negative-controls"; break;
      case "--strict": strict = true; break;
      case "--fixtures-dir": if (i+1<args.length) fd = args[++i]; else { console.error("--fixtures-dir requires path"); return 2; } break;
      default: console.error(`unknown: ${args[i]}`); return 2;
    }
  }
  if (mode === "case" && caseName) {
    const cp = path.join(fd, caseName);
    if (!fs.existsSync(cp)) { console.error(`case not found: ${cp}`); return 2; }
    const r = runWorkflowReplay(cp, { strict }); printResult(r); return r.exitCode;
  }
  const results = runAllWorkflowReplays(fd, { strict, negativeControls: mode === "negative-controls" });
  if (results.length === 0) { console.log("no fixtures found."); return 0; }
  if (results[0].caseName === "<fixtures-dir>") { console.log(results[0].verdict); return results[0].exitCode; }
  let gx = 0;
  for (const r of results) { printResult(r); if (r.exitCode === 1) gx = 1; }
  console.log(`\n--- ${results.length} fixture(s) replayed ---`);
  return gx;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && __filename === process.argv[1]) { main().then(c => process.exit(c)); }
