// @test-group engine
// suite-bucket-hub-list.test.mjs — gap-ac122-suite-bucket-hub-list-full-suite (AC1/AC2/AC3).
//
// The "suite 三桶划分" phase's HUB fallback: an EXPLICIT hub-file list + the judgment "a change
// touching ANY hub file ⇒ FULL suite unconditionally (no precise fan-out)". This is the AC122
// counterpart to AC120's test→bucket attribution (suite-bucket-attribution.ts) and AC121's per-test
// re-attribution — a DIFFERENT axis: those attribute TESTS to buckets; this lists HUB FILES whose
// touch forces the full suite regardless of which bucket the touched files would otherwise select.
//
// AC1 — the list is an EXPLICIT data array (non-heuristic), anchored to manager-phase-goal AC122's
//       "至少含" members: scripts/test.sh, full-suite-runner.ts, runner-grouping*, select-tests-for-touches.ts.
// AC2 — touching any hub file ⇒ fullSuite:true, and the decision NEVER computes a fan-out subset
//       (the fan-out is a later concern, AC124 — this module only answers the hub question).
// AC3 — replay REAL done tasks whose ## Touches hit a hub file: 0 false negatives (every one judged
//       full-suite). The derivation uses a TEST-LOCAL pattern (independent of the implementation's
//       HUB_FILES) so a dropped member can't silently shrink the replay set and pass by tautology.
//
// Note on AC3's count: the phase-goal baseline names "22 含 H 枢纽" as a COUNT over a 7-DAY
// "翻 done" window, not a list. This test enumerates the FULL done-task store (the reproducible,
// complete superset) and asserts the invariant — ZERO false negatives — rather than hardcoding a
// window-dependent 22. The count is reported (asserted non-empty), not papered over.
//
// Run: scripts/test.sh plugin/test/suite-bucket-hub-list.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HUB_FILES,
  hubDecision,
  isHubFile,
  touchesHub,
  hubEntryToRegExp,
} from "../scripts/suite-bucket-hub-list.ts";
import { extractTouchesSection, parseTouchEntries } from "../scripts/touches-parser.ts";

// Repo root, derived from this test file's own location (plugin/test/ → up two levels). Deterministic,
// independent of `.quay/config.yml` (gitignored and absent from a fresh worktree).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TASKS_DIR = path.join(ROOT, "tasks");

// ── AC1: the explicit list ───────────────────────────────────────────────────────────────────────────

test("AC1: HUB_FILES is an explicit list containing the 4 anchored members", () => {
  assert.ok(Array.isArray(HUB_FILES) && HUB_FILES.length >= 4, "HUB_FILES must be a non-empty array");
  for (const member of [
    "scripts/test.sh",
    "plugin/scripts/full-suite-runner.ts",
    "plugin/scripts/runner-grouping*",
    "plugin/scripts/select-tests-for-touches.ts",
  ]) {
    assert.ok(HUB_FILES.includes(member), `HUB_FILES must contain the anchored member: ${member}`);
  }
});

// ── AC2: touch any hub ⇒ full suite, no fan-out ─────────────────────────────────────────────────────

test("AC2: a change touching any hub file is judged full-suite", () => {
  // Each anchored member, plus the glob's expansion, is a hub.
  for (const hub of [
    "scripts/test.sh",
    "plugin/scripts/full-suite-runner.ts",
    "plugin/scripts/runner-grouping.ts", // glob expansion (no concrete file exists yet)
    "plugin/scripts/runner-grouping-helpers.ts", // glob expansion
    "plugin/scripts/select-tests-for-touches.ts",
  ]) {
    assert.equal(isHubFile(hub), true, `${hub} must be a hub file`);
  }

  const d = hubDecision(["plugin/scripts/ready-pool-check.ts", "scripts/test.sh"]);
  assert.equal(d.fullSuite, true, "touching scripts/test.sh ⇒ full suite");
  assert.deepEqual(d.hubMatches, ["scripts/test.sh"], "the reason is the hub match, not a fan-out subset");

  assert.equal(touchesHub(["plugin/scripts/full-suite-runner.ts"]), true);
  assert.equal(touchesHub(["plugin/scripts/select-tests-for-touches.ts", "plugin/scripts/foo.ts"]), true);
});

test("AC2: a non-hub change is NOT full-suite (proceeds to fan-out, a later concern)", () => {
  assert.equal(isHubFile("plugin/scripts/ready-pool-check.ts"), false);
  assert.equal(isHubFile("docs/proposals/quay-proposal.md"), false);
  assert.equal(hubDecision(["plugin/scripts/ready-pool-check.ts"]).fullSuite, false);
  assert.equal(touchesHub(["docs/proposals/foo.md", "tasks/bar.md"]), false);
});

