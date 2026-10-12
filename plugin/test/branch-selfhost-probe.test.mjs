// @test-group lowconc
// branch-selfhost-probe.test.mjs — GOAL-030 ③ (task gap-goal030-branch-selfhost-probe).
//
// The probe (`scripts/branch-selfhost-probe.mjs`) is what AC-337 reads: it launches the BRANCH tree's
// promotion-driver and `ready-pool-check --revaluate-apply` against a /tmp sandbox and prints, among
// other things, the structured transition events whose `writerModule` / `entry` realpaths are the
// DIRECT reading of "which code ran". The criterion re-derives every verdict from that JSON — it does
// not trust the probe's own exit code.
//
// What this file pins (hermetically — it NEVER spawns a driver, so it stays cheap):
//   ① THE PROBE'S SELF-CHECK RUNS AND PASSES (`--selftest`, exit 0). `--selftest` exercises the code
//      identity comparator against INJECTED paths, two-sided: an event written by a module under the
//      MAIN checkout must be flagged, and events entirely inside THIS tree must pass.
//   ② BOTH SIDES OF THE COMPARATOR, directly (not through the CLI): so a regression that made
//      `classifyEventIdentities` answer "ok" unconditionally would fail here even if the CLI's own
//      summary were rewritten. Both SIDES of the CONTRACT are exercised too — the v0 shape (provenance
//      at the top level) and the v1 shape (nested under `producer`). These are the load-bearing arms:
//      the status-event carrier holds v1 lines, so a comparator that only knew v0 would report real
//      in-tree writes as `loaded-main-checkout-code` (硬规则 3b — "cannot read it" and "the main
//      checkout wrote it" must not share a spelling).
//   ③ THE ATTRIBUTION JUDGMENT BEHIND `production.unchanged` takes both values: a delta carrying this
//      probe's fingerprints is attributable; an ordinary foreign record line is not. Without this the
//      production check would either be permanently red (a live driver appends to the carriers while
//      the probe runs) or vacuously green.
//   ④ CRITERION ↔ PROBE FIELD PARITY. AC-337's criterion is a `node -e` snippet reading a fixed set
//      of JSON paths; the probe is the producer. Nothing else in the repo forces the two to agree, so
//      a rename on either side would silently make the criterion unsatisfiable. This reads the field
//      names OUT of the goal file itself (never a copy) and asserts the probe source carries each one.
//      The runtime arm guards the two sides agree on the CONTRACT VERSION too: a criterion that still
//      reads the v0 paths while the carrier holds v1 lines is exactly the drift this file pins.
//
// Run: node --test plugin/test/branch-selfhost-probe.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { classifyEventIdentities, provenanceOf, probeAttributable } from "../../scripts/branch-selfhost-probe.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PROBE = path.join(REPO_ROOT, "scripts", "branch-selfhost-probe.mjs");

