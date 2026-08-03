// workflow-event-schema.mjs — DIR-124-A1a: canonical stage-event schema v1 module.
// Single source of truth for the stage-event schema; consumed by A1b (emission), A2 (golden
// replay), A5 (baseline metrics), and DIR-124-B (stage scheduler / migration).
//
// Byte-identical mirror: plugin/scripts/workflow-event-schema.mjs
//
// Zero npm dependencies — Node.js built-ins only.
// Export surfaces:
//   - Constants: SCHEMA_VERSION, VALID_STAGES, VALID_OUTCOMES, VALID_WAIT_REASONS,
//     VALID_ISOLATION_MODES, VALID_DISPATCH_MODES, REQUIRED_FIELDS
//   - Functions: validateEvent(obj, lineNumber?), parseEventStream(jsonlPath), emitEvent(event)
//   - CLI: --validate <file>, --selftest, --json, --emit-event '<json>'
//
// Usage (import):
//   import { SCHEMA_VERSION, validateEvent, parseEventStream, emitEvent }
//     from "../scripts/workflow-event-schema.mjs";
//
// Usage (CLI):
//   node --no-warnings workflow-event-schema.mjs --selftest
//   node --no-warnings workflow-event-schema.mjs --validate events.jsonl
//   node --no-warnings workflow-event-schema.mjs --json < event.json
//   node --no-warnings workflow-event-schema.mjs --emit-event '<json>'

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────

/** @type {"1"} */
export const SCHEMA_VERSION = "1";

/** Known stage names across execute-milestone and prepare-milestone workflows. */
export const VALID_STAGES = Object.freeze([
  // execute-milestone.js phase boundaries
  "Verify",
  "Prepared",
  "Build",
  "Build-Evidence",
  "Audit",
  "Gate",
  "Reconcile",
  "Land",
  // prepare-milestone.js phase boundaries
  "Admission",
  "Preflight",
  "ProposalAuthors",
  "Adjudicate",
  "ProposalReview",
  "PlanAuthor",
  "PlanCheck",
  "Receipt",
  // fast-mode (direct, non-workflow) execution — gap-fast-mode-no-telemetry (2026-08-02).
  // Single "Fast" stage; start/end distinguished by the A1b `eventKind` extra field
  // ('start'/'end'), matching execute-milestone.js `_emitStageEvent`'s convention. Purely
  // additive — SCHEMA_VERSION is NOT bumped (M207 additive-growth precedent).
  "Fast",
]);

/** Valid stage-outcome values. */
export const VALID_OUTCOMES = Object.freeze([
  "done",
  "needs-human",
  // prepare-milestone phase boundaries (Preflight/ProposalAuthors/Adjudicate/PlanAuthor/
  // PlanCheck/Receipt) and execute-milestone's Prepared phase return `revision-needed` when a
  // deterministic re-run may suffice — a gateable rejection, not a hard human block. The A2
  // prepared-failure / m195-stale-prepared fixtures encode it as the Prepared outcome. Purely
  // additive — SCHEMA_VERSION is NOT bumped (M207 additive-growth precedent).
  "revision-needed",
  "skipped",
  "error",
  // fast-mode (direct) execution — gap-fast-mode-no-telemetry (2026-08-02): a task abandoned
  // without a completion commit (start emitted, --task-end never reached with a terminal
  // outcome). Purely additive — SCHEMA_VERSION is NOT bumped.
  "abandoned",
]);

/** Valid wait-reason values. */
export const VALID_WAIT_REASONS = Object.freeze([
  "admission-contention",
  "cache-hit",
  "prepared-blocked",
]);

/** Valid isolation-mode values. */
export const VALID_ISOLATION_MODES = Object.freeze(["worktree"]);

/** Valid dispatch-mode values. */
export const VALID_DISPATCH_MODES = Object.freeze(["serial", "concurrent"]);

/** Required field names for a v1 StageEvent. */
export const REQUIRED_FIELDS = Object.freeze([
  "schemaVersion",
  "runId",
  "candidateId",
  "taskId",
  "stage",
  "attempt",
  "timing",
  "agentLabel",
  "commandIdentity",
  "executionCwd",
  "worktreePath",
  "baseCommit",
  "candidateCommit",
  "outcome",
  "waitReason",
  "resourceClaim",
  "observedWrites",
  "isolationMode",
  "dispatchMode",
  "recordedAtMs",
]);

