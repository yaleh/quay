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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { PARKED_MARKER_RE, analyzeTasks, assert, buildCommitTraceIndex, commitSubjectTracesTask, commitTraceLanded, execFileSync, fourArtifactBody, fs, isFixture, isParked, makeWorkspace, notYetFlipped, os, parseTask, path, taskWorkLanded, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("ready pool excludes fixture, PARKED, and done-flip ready tasks; keeps stuck-work", (t) => {
  const root = makeWorkspace("excl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "QENG-DEMO", { status: "ready", labels: ["fixture"], body: fourArtifactBody() });
  writeTask(root, "AC-REC", { status: "ready", labels: ["ac"], body: fourArtifactBody() });
  writeTask(root, "gap-parked", {
    status: "ready",
    labels: ["gap"],
    body: "> **PARKED (outer ruling, 2026-08-04) — execution suspended.**\n\n" + fourArtifactBody(),
  });
  // A MERGED DONE-FLIP ready task: work landed (Touches file exists on disk) AND every remaining
  // unchecked box is an EXTERNAL-VERIFICATION item (the "verification-window" shape — only the full
  // suite green remains) → not-yet-flipped → not dispatchable.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  writeTask(root, "gap-done-flip", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/landed.ts (new)"] }),
  });
  // STUCK-WORK: work landed but ACs far from complete (0/4) — REAL remaining implementation, NOT a
  // done-flip (gap-ready-pool-worklanded-traps-stuck-work AC2) → stays dispatchable.
  writeTask(root, "gap-stuck-work", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/landed.ts (new)"] }),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 3, "pool should be gap-a + gap-b + gap-stuck-work");
  assert.deepEqual(r.ready.sort(), ["gap-a", "gap-b", "gap-stuck-work"]);

  const reasonsById = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.deepEqual(reasonsById["QENG-DEMO"], ["fixture"]);
  assert.deepEqual(reasonsById["AC-REC"], ["ac-record"], "ac-labelled AC record excluded by kind (isAcRecord, SPEC §5 AC-tracking)");
  assert.deepEqual(reasonsById["gap-parked"], ["parked"]);
  assert.ok(reasonsById["gap-done-flip"].includes("not-yet-flipped"), "near-complete workLanded ready task excluded as done-flip");
  assert.equal(reasonsById["gap-stuck-work"], undefined, "AC-incomplete workLanded ready task is stuck-work → stays dispatchable");
});

// ── AC5/AC6: the "merged but AC all unchecked" shape is STUCK-WORK, not done-work ──────────────────
// Regression pin (gap-ready-pool-worklanded-traps-stuck-work): a merged task whose ACs are far from
// complete (<50%) has REAL remaining implementation → counted in the pool; a merged DONE-FLIP task
// (work landed AND ACs near-complete) is excluded; a truly-unstarted ready task stays.


test("pool counts merged-but-AC-incomplete stuck-work, excludes merged done-flip, keeps truly-unstarted (AC5/AC6)", (t) => {
  const root = makeWorkspace("merged-shape");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // STUCK-WORK: work LANDED (Touches file exists on disk) but ACs all unchecked → real remaining
  // implementation → must stay dispatchable (gap-ready-pool-worklanded-traps-stuck-work AC2).
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  writeTask(root, "gap-merged-stuck", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/landed.ts (new)"] }), // 0/4 AC checked
  });
  // DONE-FLIP: work landed AND the only remaining unchecked box is an EXTERNAL-VERIFICATION item
  // (3/4 — the verification-window shape) → excluded.
  writeTask(root, "gap-merged-done-flip", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/landed.ts (new)"] }),
  });
  // A genuinely-unstarted ready task: Touches file does not exist, no resolving symbols → stays.
  writeTask(root, "gap-unstarted", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/does-not-exist.ts"] }),
  });
  writeTask(root, "gap-real", { status: "ready", labels: ["gap"], body: fourArtifactBody() });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 3, "pool counts the merged stuck-work task (real remaining work)");
  assert.deepEqual(r.ready.sort(), ["gap-merged-stuck", "gap-real", "gap-unstarted"]);
  const reasonsById = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.equal(reasonsById["gap-merged-stuck"], undefined, "merged-but-AC-incomplete stuck-work task stays in the pool (AC2)");
  assert.ok(reasonsById["gap-merged-done-flip"].includes("not-yet-flipped"), "merged near-complete done-flip task excluded (AC3)");
  assert.ok(!reasonsById["gap-unstarted"], "truly-unstarted ready task stays in the pool");
});

