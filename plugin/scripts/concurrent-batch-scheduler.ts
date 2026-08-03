// concurrent-batch-scheduler.mjs — the two-level scheduler's ASSEMBLY core (DIR-044 increment 2; see
// charters/DIR-044-concurrent-scheduler-D3.md Step 2 increment 2). Given rank-ordered candidate
// charters, greedily assemble a maximal touches-DISJOINT, EXECUTION-type batch that touches NO shared
// exp5 state; defer everything else to a later (serial) round. The loop driver then dispatches ONE
// native `Agent(run_in_background=true)` build per batched candidate, each in its own worktree — this
// module computes WHICH candidates may batch (the deterministic, testable decision), it does NOT spawn
// agents and it NEVER touches manda (native-only, DIR-044 constraint).
//
// SINGLE-SOURCE (ADR-004): the disjointness verdict is IMPORTED from touches-orthogonality-check.mjs
// (checkTouchesPair) — never re-implemented here. This module adds only the batch-assembly policy:
// execution-type-only, no-shared-state, conservative-serialize.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTouches,
  expandGlobs,
  matchGlob,
  checkTouchesPair,
  findRepoRoot,
} from "./touches-orthogonality-check.ts";
// DIR-117 iteration-2 item 4: the SAME touch-set-expansion arithmetic that
// milestone-preparation-check.ts's `Prepared` gate used to detect a checked Plan outgrowing its
// declared '## Touches'. milestone-preparation-check.ts is retired with the prepare/execute
// pipeline (ADR-022 / gap-retire-the-prepare-execute-pipeline-cluster); this function is the one
// piece the batch scheduler still needs, so it is single-sourced HERE (was: imported from
// ./milestone-preparation-check.ts).
function computeTouchesExpansion(receiptTouches, declaredTouches) {
  if (!Array.isArray(declaredTouches) || !Array.isArray(receiptTouches) || receiptTouches.length === 0) {
    return { expanded: [] };
  }
  const expanded = receiptTouches.filter((t) => !declaredTouches.includes(t));
  return { expanded };
}

// Shared exp5 state — concurrent writes here would conflict, so any candidate declaring it CANNOT be
// batched (its writes must be serialized at fan-in ABSORB). Repo-relative concrete paths.
export const SHARED_STATE_PATHS = [
  "experiments/quay-perpetual-stream/dashboard.md",
  "experiments/quay-perpetual-stream/backlog.md",
  "experiments/quay-perpetual-stream/v-meta-ledger.md",
  "experiments/quay-perpetual-stream/.quay/gate-events.jsonl",
];

// ── parseCandidate ───────────────────────────────────────────────────────────────────────────────
// A candidate = its id + declared `## Touches` + its milestone type (execution | learning | …) + its
// value-type (capability-growth | discovery | instrument-correction | risk-option |
// governance-integrity, per inherited-core.md's value-typed ledger).
// Type is read from a `**type:** <t>` or `type: <t>` line; defaults to "execution".
// Value-type is read from a `**Value type:** <vt>` line (also tolerates the older
// `Value type (per ...): **<vt>**` prose form and camelCase spellings like `instrumentCorrection`,
// DIR-116). Unstated → defaults to "capability-growth" — conservative-PERMISSIVE for backward compat
// with the many pre-DIR-116 charters/fixtures that never declared this field (mirrors the `type`
// field's own unstated-default policy above); the field is only ever used to DEFER, never to admit
// something the touches/type checks would otherwise reject.
export function parseCandidate(id, charterText) {
  const touches = parseTouches(charterText);
  let type = "execution";
  // Tolerates `type: x`, `**type:** x` (colon inside bold), and `**type**: x`.
  const m = String(charterText).match(/^\s*\*{0,2}type\*{0,2}\s*:\s*\*{0,2}\s*`?([a-z][\w-]*)/im);
  if (m) type = m[1].toLowerCase();
  let valueType = "capability-growth";
  // "value type" / "value-type", not "value-typed" (word-boundary after "type" excludes that word);
  // no `^` anchor — real charters put this field mid-line (e.g. "**Class:** development ·
  // **Value type:** ...") and/or with parenthetical prose between the label and the colon.
  const vm = String(charterText).match(/value[\s-]?type\b[^:\n]*:\s*\*{0,2}\s*`?([a-zA-Z][\w-]*)/i);
  if (vm) valueType = vm[1].toLowerCase();
  return { id, touches, type, valueType };
}

