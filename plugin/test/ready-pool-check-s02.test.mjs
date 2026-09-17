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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/13 (14 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { MISMATCH_FULL_ID, analyzeTasks, artifactsComplete, assert, execFileSync, fourArtifactBody, fs, gitCommit, isExternalVerificationItem, isPendingImplementationItem, makeRealGitRepo, makeTruncatedWorktreeFixture, makeWorkspace, notYetFlipped, os, path, taskWorkLanded, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("AC2/AC3 (name mismatch) — analyzeTasks reports the unresolvable name AND keeps the resolvable one in the pool", (t) => {
  const { root } = makeTruncatedWorktreeFixture(t, "nyf-name-mismatch-report");
  // A second worktree whose name binds to NOTHING (not even a unique prefix) — the AC2 population.
  const orphanRoot = path.join(root, "..", `${path.basename(root)}-orphan`);
  const orphanWt = path.join(orphanRoot, "gap-nobody-knows-this-one");
  t.after(() => fs.rmSync(orphanRoot, { recursive: true, force: true }));
  fs.mkdirSync(orphanRoot, { recursive: true });
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", "task/gap-nobody-knows-this-one", orphanWt]);

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.ready.includes(MISMATCH_FULL_ID), true, "AC1: the task stays in the ready pool (its truncated worktree was recognized)");
  assert.equal(r.excluded.some((e) => e.id === MISMATCH_FULL_ID), false, "AC1: no not-yet-flipped exclusion — the silent 30 h pool exit is closed");

  assert.equal(r.mismatched_worktrees.evaluated, true, "AC2: the store was readable ⇒ the diagnostic is a real judgment, not a default");
  assert.deepEqual(r.mismatched_worktrees.records.map((x) => x.name), ["gap-nobody-knows-this-one"],
    "AC2: exactly the unresolvable task-worktree name is reported — the resolvable truncated one is not a mismatch");
  assert.equal(r.mismatched_worktrees.count, 1);
  assert.equal(r.mismatched_worktrees.records[0].type, "mismatched-worktree-name",
    "AC2: a TYPED record — structurally distinct from «everything is fine», not a silent no-op");
});

// ── HOISTED leftover-worktree exemption + touch-absent-from-ref veto
// (gap-nyf-doneflipready-arm-bypasses-leftover-worktree-exemption) ───────────────────────────────────
// The leftover-worktree exemption used to gate ONLY the standalone `allChecked` arm, so the
// `doneFlipReady` arm (workLandedReady || commitTraceReady) BYPASSED it: a worktree-open task whose
// taskWorkLanded read true (via symbol-resolution / touch-file existence over the main checkout's DISK
// tree — a proxy that fires on PRE-EXISTING files the task EDITS, hard rule 4b) was judged not-yet-
// flipped and left the pool FOREVER. Two fixes: (1) hoist the worktree exemption ABOVE every arm —
// an open `task/<id>` worktree is the DIRECT "fan-in not yet complete" quantity, so it suppresses ALL
// landed/completion signals; (2) a declared code-root Touches file ABSENT from the landing ref's tree
// vetoes the landed arms (file-existence is zero information; presence in the ref is the direct read).


test("AC1 — open worktree suppresses the workLanded done-flip arm (allChecked + workLanded stays dispatchable)", (t) => {
  const root = makeRealGitRepo("nyf-wl-worktree");
  const wtPath = path.join(root, "..", `${path.basename(root)}-wt`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(wtPath, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  // workLanded fires: the (new)-tagged touch EXISTS on disk and is committed (so it is IN the ref —
  // the touch-absent veto is clear, isolating the worktree hoist as the only suppressor).
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  gitCommit(root, "seed + landed");
  const id = "gap-nyf-wl";
  const body = fourArtifactBody({ checkedAc: 4, touches: ["- code/landed.ts (new)"] });
  writeTask(root, id, { status: "ready", labels: ["gap"], body });
  const task = { id, status: "ready", body };
  // Precondition (RED on the OLD code — doneFlipReady fired regardless of the open-worktree state).
  assert.equal(notYetFlipped(task, root), true, "no worktree + workLanded + allChecked is a done-flip (precondition)");
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `task/${id}`, wtPath]);
  assert.equal(notYetFlipped(task, root), false, "open worktree suppresses the workLanded done-flip arm (AC1)");
});


test("AC2 — open worktree suppresses the commit-trace done-flip arm (commitTraceReady stays dispatchable)", (t) => {
  const root = makeRealGitRepo("nyf-trace-worktree");
  const wtPath = path.join(root, "..", `${path.basename(root)}-wt`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(wtPath, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  gitCommit(root, "seed");
  const id = "gap-nyf-trace";
  const body = fourArtifactBody({ checkedAc: 4, touches: ["- code/never.ts"] });
  writeTask(root, id, { status: "ready", labels: ["gap"], body });
  const task = { id, status: "ready", body };
  // A commit subject naming the task in the inner: convention ⇒ commitTraceReady = true.
  const commitTraceSubjects = ["inner: gap-nyf-trace — implementation landed"];
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `task/${id}`, wtPath]);
  assert.equal(notYetFlipped(task, root, null, { commitTraceSubjects }), false,
    "open worktree suppresses the commit-trace done-flip arm (AC2)");
});


test("AC3 — regression: worktree removed + allChecked + landed is a done-flip again (original behavior, bidirectional)", (t) => {
  const root = makeRealGitRepo("nyf-regress");
  const wtPath = path.join(root, "..", `${path.basename(root)}-wt`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(wtPath, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  gitCommit(root, "seed + landed");
  const id = "gap-nyf-regress";
  const body = fourArtifactBody({ checkedAc: 4, touches: ["- code/landed.ts (new)"] });
  writeTask(root, id, { status: "ready", labels: ["gap"], body });
  const task = { id, status: "ready", body };
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `task/${id}`, wtPath]);
  assert.equal(notYetFlipped(task, root), false, "open worktree keeps it dispatchable (bidirectional setup)");
  execFileSync("git", ["-C", root, "worktree", "remove", "--force", wtPath]);
  assert.equal(notYetFlipped(task, root), true, "worktree removed + allChecked + landed is a done-flip again (AC3)");
});


test("AC4 — a declared Touches file ABSENT from the landing ref vetoes the landed signal (fail-closed dispatchable)", (t) => {
  const root = makeRealGitRepo("nyf-absent-touch");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  gitCommit(root, "seed");
  // A (new)-tagged touch that EXISTS on disk (so taskWorkLanded's touch-existence signal fires) but is
  // NOT committed to the landing ref — file-existence is a PROXY reading the disk tree; "absent from
  // the ref" is the DIRECT quantity (hard rule 4b). The veto must suppress the landed arms.
  fs.writeFileSync(path.join(root, "code", "absent.ts"), "export const absent = 1;\n");
  const task = {
    status: "ready",
    body: "## Acceptance Criteria\nprose only, no checkboxes\n## Touches\n- code/absent.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(taskWorkLanded(task.body, root), true, "precondition: the touch-existence signal fires (file on disk)");
  assert.equal(notYetFlipped(task, root), false, "Touches file absent from the landing ref ⇒ landed signal suppressed (AC4)");
  // Negative control: land the file into the ref ⇒ the veto clears ⇒ the no-AC landed shape is a
  // done-flip again (a parameter flip flips the conclusion — hard rule 4 / 推论四).
  gitCommit(root, "land the absent file");
  assert.equal(notYetFlipped(task, root), true, "once the Touches file IS in the ref, the landed signal fires again (AC4 negative control)");
});

// ── no-AC-section fallback (gap-git-history-landed-master-stale-under-two-line-model AC4) ──────────
// A task with NO `## Acceptance Criteria` checkboxes (total=0) is STRUCTURALLY unable to tick ACs:
// allAcsChecked is恒 false, so it could never be a done-flip through the checkbox signals and would
// sit in the ready pool forever (measured 2026-08-11: last-pane / suite-red — the closure probe's
// systematic undercount). The fallback: when its work HAS landed, the landing itself is its closeout
// signal — total===0 joins the all-checked / >50% gate. A no-AC task whose work has NOT landed stays
// dispatchable (stuck-work protection intact).


test("no-AC-section fallback (AC4, AC47-corrected): present-but-boxless landed no-AC task is a done-flip; ABSENT AC section is fail-closed", (t) => {
  const root = makeWorkspace("no-ac");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Work landed via a (new)-marked touch file that now exists.
  fs.writeFileSync(path.join(root, "code", "last-pane.ts"), "export const lastPane = 1;\n");
  // PRESENT `## Acceptance Criteria` heading with ZERO checkboxes (prose only) — the "段存在且零未勾"
  // state: total=0, sectionFound=true ⇒ the no-AC closeout fallback PRESERVED (landing is its
  // closeout) — a done-flip candidate (AC4, unchanged by the AC47 fail-closed fix).
  const landedProseNoBox = {
    status: "ready",
    body: "## Acceptance Criteria\nno checkboxes at all\n## Touches\n- code/last-pane.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(landedProseNoBox, root), true,
    "present-but-boxless no-AC task whose work has landed is a done-flip candidate (AC4)");
  // ABSENT `## Acceptance Criteria` heading (extractSectionByShape → null) — the AC47 fail-closed
  // shape: sectionFound=false ⇒ countCompletionCheckboxes total is NaN ⇒ the total===0 closeout
  // arm is STRUCTURALLY unreachable ⇒ NOT a done-flip, even with work landed. (Deliberate change:
  // gap-ac47-completion-predicate-consumer-fail-closed — an unreadable section must not be judged
  // complete, else DIR-014's 5 unchecked boxes under a suffixed heading are swallowed.)
  const landedAbsentAc = {
    status: "ready",
    body: "## Touches\n- code/last-pane.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(landedAbsentAc, root), false,
    "ABSENT AC section + landed work is fail-closed (NOT a done-flip — the section was never read)");
  // Work NOT landed → no-AC task stays in the dispatchable pool (present or absent section).
  const unlandedNoAc = {
    status: "ready",
    body: "## Touches\n- code/never.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(unlandedNoAc, root), false,
    "no-AC task whose work has NOT landed stays in the pool (AC4)");
  // A no-AC section entirely ABSENT (extractSection → null) + unlanded work stays in the pool.
  const noAcSection = {
    status: "ready",
    body: "## Proposal\nA real proposal paragraph that is more than forty non-whitespace chars.\n## Touches\n- code/never.ts (new)\n",
  };
  assert.equal(notYetFlipped(noAcSection, root), false,
    "absent AC section + unlanded work stays in the pool (AC4)");
});


test("ready pool: a no-AC task whose work lands on INTEGRATION is a done-flip (two-line model + AC4)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-2line-${Date.now()}-`));
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
  // Two-line model: the working line is integration (master stays stale behind it).
  git("checkout", "-q", "-b", "integration");
  // A no-checkbox task: `## Acceptance Criteria` heading PRESENT but with zero checkboxes (the
  // "段存在且零未勾" state — sectionFound:true, total:0) — structurally unable to tick ACs, so its
  // landing is its closeout (AC4 no-AC fallback, PRESERVED by the AC47 fail-closed fix; the fix
  // only fails-closed on an ABSENT/unreadable section, not a present-but-boxless one).
  writeTask(root, "gap-last-pane-telemetry", {
    status: "ready",
    labels: ["gap"],
    body: [
      "**type:** execution",
      "## Proposal",
      "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
      "## Touches",
      "- code/last-pane.ts",
      "## Acceptance Criteria",
      "prose acceptance criteria with no checkboxes at all",
      "## Definition of Done",
      "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
    ].join("\n"),
  });
  // Land the work on integration via a fan-in merge that references the task.
  git("checkout", "-q", "-b", "task/gap-last-pane");
  fs.writeFileSync(path.join(root, "code", "last-pane.ts"), "export const lastPane = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "last-pane impl");
  git("checkout", "-q", "integration");
  git("merge", "--no-ff", "task/gap-last-pane", "-m", "inner: gap-last-pane-telemetry — emit last-pane evidence", "-q");
  git("branch", "-D", "task/gap-last-pane");

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, integration: "integration" });
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.ok(byId["gap-last-pane-telemetry"]?.includes("not-yet-flipped"),
    "no-AC task whose work landed on integration is a done-flip (AC4 + two-line model)");
  assert.equal(r.ready.includes("gap-last-pane-telemetry"), false, "the done-flip task is NOT in the dispatchable pool");
});