// ── AC2/AC3/AC4 (gap-ready-pool-check-taskworklanded-overshoot-excludes-existing-file-tasks) ──────
// The taskWorkLanded touch signal overshot: "Touches file exists on master" fired for tasks that
// merely MODIFY an existing file, excluding them from the pool. Fix: only a task-CREATED file
// (`(new)` touch now existing) is landing evidence; an existing-file task is judged by its own
// symbols. AC2 (not-landed existing-file task stays in pool) + AC3 (landed one is excluded).


test("existing-file-modifying tasks: not-landed stays, done-flip landed is excluded, stuck-work landed stays (AC2/AC3)", (t) => {
  const root = makeWorkspace("existing-file");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The file exists on master regardless — the touch is NOT marked (new), so file existence must
  // NOT count as landing evidence for THIS task.
  fs.writeFileSync(path.join(root, "code", "existing.ts"), "export const preexisting = 1;\n");
  // NOT landed: an existing-file task whose work has not landed → must stay in the pool.
  writeTask(root, "gap-mod-not-landed", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/existing.ts"] }), // 0/4 AC, no (new), no resolving symbols
  });
  // DONE-FLIP landed: an existing-file task whose work HAS landed via a task-created file ((new)
  // exists) AND the only remaining unchecked box is an EXTERNAL-VERIFICATION item (3/4) → excluded.
  fs.writeFileSync(path.join(root, "code", "created.ts"), "export const created = 1;\n");
  writeTask(root, "gap-mod-done-flip", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/existing.ts", "- code/created.ts (new)"] }),
  });
  // STUCK-WORK landed: the same landing evidence but ACs far from complete (0/4) → real remaining
  // implementation → stays dispatchable (AC2).
  writeTask(root, "gap-mod-stuck", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/existing.ts", "- code/created.ts (new)"] }),
  });
  writeTask(root, "gap-real", { status: "ready", labels: ["gap"], body: fourArtifactBody() });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 3, "pool keeps the not-landed + the stuck-work existing-file tasks");
  assert.deepEqual(r.ready.sort(), ["gap-mod-not-landed", "gap-mod-stuck", "gap-real"]);
  const reasonsById = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.ok(!reasonsById["gap-mod-not-landed"], "not-landed existing-file task stays in the pool (AC2)");
  assert.equal(reasonsById["gap-mod-stuck"], undefined, "landed-but-AC-incomplete existing-file task is stuck-work → stays (AC2)");
  assert.ok(reasonsById["gap-mod-done-flip"].includes("not-yet-flipped"), "near-complete landed existing-file task excluded (AC3)");
});

// ── git-history landed signal (gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks) ──
// A prose-heavy-AC merged task (no resolvable symbols, no (new) touches) whose work landed via a
// fan-in merge that references it is judged by the SAME AC gate as the other workLanded signals:
// near-complete (>50% AC) → done-flip, excluded from the dispatchable pool; far-from-complete
// (<50% AC) → stuck-work, stays dispatchable (gap-ready-pool-worklanded-traps-stuck-work AC2/AC3).
// These tests need a REAL git repo (the signal reads `git log master`), created inline (mkdtemp +
// the same t.after cleanup the other ready-pool tests use) so the R6 isolation checker sees the
// directory covered.