function realpathOr(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** The sibling main checkout (dirname of the shared git dir) — the "foreign code" tree. */
function mainCheckout() {
  const out = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  if (out.status !== 0) return REPO_ROOT;
  const raw = out.stdout.trim();
  const abs = path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
  return path.dirname(realpathOr(abs));
}

const ROOT = realpathOr(REPO_ROOT);
const MAIN = realpathOr(mainCheckout());

function event(writerModule, entry) {
  return { ts: "2026-01-01T00:00:00.000Z", taskId: "x", from: "todo", to: "ready", kind: "promote", writerModule, entry };
}

/** The CONTRACT v1 shape: the SAME provenance triple, nested under `producer`. v0 kept `writerModule`/
 *  `entry` at the top level; v1 ("moves the provenance triple under `producer`",
 *  `packages/quay/src/kernel/task-transition.ts`) is what every production carrier line holds today.
 *  A comparator pinned only on the v0 shape answers `undefined` here and misreads real in-tree writes
 *  as loaded-main-checkout-code, so the v1 arms below are regression locks, not decoration. */
function v1Event(writerModule, entry) {
  return { schema: "task-status-event/v1", ts: "2026-01-01T00:00:00.000Z", taskId: "x", from: "todo", to: "ready", kind: "promote", producer: { writerModule, entry } };
}

test("--selftest exits 0 (the probe's own two-sided identity check)", () => {
  const r = spawnSync(process.execPath, ["--no-warnings", PROBE, "--selftest"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(r.status, 0, `--selftest must pass; stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stdout, /SELFTEST PASS/);
});

test("identity comparator flags main-checkout code and accepts in-tree code", () => {
  // (a) a writerModule under the MAIN checkout is NOT this tree's code.
  // ⛔ On a linked-worktree checkout the REAL main checkout is the meaningful foreign root — it is
  // the actual branch-self-host scenario. But in CI the checkout IS its own main checkout
  // (measured `root=/_work/quay/quay main=/_work/quay/quay`), so `MAIN === ROOT` and injecting it
  // makes the "foreign" path an IN-TREE one: the arm proved nothing and red-ed CI. Fall back to a
  // synthetic root, which is distinct from ROOT on every host — the assertion still runs
  // everywhere (never skipped into vacuity), and on a developer checkout it still exercises the
  // real main-checkout path.
  const synthetic = MAIN === ROOT ? realpathOr(fs.mkdtempSync(path.join(os.tmpdir(), "bsp-foreign-"))) : null;
  const foreignRoot = synthetic ?? MAIN;
  try {
    // (a) a writerModule under the MAIN checkout is NOT this tree's code.
    const foreign = classifyEventIdentities(
      [event(path.join(foreignRoot, "packages", "quay", "src", "kernel", "task-transition.ts"), path.join(foreignRoot, "plugin", "scripts", "ready-pool-check.ts"))],
      ROOT,
    );
    assert.equal(foreign.ok, false, "a writerModule outside this tree must be flagged");
    assert.equal(foreign.bad.length, 1);

    // (b) every path inside THIS tree passes.
    const inTree = classifyEventIdentities(
      [event(path.join(ROOT, "packages", "quay", "src", "kernel", "task-transition.ts"), path.join(ROOT, "plugin", "scripts", "ready-pool-check.ts"))],
      ROOT,
    );
    assert.equal(inTree.ok, true, JSON.stringify(inTree.bad));

    // (c) 硬规则 3b — an absent provenance (null entry) must NOT be silently accepted as in-tree.
    const noEntry = classifyEventIdentities([event(path.join(ROOT, "packages", "quay", "src", "kernel", "task-transition.ts"), null)], ROOT);
    assert.equal(noEntry.ok, false, "a null entry must not read as in-tree");

    // (d) CONTRACT v1 — the provenance triple is nested under `producer`. Both directions, because a
    //     v0-only reader reads `undefined` here: the in-tree arm would go RED (a real in-tree write
    //     reported as main-checkout code) and the foreign arm would have passed for the wrong reason.
    const v1InTree = classifyEventIdentities(
      [v1Event(path.join(ROOT, "packages", "quay", "src", "kernel", "task-transition.ts"), path.join(ROOT, "plugin", "scripts", "ready-pool-check.ts"))],
      ROOT,
    );
    assert.equal(v1InTree.ok, true, `a v1 (producer) in-tree event must pass: ${JSON.stringify(v1InTree.bad)}`);
    const v1Foreign = classifyEventIdentities(
      [v1Event(path.join(foreignRoot, "packages", "quay", "src", "kernel", "task-transition.ts"), path.join(foreignRoot, "plugin", "scripts", "ready-pool-check.ts"))],
      ROOT,
    );
    assert.equal(v1Foreign.ok, false, "a v1 producer outside this tree must be flagged");
    assert.equal(v1Foreign.bad.length, 1);

    // (e) 硬规则 3b on the v1 branch too: an unreadable provenance stays RED, never "in tree".
    assert.equal(classifyEventIdentities([{ schema: "task-status-event/v1", from: "todo", to: "ready", kind: "promote" }], ROOT).ok, false, "a v1 record with no producer must not read as in-tree");
    assert.equal(classifyEventIdentities([v1Event(path.join(ROOT, "x.ts"), null)], ROOT).ok, false, "a v1 null entry must not read as in-tree");

    // (f) the version dispatch itself, directly — the two shapes must resolve to the SAME pair.
    assert.deepEqual(provenanceOf(event("/a/w.ts", "/a/p.ts")), { writerModule: "/a/w.ts", entry: "/a/p.ts" });
    assert.deepEqual(provenanceOf(v1Event("/b/w.ts", "/b/p.ts")), { writerModule: "/b/w.ts", entry: "/b/p.ts" });
    assert.deepEqual(provenanceOf({ schema: "task-status-event/v1" }), { writerModule: undefined, entry: undefined });
    assert.deepEqual(provenanceOf(null), { writerModule: undefined, entry: undefined });
  } finally {
    if (synthetic != null) fs.rmSync(synthetic, { recursive: true, force: true });
  }
});

test("production attribution takes both values", () => {
  const sandbox = "/tmp/branch-selfhost-probe-abcdef";
  const markers = [sandbox, "bsp-run-1", "bsp-todo-alpha"];
  // (a) a record naming this probe's sandbox / run / tasks IS attributable to the probe.
  assert.equal(
    probeAttributable(JSON.stringify({ root: sandbox, applied: [{ id: "bsp-todo-alpha" }] }) + "\n", markers),
    true,
  );
  assert.equal(probeAttributable(JSON.stringify({ run_id: "bsp-run-1" }) + "\n", markers), true);
  // (b) an ordinary foreign producer's record (a live driver appending to its own round log) is NOT.
  const foreignLine = JSON.stringify({ ts: "2026-10-08T00:00:00.000Z", round: 5, run_id: "pm-123", pid: 42, action: "promote" }) + "\n";
  assert.equal(probeAttributable(foreignLine, markers), false);
  // (c) the empty delta (byte-identical file) is never attributable.
  assert.equal(probeAttributable("", markers), false);
});

test("AC-337's criterion fields are all produced by the probe", () => {
  const goalFile = fs.readdirSync(path.join(REPO_ROOT, "goals")).find((f) => f.startsWith("AC-337") && f.endsWith(".md"));
  assert.ok(goalFile, "goals/AC-337-*.md must exist — this test reads the criterion from it, never a copy");
  const criterionText = fs.readFileSync(path.join(REPO_ROOT, "goals", goalFile), "utf8");
  const probeSource = fs.readFileSync(PROBE, "utf8");

  // The JSON paths the criterion dereferences (its `node -e` reader). Every name must appear in the
  // probe's source, otherwise the two sides have drifted and the criterion can no longer be met.
  // The four event paths come in ONE v0/v1 pair — the criterion resolves the provenance through the
  // version dispatch (`schema` present ⇒ `producer`, absent ⇒ the top level), so both halves of the
  // pair must exist on both sides or one record shape silently reads as `undefined`.
  const fields = [
    "J.root",
    "J.events",
    "J.promotion",
    "J.promotion.flips",
    "J.promotion.childResolution",
    "J.revaluation",
    "J.revaluation.flips",
    "J.negativeControl",
    "J.production",
    "J.production.unchanged",
    "J.env",
    "J.env.QUAY_PLUGIN_ROOT",
    "e.schema",
    "e.producer",
    "p.writerModule",
    "p.entry",
    "e.writerModule",
    "e.entry",
  ];
  for (const f of fields) {
    assert.ok(criterionText.includes(f), `AC-337's criterion must still read ${f} (test is stale if not)`);
  }
  // The probe-side tokens each of those paths resolves to. Top-level fields are assigned onto the
  // output object (`out.<name>`), nested ones appear as object-literal keys; the event paths are the
  // version dispatch inside `provenanceOf`.
  const produced = [
    "out.root",
    "out.events",
    "out.promotion",
    "out.revaluation",
    "out.negativeControl",
    "out.production",
    "childResolution:",
    "flips:",
    "unchanged",
    "QUAY_PLUGIN_ROOT",
    "mainHasModule",
    "evaluated",
    "e.schema",
    "e.producer",
    "p.writerModule",
    "p.entry",
    "e.writerModule",
    "e.entry",
  ];
  for (const name of produced) {
    assert.ok(probeSource.includes(name), `the probe must still emit ${name}`);
  }
});
