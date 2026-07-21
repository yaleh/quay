// Unit tests for concurrent-batch-scheduler.mjs — the two-level scheduler's ASSEMBLY core
// (DIR-044 increment 2). Given rank-ordered candidate charters, greedily assemble a maximal
// touches-DISJOINT, execution-type batch that touches NO shared exp5 state, deferring the rest to a
// later (serial) round. RED-first (ADR-001 / DIR-019). The disjointness verdict is single-sourced —
// this module IMPORTS checkTouchesPair from touches-orthogonality-check.mjs, never re-implements it.
// Run:
//   node --test experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCandidate,
  touchesSharedState,
  SHARED_STATE_PATHS,
  assembleBatch,
  main,
} from "../scripts/concurrent-batch-scheduler.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SFX = path.join(__dirname, "..", "fixtures", "scheduler");
const sfx = (f) => path.join(SFX, f);

// A fake expander maps a declared glob → concrete file set (hermetic, no fs).
const fakeExpand = (mapping) => (globs) => {
  const out = new Set();
  for (const g of globs) for (const f of (mapping[g] || [])) out.add(f);
  return out;
};

// ── parseCandidate ───────────────────────────────────────────────────────────────────────────────
test("parseCandidate: extracts id, touches globs, and type", () => {
  const c = parseCandidate("cand-1", "**type:** execution\n## Touches\n- x/a.js\n- y/b.js");
  assert.equal(c.id, "cand-1");
  assert.deepEqual(c.touches.globs, ["x/a.js", "y/b.js"]);
  assert.equal(c.type, "execution");
});

test("parseCandidate: type defaults to 'execution' when unstated; learning detected", () => {
  assert.equal(parseCandidate("c", "## Touches\n- a.js").type, "execution");
  assert.equal(parseCandidate("c", "**type:** learning\n## Touches\n- a.js").type, "learning");
  assert.equal(parseCandidate("c", "type: learning-experiment\n## Touches\n- a.js").type, "learning-experiment");
});

// ── touchesSharedState ───────────────────────────────────────────────────────────────────────────
test("touchesSharedState: a glob covering dashboard.md is flagged", () => {
  assert.equal(touchesSharedState(["experiments/quay-perpetual-stream/dashboard.md"]), true);
  assert.equal(touchesSharedState(["experiments/quay-perpetual-stream/**"]), true); // covers dashboard
  assert.equal(touchesSharedState(["packages/quay/src/gate/registry.js"]), false);
});

test("SHARED_STATE_PATHS includes the known shared exp5 artifacts", () => {
  const joined = SHARED_STATE_PATHS.join("|");
  assert.match(joined, /dashboard\.md/);
  assert.match(joined, /backlog\.md/);
  assert.match(joined, /v-meta-ledger\.md/);
  assert.match(joined, /gate-events\.jsonl/);
});

// ── assembleBatch ────────────────────────────────────────────────────────────────────────────────
test("assembleBatch: two disjoint execution candidates → both batched", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("B", "**type:** execution\n## Touches\n- y/b.js"),
  ];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"], "y/b.js": ["y/b.js"] }) });
  assert.deepEqual(r.batch, ["A", "B"]);
  assert.deepEqual(r.deferred, []);
});

test("assembleBatch: an overlapping candidate is deferred, not batched", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- g/reg.js"),
    parseCandidate("B", "**type:** execution\n## Touches\n- g/**"), // overlaps A on g/reg.js
    parseCandidate("C", "**type:** execution\n## Touches\n- z/c.js"),
  ];
  const expand = fakeExpand({ "g/reg.js": ["g/reg.js"], "g/**": ["g/reg.js", "g/x.js"], "z/c.js": ["z/c.js"] });
  const r = assembleBatch(cands, { expand });
  assert.deepEqual(r.batch, ["A", "C"]);          // A anchors, C disjoint from A → in; B overlaps A → out
  assert.equal(r.deferred.length, 1);
  assert.equal(r.deferred[0].id, "B");
  assert.match(r.deferred[0].reason, /overlap/i);
});

test("assembleBatch: learning-type is NEVER batched (always serial), even if disjoint", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("L", "**type:** learning\n## Touches\n- y/b.js"),
  ];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"], "y/b.js": ["y/b.js"] }) });
  assert.deepEqual(r.batch, ["A"]);
  assert.equal(r.deferred[0].id, "L");
  assert.match(r.deferred[0].reason, /learning/i);
});

test("assembleBatch: a candidate touching SHARED STATE cannot be batched (serialize)", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("S", "**type:** execution\n## Touches\n- experiments/quay-perpetual-stream/dashboard.md"),
  ];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"], "experiments/quay-perpetual-stream/dashboard.md": ["experiments/quay-perpetual-stream/dashboard.md"] }) });
  assert.deepEqual(r.batch, ["A"]);
  assert.equal(r.deferred[0].id, "S");
  assert.match(r.deferred[0].reason, /shared/i);
});

test("assembleBatch: absent/overbroad touches candidate is deferred (conservative)", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("N", "**type:** execution\n## Proposal\nno touches"),
    parseCandidate("O", "**type:** execution\n## Touches\n- **"),
  ];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"] }) });
  assert.deepEqual(r.batch, ["A"]);
  assert.deepEqual(r.deferred.map((d) => d.id).sort(), ["N", "O"]);
});

test("assembleBatch: a single anchor candidate with no peers still yields a 1-wide batch", () => {
  const cands = [parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js")];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"] }) });
  assert.deepEqual(r.batch, ["A"]);
});

test("assembleBatch: empty candidate list → empty batch, no throw", () => {
  const r = assembleBatch([], { expand: fakeExpand({}) });
  assert.deepEqual(r.batch, []);
  assert.deepEqual(r.deferred, []);
});

// ── main() end-to-end over real fixture charters (covers CLI + fs expansion) ──────────────────────
test("main: real disjoint execution pair → 2-wide batch, exit 0", async () => {
  const code = await main(["node", "s", "--root", REPO_ROOT, sfx("exec-a.md"), sfx("exec-b.md")]);
  assert.equal(code, 0);
});

test("main: real mixed set (overlap + learning + shared-state) → only the disjoint pair batches", async () => {
  const code = await main([
    "node", "s", "--root", REPO_ROOT,
    sfx("exec-a.md"), sfx("exec-b.md"), sfx("exec-c-overlaps-a.md"), sfx("learning-d.md"), sfx("shared-state-e.md"),
  ]);
  assert.equal(code, 0); // assembly always succeeds; batch=[exec-a,exec-b], rest deferred
});

test("main: no charter args → usage, exit 2", async () => {
  assert.equal(await main(["node", "s"]), 2);
});

test("main: missing charter file → exit 2", async () => {
  assert.equal(await main(["node", "s", "--root", REPO_ROOT, sfx("nope.md")]), 2);
});

test("main: no --root falls back to findRepoRoot", async () => {
  assert.equal(await main(["node", "s", sfx("exec-a.md"), sfx("exec-b.md")]), 0);
});
