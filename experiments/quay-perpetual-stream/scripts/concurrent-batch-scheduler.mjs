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
} from "./touches-orthogonality-check.mjs";

// Shared exp5 state — concurrent writes here would conflict, so any candidate declaring it CANNOT be
// batched (its writes must be serialized at fan-in ABSORB). Repo-relative concrete paths.
export const SHARED_STATE_PATHS = [
  "experiments/quay-perpetual-stream/dashboard.md",
  "experiments/quay-perpetual-stream/backlog.md",
  "experiments/quay-perpetual-stream/v-meta-ledger.md",
  "experiments/quay-perpetual-stream/.quay/gate-events.jsonl",
];

// ── parseCandidate ───────────────────────────────────────────────────────────────────────────────
// A candidate = its id + declared `## Touches` + its milestone type (execution | learning | …).
// Type is read from a `**type:** <t>` or `type: <t>` line; defaults to "execution".
export function parseCandidate(id, charterText) {
  const touches = parseTouches(charterText);
  let type = "execution";
  // Tolerates `type: x`, `**type:** x` (colon inside bold), and `**type**: x`.
  const m = String(charterText).match(/^\s*\*{0,2}type\*{0,2}\s*:\s*\*{0,2}\s*`?([a-z][\w-]*)/im);
  if (m) type = m[1].toLowerCase();
  return { id, touches, type };
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
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") { root = args[++i]; continue; }
    files.push(args[i]);
  }
  if (files.length < 1) { usage(); return 2; }
  for (const f of files) {
    if (!fs.existsSync(f)) { process.stderr.write(`ERROR: charter not found: ${f}\n`); return 2; }
  }
  const expandRoot = root ? path.resolve(root) : findRepoRoot(path.resolve(path.dirname(files[0])));
  const expand = (globs) => expandGlobs(globs, expandRoot);
  const candidates = files.map((f) => parseCandidate(path.basename(f, ".md"), fs.readFileSync(f, "utf8")));
  const r = assembleBatch(candidates, { expand });
  process.stdout.write(`BATCH (${r.batch.length}-wide, concurrent): ${r.batch.join(", ") || "(none)"}\n`);
  for (const d of r.deferred) process.stdout.write(`  deferred: ${d.id} — ${d.reason}\n`);
  // Exit 0 always (assembly succeeded); a caller inspects the batch. A 1-wide-or-empty batch is a
  // valid outcome (fully serial), not an error.
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
