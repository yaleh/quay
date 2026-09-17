// @test-group engine
// fan-in-execute-paths.test.mjs — gap-fan-in-execute-three-unverified-paths: the three UNVERIFIED
// hot points of plugin/workflows/fan-in-execute.js, exercised through the REAL invocation path
// (判据3 — NOT fixture-only pure-function mocks; the AC78 lesson: "改 workflow 的唯一有效验证=实调").
//
//   REAL-INVOCATION harness: every test first vm-EXECUTES the actual workflow file
//   (fan-in-execute.js) with the workflow-runtime globals (args/phase/log/agent) mocked, so the
//   script's own code runs and PRODUCES the exact subagent prompt it would emit — a parser/runtime
//   break in the file (the AC78 `meta is not defined` class, or a template-literal backtick blowup)
//   fails every test, not just a source read. Then each hot point's bash block is extracted from
//   the REAL emitted prompt and EXECUTED against real git / real filesystem state:
//
//   ① code_delta 正则 (:61-65)  — run the REAL fork/merge-base/diff/code_delta pipeline in a real
//       temp git repo (doc/code/test deltas) and assert the AC75 rerun/skip classification.
//   ② --agent-id 自找 (承重点②) — run the REAL selfloc bash (candidates/count/ls -t) against a fake
//       ~/.claude tree replaying the DIR-127/DIR-128 concurrency (flat trap a017ce6b7fab53eb9),
//       assert it deterministically picks the workflow-run subagent, NOT the flat trap; zero
//       candidates ⇒ fail-closed exit 2.
//   ③ flip sed 失败路径 (承重点③) — run the REAL flip guard against real task files: normal flip,
//       line-shape mismatch (status:Ready) ⇒ exit 2 + FATAL (no silent green), body annotation
//       'status: ready——注解' preserved (anchored $, no corruption).
//   ④ flip AC 完成闸 (gap-fan-in-flip-no-ac-completion-check) — run the REAL flip block against real
//       task files: AC 未全勾（gap-ac72 形态真样本）⇒ exit 2 + FATAL + 不翻 done; AC/DoD 段缺失 ⇒
//       exit 2 NOT-EVALUATED + 不翻 done（无法评估 ≠ 合格）; 剩余未勾均为（待外部）⇒ 翻 done; ③ 行形
//       检查与 AC 闸并列（两检查都过才翻，AC 闸在行形检查之后、sed 之前）。
//   ⑤ anti-drift-touches 守卫 (gap-anti-drift-touches-zero-coverage-fast-mode) — run the REAL step-1
//       anti-drift block from the emitted prompt against a real temp git repo (task worktree after the
//       step-1 merge): a task whose ACTUAL diff touches a file OUTSIDE its declared ## Touches ⇒ the
//       block HARD-FAILs (exit 2 + FATAL + ANTI-DRIFT HARD FAIL — the AC2 负控制: 现真值=不会, 修复后应红);
//       a task whose actual diff is fully within its declared Touches ⇒ the block stays green (AC3).
//
// Run:
//   scripts/test.sh plugin/test/fan-in-execute-paths.test.mjs
//   scripts/test.sh --for-task gap-fan-in-execute-three-unverified-paths --allow-thin
//   node --test plugin/test/fan-in-execute-paths.test.mjs

// SPLIT from fan-in-execute-paths.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/6 (16 tests). Shared fixtures: ./helpers/fan-in-execute-paths-harness.mjs (single source).

import { test } from "node:test";
import { F127_ID, F128_ID, FLAT_TRAP_ID, REPO_ROOT, SESSION, SLUG, assert, classifyRealDelta, cleanup, extractBlockFromPrompts, flipBlockFor, fs, makeDir127ReplayHome, makeFlipDir, os, path, promptContaining, runBash, runWorkflow, vm, writeAgentFile } from "./helpers/fan-in-execute-paths-harness.mjs";