test("ready pool excludes a prose-heavy DONE-FLIP via git-history, keeps git-history STUCK-WORK (AC1/AC2/AC3)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-gh-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  // A prose-heavy DONE-FLIP task: ACs yield no resolvable symbols and Touches are existing-file
  // paths (no (new)) — the shape that was under-detected (web-board). Its work lands via a fan-in
  // merge "merge web-board: …" that modified code/board.ts → git-history fires; the only remaining
  // unchecked box is an EXTERNAL-VERIFICATION item (3/4) → excluded as done-flip.
  writeTask(root, "gap-web-board-needs-an-inconsistency-verdict-it-does-not-have", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/board.ts"] }),
  });
  // A genuinely-unstarted ready task stays in the pool (no commit references it).
  writeTask(root, "gap-unstarted", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/never.ts"] }) });
  git("checkout", "-q", "-b", "task/gap-web-board");
  fs.writeFileSync(path.join(root, "code", "board.ts"), "board\n");
  git("add", ".");
  git("commit", "-q", "-m", "board impl");
  git("checkout", "-q", "master");
  git("merge", "--no-ff", "task/gap-web-board", "-m", "merge web-board: /board route joins intent/execution/landing", "-q");
  git("branch", "-D", "task/gap-web-board");
  // STUCK-WORK via git-history: the same under-detected prose shape whose work also lands via a
  // fan-in merge (references "web-stuck") BUT whose ACs are far from complete (0/4) → real remaining
  // implementation → stays dispatchable (AC2).
  writeTask(root, "gap-web-stuck-work", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/board-stuck.ts"] }),
  });
  git("checkout", "-q", "-b", "task/gap-web-stuck");
  fs.writeFileSync(path.join(root, "code", "board-stuck.ts"), "stuck\n");
  git("add", ".");
  git("commit", "-q", "-m", "board-stuck impl");
  git("checkout", "-q", "master");
  git("merge", "--no-ff", "task/gap-web-stuck", "-m", "merge web-stuck: /board-stuck route joins intent/execution/landing", "-q");
  git("branch", "-D", "task/gap-web-stuck");

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.ok(
    byId["gap-web-board-needs-an-inconsistency-verdict-it-does-not-have"]?.includes("not-yet-flipped"),
    "prose-heavy near-complete merged task excluded via the git-history signal (AC3)",
  );
  assert.equal(r.ready.includes("gap-web-board-needs-an-inconsistency-verdict-it-does-not-have"), false,
    "the done-flip landed task is NOT in the dispatchable pool");
  assert.equal(r.ready.includes("gap-web-stuck-work"), true,
    "git-history landed but AC-incomplete task is stuck-work → in the dispatchable pool (AC2)");
  assert.equal(byId["gap-web-stuck-work"], undefined, "stuck-work task not excluded (AC2)");
  assert.equal(r.ready.includes("gap-unstarted"), true, "a genuinely-unstarted ready task stays in the pool");
});

// ── COMMIT-TRACE signal (gap-nyf-branch-existence-vs-commit-trace) ────────────────────────────────
// The not-yet-flipped criterion used to depend on TRANSIENT artifacts: the task/<id> branch existing
// and unmerged (a branch merged+DELETED makes that signal vanish), and a git-history signal hardcoded
// to `master` (STALE under the two-line branch model — integration-landed commits invisible to it).
// Both hid "work already landed, still ready" tasks — the 16 phantom ready tasks (2026-08-11), each
// verified via `git log --all | grep -E "inner: <id>|fan-in: task/<id>"`. The COMMIT-TRACE signal is
// PERSISTENT (commit SUBJECTS survive branch deletion) and reads `--all` (covers the integration
// fan-in). AC2: `inner: <id>` / `fan-in: task/<id>` commit ⇒ work landed ⇒ not dispatchable. AC3: the
// "别改它" stuck-work guard (gap-ready-pool-worklanded-traps-stuck-work) is preserved — a traced task
// whose ACs are far from complete stays dispatchable.