// ── isCapabilityGrowth ───────────────────────────────────────────────────────────────────────────
// Normalizes away hyphens/case so both spellings actually seen in the wild — "instrument-correction"
// (kebab, most charters) and "instrumentCorrection" (camelCase, e.g. DIR-109/M185's own charter) —
// compare equal.
function normalizeValueType(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
export function isCapabilityGrowth(valueType) {
  return normalizeValueType(valueType) === "capabilitygrowth";
}

// ── touchesSharedState ───────────────────────────────────────────────────────────────────────────
// True iff any declared glob matches (covers) a known shared-state path.
export function touchesSharedState(globs) {
  for (const g of globs) {
    for (const sp of SHARED_STATE_PATHS) {
      if (g === sp || matchGlob(g, sp)) return true;
    }
  }
  return false;
}

// ── assembleBatch ────────────────────────────────────────────────────────────────────────────────
// Greedy maximal disjoint batch over rank-ordered candidates. A candidate JOINS iff:
//   - type is a batchable execution type (NOT learning — learning is always serial), AND
//   - value-type is capability-growth (DIR-116 — the one real residual gap from DIR-057 not covered
//     by DIR-066/106/107: a governance-integrity/instrument-correction/discovery/risk-option-typed
//     candidate is exactly the class of work DIR-057's safety argument meant to exclude, even when it
//     avoids the narrower learning-type/shared-state checks below), AND
//   - it does not touch shared state, AND
//   - its `## Touches` is well-declared (checkTouchesPair's conservative rules pass against the batch),
//     AND it is touches-disjoint from EVERY candidate already in the batch.
// The first eligible candidate anchors the batch; ineligible/overlapping ones are deferred with a
// reason. `expand(globs) → Set<path>` is injected (CLI passes an fs-backed expander).
export function assembleBatch(candidates, { expand }) {
  const batch = [];      // parsed candidates admitted
  const deferred = [];
  for (const c of candidates) {
    if (isLearning(c.type)) {
      deferred.push({ id: c.id, reason: `learning-type ("${c.type}") is never batched — always serial` });
      continue;
    }
    if (!isCapabilityGrowth(c.valueType)) {
      deferred.push({
        id: c.id,
        reason: `value-type ("${c.valueType}") is not capability-growth — non-capability-growth work must serialize (deferred to fan-in ABSORB)`,
      });
      continue;
    }
    if (c.touches.hasSection && touchesSharedState(c.touches.globs)) {
      deferred.push({ id: c.id, reason: "touches shared exp5 state — must serialize (deferred to fan-in ABSORB)" });
      continue;
    }
    // Disjoint from every already-admitted candidate? Reuse the single-source verdict.
    let blocked = null;
    for (const inBatch of batch) {
      const r = checkTouchesPair(c.touches, inBatch.touches, expand);
      if (!r.disjoint) { blocked = { peer: inBatch.id, reason: r.reason }; break; }
    }
    if (blocked) {
      deferred.push({ id: c.id, reason: `not disjoint from ${blocked.peer}: ${blocked.reason}` });
      continue;
    }
    // A lone anchor still must have a well-declared touches (else it is unsafe to reason about even
    // solo — conservative). Probe it against itself via the conservative gate.
    if (batch.length === 0) {
      const self = checkTouchesPair(c.touches, c.touches, expand);
      if (!self.disjoint && !isSelfOverlapOnly(self)) {
        deferred.push({ id: c.id, reason: `ill-declared touches: ${self.reason}` });
        continue;
      }
    }
    batch.push(c);
  }
  return { batch: batch.map((c) => c.id), deferred };
}

// ── worktreeDispatchEligibility ─────────────────────────────────────────────────────────────────
// DIR-123: the SINGLE pre-dispatch safety decision for which candidates may be dispatched CONCURRENTLY
// under execute-milestone.js's `isolationMode:'worktree'`. A thin, explicitly-named wrapper over
// assembleBatch — the disjointness verdict is STILL checkTouchesPair (imported from
// touches-orthogonality-check.ts), NEVER a second eligibility checker (DIR-123 Requested-action #7:
// this directive is about EXECUTION isolation, not re-deciding which tasks may batch).
//
// SAME-FILE-CONFLICT RESOLUTION (DIR-123 Requested-action #5, the explicit decision): two candidates
// whose `## Touches` expand to OVERLAPPING file-sets are REJECTED PRE-DISPATCH — the later one is
// deferred to a serial round (it lands in `mustSerialize` tagged `sameFileConflict:true`), NOT admitted
// to run concurrently and left to collide at Land. Land's own real-merge-conflict handling
// (milestone-worktree.ts mergeWorktree → outcome:"conflict" → auto-abort + needs-human, never a blanket
// --ours/--theirs) is the DEFINED backstop for an UNDECLARED touch that slips past this check — never the
// primary mechanism. Returns {eligible:[ids], mustSerialize:[{id, reason, sameFileConflict}]}.
export function worktreeDispatchEligibility(candidates, { expand }) {
  const r = assembleBatch(candidates, { expand });
  const mustSerialize = r.deferred.map((d) => ({
    id: d.id,
    reason: d.reason,
    // "overlapping file-sets" is checkTouchesPair's concrete-overlap verdict (assembleBatch wraps it as
    // "not disjoint from <peer>: overlapping file-sets"). Distinguish it from the OTHER serialize reasons
    // (learning-type / shared-state / non-capability-growth / conservative ill-declared touches) so the
    // DIR-123 same-file-conflict fixture asserts on the conflict case specifically, not a conservative one.
    sameFileConflict: /overlapping file-sets/i.test(d.reason),
  }));
  return { eligible: r.batch, mustSerialize };
}

// ── applyPreparationExpansion ────────────────────────────────────────────────────────────────────
// DIR-117 iteration-2 item 4: a candidate's declared '## Touches' can go stale once its checked
// Plan (a real milestone-preparation-check.ts receipt's `.touches`) covers MORE than what the
// charter/task originally declared. Detecting this in isolation (milestone-preparation-check.ts's
// own `touches-expanded` code, run against ONE candidate at a time) is necessary but not
// sufficient — a real batch candidate must be RE-EVALUATED against the WHOLE batch using the
// EXPANDED set, not silently admitted/blocked using the stale narrower declaration. `receiptsById`
// is an optional `{candidateId: receiptFile}` map; a candidate with no entry (or an unreadable/
// missing receipt) is returned UNCHANGED — this never invents an expansion the caller didn't ask
// to check for, matching the Prepared gate's own opt-in posture (DIR-117's back-compat rule).
export function loadReceiptTouches(receiptFile) {
  if (!receiptFile || !fs.existsSync(receiptFile)) return null;
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
    return Array.isArray(receipt.touches) ? receipt.touches : null;
  } catch {
    return null;
  }
}