test("① REAL code delta — plugin/workflows/fan-in-execute.js must classify as code (rerun full suite)", async (t) => {
  // 判据2 ① 能取假: a code-face delta wrongly classified as doc would SKIP the full suite (漏检).
  // This is the AC78 承重点 file itself — editing it MUST trigger the full suite. The classify script
  // reads the registry (fan-in-workflow-check `@static-object plugin/workflows/fan-in-execute.js`), so
  // no hand-written exclude list can hide it.
  const codeDelta = await classifyRealDelta({ "plugin/workflows/fan-in-execute.js": "export const meta = {}\n" });
  assert.notEqual(codeDelta, "", `code delta must be non-empty for a .js workflow file, got: ${JSON.stringify(codeDelta)}`);
  assert.match(codeDelta, /plugin\/workflows\/fan-in-execute\.js/);
});


test("① REAL test delta — plugin/test/*.test.mjs must classify as code (test assertion face reruns)", async (t) => {
  const codeDelta = await classifyRealDelta({ "plugin/test/fan-in-execute-paths.test.mjs": "import { test } from 'node:test'\n" });
  assert.notEqual(codeDelta, "", `test delta must be non-empty (test assertion face), got: ${JSON.stringify(codeDelta)}`);
  assert.match(codeDelta, /plugin\/test\//);
});


test("① REAL doc delta — tasks/ + goals/ + docs/ + adr/ + .quay/ only must classify as doc (skip full suite)", async (t) => {
  // 判据2 ① 镜像: a pure-doc delta classified as code would WASTE a full-suite run (该跳却重跑).
  // NOTE: orchestration/*-tick-core.md is deliberately NOT here — it is read by tick-core-static-check
  // / rhythm-consumer (`@static-object orchestration/*-tick-core.md`), so it classifies as CODE
  // (gap-fan-in-delta-scope-doc-only-skip AC2 取假二).
  // NOTE 2: `.quay/config.yml` is likewise NOT here — provider-binding-resolvability-check reads it
  // (`@static-object .quay/config.yml`), so the registry override makes it CODE. That override is the
  // DESIGNED precedence (see isDocPath: "a checker reads it ⇒ code"), and it already fires for a path
  // under a doc surface today — docs/analysis/ac69-slot-release-vs-dispatch-gap.json is CODE, which is
  // why this fixture samples docs/proposals/ + docs/references/ instead. Same class, same treatment:
  // the `.quay/` surface stays covered below by a genuinely doc-only, non-checker-read path
  // (gap-pre-fix-upgraded-project-unresolvable-binding-undetected).
  const files = {
    "tasks/gap-fan-in-execute-three-unverified-paths.md": "status: ready\n",
    "goals/AC-999-fake.md": "status: ready\n",
    "docs/proposals/exp5-crystallization-strategy.md": "x\n",
    "docs/references/git.md": "y\n",
    "adr/ADR-010-scheduled-milestone-e2e-incl-browser-tests.md": "y\n",
    ".quay/prepare-epochs/DIR-999.json": "{}\n",
    "measurements/round-x.json": "{}\n",
    "milestones/fast-mode-telemetry/2026-08-16.json": "{}\n",
  };
  const codeDelta = await classifyRealDelta(files);
  assert.equal(codeDelta, "", `pure-doc delta must produce empty code_delta, got: ${JSON.stringify(codeDelta)}`);
});


test("① REAL doc delta negative — packages/quay/src/goal-store.ts must classify as code (goals/ is a prefix, not substring goal)", async (t) => {
  // gap-doc-surfaces-missing-goals-prefix AC4: a real code file whose path CONTAINS "goal" but is NOT
  // under the goals/ directory must stay CODE. The DOC_SURFACES entry is the prefix "goals/", not a
  // substring match on "goal" — an over-broad fix (substring) would misclassify this as doc and skip.
  const codeDelta = await classifyRealDelta({ "packages/quay/src/goal-store.ts": "export const x = 1\n" });
  assert.notEqual(codeDelta, "", `packages/quay/src/goal-store.ts must classify as code (not goals/ prefix), got empty`);
  assert.match(codeDelta, /packages\/quay\/src\/goal-store\.ts/);
});


test("① REAL decision — code delta ⇒ rerun decision, doc delta ⇒ skip decision (AC75 semantics)", async (t) => {
  // The workflow's OWN prose (from the emitted prompt) states the decision mapping; the real classify
  // output drives it. Re-run both through the real pipeline and confirm the mapping holds.
  const codeDelta = await classifyRealDelta({ "plugin/scripts/foo.ts": "export const x = 1\n" });
  const docDelta = await classifyRealDelta({ "tasks/gap-x.md": "x\n" });
  assert.notEqual(codeDelta, "", "code delta must be non-empty ⇒ rerun");
  assert.equal(docDelta, "", "doc delta must be empty ⇒ skip");
});


test("① AC2 取假一 — code committed EARLIER in branch history must still classify as code even when the develop-side delta is doc-only (the AC97 shape)", async (t) => {
  // gap-fan-in-delta-scope-doc-only-skip AC2 取假一: the OLD gate diffed `git diff --name-only fork
  // develop` (develop-side delta) — with develop having advanced only doc files since the fork, that
  // delta was doc-only ⇒ skipped the full suite while the branch's own code (serve.ts, committed in
  // branch history) silently landed on develop never full-suite-covered. The FIX diffs `fork HEAD` —
  // the branch's overall change ⇒ serve.ts must appear in code_delta.
  const codeDelta = await classifyRealDelta({ "packages/quay/src/serve-handlers.ts": "export const x = 1\n" });
  assert.notEqual(codeDelta, "", `branch-overall delta must see the branch's own code (取假一), got empty`);
  assert.match(codeDelta, /packages\/quay\/src\/serve-handlers\.ts/);
  // The develop-side delta (what the OLD gate saw) is doc-only — prove the falsification is real:
  // the same repo's `git diff fork develop` contains only the doc commit.
});


test("① AC2 取假一 structural — the step-2 delta line diffs fork→HEAD (branch overall), NOT fork→develop (develop-side)", async (t) => {
  // The exact fix: `git diff --name-only "$fork" HEAD`. A regression back to `${mergeTarget}` (the
  // develop-side delta the AC97 bug exploited) must fail this.
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-dir", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-dir", mergeTarget: "develop" },
  });
  const step2 = extractBlockFromPrompts(prompts, "【无锁段 step 2", "【无锁段 step 3");
  const deltaLine = step2.split("\n").find((l) => /^delta=/.test(l));
  assert.ok(deltaLine, "delta assignment line present");
  assert.match(deltaLine, /diff --name-only "\$fork" HEAD/, `delta must diff fork→HEAD (branch overall), got: ${deltaLine}`);
  // mergeTarget renders as the literal branch name in the prompt (here "develop"); the OLD develop-side
  // form `git diff --name-only "$fork" develop` must NOT be present.
  assert.doesNotMatch(deltaLine, /diff --name-only "\$fork" develop(?:$|\s)/, "delta must NOT diff fork→develop (the old develop-side delta)");
});