/** @typedef {"done"|"needs-human"|"revision-needed"|"skipped"|"error"|"abandoned"|null} Outcome */
/** @typedef {"admission-contention"|"cache-hit"|"prepared-blocked"|null} WaitReason */
/** @typedef {"worktree"|null} IsolationMode */
/** @typedef {"serial"|"concurrent"|null} DispatchMode */

/**
 * @typedef {object} Timing
 * @property {number|null} queuedAtMs
 * @property {number|null} startedAtMs
 * @property {number|null} endedAtMs
 */

/**
 * @typedef {object} StageEvent
 * @property {"1"} schemaVersion
 * @property {string} runId
 * @property {string} candidateId
 * @property {string} taskId
 * @property {string} stage
 * @property {number} attempt
 * @property {Timing} timing
 * @property {string} agentLabel
 * @property {string|null} commandIdentity
 * @property {string} executionCwd
 * @property {string|null} worktreePath
 * @property {string|null} baseCommit
 * @property {string|null} candidateCommit
 * @property {Outcome} outcome
 * @property {WaitReason} waitReason
 * @property {string|null} resourceClaim
 * @property {string[]} observedWrites
 * @property {IsolationMode} isolationMode
 * @property {DispatchMode} dispatchMode
 * @property {number} recordedAtMs
 */

// ── validateEvent ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Structural validation of a v1 StageEvent object.
 *
 * Checks: required fields present, types correct, enumerated-value membership for constrained
 * fields. Unknown additional properties are allowed (forward-compat for v2).
 *
 * @param {any} obj — the object to validate
 * @param {number} [lineNumber] — optional line number for error context
 * @returns {{ok: true, event: StageEvent}} | {{ok: false, error: string, lineNumber?: number}}
 */