test("commitSubjectTracesTask: inner:/fan-in: subject forms trace the task; mere id mentions do not (AC2)", () => {
  const id = "gap-ac36-recommended-exposes-sort-key";
  // positive: the four live commit conventions.
  assert.equal(commitSubjectTracesTask(`inner: ${id} — impl landed`, id), true, "inner: <id> form");
  assert.equal(commitSubjectTracesTask(`fan-in: task/${id}`, id), true, "fan-in: task/<id> form");
  assert.equal(commitSubjectTracesTask(`merge: fan-in task/${id} — per-hunk union`, id), true, "merge: fan-in task/<id> form");
  assert.equal(commitSubjectTracesTask(`merge: fan-in ${id} (A6, task-file evidence)`, id), true, "bare merge: fan-in <id> form");
  // negative: the id merely MENTIONED elsewhere in a subject is NOT a trace (position-based judgment —
  // e.g. an outer: closure commit listing many ids must not fire for each).
  assert.equal(commitSubjectTracesTask(`outer: closure pass 16 tasks — ${id}/fifty-to-six/install → done`, id), false, "id in a list is not a trace");
  // negative: prefix cross-fire — a LONGER sibling id must not trace a shorter id (delimited word).
  assert.equal(commitSubjectTracesTask(`inner: ${id}-sibling — impl`, id), false, "longer id must not trace the shorter prefix");
  assert.equal(commitSubjectTracesTask(`fan-in task/${id}-sibling`, id), false, "longer fan-in id must not trace the shorter prefix");
  // negative: the git-history merge format the OTHER signal handles (`merge web-board: …`) is not a trace.
  assert.equal(commitSubjectTracesTask("merge web-board: /board route joins intent/execution/landing", "gap-web-board-needs-an-inconsistency-verdict-it-does-not-have"), false);
});


test("buildCommitTraceIndex: fail-closed on a non-git root (empty, never throws)", (t) => {
  const root = makeWorkspace("ct-nongit");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(buildCommitTraceIndex(root), [], "non-git root ⇒ empty index");
  assert.equal(commitTraceLanded("gap-any", buildCommitTraceIndex(root)), false, "empty index never traces");
});


