// @test-group engine
// ready-pool-check.test.mjs — the ready-pool maintenance mechanism
// (tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism). Promotion cadence used to
// live in an outer's VOLUNTARY AC-queue (role volition, lost on session/model change); this test
// pins the PRODUCT mechanism: computing the REAL ready pool (excluding not-yet-flipped / fixture /
// PARKED), reporting dispatchable_disjoint (the largest mutually-disjoint pool subset via
// checkTouchesPair) as the CRITERION, and recommending todo→ready promotions in a DEFINED order
// (touch-disjointness FIRST vs the pool + in-flight, then gap-* > DIR-*, then touches-resolve
// first) when pool < floor (= cap × 4, default 20 — dispatch single source).
//
// AC1 floor = cap × 4 (20 at cap 5, configurable) · AC2 dispatchable_disjoint via checkTouchesPair
// AC3 pool-big-but-all-colliding self-report + no-false-report-on-criterion-met · AC4 disjointness
//   ranks before kind, incl. in-flight · AC5 touchesResolve guard kept · AC6 cost asymmetry doc
// AC7 real use · AC8 node:test + @test-group engine
//
// Run: scripts/test.sh plugin/test/ready-pool-check.test.mjs

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 17/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { BLOCKING_WEIGHT, PREREQ_BODY, PREREQ_KEYWORD_RE, PRE_EDGE_AC207_SNIPPET, SUITE_BLOCKING_WEIGHT, __dirname, analyzeTasks, assert, fourArtifactBody, fs, makeWorkspace, path, prosePrereqGap, withSelfTouch, writeRounds, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("analyzeTasks: suite-blocking jumps ready_relevance; negative control unchanged (AC2/AC3/AC4)", (t) => {
  const root = makeWorkspace("suiteblock");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-plain-ready", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/plain.ts (new)"] }) });
  writeTask(root, "gap-watchdog", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/wd.ts (new)"] }) });

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };

  // AC4 negative control FIRST: no verification-round / state file ⇒ no signal ⇒ ordering unchanged.
  // Both tasks are plain 1-touch ready tasks (value 1); alphabetical id tie-break puts gap-plain-ready
  // first.
  const before = analyzeTasks(opts);
  assert.equal(before.suite_blocking.window_active, false);
  assert.deepEqual(before.suite_blocking.tasks, []);
  assert.deepEqual(
    before.ready_relevance.map((e) => e.id),
    ["gap-plain-ready", "gap-watchdog"],
    "no red window ⇒ pre-signal ordering (id tie-break)",
  );
  for (const e of before.ready_relevance) assert.equal(e.blocking_suite, false);

  // AC2/AC3: a 3-consecutive-red window whose failures hit the watchdog task's Touches.
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 210 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] })));
  const after = analyzeTasks(opts);
  assert.equal(after.suite_blocking.window_active, true);
  assert.equal(after.suite_blocking.consecutive_red, 3);
  assert.deepEqual(after.suite_blocking.failure_files, ["code/wd.ts"]);
  assert.deepEqual(after.suite_blocking.tasks, ["gap-watchdog"], "only the Touches-hitting task is suite-blocking");
  const watchdog = after.ready_relevance.find((e) => e.id === "gap-watchdog");
  assert.equal(watchdog.blocking, true, "suite-blocking flips blocking true in ready_relevance");
  assert.equal(watchdog.blocking_suite, true);
  assert.equal(watchdog.value, BLOCKING_WEIGHT + SUITE_BLOCKING_WEIGHT + 1);
  assert.equal(after.ready_relevance[0].id, "gap-watchdog", "suite-blocker jumps to the front of the ready pool ranking");
  assert.equal(after.ready_relevance.find((e) => e.id === "gap-plain-ready").blocking_suite, false, "unrelated task stays unflagged");

  // negative: last round green clears the window ⇒ ordering back to the pre-signal tie-break.
  writeRounds(root, [
    ...Array.from({ length: 3 }, () => ({ state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts" }] })),
    { round: 213, state: "green", fail: 0 },
  ]);
  const green = analyzeTasks(opts);
  assert.equal(green.suite_blocking.window_active, false);
  assert.deepEqual(green.ready_relevance.map((e) => e.id), ["gap-plain-ready", "gap-watchdog"], "green round clears the window ⇒ no re-rank");
});


test("analyzeTasks: suite red ⇒ suite-fix family dispatchable, unrelated task still blocked (AC2/AC3 — gap-suite-blocking-self-lock-blocks-fix-family)", (t) => {
  const root = makeWorkspace("suitelock");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The suite-fix family — ids carry install/suite markers (the self-lock victims from the task's
  // empirical record: gap-install-family + gap-serial-phase-install were among the 22 blocked).
  writeTask(root, "gap-install-family-tests-rotate-flakes-under-full-suite", {
    status: "ready", labels: ["gap"],
    body: fourArtifactBody({ touches: ["- plugin/test/install-family.test.mjs (fix)"] }),
  });
  writeTask(root, "gap-serial-phase-install-test-residue-dependency", {
    status: "ready", labels: ["gap"],
    body: fourArtifactBody({ touches: ["- plugin/test/serial-install.test.mjs (fix)"] }),
  });
  // Unrelated task touching a failing suite file — no suite-fix marker — must stay blocked (AC3).
  writeTask(root, "gap-watchdog-unrelated", {
    status: "ready", labels: ["gap"],
    body: fourArtifactBody({ touches: ["- plugin/test/install-family.test.mjs"] }),
  });

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };

  // 3 consecutive red rounds whose failure hits the suite infra file the fix-family touches.
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 220 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "plugin/test/install-family.test.mjs", line: "x" }] })));
  const r = analyzeTasks(opts);
  assert.equal(r.suite_blocking.window_active, true);
  assert.equal(r.suite_blocking.consecutive_red, 3);
  assert.ok(!r.suite_blocking.tasks.includes("gap-install-family-tests-rotate-flakes-under-full-suite"),
    "AC2: gap-install-family (suite-fix) stays dispatchable under the red window — self-lock broken");
  assert.ok(!r.suite_blocking.tasks.includes("gap-serial-phase-install-test-residue-dependency"),
    "AC2: gap-serial-phase-install (suite-fix) stays dispatchable");
  assert.ok(r.suite_blocking.tasks.includes("gap-watchdog-unrelated"),
    "AC3 reverse control: unrelated task touching the failing suite file is still blocked");
  // The exemption must NOT make the window vanish — the failing file is still reported.
  assert.deepEqual(r.suite_blocking.failure_files, ["plugin/test/install-family.test.mjs"]);
});