export function validateEvent(obj, lineNumber) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "event must be a non-null object", lineNumber };
  }

  // Check all required fields are present
  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj)) {
      return { ok: false, error: `missing required field "${field}"`, lineNumber };
    }
  }

  // schemaVersion
  if (obj.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `schemaVersion "${obj.schemaVersion}" is not "${SCHEMA_VERSION}"`,
      lineNumber,
    };
  }

  // runId: string
  if (typeof obj.runId !== "string") {
    return { ok: false, error: `runId must be a string`, lineNumber };
  }

  // candidateId: string
  if (typeof obj.candidateId !== "string") {
    return { ok: false, error: `candidateId must be a string`, lineNumber };
  }

  // taskId: string
  if (typeof obj.taskId !== "string") {
    return { ok: false, error: `taskId must be a string`, lineNumber };
  }

  // stage: must be one of VALID_STAGES
  if (typeof obj.stage !== "string") {
    return { ok: false, error: `stage must be a string`, lineNumber };
  }
  if (!VALID_STAGES.includes(obj.stage)) {
    return {
      ok: false,
      error: `invalid stage "${obj.stage}"; must be one of: ${VALID_STAGES.join(", ")}`,
      lineNumber,
    };
  }

  // attempt: number
  if (typeof obj.attempt !== "number") {
    return { ok: false, error: `attempt must be a number`, lineNumber };
  }

  // timing: object with numeric/null fields
  if (obj.timing == null || typeof obj.timing !== "object" || Array.isArray(obj.timing)) {
    return { ok: false, error: `timing must be a non-null object`, lineNumber };
  }
  for (const tf of ["queuedAtMs", "startedAtMs", "endedAtMs"]) {
    if (!(tf in obj.timing)) {
      return { ok: false, error: `timing.${tf} is required`, lineNumber };
    }
    const tv = obj.timing[tf];
    if (tv !== null && typeof tv !== "number") {
      return { ok: false, error: `timing.${tf} must be a number or null`, lineNumber };
    }
  }

  // agentLabel: string
  if (typeof obj.agentLabel !== "string") {
    return { ok: false, error: `agentLabel must be a string`, lineNumber };
  }

  // commandIdentity: string|null
  if (obj.commandIdentity !== null && typeof obj.commandIdentity !== "string") {
    return { ok: false, error: `commandIdentity must be a string or null`, lineNumber };
  }

  // executionCwd: string
  if (typeof obj.executionCwd !== "string") {
    return { ok: false, error: `executionCwd must be a string`, lineNumber };
  }

  // worktreePath: string|null
  if (obj.worktreePath !== null && typeof obj.worktreePath !== "string") {
    return { ok: false, error: `worktreePath must be a string or null`, lineNumber };
  }

  // baseCommit: string|null
  if (obj.baseCommit !== null && typeof obj.baseCommit !== "string") {
    return { ok: false, error: `baseCommit must be a string or null`, lineNumber };
  }

  // candidateCommit: string|null
  if (obj.candidateCommit !== null && typeof obj.candidateCommit !== "string") {
    return { ok: false, error: `candidateCommit must be a string or null`, lineNumber };
  }

  // outcome: one of VALID_OUTCOMES or null
  if (obj.outcome !== null && !VALID_OUTCOMES.includes(obj.outcome)) {
    return {
      ok: false,
      error: `invalid outcome "${obj.outcome}"; must be one of: ${VALID_OUTCOMES.join(", ")} or null`,
      lineNumber,
    };
  }
  if (obj.outcome !== null && typeof obj.outcome !== "string") {
    return { ok: false, error: `outcome must be a string or null`, lineNumber };
  }

  // waitReason: one of VALID_WAIT_REASONS or null
  if (obj.waitReason !== null && typeof obj.waitReason !== "string") {
    return { ok: false, error: `waitReason must be a string or null`, lineNumber };
  }
  if (obj.waitReason !== null && !VALID_WAIT_REASONS.includes(obj.waitReason)) {
    return {
      ok: false,
      error: `invalid waitReason "${obj.waitReason}"; must be one of: ${VALID_WAIT_REASONS.join(", ")} or null`,
      lineNumber,
    };
  }

  // resourceClaim: string|null
  if (obj.resourceClaim !== null && typeof obj.resourceClaim !== "string") {
    return { ok: false, error: `resourceClaim must be a string or null`, lineNumber };
  }

  // observedWrites: array of strings
  if (!Array.isArray(obj.observedWrites)) {
    return { ok: false, error: `observedWrites must be an array`, lineNumber };
  }
  for (let i = 0; i < obj.observedWrites.length; i++) {
    if (typeof obj.observedWrites[i] !== "string") {
      return {
        ok: false,
        error: `observedWrites[${i}] must be a string`,
        lineNumber,
      };
    }
  }

  // isolationMode: one of VALID_ISOLATION_MODES or null
  if (obj.isolationMode !== null && typeof obj.isolationMode !== "string") {
    return { ok: false, error: `isolationMode must be a string or null`, lineNumber };
  }
  if (obj.isolationMode !== null && !VALID_ISOLATION_MODES.includes(obj.isolationMode)) {
    return {
      ok: false,
      error: `invalid isolationMode "${obj.isolationMode}"; must be one of: ${VALID_ISOLATION_MODES.join(", ")} or null`,
      lineNumber,
    };
  }

  // dispatchMode: one of VALID_DISPATCH_MODES or null
  if (obj.dispatchMode !== null && typeof obj.dispatchMode !== "string") {
    return { ok: false, error: `dispatchMode must be a string or null`, lineNumber };
  }
  if (obj.dispatchMode !== null && !VALID_DISPATCH_MODES.includes(obj.dispatchMode)) {
    return {
      ok: false,
      error: `invalid dispatchMode "${obj.dispatchMode}"; must be one of: ${VALID_DISPATCH_MODES.join(", ")} or null`,
      lineNumber,
    };
  }

  // recordedAtMs: number (required)
  if (typeof obj.recordedAtMs !== "number") {
    return { ok: false, error: `recordedAtMs must be a number`, lineNumber };
  }

  // Forward-compat: unknown additional properties are allowed (pass through).
  return { ok: true, event: /** @type {StageEvent} */ (obj) };
}

// ── emitEvent ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic single-line JSON serialization of a StageEvent.
 *
 * Sorted keys, no extra whitespace, no trailing newline. Two calls with the same event object
 * produce byte-identical strings.
 *
 * Builds a shallow copy with sorted keys before serializing, because JSON.stringify's array
 * replacer applies recursively to nested objects and would drop sub-object fields.
 *
 * @param {StageEvent} event
 * @returns {string} — single-line JSON (no trailing newline)
 */