test("commit-trace nyf: branch merged+DELETED on integration (master stale) ⇒ done-flip not dispatchable, stuck-work stays, untraced stays (AC2/AC3)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-ct-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  // The two-line branch model: work lands on integration; master STAYS at base (stale) — so the
  // master-based git-history signal (gitHistoryLanded) sees NONE of it. Only the commit-trace signal
  // (reads --all) can see the integration fan-in.
  git("checkout", "-q", "-b", "integration");
  // TRACED DONE-FLIP: work landed via `inner:` impl commit + `fan-in: task/<id>` merge on integration,
  // branch then DELETED (the transient branch-existence signal vanishes — the commit trace persists).
  // ALL ACs checked (the commit-trace arm's self-declared completion condition — gap-ready-pool-commit-
  // trace-subject-not-proof-of-done: a traced task with ANY unchecked AC is NOT landed).
  writeTask(root, "gap-traced-done-flip", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 4, touches: ["- code/impl.ts"] }), // prose AC (no backticked symbols), existing-file touch
  });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-traced-done-flip");
  git("checkout", "-q", "-b", "task/gap-traced-done-flip");
  fs.writeFileSync(path.join(root, "code", "impl.ts"), "export const impl = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "inner: gap-traced-done-flip — impl landed on integration");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-traced-done-flip", "-m", "fan-in: task/gap-traced-done-flip", "-q");
  git("branch", "-D", "task/gap-traced-done-flip");
  // TRACED PARTIAL (gap-ready-pool-commit-trace-subject-not-proof-of-done regression anchor — the
  // 5-swallowed-tasks shape): an `inner:` subject names the task but the ACs are NOT all checked
  // (4/4 boxes, 3 checked — an intermediate step commit, not completion), AND the intermediate commit
  // touches a file OUTSIDE the task's declared Touches (so taskWorkLanded — symbol/touch/git-history
  // evidence — does NOT fire: only the WEAK subject string names the task). The subject hit alone must
  // NOT exclude it: it has REAL remaining implementation → STAYS in the pool.
  writeTask(root, "gap-traced-partial", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, touches: ["- code/never-touched.ts"] }),
  });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-traced-partial");
  git("checkout", "-q", "-b", "task/gap-traced-partial");
  fs.writeFileSync(path.join(root, "code", "intermediate.ts"), "export const intermediate = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "inner: gap-traced-partial — intermediate step (导出 7 函数), not done");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-traced-partial", "-m", "merge: fan-in task/gap-traced-partial", "-q");
  git("branch", "-D", "task/gap-traced-partial");
  // TRACED WORKLANDED PARTIAL (criterion ⑦d — a RATIO cannot tell verification from implementation):
  // the work REALLY landed (the inner commit touches the task's OWN Touches file — taskWorkLanded
  // fires via git-history) but the remaining unchecked box (3/4) is this task's OWN implementation
  // ("an AC item that is long enough" — a generic AC, NOT an external-verification item). 3/4 = 75%
  // > 50% WOULD have been a done-flip under the old ratio — but ANY remaining implementation box
  // means NOT landed (gap-ready-pool-remaining-external-vs-implementation) → stays dispatchable.
  writeTask(root, "gap-worklanded-partial", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, touches: ["- code/wl-partial.ts"] }),
  });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-worklanded-partial");
  git("checkout", "-q", "-b", "task/gap-worklanded-partial");
  fs.writeFileSync(path.join(root, "code", "wl-partial.ts"), "export const wlPartial = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "inner: gap-worklanded-partial — impl landed");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-worklanded-partial", "-m", "fan-in: task/gap-worklanded-partial", "-q");
  git("branch", "-D", "task/gap-worklanded-partial");
  // TRACED WORKLANDED VERIFY (the awaiting-verification population anchor, e.g. gap-mcp-server): the
  // work REALLY landed AND every remaining unchecked box is annotated `（待外部）` (the
  // `全量套件绿 … 外层验证` shape — only the full suite green remains). The workLanded arm excludes it
  // as a LEGAL done-flip — but the excluded entry carries awaiting_verification:true (the task's
  // entry into the awaiting-verification state, NOT a 乙/contradiction).
  writeTask(root, "gap-worklanded-verify", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/wl-verify.ts"] }),
  });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-worklanded-verify");
  git("checkout", "-q", "-b", "task/gap-worklanded-verify");
  fs.writeFileSync(path.join(root, "code", "wl-verify.ts"), "export const wlVerify = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "inner: gap-worklanded-verify — impl landed");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-worklanded-verify", "-m", "fan-in: task/gap-worklanded-verify", "-q");
  git("branch", "-D", "task/gap-worklanded-verify");
  // TRACED STUCK-WORK: also has an `inner:` commit (and a `merge: fan-in task/<id>` merge) but ACs far
  // from complete → real remaining implementation → STAYS dispatchable (the "别改它" stuck-work guard).
  writeTask(root, "gap-traced-stuck", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 0, touches: ["- code/impl-stuck.ts"] }),
  });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-traced-stuck");
  git("checkout", "-q", "-b", "task/gap-traced-stuck");
  fs.writeFileSync(path.join(root, "code", "impl-stuck.ts"), "export const stuck = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "inner: gap-traced-stuck — partial impl");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-traced-stuck", "-m", "merge: fan-in task/gap-traced-stuck", "-q");
  git("branch", "-D", "task/gap-traced-stuck");
  // UNTRACED: no inner:/fan-in: commit anywhere → genuinely fresh ready work.
  writeTask(root, "gap-unstarted", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/never.ts"] }) });
  git("add", ".");
  git("commit", "-q", "-m", "task file gap-unstarted");

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  const acOpenById = Object.fromEntries(r.excluded.map((e) => [e.id, e.ac_open]));
  // AC2 verification anchor (a): branch merged+DELETED, but the commit trace persists on integration
  // (invisible to the stale-master git-history signal) ⇒ the done-flip task is NOT dispatchable.
  assert.ok(
    byId["gap-traced-done-flip"]?.includes("not-yet-flipped"),
    "traced done-flip task excluded via commit-trace (master stale, branch deleted)",
  );
  assert.equal(r.ready.includes("gap-traced-done-flip"), false, "traced done-flip NOT in the dispatchable pool");
  // gap-ready-pool-nyf-split-backlog-vs-contradiction: a done-flip with EVERY completion checkbox
  // checked is 甲/backlog → ac_open=0 on the excluded entry.
  assert.equal(acOpenById["gap-traced-done-flip"], 0, "all-checked not-yet-flipped task is 甲/backlog (ac_open=0)");
  // gap-ready-pool-commit-trace-subject-not-proof-of-done: a subject hit alone (partial ACs unchecked)
  // must NOT exclude — the 5-swallowed-tasks shape (e.g. gap-cli-import-refactor-run-shell-architecture:
  // inner "导出 7 函数" intermediate step, AC 5/9 unchecked) stays in the pool with real remaining work.
  assert.equal(byId["gap-traced-partial"], undefined, "traced-but-AC-partial task is NOT landed → not excluded");
  assert.equal(r.ready.includes("gap-traced-partial"), true, "traced-partial task stays in the dispatchable pool");
  // gap-ready-pool-remaining-external-vs-implementation (criterion ⑦d): a work-landed 3/4 task whose
  // remaining unchecked box is this task's OWN implementation is NOT landed — it stays dispatchable
  // (the old >50% RATIO would have excluded it as a done-flip; the NATURE of the remaining item says
  // otherwise).
  assert.equal(byId["gap-worklanded-partial"], undefined, "worklanded 3/4 with an open IMPLEMENTATION box is NOT landed → not excluded");
  assert.equal(r.ready.includes("gap-worklanded-partial"), true, "worklanded partial task stays in the dispatchable pool");
  // awaiting-verification (e.g. gap-mcp-server): a work-landed task whose EVERY remaining unchecked box
  // is annotated `（待外部）` is a LEGAL done-flip — excluded, but the entry carries
  // awaiting_verification:true (the task's entry into the awaiting-verification state, NOT a
  // 乙/contradiction).
  assert.equal(byId["gap-worklanded-verify"]?.includes("not-yet-flipped"), true, "worklanded all-remaining-external (3/4) is a legal done-flip");
  assert.equal(acOpenById["gap-worklanded-verify"], 1, "awaiting-verification task carries ac_open=1");
  const verifyEntry = r.excluded.find((e) => e.id === "gap-worklanded-verify");
  assert.equal(verifyEntry?.awaiting_verification, true, "awaiting-verification excluded entry carries the marker");
  assert.equal(r.ready.includes("gap-worklanded-verify"), false, "awaiting-verification task is NOT in the dispatchable pool");
  // "别改它" (gap-ready-pool-worklanded-traps-stuck-work): a traced task whose completion boxes are
  // far from complete is STUCK-WORK with real remaining implementation → stays dispatchable (the
  // commit-trace signal does NOT bypass the completion gate).
  assert.equal(byId["gap-traced-stuck"], undefined, "traced-but-AC-incomplete task is stuck-work → not excluded");
  assert.equal(r.ready.includes("gap-traced-stuck"), true, "traced stuck-work stays in the dispatchable pool");
  // a genuinely un-traced ready task stays dispatchable (negative control).
  assert.equal(byId["gap-unstarted"], undefined, "untraced ready task not excluded");
  assert.equal(r.ready.includes("gap-unstarted"), true, "untraced ready task stays in the dispatchable pool");
  // The A9 population-split counters: 甲 = done-flip with all boxes checked (backlog), 乙 = judged
  // landed but an open IMPLEMENTATION box (contradiction, threshold 1), awaiting_verification = every
  // open box annotated （待外部） (legitimately waiting — the awaiting-verification entry, neither 甲 nor
  // 乙).
  assert.equal(r.nyf_backlog, 1, "exactly one 甲/backlog not-yet-flipped task (the all-checked done-flip)");
  assert.equal(r.nyf_contradiction, 0, "no 乙/contradiction — a worklanded 3/4 with an open implementation box is NOT landed (stays in pool)");
  assert.equal(r.awaiting_verification, 1, "exactly one awaiting-verification task (worklanded, all remaining external)");
});