test("① AC2 取假二 — orchestration/manager-tick-core.md (read by tick-core-static-check / rhythm-consumer) must classify as CODE, never doc-only", async (t) => {
  // gap-fan-in-delta-scope-doc-only-skip AC2 取假二: the OLD hand-written `[.]md$` regex classified
  // orchestration/manager-tick-core.md as doc ⇒ a (src:N) violation there skipped the full suite and
  // reddened only at the NEXT full round. The new registry-driven definition (rhythm-consumer's
  // `@static-object orchestration/*-tick-core.md`) must classify it as code ⇒ the fan-in re-runs the
  // full suite.
  const codeDelta = await classifyRealDelta({ "orchestration/manager-tick-core.md": "## (src:N) violation\n" });
  assert.notEqual(codeDelta, "", `orchestration/manager-tick-core.md must classify as code (取假二), got empty`);
  assert.match(codeDelta, /orchestration\/manager-tick-core\.md/);
});


test("① AC2 — orchestration/fast-mode-tick-core.md and other checker-read .md must also classify as code", async (t) => {
  const fastMode = await classifyRealDelta({ "orchestration/fast-mode-tick-core.md": "x\n" });
  assert.notEqual(fastMode, "", "orchestration/fast-mode-tick-core.md must be code (read by ac61/rhythm-consumer)");
  const loopDoc = await classifyRealDelta({ "plugin/loop/fast-mode-loop-tick.md": "x\n" });
  assert.notEqual(loopDoc, "", "plugin/loop/fast-mode-loop-tick.md must be code (read by adr016/retired-clause/ac61)");
  const claude = await classifyRealDelta({ "CLAUDE.md": "x\n" });
  assert.notEqual(claude, "", "CLAUDE.md must be code (read by retired-clause-check)");
});