export function emitEvent(event) {
  const sorted = {};
  for (const key of Object.keys(event).sort()) {
    sorted[key] = event[key];
  }
  return JSON.stringify(sorted);
}

// ── parseEventStream ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stream reader for a JSONL file of StageEvents.
 *
 * Reads line-by-line via node:readline — never loads the full file into memory.
 * Malformed lines (bad JSON, validation failure) yield {ok: false, error, lineNumber}
 * and iteration continues. Empty/whitespace-only lines are skipped silently.
 *
 * @param {string} jsonlPath — path to the JSONL file
 * @returns {AsyncGenerator<{ok: true, event: StageEvent} | {ok: false, error: string, lineNumber: number}>}
 */
export async function* parseEventStream(jsonlPath) {
  const stream = fs.createReadStream(jsonlPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;
  try {
    for await (const line of rl) {
      lineNumber++;
      // Skip empty / whitespace-only lines
      if (line.trim() === "") continue;

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        yield { ok: false, error: `JSON parse error at line ${lineNumber}: ${e.message}`, lineNumber };
        continue;
      }

      const result = validateEvent(parsed, lineNumber);
      yield result;
    }
  } finally {
    // Ensure the readline interface is closed even if the consumer breaks early
    rl.close();
    // Also close the underlying stream to prevent fd leaks
    try { stream.destroy(); } catch (_) { /* best-effort */ }
  }
}

// ── selftest ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Built-in smoke test: construct, emit, parse, validate round-trip; value-range checks.
 *
 * @returns {boolean} — true if all checks pass
 */