test("isFixture / isParked / notYetFlipped unit behavior", (t) => {
  const root = makeWorkspace("n-y-f");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const fixture = parseTask("---\nid: x\nlabels:\n  - fixture\n---\nbody");
  assert.equal(isFixture(fixture), true);
  assert.equal(isFixture(parseTask("---\nid: x\nlabels:\n  - gap\n---\nbody")), false);

  // A plain-text mention of the WORD "PARKED" in AC prose is NOT a marker.
  const proseParked = parseTask("---\nid: x\n---\nbody with PARKED in prose explaining exclusions");
  assert.equal(isParked(proseParked), false);
  assert.equal(PARKED_MARKER_RE.test("PARKED"), false, "bare word must not match the bold-marker regex");

  const parked = parseTask("---\nid: x\n---\n> **PARKED (human, 2026-08-04) — execution suspended.**\nmore");
  assert.equal(isParked(parked), true);

  // notYetFlipped's workLanded signal is now AC-gated (gap-ready-pool-worklanded-traps-stuck-work):
  // a merged-but-AC-incomplete ready task is STUCK-WORK (real remaining implementation) →
  // dispatchable; a merged NEAR-COMPLETE ready task (work landed + ACs >50%) is a done-flip →
  // excluded.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const stuckWork = {
    status: "ready",
    body: "## Acceptance Criteria\n- [ ] unchecked\n- [ ] still unchecked\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(stuckWork, root), false, "merged-but-AC-incomplete stuck-work ready task stays dispatchable");
  const doneFlip = {
    status: "ready",
    body: "## Acceptance Criteria\n- [x] done\n- [x] done\n- [ ] 全量套件绿（外层 verification-round 验证）（待外部）\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(doneFlip, root), true, "merged ready task whose only remaining box is external verification is a done-flip and must be excluded");

  // A truly-unstarted ready task (work not on master — Touches file absent, no resolving symbols)
  // STAYS in the pool.
  const unstarted = {
    status: "ready",
    body: "## Acceptance Criteria\n- [ ] not started\n## Touches\n- code/missing.ts\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(unstarted, root), false, "unstarted ready task must stay in the pool");

  // status is part of the predicate: a `done` task is never the not-yet-flipped state.
  const doneTask = { status: "done", body: "## Acceptance Criteria\n- [ ] whatever\n## Touches\n- code/landed.ts\n" };
  assert.equal(notYetFlipped(doneTask, root), false, "done status is not the not-yet-flipped state");
});

// ── AC-complete-not-flipped union signal (gap-closure-detection-reads-symbols-not-checkboxes) ──────
// The ready-pool closure signal (`notYetFlipped`) read WORK-LANDED evidence (symbol resolution /
// `(new)` touches / git history) — never AC checkboxes — so a prose-AC COMPLETED task (all ACs
// checked, but no resolvable symbols / no `(new)` touches / no git reference) stayed in the
// dispatchable pool and got re-dispatched (measured 2026-08-08: 17/21 ready tasks were
// AC-complete-not-flipped). Fix: the not-yet-flipped signal is a UNION — taskWorkLanded OR
// all_acs_checked && status==ready (the COMPLETION state, independent of writing style). The
// taskWorkLanded arm is itself AC-gated (gap-ready-pool-worklanded-traps-stuck-work): a workLanded
// task is a done-flip only when AC-complete or near-complete (>50%); AC-far-from-complete
// workLanded tasks are STUCK-WORK and stay dispatchable. AC1 positive control
// (AC-complete-but-not-flipped is surfaced) + AC2 union-with-AC-gate (taskWorkLanded stays pure /
// landed-but-incomplete is stuck-work / landed-near-complete is excluded) + negative controls
// (partial / zero-checkbox / non-ready are NOT surfaced).
