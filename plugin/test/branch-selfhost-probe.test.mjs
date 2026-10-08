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
//      summary were rewritten.
//   ③ THE ATTRIBUTION JUDGMENT BEHIND `production.unchanged` takes both values: a delta carrying this
//      probe's fingerprints is attributable; an ordinary foreign record line is not. Without this the
//      production check would either be permanently red (a live driver appends to the carriers while
//      the probe runs) or vacuously green.
//   ④ CRITERION ↔ PROBE FIELD PARITY. AC-337's criterion is a `node -e` snippet reading a fixed set
//      of JSON paths; the probe is the producer. Nothing else in the repo forces the two to agree, so
//      a rename on either side would silently make the criterion unsatisfiable. This reads the field
//      names OUT of the goal file itself (never a copy) and asserts the probe source carries each one.
//
// Run: node --test plugin/test/branch-selfhost-probe.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { classifyEventIdentities, probeAttributable } from "../../scripts/branch-selfhost-probe.mjs";

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
  const foreign = classifyEventIdentities(
    [event(path.join(MAIN, "packages", "quay", "src", "kernel", "task-transition.ts"), path.join(MAIN, "plugin", "scripts", "ready-pool-check.ts"))],
    ROOT,
  );
  assert.equal(foreign.ok, false, "a main-checkout writerModule must be flagged");
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
    "e.writerModule",
    "e.entry",
  ];
  for (const f of fields) {
    assert.ok(criterionText.includes(f), `AC-337's criterion must still read ${f} (test is stale if not)`);
  }
  // The probe-side tokens each of those paths resolves to. Top-level fields are assigned onto the
  // output object (`out.<name>`), nested ones appear as object-literal keys; the two event fields are
  // read off the records the kernel writes.
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
    "e.writerModule",
    "e.entry",
  ];
  for (const name of produced) {
    assert.ok(probeSource.includes(name), `the probe must still emit ${name}`);
  }
});