export function selftest() {
  let allPassed = true;

  /**
   * @param {string} name
   * @param {boolean} condition
   * @param {string} detail
   */
  function check(name, condition, detail) {
    if (condition) {
      console.log(`SELFTEST PASS: ${name} — ${detail}`);
    } else {
      console.error(`SELFTEST FAIL: ${name} — ${detail}`);
      allPassed = false;
    }
  }

  // ── Minimal valid event ──
  /** @type {StageEvent} */
  const validEvent = {
    schemaVersion: "1",
    runId: "M248",
    candidateId: "M248-DIR-124",
    taskId: "DIR-124-A1a",
    stage: "Build",
    attempt: 0,
    timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: null },
    agentLabel: "build-agent",
    commandIdentity: "tsx script.ts",
    executionCwd: "/home/user/work/quay",
    worktreePath: null,
    baseCommit: "abc123def",
    candidateCommit: null,
    outcome: null,
    waitReason: null,
    resourceClaim: null,
    observedWrites: [],
    isolationMode: null,
    dispatchMode: "serial",
    recordedAtMs: 2000,
  };

  // Round-trip: validate → emit → parse → validate
  const vr1 = validateEvent(validEvent);
  check("validate-valid-event", vr1.ok, `ok=${vr1.ok}`);

  const emitted = emitEvent(validEvent);
  check("emit-is-string", typeof emitted === "string", `type=${typeof emitted}`);
  check("emit-single-line", !emitted.includes("\n"), "no embedded newline");

  // Deterministic output: two calls produce identical strings
  const emitted2 = emitEvent(validEvent);
  check("emit-deterministic", emitted === emitted2, "two calls → byte-identical");

  // Round-trip: parse the emitted JSON and validate
  const reparsed = JSON.parse(emitted);
  const vr2 = validateEvent(reparsed);
  check("roundtrip-validate", vr2.ok, `ok=${vr2.ok}`);
  check("roundtrip-stage", vr2.ok && vr2.event.stage === "Build", `stage=${vr2.ok ? vr2.event.stage : "N/A"}`);
  check("roundtrip-schemaVersion", vr2.ok && vr2.event.schemaVersion === "1", "schemaVersion preserved");

  // Sorted keys: first key in emitted JSON should be the first alphabetically among required fields
  const sortedKeys = Object.keys(validEvent).sort();
  const firstKey = sortedKeys[0];
  check("emit-sorted-keys", emitted.startsWith(`{"${firstKey}":`), `starts with "${firstKey}"`);

  // ── Missing required field ──
  const missingFieldResult = validateEvent({ runId: "M248" });
  check("reject-missing-field", !missingFieldResult.ok && missingFieldResult.error.includes("schemaVersion"),
    `error="${missingFieldResult.error}"`);

  // ── Wrong type: attempt as string ──
  const wrongTypeEvent = { ...validEvent, attempt: "0" };
  const wrongTypeResult = validateEvent(wrongTypeEvent);
  check("reject-wrong-type", !wrongTypeResult.ok && wrongTypeResult.error.includes("attempt"),
    `error="${wrongTypeResult.error}"`);

  // ── Invalid stage ──
  const invalidStageEvent = { ...validEvent, stage: "UnknownPhase" };
  const invalidStageResult = validateEvent(invalidStageEvent);
  check("reject-invalid-stage", !invalidStageResult.ok && invalidStageResult.error.includes("UnknownPhase"),
    `error="${invalidStageResult.error}"`);

  // ── Schema version mismatch ──
  const wrongVersionEvent = { ...validEvent, schemaVersion: "2" };
  const wrongVersionResult = validateEvent(wrongVersionEvent);
  check("reject-wrong-version", !wrongVersionResult.ok && wrongVersionResult.error.includes('"2"'),
    `error="${wrongVersionResult.error}"`);

  // ── Invalid outcome ──
  const badOutcomeEvent = { ...validEvent, outcome: "unknown" };
  const badOutcomeResult = validateEvent(badOutcomeEvent);
  check("reject-invalid-outcome", !badOutcomeResult.ok && badOutcomeResult.error.includes("unknown"),
    `error="${badOutcomeResult.error}"`);

  // ── All VALID_STAGES accepted ──
  for (const s of VALID_STAGES) {
    const se = { ...validEvent, stage: s };
    const r = validateEvent(se);
    check(`stage-${s}`, r.ok, `ok=${r.ok}`);
  }

  // ── All VALID_OUTCOMES accepted ──
  for (const o of VALID_OUTCOMES) {
    const oe = { ...validEvent, outcome: o };
    const r = validateEvent(oe);
    check(`outcome-${o}`, r.ok, `ok=${r.ok}`);
  }

  // ── Null outcome accepted ──
  const nullOutcomeResult = validateEvent({ ...validEvent, outcome: null });
  check("outcome-null", nullOutcomeResult.ok, `ok=${nullOutcomeResult.ok}`);

  // ── All VALID_WAIT_REASONS accepted ──
  for (const w of VALID_WAIT_REASONS) {
    const we = { ...validEvent, waitReason: w };
    const r = validateEvent(we);
    check(`waitReason-${w}`, r.ok, `ok=${r.ok}`);
  }

  // ── All VALID_ISOLATION_MODES accepted ──
  for (const im of VALID_ISOLATION_MODES) {
    const ie = { ...validEvent, isolationMode: im };
    const r = validateEvent(ie);
    check(`isolationMode-${im}`, r.ok, `ok=${r.ok}`);
  }

  // ── All VALID_DISPATCH_MODES accepted ──
  for (const dm of VALID_DISPATCH_MODES) {
    const de = { ...validEvent, dispatchMode: dm };
    const r = validateEvent(de);
    check(`dispatchMode-${dm}`, r.ok, `ok=${r.ok}`);
  }

  // ── null commandIdentity accepted ──
  const nullCmdResult = validateEvent({ ...validEvent, commandIdentity: null });
  check("commandIdentity-null", nullCmdResult.ok, `ok=${nullCmdResult.ok}`);

  // ── Unknown additional properties pass through (forward-compat) ──
  const extraEvent = { ...validEvent, futureField: "hello", anotherExtra: 42 };
  const extraResult = validateEvent(extraEvent);
  check("forward-compat-extra-fields", extraResult.ok, `ok=${extraResult.ok} (futureField, anotherExtra)`);

  // ── recordAtMs missing ──
  const missingRecorded = { ...validEvent };
  delete missingRecorded.recordedAtMs;
  const missingRecordedResult = validateEvent(missingRecorded);
  check("reject-missing-recordedAtMs", !missingRecordedResult.ok && missingRecordedResult.error.includes("recordedAtMs"),
    `error="${missingRecordedResult.error}"`);

  // ── observedWrites with non-string element rejected ──
  const badWritesEvent = { ...validEvent, observedWrites: ["file1.md", 42] };
  const badWritesResult = validateEvent(badWritesEvent);
  check("reject-non-string-observedWrites", !badWritesResult.ok && badWritesResult.error.includes("observedWrites[1]"),
    `error="${badWritesResult.error}"`);

  // ── timing missing sub-field ──
  const badTimingEvent = { ...validEvent, timing: { queuedAtMs: 1000 } };
  const badTimingResult = validateEvent(badTimingEvent);
  check("reject-missing-timing-startedAtMs", !badTimingResult.ok && badTimingResult.error.includes("timing.startedAtMs"),
    `error="${badTimingResult.error}"`);

  // ── timing with wrong type ──
  const badTimingTypeEvent = { ...validEvent, timing: { queuedAtMs: 1000, startedAtMs: "not-a-number", endedAtMs: null } };
  const badTimingTypeResult = validateEvent(badTimingTypeEvent);
  check("reject-wrong-type-timing", !badTimingTypeResult.ok && badTimingTypeResult.error.includes("timing.startedAtMs must be a number or null"),
    `error="${badTimingTypeResult.error}"`);

  // ── Emit with keys in non-alphabetical insertion order still produces sorted output ──
  const unorderedEvent = {};
  // Insert keys in reverse alphabetical order
  for (const k of [...REQUIRED_FIELDS].reverse()) {
    unorderedEvent[k] = validEvent[k] !== undefined ? validEvent[k] : null;
  }
  // Fix specific values
  unorderedEvent.schemaVersion = "1";
  unorderedEvent.attempt = 0;
  unorderedEvent.recordedAtMs = 2000;
  const unorderedEmitted = emitEvent(unorderedEvent);
  check("emit-insertion-order-independent", unorderedEmitted === emitted,
    "reverse insertion order → same output");

  const passedCount = (() => {
    // Count passes from the output we just logged
    // We can't easily introspect, so we just return allPassed
    return allPassed;
  })();

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

