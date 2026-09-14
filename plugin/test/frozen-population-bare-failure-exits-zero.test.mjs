// @test-group engine
// frozen-population-bare-failure-exits-zero.test.mjs — the FROZEN-POPULATION regression pin for AC-241
// (tasks/gap-ac241-frozen-bare-failure-exits-have-no-owner, GOAL-009 AC-241).
//
// ── WHAT THIS PINS, AND WHY A NEW FILE RATHER THAN ANOTHER CASE IN THE EXISTING ONE ─────────────────
// The existing criterion-failure-attribution-check.test.mjs pins the DETECTOR and the shrink-only
// RATCHET. Both were already correct when AC-241 regressed for the FIFTH time on 2026-09-14T04:53:40Z.
// AC-179 was IN the ratchet's `ids` list, the ratchet read `bareAcs=30 ≤ baseline 32`, `status=pass`,
// `exit 0` — and the production ledger still took an unattributable `verdict:fail`. A correct detector
// over a population nobody owns produces exactly the same green as no defect at all.
//
// So this file pins the QUANTITY the detector reports about the population, not the detector's ability
// to report: `bareAcs === 0` over the in-domain frozen population. That is a claim about the store, and
// it is the claim AC-241's invariant actually needs.
//
// ── WHY THE FOUR PREVIOUS `done` TASKS (all claiming goal_ac: AC-241) DID NOT HOLD ──────────────────
// Each one closed a real hole, and each one was on a DIFFERENT face than the one that kept failing:
//   1. gap-goal-criteria-bare-failing-exit-unattributable  — built the detector + the shrink-only
//      ratchet (baseline 32). DETECTION face.
//   2. gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit   — widened the predicate to
//      the trailing computed form. DETECTION face.
//   3. gap-criterion-attribution-blind-to-silent-terminal-command          — widened it again to the
//      implicit-exit class (a criterion with no `exit` inherits its status). DETECTION face.
//   4. gap-criterion-attribution-write-gate-at-birth                      — refused such a criterion at
//      the goal-store WRITE surface. BIRTH face.
// None of them could touch AC-179, and the reason is structural, not an oversight:
//   · (1)–(3) are moot: AC-179 was ALREADY detected — it is in `ids`, and it is in the committed
//     baseline. No improvement to a detector changes the disposition of a criterion it already sees.
//   · (4) is moot for the same reason from the other side: the write gate only judges a criterion
//     being WRITTEN. AC-179's criterion was written long ago; on UPDATE the gate is shrink-only
//     ("may not get worse"), and nothing in it ever requires an existing record to get BETTER.
//   · The ratchet's baseline is an explicit EXEMPTION LIST. `criterion-failure-attribution-check.ts`
//     and `goal-store.ts` both say so verbatim ("⛔ 故意不是零目标"). A member of that list has no
//     repair path at all — being ≤ baseline is the whole of what is asked of it.
// ⇒ The residual was never a detection gap or a birth gap. It was the 30-record EXISTING population,
// which had no owner. (The same shape as hard rule 4 推论三: an AC satisfied only by a fixture proves
// "can produce", not "did produce" — and here, a ratchet satisfied only by exemptions proves nothing
// about the exempt ones.)
//
// ── WHY THE `frozen-violated` OWNER OF AC-179 IS NOT THIS OWNER ─────────────────────────────────────
// `.quay/goal-round.jsonl` round 23 (2026-09-14T04:51:55Z) recorded, verbatim:
//   "frozenFailing":{"failing":["AC-179"],"judgment":"violated","cause":null,"frozenScope":77}
//   {"goal":"GOAL-001","ac":"AC-179","state":"frozen-violated","taskCount":0}
// so AC-179's TRUTH did have an owner — `computeGoalGaps`'s frozen-violated branch spawned
// `gap-ac179-criterion-cold-miss-30s-ttl-always-expired`, which is the task that repairs the
// dashboard's cold-build latency. That task repairs the TRUTH and cannot repair the ATTRIBUTION: its
// own DoD pins `goals/AC-179-*.md`'s criterion verbatim ("AC-179 criterion 逐字不改"), and its own
// Finding states that any fixed latency cap eventually flips again under host load. So its landing
// makes AC-241 green for a while and then red again on the next load spike — a LIVELOCK, not a
// convergence, with one unattributable `verdict:fail` written to the append-only ledger per cycle.
// This task deletes the DEPENDENCE: after it, AC-179 may still fail, and the ledger's tail event for
// it is an ATTRIBUTABLE fail that names /dashboard and `id="goal-card"`. AC-241 then stops being a
// function of host load. Both tasks are needed; they are not duplicates (different `## Touches`:
// that one does not touch goals/AC-179-*.md, and this one does not touch the dashboard).
//
// ── THE FALSIFICATION (hard rule 4 / 硬规则 3b) ─────────────────────────────────────────────────────
// "The set is empty" is a claim that a GREEN-ONLY test cannot distinguish from "the question was never
// asked". So the second test builds a synthetic workspace holding ONE criterion with a bare
// `sys.exit(1)`, points the SAME CLI at it with a count-0 baseline, and requires exit ≠ 0. The third
// test is the opposite control (a criterion whose failure exit writes a cause stays green), so this
// file cannot pass by being an always-red detector.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { enumerateBareFailureExits, readBaseline } from "../scripts/criterion-failure-attribution-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "plugin/scripts/criterion-failure-attribution-check.ts");
const BASELINE_REL = "docs/analysis/criterion-failure-attribution.baseline.json";