test("analyzeTasks: dir-glob Touches task is NOT suite-blocking in a red window; concrete-file task is (AC4 negative control — gap-suite-blocking-directory-glob-overbroad)", (t) => {
  const root = makeWorkspace("glob-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The crystallization shape: Touches carry a concrete script AND the `plugin/test/` directory glob.
  writeTask(root, "gap-crystal-dir", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- plugin/test/", "- plugin/scripts/capability-catalog.sh"] }) });
  // A task whose Touches name the CONCRETE failing file under that directory.
  writeTask(root, "gap-real-blocker", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- plugin/test/checker-cost.test.mjs"] }) });
  // The directory must EXIST with the failing file on disk — otherwise the dir glob expands to an
  // empty set and the test cannot distinguish the fixed (dir glob filtered) from the buggy (dir glob
  // attributed) behavior. This mirrors the real repo where plugin/test/ is a real directory.
  fs.mkdirSync(path.join(root, "plugin", "test"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "test", "checker-cost.test.mjs"), "// fixture\n");
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };

  // 3 consecutive red rounds whose ONLY failing file is under plugin/test/ — the real-repo shape
  // where the crystallization task used to be a false suite-blocker.
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 320 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "plugin/test/checker-cost.test.mjs", line: "x" }] })));
  const r = analyzeTasks(opts);
  assert.equal(r.suite_blocking.window_active, true);
  assert.deepEqual(r.suite_blocking.tasks, ["gap-real-blocker"], "only the concrete-file task is suite-blocking — the dir-glob task is NOT (AC4 negative control)");
  const crystal = r.ready_relevance.find((e) => e.id === "gap-crystal-dir");
  assert.equal(crystal.blocking_suite, false, "the dir-glob task's blocking_suite stays false in a red window");
});


test("AC5: suite-blocking obligation recorded mechanically in the obligation ledger (JSONL)", (t) => {
  // The ledger is at <repoRoot>/orchestration/manager-obligation-ledger.jsonl — the AC5 deliverable:
  // the "suite-blocker can't get prioritized" obligation is now MECHANICALLY derivable (ready-pool-
  // check's blocking_suite field), recorded as a machine-readable JSONL row (not prose).
  const repoRoot = path.resolve(__dirname, "..", "..");
  const ledger = path.join(repoRoot, "orchestration", "manager-obligation-ledger.jsonl");
  assert.ok(fs.existsSync(ledger), "obligation ledger exists");
  const rows = fs.readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const suite = rows.find((r) =>
    /SUITE-BLOCK|SUITE_BLOCK|BLOCKING.*SUITE|OB-BLOCKING-DEFECT-NOT-PRIORITIZED/i.test(String(r.id)) ||
    /blocking_suite/.test(String(r.reading || "") + String(r.note || "")) ||
    /suite.*阻塞|阻塞.*suite|连续红窗/i.test(String(r.reading || "") + String(r.note || "")));
  assert.ok(suite, "a suite-blocking obligation row exists in the ledger");
  for (const key of ["tick", "id", "condition", "reading", "note"]) {
    assert.ok(suite[key] !== undefined && suite[key] !== null && suite[key] !== "", `obligation row carries \`${key}\``);
  }
});

// ── PROSE-PREREQUISITE GAP (gap-prerequisite-gates-prose-invisible-to-mechanisms) ──────────────────
// A prerequisite written ONLY as prose (a `[[task-id]]` wikilink inside a "Do not dispatch until …
// lands / 前置" paragraph) is invisible to every mechanism path that reads relation edges
// (parent/children/depends_on). The detector makes it FAIL-CLOSED: a ready task with a prose prereq
// that has NO relation edge is excluded from the dispatchable pool, and a todo candidate with the
// same shape is ineligible for author→ready promotion.