// ── stuck-work vs done-flip (gap-ready-pool-worklanded-traps-stuck-work) ──────────────────────────
// The not-yet-flipped exclusion used to treat ANY workLanded task as "done, not yet flipped". But
// workLanded only means "some work landed" — a workLanded task with an open completion box that is
// this task's OWN implementation/evidence has REAL remaining implementation (stuck-work) and must
// stay dispatchable (AC2); only a workLanded task that is completion-complete, OR whose every
// remaining unchecked box is an EXTERNAL-VERIFICATION item (the "verification-window" done-flip
// shape — gap-ready-pool-remaining-external-vs-implementation, criterion ⑦d: judged by the NATURE of
// the remaining items, never a ratio), is excluded (AC3). A task at exactly 50% (gap-session-liveness
// 4/8 — with non-external remaining items) returns to the pool (verification anchor (a)).


test("stuck-work (workLanded + AC ≤50%) stays dispatchable; done-flip (workLanded + AC >50%) is excluded (AC2/AC3)", (t) => {
  const root = makeWorkspace("stuck-vs-flip");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // gap-session-liveness shape: work landed (Touches file exists) but only 4/8 ACs checked = 50%.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  writeTask(root, "gap-session-liveness", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ acBoxes: 8, checkedAc: 4, touches: ["- code/landed.ts (new)"] }),
  });
  // gap-dispatch shape: work landed and 5/6 ACs checked — the ONE remaining unchecked box is an
  // EXTERNAL-VERIFICATION item (only the verification window remains) → excluded.
  writeTask(root, "gap-dispatch", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ acBoxes: 6, checkedAc: 5, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/landed.ts (new)"] }),
  });
  writeTask(root, "gap-real", { status: "ready", labels: ["gap"], body: fourArtifactBody() });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.equal(r.ready.includes("gap-session-liveness"), true, "AC-incomplete workLanded task is stuck-work → back in the pool (AC2)");
  assert.equal(byId["gap-session-liveness"], undefined, "stuck-work task not excluded (AC2)");
  assert.equal(r.ready.includes("gap-dispatch"), false, "near-complete workLanded task is a done-flip → excluded (AC3)");
  assert.ok(byId["gap-dispatch"]?.includes("not-yet-flipped"), "done-flip task excluded with reason not-yet-flipped (AC3)");
  assert.equal(r.pool, 2, "pool = gap-session-liveness + gap-real");
});