test("AC2 negative control: the decision never computes a fan-out subset", () => {
  // A change touching a hub PLUS product/mechanism files returns fullSuite:true with ONLY the hub(s)
  // listed as the reason — it never enumerates buckets or a test subset (that would be precise fan-out,
  // which AC122 forbids here).
  const d = hubDecision([
    "packages/quay/src/gate/lifecycle.ts",
    "plugin/scripts/full-suite-runner.ts",
    "plugin/scripts/ready-pool-check.ts",
  ]);
  assert.equal(d.fullSuite, true);
  assert.deepEqual(d.hubMatches, ["plugin/scripts/full-suite-runner.ts"]);
});

// ── unit surface: the glob compiler ──────────────────────────────────────────────────────────────────

test("AC1 unit: hubEntryToRegExp escapes metacharacters and maps * to a wildcard", () => {
  assert.equal(hubEntryToRegExp("scripts/test.sh").test("scripts/test.sh"), true);
  assert.equal(hubEntryToRegExp("scripts/test.sh").test("scripts/testXsh"), false);
  assert.equal(hubEntryToRegExp("plugin/scripts/runner-grouping*").test("plugin/scripts/runner-grouping.ts"), true);
  assert.equal(hubEntryToRegExp("plugin/scripts/runner-grouping*").test("plugin/scripts/xrunner-grouping.ts"), false);
  // a dot is literal, not a regex wildcard
  assert.equal(hubEntryToRegExp("scripts/test.sh").test("scripts/testash"), false);
});

// ── AC3: replay real "含 H 枢纽" tasks (0 false negatives) ──────────────────────────────────────────

// TEST-LOCAL hub pattern (hardcoded from the phase-goal, NOT imported from the implementation). The
// replay set is derived with THIS so a member dropped from HUB_FILES still keeps those tasks in the set
// and the assertion below fails — i.e. the replay is not a tautology of the implementation's own list.
const HUB_PATTERN_BY_SPEC =
  /^(scripts\/test\.sh|plugin\/scripts\/full-suite-runner\.ts|plugin\/scripts\/runner-grouping.*|plugin\/scripts\/select-tests-for-touches\.ts)$/;

function isHubBySpec(rel) {
  return HUB_PATTERN_BY_SPEC.test(rel);
}

/** Enumerate done tasks whose ## Touches hits a hub file (by the independent spec pattern). */
function enumerateHubTasks() {
  const out = [];
  for (const f of fs.readdirSync(TASKS_DIR)) {
    if (!f.endsWith(".md")) continue;
    const text = fs.readFileSync(path.join(TASKS_DIR, f), "utf8");
    if (!/^status:\s*done\s*$/m.test(text)) continue;
    const entries = parseTouchEntries(extractTouchesSection(text).section);
    if (entries.length === 0) continue;
    const hubHits = entries.filter(isHubBySpec);
    if (hubHits.length > 0) out.push({ id: f.replace(/\.md$/, ""), touches: entries, hubHits });
  }
  return out;
}

test("AC3: every done task touching a hub file is judged full-suite (0 false negatives)", () => {
  const hubTasks = enumerateHubTasks();
  // Non-vacuous: a hub list that matches no real task is a red flag (the whole point is that hubs
  // fan out to real tasks).
  assert.ok(hubTasks.length > 0, "the hub-replay set must be non-empty");
  for (const t of hubTasks) {
    assert.equal(
      touchesHub(t.touches),
      true,
      `${t.id}: touches ${JSON.stringify(t.hubHits)} — must be judged full-suite`,
    );
  }
});

test("AC3 named fixtures: concrete hub-touching tasks replay as full-suite", () => {
  for (const id of [
    "gap-ac74-serial-lowconc-literal-direct-path", // touches scripts/test.sh + full-suite-runner.ts
    "gap-ac101-lane-concurrency-control-round", // touches scripts/test.sh + full-suite-runner.ts
    "gap-ac101-suite-under-600s", // touches scripts/test.sh
    "gap-ac84-suite-source-starvation-reader-disposition", // touches full-suite-runner.ts
  ]) {
    const file = path.join(TASKS_DIR, `${id}.md`);
    if (!fs.existsSync(file)) continue; // task archived/renamed — skip, not a hub-list defect
    const text = fs.readFileSync(file, "utf8");
    const entries = parseTouchEntries(extractTouchesSection(text).section);
    assert.equal(touchesHub(entries), true, `${id}: a known hub-touching task must be full-suite`);
  }
});