const tmpDirs = [];
function mkTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** Drive the REAL CLI the ratchet uses, against an arbitrary root. */
function runCli(root, extraArgs = []) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CLI, "--root", root, "--json", ...extraArgs],
    { encoding: "utf8" },
  );
}

/** Build a fixture workspace: `goals/<id>-fixture.md` per entry + a count-N baseline. */
function mkFixture(entries, baselineCount) {
  const root = mkTmp("frozen-bare-");
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs/analysis"), { recursive: true });
  for (const [id, criterion] of entries) {
    fs.writeFileSync(
      path.join(root, `goals/${id}-fixture.md`),
      ["---", `id: ${id}`, `title: fixture ${id}`, "status: active", "kind: criterion", "criterion: |",
        ...criterion.split("\n").map((l) => "  " + l), "---", ""].join("\n"),
    );
  }
  fs.writeFileSync(
    path.join(root, BASELINE_REL),
    JSON.stringify(
      { count: baselineCount, inDomain: entries.length, entries: [], generatedAt: "2026-09-14T00:00:00.000Z" },
      null, 2,
    ) + "\n",
  );
  return root;
}

// ── 1. THE PIN: the in-domain frozen population carries ZERO bare failure exits ─────────────────────

test("the frozen population carries ZERO bare failure exits (bareAcs === 0), and the committed baseline anchors it at 0", () => {
  const r = runCli(REPO_ROOT);
  assert.equal(
    r.status, 0,
    `the real repo must pass its own ratchet: exit=${r.status} stdout=${r.stdout} stderr=${r.stderr}`,
  );
  const out = JSON.parse(r.stdout);
  assert.equal(out.evaluated ?? true, true, "the enumeration must be evaluable (硬规则 3b: unreadable ≠ empty)");
  assert.ok(out.inDomain > 0, "the enumeration must have read a non-empty in-domain set");
  // THE claim this file exists for. Not "≤ baseline" — ZERO. `≤ baseline` was already true, five times,
  // while AC-241 regressed.
  assert.equal(
    out.bareAcs, 0,
    `the frozen population still carries bare failure exits: ${JSON.stringify(out.ids)} — every one of them can write an unattributable verdict:fail into the append-only ledger`,
  );
  assert.deepEqual(out.ids, [], "…and the enumeration confirms it by naming no id");
  // Independent read of the same tree through the library entry point — the CLI's number must be a LIVE
  // enumeration, not a constant (hard rule 4b: a quantity produced by the thing under test cannot judge it).
  const live = enumerateBareFailureExits(path.join(REPO_ROOT, "goals"));
  assert.equal(live.evaluated, true, "the direct enumeration must be evaluable");
  assert.equal(out.bareAcs, live.bareAcs.length, "the CLI count must equal a direct enumeration of goals/");
  // …and the committed artifact must anchor that at 0, so a NEW bare exit cannot hide behind a stale
  // allowance. (This is the assertion that would have caught the exemption list for what it was.)
  const committed = readBaseline(path.join(REPO_ROOT, BASELINE_REL));
  assert.ok(committed, `the committed baseline must exist and be well-shaped (${BASELINE_REL})`);
  assert.equal(
    committed.count, 0,
    `the committed baseline must be 0, not an exemption list (got ${committed.count}; entries=${JSON.stringify(committed.entries.map((e) => e.id))})`,
  );
});

// ── 2. THE FALSIFICATION: the SAME assertion must go RED on a synthetic bare criterion ─────────────

test("FALSIFICATION — one synthetic bare criterion makes the identical assertion exit non-zero", () => {
  // The real population is empty ⇒ the assertion above is trivially satisfiable by an input the checker
  // cannot read, or by a checker that stopped reporting. Drive the SAME CLI on an input that IS bare.
  const bare = "import sys\nsys.exit(1)";
  const root = mkFixture([["AC-900", bare]], 0);
  const r = runCli(root);
  assert.notEqual(
    r.status, 0,
    `a synthetic criterion carrying a bare sys.exit(1) MUST make the checker red against a count-0 baseline; got exit=0 stdout=${r.stdout}`,
  );
  const out = JSON.parse(r.stdout);
  assert.equal(out.bareAcs, 1, "the fixture's bare criterion must be counted (the red must be for the right reason)");
  assert.deepEqual(out.ids, ["AC-900"], "…and named, not merely counted");
  // And the failure is a FAIL (1), not NOT-EVALUATED (3) — the two must stay pairwise distinct (硬规则 3b).
  assert.equal(r.status, 1, `want exit 1 (FAIL), got ${r.status} — a red for the wrong reason is not this control`);
});

// ── 3. THE OPPOSITE CONTROL: an attributable criterion stays GREEN ─────────────────────────────────

test("OPPOSITE CONTROL — a criterion whose failure exit writes a cause stays green", () => {
  // Without this, test 2 could pass because the checker reports EVERYTHING (an always-red detector).
  const attributable = [
    "import sys",
    'if not _ok: sys.stderr.write("AC-901 fail - synthetic cause naming the subject\\n"); sys.exit(1)',
  ].join("\n");
  const root = mkFixture([["AC-901", attributable]], 0);
  const r = runCli(root);
  assert.equal(r.status, 0, `an attributable failure exit must stay green; got exit=${r.status} stdout=${r.stdout}`);
  assert.equal(JSON.parse(r.stdout).bareAcs, 0, "…and must not be counted");
});