// ── remaining-external-vs-implementation (gap-ready-pool-remaining-external-vs-implementation) ──────
// The workLanded arm's "verification-window done-flip" leniency used to be a RATIO (acRatio > 0.5),
// which could not distinguish "the remaining unchecked boxes depend only on EXTERNAL events (suite
// green / outer verification-round)" from "the remaining unchecked boxes include this task's OWN
// implementation/evidence" — the gap-cli-import-refactor misfire (AC 5/5 + DoD 4/4 = 5/9 = 55.6% >
// 50%: the DoD still carried the run()/shell golden-replay EVIDENCE — real remaining implementation —
// yet it was excluded as landed). HUMAN ruling (2026-08-12): the ratio is DELETED — the remaining-item
// nature is DECLARED by the task author at the item END (`（待外部）` / `（待本任务）`, closed enum;
// UNANNOTATED = 待本任务, fail-closed). ALL remaining items annotated （待外部） ⇒ awaiting-verification
// (excluded from the dispatchable pool); ANY （待本任务） or unannotated ⇒ stays ready (dispatchable).


test("isExternalVerificationItem / isPendingImplementationItem: the author DECLARED annotation enum (human ruling)", () => {
  // （待外部） at the item END ⇒ external (the awaiting-verification shape).
  assert.equal(isExternalVerificationItem("全量套件绿（外层 verification-round 验证）（待外部）"), true, "item ends with （待外部） ⇒ external");
  assert.equal(isExternalVerificationItem("等外层 verification-round（待外部）"), true, "（待外部） trailing marker");
  assert.equal(isExternalVerificationItem("full suite green（待外部）"), true, "（待外部） on an EN item");
  // POSITION: the annotation must be at the END — a （待外部） NOT at the end is not the declared enum
  // (position-based judgment, hard rule 2).
  assert.equal(isExternalVerificationItem("（待外部）全量套件绿"), false, "annotation must be at the item END, not the front");
  // （待本任务） ⇒ this task's own work ⇒ NOT external.
  assert.equal(isExternalVerificationItem("run()/shell 架构 + 逐命令搬迁的 golden-replay 证据 + 实际耗时贴出（待本任务）"), false, "（待本任务） ⇒ not external");
  assert.equal(isExternalVerificationItem("拆后 floor 下降 + 总耗时贴出（待本任务）"), false, "（待本任务） evidence ⇒ not external");
  assert.equal(isPendingImplementationItem("run()/shell 架构 + golden-replay 证据（待本任务）"), true, "isPendingImplementationItem agrees");
  // FAIL-CLOSED (the decisive direction): an UNANNOTATED unchecked item defaults to 待本任务 — a
  // missing annotation can never make a task wrongly landed (today's 5-swallowed-tasks defect).
  assert.equal(isExternalVerificationItem("全量套件绿（外层 verification-round 验证）"), false, "unannotated external-looking item is NOT external (fail-closed)");
  assert.equal(isExternalVerificationItem("an AC item that is long enough"), false, "unannotated generic item ⇒ not external");
  assert.equal(isExternalVerificationItem("AC1–AC5 全部勾上"), false, "unannotated ⇒ not external (fail-closed)");
  // An item annotated with the OLD non-enum marker （外部） is NOT the declared （待外部） ⇒ fail-closed.
  assert.equal(isExternalVerificationItem("全量套件绿（外层 verification-round 验证）（外部）"), false, "（外部） is NOT in the closed enum ⇒ fail-closed 待本任务");
});