test("ready task with prose prereq and NO relation edge ⇒ excluded from the pool (prose-prereq-no-edge)", (t) => {
  const root = makeWorkspace("prereq-ready");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The referenced prereq task exists (so the wikilink resolves) but has NO relation edge to the target.
  writeTask(root, "gap-prereq-a", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-no-edge", {
    status: "ready",
    labels: ["gap"],
    body: PREREQ_BODY(["gap-prereq-a"]),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const ex = r.excluded.find((e) => e.id === "gap-no-edge");
  assert.ok(ex, "prose-prereq-no-edge ready task must be in the excluded list");
  assert.ok(ex.reasons.some((s) => s.includes("前置")), `exclusion reason must carry the 前置 literal, got: ${ex.reasons.join(";")}`);
  assert.equal(r.ready.includes("gap-no-edge"), false, "the task must NOT be in the dispatchable ready pool");
});


test("prose prereq that IS a relation edge (depends_on) ⇒ NOT excluded; depsReady checks depends_on", (t) => {
  const root = makeWorkspace("prereq-edge");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-prereq-a", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-prereq-b", { status: "todo", labels: ["gap"], body: fourArtifactBody() });
  // The prose prereq is ALSO expressed as a depends_on edge (done) ⇒ no gap, stays dispatchable.
  writeTask(root, "gap-edged-ready", {
    status: "ready",
    labels: ["gap"],
    parent: null,
    children: [],
    body: PREREQ_BODY(["gap-prereq-a", "gap-prereq-b"]),
  });
  // Add depends_on AFTER writeTask by patching the file (writeTask has no dependsOn param).
  const file = path.join(root, "tasks", "gap-edged-ready.md");
  const raw = fs.readFileSync(file, "utf8").replace("parent: null", "depends_on:\n  - gap-prereq-a\n  - gap-prereq-b\nparent: null");
  fs.writeFileSync(file, raw);

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.equal(r.ready.includes("gap-edged-ready"), true, "prose prereq ALSO expressed as an edge stays dispatchable");
  assert.equal(r.excluded.some((e) => e.id === "gap-edged-ready"), false);

  // depsReady: gap-prereq-a done + gap-prereq-b todo ⇒ the todo candidate is NOT deps-ready.
  writeTask(root, "gap-child-cand", { status: "todo", labels: ["gap"], parent: null, children: [], body: PREREQ_BODY([]) });
  const file2 = path.join(root, "tasks", "gap-child-cand.md");
  const raw2 = fs.readFileSync(file2, "utf8").replace("parent: null", "depends_on:\n  - gap-prereq-a\n  - gap-prereq-b\nparent: null");
  fs.writeFileSync(file2, raw2);
  const r2 = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const cand = r2.candidates.find((c) => c.id === "gap-child-cand");
  assert.equal(cand.depsReady, false, "a depends_on entry not done ⇒ deps NOT ready (parent alone no longer the only dep)");
});


test("todo candidate with prose prereq and NO edge ⇒ ineligible for promotion (author→ready fail-closed)", (t) => {
  const root = makeWorkspace("prereq-promo");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-prereq-a", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  // AC1 (gap-ac46-pool-criteria-in-gate): the candidate needs its C8 self-touch so it PASSES the
  // self-touch gate and the prose-prereq gap (not self-touch) becomes the blocking reason.
  writeTask(root, "gap-cand", {
    status: "todo",
    labels: ["gap"],
    parent: null,
    children: [],
    body: withSelfTouch(PREREQ_BODY(["gap-prereq-a"]), "gap-cand"),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, targetedId: "gap-cand" });
  assert.equal(r.targeted_promotion.eligible, false, "targeted promotion must reject prose-prereq-no-edge");
  assert.deepEqual(r.targeted_promotion.checks.prosePrereqGap, ["gap-prereq-a"], "the gap names the missing edge");
  const cand = r.candidates.find((c) => c.id === "gap-cand");
  assert.equal(cand.eligible, false, "bulk promotion must reject prose-prereq-no-edge");
  assert.deepEqual(cand.prosePrereqGap, ["gap-prereq-a"]);
});



test("PREREQ_KEYWORD_RE now matches 阻塞 paragraphs — the pre-fix table saw none of them (AC1)", () => {
  const hits = PRE_EDGE_AC207_SNIPPET.split(/\r?\n\s*\r?\n/).filter((p) => PREREQ_KEYWORD_RE.test(p));
  assert.ok(hits.length > 1, `阻塞 must make >1 paragraph match (got ${hits.length})`);
  assert.equal(PREREQ_KEYWORD_RE.test("第四阻塞 `gap-x` 仍未解除"), true, "阻塞 is in the widened keyword table");
  assert.equal(PREREQ_KEYWORD_RE.test("前序任务 `gap-x`"), true, "前序 stays in the table");
});