export function applyPreparationExpansion(candidates, receiptsById) {
  if (!receiptsById) return { candidates, expansions: [] };
  const expansions = [];
  const expanded = candidates.map((c) => {
    const receiptFile = receiptsById[c.id];
    const receiptTouches = loadReceiptTouches(receiptFile);
    if (!receiptTouches) return c;
    const { expanded: newPaths } = computeTouchesExpansion(receiptTouches, c.touches.globs);
    if (newPaths.length === 0) return c;
    expansions.push({ id: c.id, addedGlobs: newPaths });
    return { ...c, touches: { ...c.touches, globs: [...c.touches.globs, ...newPaths] } };
  });
  return { candidates: expanded, expansions };
}

function isLearning(type) {
  // Conservative: any type MENTIONING "learning" (not only a leading token) is treated as learning
  // and never batched — hardening from the DIR-044 increment-4 audit (a "…-learning" type must not
  // sneak into a batch).
  return /learning/i.test(String(type));
}

// checkTouchesPair(x, x) returns disjoint:false with reason "overlapping file-sets" (a set overlaps
// itself). That self-overlap is expected and does NOT indicate an ill-declared candidate; a
// CONSERVATIVE reason (absent/overbroad/empty) DOES. Distinguish them.
function isSelfOverlapOnly(result) {
  return /overlapping file-sets/i.test(result.reason);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage() {
  process.stderr.write("Usage: concurrent-batch-scheduler.mjs [--root <dir>] <charter1.md> <charter2.md> [charterN.md ...]\n");
}

export async function main(argv) {
  const args = argv.slice(2);
  let root = null;
  // DIR-117 iteration-2 item 4: `--receipts id1=file1.json,id2=file2.json` — optional, maps a
  // candidate id (charter basename, no .md) to a real milestone-preparation-check.ts receipt file.
  // Omitted entirely → byte-for-behavior unchanged (golden replay for every pre-existing call).
  let receiptsById = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") { root = args[++i]; continue; }
    if (args[i] === "--receipts") {
      receiptsById = {};
      for (const pair of args[++i].split(",")) {
        const eq = pair.indexOf("=");
        if (eq > 0) receiptsById[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      }
      continue;
    }
    files.push(args[i]);
  }
  if (files.length < 1) { usage(); return 2; }
  for (const f of files) {
    if (!fs.existsSync(f)) { process.stderr.write(`ERROR: charter not found: ${f}\n`); return 2; }
  }
  const expandRoot = root ? path.resolve(root) : findRepoRoot(path.resolve(path.dirname(files[0])));
  const expand = (globs) => expandGlobs(globs, expandRoot);
  const parsedCandidates = files.map((f) => parseCandidate(path.basename(f, ".md"), fs.readFileSync(f, "utf8")));
  const { candidates, expansions } = applyPreparationExpansion(parsedCandidates, receiptsById);
  for (const e of expansions) {
    process.stdout.write(`  re-evaluated (checked Plan expanded '## Touches'): ${e.id} — +${e.addedGlobs.length} path(s): ${e.addedGlobs.join(", ")}\n`);
  }
  const r = assembleBatch(candidates, { expand });
  process.stdout.write(`BATCH (${r.batch.length}-wide, concurrent): ${r.batch.join(", ") || "(none)"}\n`);
  for (const d of r.deferred) process.stdout.write(`  deferred: ${d.id} — ${d.reason}\n`);
  // Exit 0 always (assembly succeeded); a caller inspects the batch. A 1-wide-or-empty batch is a
  // valid outcome (fully serial), not an error.
  return 0;
}

// gap-config-wiring-check-symlink-noop: same root cause as config-wiring-check.ts's fix (confirmed,
// not assumed — see that file's comment). Raw string equality between `process.argv[1]` (never
// resolved through a symlink) and `fileURLToPath(import.meta.url)` (always resolved through
// symlinks by Node's ESM loader) can never hold when this script is invoked via the
// `experiments/quay-perpetual-stream/scripts/` mirror symlink, so `main()` silently never runs.
// Resolving both sides through `fs.realpathSync` fixes the mirror path to behave identically to
// the real path instead of silently no-opping.
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    const invokedReal = fs.realpathSync(path.resolve(process.argv[1]));
    const moduleReal = fileURLToPath(import.meta.url);
    return invokedReal === moduleReal;
  } catch {
    return false;
  }
}

const isDirect = isDirectInvocation();
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