test(">50% checked but a remaining implementation box ⇒ NOT landed (stays in the dispatchable pool)", (t) => {
  const root = makeWorkspace("remaining-impl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // work landed (Touches file exists on disk) AND 3/4 = 75% > 50% — but the ONE remaining unchecked
  // box is a generic AC item (this task's own implementation). The old >50% ratio would have excluded
  // it as a done-flip; criterion ⑦d says ANY remaining implementation box ⇒ NOT landed.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const task = {
    status: "ready",
    body: fourArtifactBody({ checkedAc: 3, touches: ["- code/landed.ts (new)"] }),
  };
  assert.equal(notYetFlipped(task, root), false, ">50% with an open implementation box is NOT landed");
});


test("all remaining unchecked boxes annotated （待外部） ⇒ awaiting-verification (excluded, not dispatchable)", (t) => {
  const root = makeWorkspace("remaining-ext");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // work landed AND 3/4 checked — the ONE remaining unchecked box is annotated （待外部） (only the full
  // suite green remains, e.g. gap-mcp-server) ⇒ the task enters awaiting-verification (a legal
  // done-flip — excluded from the dispatchable pool).
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const task = {
    status: "ready",
    body: fourArtifactBody({ checkedAc: 3, uncheckedText: "全量套件绿（外层 verification-round 验证）（待外部）", touches: ["- code/landed.ts (new)"] }),
  };
  assert.equal(notYetFlipped(task, root), true, "all-remaining-external workLanded task enters awaiting-verification (excluded)");
});