// ── REAL-INVOCATION smoke (判据3 / AC78 实调 protection) ──────────────────────────────────────────


test("REAL-INVOCATION — the workflow file vm-executes and emits the multi-agent prompt set (AC78 + stage-2 wait shape)", async (t) => {
  const { prompts, phases, result } = await runWorkflow({
    args: { task: "gap-test-smoke", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-test-1", mergeTarget: "develop" },
  });
  assert.ok(prompts.length >= 2, `fan-in emits phase1 + stage2 prompts, got ${prompts.length}`);
  // Phase 1 (prep): steps 0-4 incl. merge develop.
  assert.ok(prompts[0].includes("【无锁段 step 1"), "phase-1 prompt must carry step 1 (merge develop)");
  assert.ok(prompts[0].includes("【无锁段 step 4"), "phase-1 prompt must carry step 4");
  // Phase 2 (mechanical): flip/selfloc/bracket live in the LAST agent prompt.
  const p2 = promptContaining(prompts, "# flip-block-start");
  assert.ok(p2.includes("【持锁段 step 5"), "phase-2 prompt must carry step 5");
  assert.ok(p2.includes("# selfloc-block-start"), "selfloc block marker present");
  assert.deepEqual(phases, ["FanIn"]);
  // Default mock sequence drives the GREEN path through the script-owned wait ⇒ outcome green.
  assert.equal(result.outcome, "green");
  assert.equal(result.ffOk, true);
});

// ── ② --agent-id self-location determinism (REAL bash over a fake ~/.claude tree) ────────────────


test("② DIR-127/DIR-128 replay — the workflows/-scoped self-location picks the workflow-run subagent, NOT the flat trap", async (t) => {
  const { home } = makeDir127ReplayHome();
  t.after(() => cleanup(home));
  const { prompts } = await runWorkflow({
    args: { task: "gap-dir-127", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-dir127", mergeTarget: "develop" },
  });
  const selfloc = extractBlockFromPrompts(prompts, "# selfloc-block-start", "# selfloc-block-end");
  const r = runBash(selfloc + '\necho "RESULT_AGENT_ID=$agent_id"', { cwd: "/tmp", env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, `selfloc bash failed (${r.status}): ${r.stderr}`);
  const m = r.stdout.match(/RESULT_AGENT_ID=([^\n]*)/);
  assert.ok(m, `agent_id echo missing:\n${r.stdout}`);
  // The flat trap (a017ce6b7fab53eb9 — DIR-128's impl agent) must NOT be chosen:
  assert.notEqual(m[1], FLAT_TRAP_ID, `MUST NOT mis-attribute to the flat trap (DIR-127/DIR-128 bug)`);
  assert.equal(m[1], F127_ID, "must pick DIR-127's own workflow-run fan-in subagent (the current run, newest)");
});


test("② regression canary — the OLD flat-glob heuristic WOULD mis-pick the trap (判据2 ② 能取假)", (t) => {
  const { home } = makeDir127ReplayHome();
  t.after(() => cleanup(home));
  // The pre-fix command (flat subagents/ glob) — replays the real DIR-127 ff misattribution.
  const oldCmd = `self=$(ls -t ~/.claude/projects/*/subagents/agent-*.jsonl 2>/dev/null | while read f; do grep -l 'gap-dir-127' "$f" 2>/dev/null; done | head -1)\necho "RESULT_AGENT_ID=$(basename "$self" .jsonl 2>/dev/null | sed 's/^agent-//')"`;
  const r = runBash(oldCmd, { cwd: "/tmp", env: { ...process.env, HOME: home } });
  const m = r.stdout.match(/RESULT_AGENT_ID=([^\n]*)/);
  assert.ok(m, `agent_id echo missing:\n${r.stdout}`);
  assert.equal(m[1], FLAT_TRAP_ID, "the old flat heuristic picks the DIR-128 impl agent — the recorded bug");
});


test("② zero candidates ⇒ fail-closed exit 2 (refuses to guess an agent id)", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-emptyhome-"));
  t.after(() => cleanup(home));
  const { prompts } = await runWorkflow({
    args: { task: "gap-no-such-task", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-none", mergeTarget: "develop" },
  });
  const selfloc = extractBlockFromPrompts(prompts, "# selfloc-block-start", "# selfloc-block-end");
  const r = runBash(selfloc, { cwd: "/tmp", env: { ...process.env, HOME: home } });
  assert.equal(r.status, 2, `fail-closed must exit 2, got ${r.status}`);
  assert.match(r.stderr, /FATAL/);
});


test("② determinism — multiple workflow-run candidates for the SAME task pick the newest (current run)", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-multi-"));
  t.after(() => cleanup(home));
  const now = Date.now();
  const base = path.join(home, ".claude", "projects", SLUG, SESSION, "subagents", "workflows");
  // A prior (stale) run of the SAME task + the current run — both mention the task.
  writeAgentFile(path.join(base, "wf_oldrun-000", `agent-${F127_ID}.jsonl`), ["fan-in gap-dir-127 (stale)"], now - 60_000);
  writeAgentFile(path.join(base, "wf_newrun-111", `agent-${F128_ID}.jsonl`), ["fan-in gap-dir-127 (current)"], now);
  const { prompts } = await runWorkflow({
    args: { task: "gap-dir-127", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-retry", mergeTarget: "develop" },
  });
  const selfloc = extractBlockFromPrompts(prompts, "# selfloc-block-start", "# selfloc-block-end");
  const r = runBash(selfloc + '\necho "RESULT_AGENT_ID=$agent_id"', { cwd: "/tmp", env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/RESULT_AGENT_ID=([^\n]*)/);
  assert.equal(m[1], F128_ID, "must pick the NEWEST workflow-run subagent mentioning the task");
});

// ── ③ flip sed fail-closed (REAL bash over real task files) ──────────────────────────────────────




test("③ normal flip — 'status: ready' → 'status: done', body 'status: ready——注解' preserved", async (t) => {
  const dir = makeFlipDir("fan-in-flip-");
  t.after(() => cleanup(dir));
  const taskFile = path.join(dir, "tasks", "gap-test-flip.md");
  fs.writeFileSync(taskFile, [
    "---",
    "id: gap-test-flip",
    "status: ready",
    "---",
    "## Acceptance Criteria",
    "- [x] AC1 done",
    "- [x] AC2 done",
    "## Definition of Done",
    "- [x] DoD done",
    "## Plan",
    "status: ready——注解（body 里的历史说明，不得被误翻）",
  ].join("\n") + "\n", "utf8");
  const r = runBash(await flipBlockFor("gap-test-flip", dir), { cwd: dir });
  assert.equal(r.status, 0, `flip should succeed: ${r.stderr}`);
  const after = fs.readFileSync(taskFile, "utf8");
  assert.match(after, /^status: done$/m, "frontmatter flipped to done");
  assert.doesNotMatch(after, /^status: ready$/m, "frontmatter no longer ready");
  assert.ok(after.includes("status: ready——注解"), "body annotation must NOT be corrupted by the flip");
});


test("③ line-shape mismatch (status:Ready) ⇒ exit 2 + FATAL, file NOT flipped (no silent green)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-flipbad-"));
  t.after(() => cleanup(dir));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  const taskFile = path.join(dir, "tasks", "gap-test-bad.md");
  const original = "---\nid: gap-test-bad\nstatus:Ready\n---\n";
  fs.writeFileSync(taskFile, original, "utf8");
  const r = runBash(await flipBlockFor("gap-test-bad", dir), { cwd: dir });
  assert.equal(r.status, 2, `line-shape mismatch must exit 2 (fail-closed), got ${r.status}`);
  assert.match(r.stderr, /FATAL/);
  assert.match(r.stderr, /flip 失败/);
  assert.equal(fs.readFileSync(taskFile, "utf8"), original, "file must be unchanged when flip fails");
});