// ── Repo-root detection ──────────────────────────────────────────────────────────────────────────────

/**
 * Find the workspace root by walking up from the script location or CWD.
 * Uses .quay/config.yml as the sentinel file.
 *
 * @returns {string} — the workspace root path
 */
function findRepoRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  let dir = path.resolve(scriptDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: try git rev-parse from CWD
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8", timeout: 5_000 }).trim();
  } catch (_) {
    return process.cwd();
  }
}

// ── CLI entry point ──────────────────────────────────────────────────────────────────────────────────

/**
 * CLI main function. Entry point when invoked directly via `node workflow-event-schema.mjs`.
 *
 * Modes:
 *   --validate <file>   Validate a JSONL file, print summary, exit 0 if all valid.
 *   --selftest          Run internal smoke test, exit 0 on pass.
 *   --json              Read a single JSON object from stdin, validate, print result.
 *   --emit-event '<js>' Parse JSON arg, validate, append to .workflow-events/<runId>.jsonl.
 *
 * @param {string[]} argv — process.argv
 * @returns {Promise<number>} — exit code
 */
async function main(argv) {
  const args = argv.slice(2);

  // --selftest
  if (args.includes("--selftest")) {
    return selftest() ? 0 : 1;
  }

  // --validate <file>
  if (args.includes("--validate")) {
    const idx = args.indexOf("--validate");
    const fpath = args[idx + 1];
    if (!fpath) {
      console.error("Usage: node workflow-event-schema.mjs --validate <file>");
      return 1;
    }
    if (!fs.existsSync(fpath)) {
      console.error(`File not found: ${fpath}`);
      return 1;
    }
    let total = 0;
    let validCount = 0;
    let invalidCount = 0;
    try {
      for await (const result of parseEventStream(fpath)) {
        total++;
        if (result.ok) {
          validCount++;
        } else {
          invalidCount++;
          console.error(`Line ${result.lineNumber}: ${result.error}`);
        }
      }
    } catch (e) {
      console.error(`Error reading file: ${e.message}`);
      return 1;
    }
    console.log(`Validated ${fpath}: ${total} total, ${validCount} valid, ${invalidCount} invalid`);
    return invalidCount === 0 ? 0 : 1;
  }

  // --json (read from stdin)
  if (args.includes("--json")) {
    const chunks = [];
    try {
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
    } catch (_) {
      console.error("Error reading stdin");
      return 1;
    }
    const input = chunks.join("");
    if (input.trim() === "") {
      console.log(JSON.stringify({ ok: false, error: "empty input" }));
      return 1;
    }
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, error: `JSON parse error: ${e.message}` }));
      return 1;
    }
    const result = validateEvent(parsed);
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }

  // --emit-event '<json>'
  if (args.includes("--emit-event")) {
    const idx = args.indexOf("--emit-event");
    const jsonArg = args[idx + 1];
    if (!jsonArg) {
      console.error("Usage: node workflow-event-schema.mjs --emit-event '<json>'");
      return 0;
    }
    let event;
    try {
      event = JSON.parse(jsonArg);
    } catch (e) {
      console.error(`Invalid JSON: ${e.message}`);
      return 0; // fail-soft
    }
    const validation = validateEvent(event);
    if (!validation.ok) {
      console.error(`Validation failed: ${validation.error}`);
      return 0; // fail-soft — event log is best-effort
    }

    // Derive runId from the event itself
    const runId = validation.event.runId;
    if (!runId || typeof runId !== "string") {
      console.error("event.runId is missing or not a string");
      return 0; // fail-soft
    }

    // WORKFLOW_EVENTS_DIR env override: point --emit-event at a per-run-unique location instead of
    // the live .workflow-events/ store (gap-r1-cannot-see-tests-writing-into-the-live-task-store —
    // R7 live-data-dir-write). The default stays repoRoot/.workflow-events for the CLI.
    const repoRoot = findRepoRoot();
    const eventsDir = process.env.WORKFLOW_EVENTS_DIR || path.join(repoRoot, ".workflow-events");
    try {
      if (!fs.existsSync(eventsDir)) {
        fs.mkdirSync(eventsDir, { recursive: true });
      }
    } catch (e) {
      console.error(`Cannot create .workflow-events/ directory: ${e.message}`);
      return 0; // fail-soft
    }

    const logPath = path.join(eventsDir, `${runId}.jsonl`);
    const line = emitEvent(validation.event) + "\n";
    try {
      fs.appendFileSync(logPath, line, "utf8");
    } catch (e) {
      console.error(`Cannot write to event log: ${e.message}`);
      return 0; // fail-soft
    }
    return 0;
  }

  // No args or --help — print usage and exit 0 (module loaded for import only)
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log("workflow-event-schema.mjs — stage-event schema v1");
    console.log("Usage:");
    console.log("  node workflow-event-schema.mjs --validate <file>    Validate a JSONL file");
    console.log("  node workflow-event-schema.mjs --selftest            Run internal smoke test");
    console.log("  node workflow-event-schema.mjs --json                Validate JSON from stdin");
    console.log("  node workflow-event-schema.mjs --emit-event '<json>' Emit event to .workflow-events/");
    console.log("");
    console.log("Exports (for import): SCHEMA_VERSION, VALID_STAGES, VALID_OUTCOMES,");
    console.log("  VALID_WAIT_REASONS, VALID_ISOLATION_MODES, VALID_DISPATCH_MODES,");
    console.log("  REQUIRED_FIELDS, validateEvent, parseEventStream, emitEvent");
    return 0;
  }

  // Unknown flags
  console.error(`Unknown arguments: ${args.join(" ")}`);
  console.error("Use --help for usage.");
  return 0;
}

// ── Direct-entry check ───────────────────────────────────────────────────────────────────────────────

/**
 * Is this module being run directly (vs imported)?
 * Re-implements the isDirectEntry pattern from gate-script-base.ts for .mjs.
 *
 * @param {string} [argv1] — process.argv[1]
 * @returns {boolean}
 */
function isDirectEntry(argv1) {
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(path.resolve(entry)) === fileURLToPath(import.meta.url);
  } catch (_) {
    // Fallback: simple basename match
    return entry.endsWith("workflow-event-schema.mjs");
  }
}

// Run CLI if invoked directly
if (isDirectEntry()) {
  main(process.argv).then((code) => process.exit(code));
}