test("AC all checked but DoD has unchecked IMPLEMENTATION boxes ⇒ NOT landed (cli-import shape, human ruling)", (t) => {
  const root = makeWorkspace("ac-full-dod-open");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The gap-cli-import-refactor shape: AC 5/5 fully checked, but the DoD still carries this task's
  // OWN implementation/evidence as UNCHECKED boxes annotated `（待本任务）` (the run()/shell golden-replay
  // EVIDENCE + scoped test green), plus one `（待外部）` full-suite item. Work LANDED (the code IS merged)
  // + AC all checked was the old "landed" judgment — but the author DECLARED the implementation items
  // 待本任务, so the task is NOT landed ⇒ stays in the dispatchable pool.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const task = {
    status: "ready",
    body: [
      "**type:** execution",
      "## Proposal",
      "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
      "## Contract",
      "measure x\nband y\ninvoke z\ncontrol ok\nresume r",
      "## Acceptance Criteria",
      "- [x] AC1: done long enough to be a real box",
      "- [x] AC2: done long enough to be a real box",
      "- [x] AC3: done long enough to be a real box",
      "- [x] AC4: done long enough to be a real box",
      "- [x] AC5: done long enough to be a real box",
      "## Definition of Done",
      "- [ ] run()/shell 架构 + 逐命令搬迁的 golden-replay 证据 + 实际耗时贴出（见 Evidence）（待本任务）",
      "- [ ] 既有测试 + 新增测试全绿（--for-task scoped）（待本任务）",
      "- [ ] 全量套件绿（外层 verification-round 验证）（待外部）",
      "## Touches",
      "- code/landed.ts (new)",
    ].join("\n"),
  };
  assert.equal(notYetFlipped(task, root), false, "AC all-checked but DoD has open 待本任务 boxes ⇒ NOT landed (stays in pool)");
});


test("artifactsComplete is shape-aware and content-gated", () => {
  const contract = fourArtifactBody();
  assert.deepEqual(artifactsComplete(contract).missing, []);
  assert.equal(artifactsComplete(contract).complete, true);

  // Missing DoD → incomplete, names the missing artifact.
  const noDod = fourArtifactBody().replace("## Definition of Done", "## Resolution");
  const r = artifactsComplete(noDod);
  assert.equal(r.complete, false);
  assert.ok(r.missing.includes("dod"), `missing should include dod, got ${r.missing}`);

  // Unknown shape fails closed.
  assert.equal(artifactsComplete("## Some unknown heading\ncontent").complete, false);
});


test("artifactsComplete recognizes finding-shape draft AC/DoD headings (gap-todo-shape-mismatch-author-gate)", () => {
  // The 9 finding-shape gap-* tasks use `## AC（draft）` / `## DoD（draft）` (full-width parens) or
  // `## AC (draft)` (half-width parens) for their AC/DoD sections. The `（draft）` suffix is a
  // heading-label convention, not an absent section — the four-artifacts gate must count these
  // sections or those todo tasks are wrongly ineligible for author→ready promotion.
  const finding = "## Finding\nA real finding paragraph that is definitely more than forty non-whitespace characters long.";
  const acDraft = "## AC（draft）\n- [ ] the first draft acceptance item whose text is definitely longer than forty characters";
  const dodDraft = "## DoD（draft）\n- [ ] the first draft done item whose text is definitely longer than forty characters";
  const fullWidth = finding + "\n" + acDraft + "\n" + dodDraft;
  const rFull = artifactsComplete(fullWidth);
  assert.equal(rFull.complete, true, `full-width draft headings should complete, got ${JSON.stringify(rFull.missing)}`);
  assert.deepEqual(rFull.missing, []);

  // Half-width parens need literal (regex-escaped) heading matching — `AC (draft)` must not be
  // interpreted as a regex capture group.
  const halfWidth = finding + "\n" + acDraft.replace("（draft）", " (draft)") + "\n" + dodDraft.replace("（draft）", " (draft)");
  const rHalf = artifactsComplete(halfWidth);
  assert.equal(rHalf.complete, true, `half-width draft headings should complete, got ${JSON.stringify(rHalf.missing)}`);
  assert.deepEqual(rHalf.missing, []);

  // A finding-shape task WITHOUT any AC section still fails closed (missing ac+dod).
  const noAc = finding + "\n## Proposal\nA proposal paragraph that is more than forty non-whitespace chars.";
  const rNoAc = artifactsComplete(noAc);
  assert.equal(rNoAc.complete, false);
  assert.ok(rNoAc.missing.includes("ac"), `missing should include ac, got ${rNoAc.missing}`);
});

// ── AC1: floor = cap × 4 (20 at cap 5) — single source, no hardcoded literal ──────────────────────
