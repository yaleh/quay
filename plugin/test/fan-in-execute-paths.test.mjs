// @test-group serial
// fan-in-execute-paths.test.mjs — gap-fan-in-execute-three-unverified-paths: the three UNVERIFIED
// hot points of .claude/workflows/fan-in-execute.js, exercised through the REAL invocation path
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

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { buildTaskManifest, checkTaskAntiDrift } from "../scripts/anti-drift-touches-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".claude", "workflows", "fan-in-execute.js");

// ── REAL-INVOCATION harness: vm-execute the actual workflow file ────────────────────────────────────
// The workflow file is ESM-ish (`export const meta`) with a top-level `return` (workflow-runtime-only),
// so it is NOT directly importable — we strip `export ` and wrap in an async function, then run it in
// a vm context with the workflow-runtime globals the script expects. The script's own code executes
// and `agent()` captures the exact prompt it would send to the fan-in subagent.
async function runWorkflow(opts) {
  const src = fs.readFileSync(WORKFLOW, "utf8");
  const body = src.replace(/^export\s+const\s+meta/m, "const meta");
  const wrapped = "(async () => {\n" + body + "\n})()";
  const captured = { prompts: [], schemas: [], phases: [], logs: [], delays: [] };
  // Default agent sequence: drive the GREEN path (phase1 suite-started → stage2 green), so tests that
  // only extract blocks from the emitted prompts still exercise the full multi-agent flow. The stage-2
  // agent (NOT a separate poll agent) loops <600s Bash waits inline, then does the mechanical steps
  // (gap-subagent-turn-budget-13min-falsified: no per-round short-lived poll agents anymore).
  const defaultResults = [
    { outcome: "suite-started", suitePid: 4242, codeDelta: "mock-code", worktreeHead: "mockhead", note: "mock-prep" },
    { outcome: "green", ffOk: true, developHead: "dhead", worktreeHead: "whead", agentIdUsed: "mockagent", codeDelta: "mock-code", note: "bracketClose=OK", bracketClosed: true },
  ];
  const sandbox = {
    console,
    // The workflow no longer owns setTimeout-based poll scheduling (the stage-2 agent waits inline);
    // the delay recording is kept for tests that still inspect captured.delays (empty in the new shape).
    setTimeout: (fn, _ms) => { captured.delays.push(_ms); setTimeout(fn, 0); },
    clearTimeout,
    args: JSON.stringify(opts.args),
    phase: (...a) => captured.phases.push(...a),
    log: (...a) => captured.logs.push(...a),
    agent: async (prompt, schema) => {
      const i = captured.prompts.length;
      captured.prompts.push(prompt);
      captured.schemas.push(schema);
      if (typeof opts.agentResult === "function") return opts.agentResult(prompt, schema, i);
      if (opts.agentResults && i < opts.agentResults.length) return opts.agentResults[i];
      if (opts.agentResult !== undefined) return opts.agentResult;
      return i < defaultResults.length ? defaultResults[i] : { outcome: "red", ffOk: false };
    },
  };
  const ctx = vm.createContext(sandbox);
  const script = new vm.Script(wrapped, { filename: WORKFLOW });
  const promise = script.runInContext(ctx);
  if (!promise || typeof promise.then !== "function") {
    throw new Error(`vm execution of ${WORKFLOW} did not return a promise (got ${typeof promise})`);
  }
  const result = await promise;
  return { ...captured, result, prompt: captured.prompts[0] ?? null };
}

function extractBlock(text, start, end) {
  const s = text.indexOf(start);
  const e = text.indexOf(end, s);
  if (s === -1 || e === -1) {
    throw new Error(`block markers not found in emitted prompt: start=${start} end=${end}`);
  }
  return text.slice(s, e);
}

/** Search ALL emitted prompts for the block between `start` and `end` markers (the split fan-in emits
 *  multiple agent prompts: phase 1 = prep/launch, poll = suite wait, phase 2 = record/flip/ff/bracket).
 *  Returns the FIRST prompt that contains the start marker and slices to the end marker. */
function extractBlockFromPrompts(prompts, start, end) {
  for (const p of prompts) {
    const s = p.indexOf(start);
    if (s === -1) continue;
    const e = p.indexOf(end, s);
    if (e === -1) throw new Error(`block end marker not found in the same prompt: start=${start} end=${end}`);
    return p.slice(s, e);
  }
  throw new Error(`block markers not found in any emitted prompt: start=${start} end=${end}`);
}

/** The single prompt containing `marker` (e.g. "# flip-block-start"). Fails if none. */
function promptContaining(prompts, marker) {
  const p = prompts.find((x) => x.includes(marker));
  if (!p) throw new Error(`no emitted prompt contains marker: ${marker}`);
  return p;
}

function runBash(cmd, opts = {}) {
  const r = spawnSync("bash", ["-c", cmd], {
    encoding: "utf8",
    timeout: 30_000,
    ...opts,
  });
  if (r.error) {
    throw new Error(`bash spawn failed: ${r.error.message}\ncmd: ${cmd.slice(0, 200)}`);
  }
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ── ① real git repo helpers ────────────────────────────────────────────────────────────────────────
// gap-fan-in-delta-scope-doc-only-skip (AC2 取假一): the repo models the AC97 shape — the BRANCH (main,
// = the fan-in worktree's HEAD) holds the files under test, develop advances with a DOC-ONLY commit
// since the fork. `git diff --name-only <merge-base> HEAD` = the branch's overall change (the fan-in
// would land); `git diff --name-only <merge-base> develop` (the OLD buggy develop-side delta) sees only
// the doc commit ⇒ the old gate judged doc-only and skipped the full suite while the branch's code
// slipped through. The real `plugin/` tree is symlinked in (AFTER the commits) so the classify script
// resolves; the symlink is untracked and never appears in the git diff.

// ── ⑦ runtime-tree symlink helper (gap-fan-in-orchestration-bootstrap-self-fix) ─────────────────────
// The workflow's step-0 bootstrap block and every fan-in orchestration script call now resolve through
// ${worktree} (explicit worktree-rooted paths, NOT cwd / ${root}). Tests that EXECUTE those blocks
// against a temp worktree must give the temp worktree a resolvable runtime tree — symlink the REAL
// plugin/ + scripts/ AFTER the git commits (untracked ⇒ never in `git diff --name-only`), subdir-by-
// subdir when the delta itself carries a plugin/ path (a whole-dir symlink would EEXIST on the
// committed delta file's dir).

/** Symlink the REAL repo's runtime trees into a temp worktree so worktree-resolved orchestration
 *  scripts (${worktree}/plugin/scripts/…) execute against the real implementation. plugin/ is symlinked
 *  whole UNLESS the delta carries a plugin/ path (then the classify import chain is symlinked
 *  file-by-file into the existing plugin/scripts/); scripts/ (scripts/test.sh — the classify's
 *  --root registry) is always symlinked. */
function symlinkRuntimeTrees(dir, files) {
  const delta = new Set(Object.keys(files || {}).map((p) => String(p).replace(/\\/g, "/")));
  const hasPluginDelta = [...delta].some((p) => p === "plugin" || p.startsWith("plugin/"));
  if (!hasPluginDelta) {
    if (!fs.existsSync(path.join(dir, "plugin"))) {
      fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(dir, "plugin"), "dir");
    }
  } else {
    fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
    for (const f of ["select-static-checks-for-touches.ts", "runner-static-gate.ts", "task-schema.ts", "touches-parser.ts",
                     "gate-script-base.ts", "wiring-coverage-check.ts", "touches-orthogonality-check.ts"]) {
      const dest = path.join(dir, "plugin", "scripts", f);
      if (!fs.existsSync(dest) && !delta.has(`plugin/scripts/${f}`)) {
        fs.symlinkSync(path.join(REPO_ROOT, "plugin", "scripts", f), dest, "file");
      }
    }
  }
  if (!fs.existsSync(path.join(dir, "scripts"))) {
    fs.symlinkSync(path.join(REPO_ROOT, "scripts"), path.join(dir, "scripts"), "dir");
  }
}
function makeRepoWithDelta(files, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-delta-"));
  const run = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
    }
  };
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "test@test"]);
  run(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  run(["add", "-A"]);
  run(["commit", "-qm", "base"]);
  run(["checkout", "-q", "-b", "develop"]);
  // develop advances with a DOC-ONLY commit since the fork (the AC97 develop-side delta). The
  // branch's OWN code (committed before/independently of this) is what the new delta must see.
  const developFiles = opts.developFiles ?? { "tasks/develop-note.md": "dev-doc\n" };
  for (const [p, content] of Object.entries(developFiles)) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  run(["add", "-A"]);
  run(["commit", "-qm", "develop-doc-only"]);
  run(["checkout", "-q", "main"]); // HEAD = the task worktree view (the branch)
  for (const [p, content] of Object.entries(files)) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  run(["add", "-A"]);
  run(["commit", "-qm", "branch-delta"]);
  if (opts.mergeDevelop) run(["merge", "-q", "develop", "-m", "merge-develop"]);
  return dir;
}

// Run the REAL step-2 bash (fork/delta/code_delta) from the workflow's emitted prompt against a real
// temp git repo holding `files` on the BRANCH. Returns the computed code_delta string.
// The bash runs with cwd = the REAL repo root: `git -C <temp>` addresses the temp repo by absolute
// path, while the classify call `node plugin/scripts/select-static-checks-for-touches.ts` must resolve
// through the REAL plugin/ tree (a temp repo with files under `plugin/` would shadow it).
async function classifyRealDelta(files, opts) {
  const repo = makeRepoWithDelta(files, opts);
  try {
    symlinkRuntimeTrees(repo, files); // worktree-resolved classify needs a runtime tree in the temp repo
    const { prompts } = await runWorkflow({
      args: { task: "gap-test-delta", worktree: repo, root: REPO_ROOT, runId: "fm-test-1", mergeTarget: "develop" },
    });
    const step2 = extractBlockFromPrompts(prompts, "【无锁段 step 2", "【无锁段 step 3");
    const bashLines = step2
      .split("\n")
      .filter((l) => /^(fork=|delta=|code_delta=)/.test(l));
    assert.ok(bashLines.length >= 3, `step-2 bash lines found: ${bashLines.length}`);
    const r = runBash(bashLines.join("\n") + '\necho "RESULT_CODE_DELTA=[$code_delta]"', { cwd: REPO_ROOT });
    assert.equal(r.status, 0, `step-2 bash failed: ${r.stderr}`);
    const m = r.stdout.match(/RESULT_CODE_DELTA=\[([\s\S]*)\]/);
    assert.ok(m, `code_delta echo missing in stdout:\n${r.stdout}`);
    return m[1];
  } finally {
    cleanup(repo);
  }
}

// ── ② fake ~/.claude tree helpers ──────────────────────────────────────────────────────────────────
const SLUG = "-home-yale-work-quay";
const SESSION = "bc1a438b-66f2-4760-8964-91c641166602";
const FLAT_TRAP_ID = "a017ce6b7fab53eb9"; // the REAL DIR-128 impl agent the old heuristic mis-picked
const F127_ID = "f127deadbeef000001"; // DIR-127's OWN workflow-run fan-in subagent
const F128_ID = "f128deadbeef000002"; // DIR-128's workflow-run fan-in subagent

function writeAgentFile(file, mentions, mtimeMs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = mentions.map((m) => JSON.stringify({ message: { role: "user", content: m } })).join("\n") + "\n";
  fs.writeFileSync(file, body, "utf8");
  fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
}

/** Replays the DIR-127/DIR-128 concurrency: a FLAT subagent (the trap, newest mtime) mentions the
 *  task 41×, while the task's OWN workflow-run subagent also mentions it. The trap sits at the
 *  ONE-level flat subagents path (`<slug>/subagents/`) so the OLD flat-glob heuristic (判据2 ②
 *  canary) matches it; the workflow-run subagents sit at the REAL two-level path
 *  (`<slug>/<session>/subagents/workflows/<run>/`). Returns { home, files }. */
function makeDir127ReplayHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-fakehome-"));
  const project = path.join(home, ".claude", "projects", SLUG);
  const sessionSubagents = path.join(project, SESSION, "subagents");
  const now = Date.now();
  const flatTrap = path.join(project, "subagents", `agent-${FLAT_TRAP_ID}.jsonl`);
  const wf127 = path.join(sessionSubagents, "workflows", "wf_dir127f0-1a2", `agent-${F127_ID}.jsonl`);
  const wf128 = path.join(sessionSubagents, "workflows", "wf_dir128f0-3b4", `agent-${F128_ID}.jsonl`);
  // The trap: DIR-128's implementation subagent mentions DIR-127 41× AND is the newest (the real
  // 2026-08-14 11:18 trap — ls -t + grep task picked it for DIR-127's ff).
  writeAgentFile(flatTrap, Array.from({ length: 41 }, (_, i) => `gap-dir-127 mention ${i}`), now);
  // DIR-127's own fan-in subagent (the CORRECT pick): mentions DIR-127, slightly older than the trap.
  writeAgentFile(wf127, ["fan-in gap-dir-127", "git merge develop", "flip done"], now - 2000);
  // DIR-128's fan-in subagent: mentions DIR-128 only — NOT a candidate for the DIR-127 search.
  writeAgentFile(wf128, ["fan-in gap-dir-128", "git merge develop", "flip done"], now - 4000);
  return { home, files: { flatTrap, wf127, wf128 } };
}

// ── ① code_delta regex classification (REAL git execution, 判据3) ─────────────────────────────────

test("① REAL code delta — .claude/workflows/fan-in-execute.js must classify as code (rerun full suite)", async (t) => {
  // 判据2 ① 能取假: a code-face delta wrongly classified as doc would SKIP the full suite (漏检).
  // This is the AC78 承重点 file itself — editing it MUST trigger the full suite. The classify script
  // reads the registry (fan-in-workflow-check `@static-object .claude/workflows/fan-in-execute.js`), so
  // no hand-written exclude list can hide it.
  const codeDelta = await classifyRealDelta({ ".claude/workflows/fan-in-execute.js": "export const meta = {}\n" });
  assert.notEqual(codeDelta, "", `code delta must be non-empty for a .js workflow file, got: ${JSON.stringify(codeDelta)}`);
  assert.match(codeDelta, /\.claude\/workflows\/fan-in-execute\.js/);
});

test("① REAL test delta — plugin/test/*.test.mjs must classify as code (test assertion face reruns)", async (t) => {
  const codeDelta = await classifyRealDelta({ "plugin/test/fan-in-execute-paths.test.mjs": "import { test } from 'node:test'\n" });
  assert.notEqual(codeDelta, "", `test delta must be non-empty (test assertion face), got: ${JSON.stringify(codeDelta)}`);
  assert.match(codeDelta, /plugin\/test\//);
});

test("① REAL doc delta — tasks/ + docs/ + adr/ + .quay/ only must classify as doc (skip full suite)", async (t) => {
  // 判据2 ① 镜像: a pure-doc delta classified as code would WASTE a full-suite run (该跳却重跑).
  // NOTE: orchestration/*-tick-core.md is deliberately NOT here — it is read by tick-core-static-check
  // / rhythm-consumer (`@static-object orchestration/*-tick-core.md`), so it classifies as CODE
  // (gap-fan-in-delta-scope-doc-only-skip AC2 取假二).
  const files = {
    "tasks/gap-fan-in-execute-three-unverified-paths.md": "status: ready\n",
    "docs/proposals/exp5-crystallization-strategy.md": "x\n",
    "docs/references/git.md": "y\n",
    "adr/ADR-010-scheduled-milestone-e2e-incl-browser-tests.md": "y\n",
    ".quay/config.yml": "providers: {}\n",
    "measurements/round-x.json": "{}\n",
    "milestones/fast-mode-telemetry/2026-08-16.json": "{}\n",
  };
  const codeDelta = await classifyRealDelta(files);
  assert.equal(codeDelta, "", `pure-doc delta must produce empty code_delta, got: ${JSON.stringify(codeDelta)}`);
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

async function flipBlockFor(task, worktree) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root: REPO_ROOT, runId: "fm-flip", mergeTarget: "develop" },
  });
  return extractBlockFromPrompts(prompts, "# flip-block-start", "# flip-block-end");
}

// makeFlipDir — a temp "worktree" dir for flip-block tests. Symlinks the REAL `plugin/` tree so the
// AC completion gate script (plugin/scripts/fan-in-ac-completion-gate.ts) and its import chain
// (ready-pool-check.ts / slot-refill.ts / …) resolve through the real repo files (判据3 — real
// invocation, not a fixture stub). The flip block runs with cwd = this dir, so `tasks/<id>.md` is
// the test's own file while `plugin/scripts/…` comes from the real tree.
function makeFlipDir(prefix = "fan-in-flip-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(dir, "plugin"), "dir");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  return dir;
}

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

test("③ multiple exact 'status: ready' matches ⇒ exit 2 + FATAL (refuses to multi-flip)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-flipmulti-"));
  t.after(() => cleanup(dir));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  const taskFile = path.join(dir, "tasks", "gap-test-multi.md");
  fs.writeFileSync(taskFile, [
    "---",
    "id: gap-test-multi",
    "status: ready",
    "---",
    "## Evidence",
    "status: ready",
  ].join("\n") + "\n", "utf8");
  const r = runBash(await flipBlockFor("gap-test-multi", dir), { cwd: dir });
  assert.equal(r.status, 2, `ambiguous (2 exact matches) must exit 2, got ${r.status}`);
  assert.match(r.stderr, /FATAL/);
  assert.match(r.stderr, /应恰有 1 行/);
});

// ── ④ flip AC-completion gate (gap-fan-in-flip-no-ac-completion-check, REAL bash) ───────────────

test("④ AC 未全勾（gap-ac72 形态真样本）⇒ exit 2 + FATAL, 不翻 done (workflow no longer bypasses AC47)", async (t) => {
  const dir = makeFlipDir("fan-in-flipac-");
  t.after(() => cleanup(dir));
  const taskFile = path.join(dir, "tasks", "gap-test-acfail.md");
  fs.writeFileSync(taskFile, [
    "---",
    "id: gap-test-acfail",
    "status: ready",
    "---",
    "## Acceptance Criteria",
    "- [ ] AC1 判据1：未勾",
    "- [ ] AC2 判据2：未勾",
    "## Definition of Done",
    "- [ ] DoD 未勾",
  ].join("\n") + "\n", "utf8");
  const r = runBash(await flipBlockFor("gap-test-acfail", dir), { cwd: dir });
  assert.equal(r.status, 2, `AC 未全勾 must exit 2 (flip refused), got ${r.status}`);
  assert.match(r.stderr, /FATAL/);
  assert.match(r.stderr, /AC 完成闸未通过/);
  const after = fs.readFileSync(taskFile, "utf8");
  assert.match(after, /^status: ready$/m, "file must NOT be flipped when ACs are unchecked");
  assert.doesNotMatch(after, /^status: done$/m, "file must NOT be flipped when ACs are unchecked");
});

test("④ AC/DoD 段缺失 ⇒ exit 2 NOT-EVALUATED, 不翻 done (无法评估 ≠ 合格)", async (t) => {
  const dir = makeFlipDir("fan-in-flipacnone-");
  t.after(() => cleanup(dir));
  const taskFile = path.join(dir, "tasks", "gap-test-nosec.md");
  fs.writeFileSync(taskFile, "---\nid: gap-test-nosec\nstatus: ready\n---\n## Plan\nonly a plan\n", "utf8");
  const r = runBash(await flipBlockFor("gap-test-nosec", dir), { cwd: dir });
  assert.equal(r.status, 2, `missing AC/DoD section must exit 2 (NOT-EVALUATED), got ${r.status}`);
  assert.match(r.stderr, /FATAL/);
  assert.match(fs.readFileSync(taskFile, "utf8"), /^status: ready$/m, "file must NOT be flipped when AC/DoD section is absent");
});

test("④ 剩余未勾均为（待外部）⇒ 翻 done (established awaiting-verification done-flip shape)", async (t) => {
  const dir = makeFlipDir("fan-in-flipacext-");
  t.after(() => cleanup(dir));
  const taskFile = path.join(dir, "tasks", "gap-test-ext.md");
  fs.writeFileSync(taskFile, [
    "---",
    "id: gap-test-ext",
    "status: ready",
    "---",
    "## Acceptance Criteria",
    "- [x] AC1 impl done",
    "- [ ] AC2 等全量套件绿（待外部）",
    "## Definition of Done",
    "- [ ] 外层验证（待外部）",
  ].join("\n") + "\n", "utf8");
  const r = runBash(await flipBlockFor("gap-test-ext", dir), { cwd: dir });
  assert.equal(r.status, 0, `待外部-only must flip (exit 0), got ${r.status}: ${r.stderr}`);
  assert.match(fs.readFileSync(taskFile, "utf8"), /^status: done$/m, "frontmatter flipped to done");
});

test("④ AC 完成闸与承重点③ 行形检查并列 — 两检查都过才翻（AC 闸在行形检查之后、sed 之前）", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-both", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-both", mergeTarget: "develop" },
  });
  const flip = extractBlockFromPrompts(prompts, "# flip-block-start", "# flip-block-end");
  assert.ok(flip.includes("fan-in-ac-completion-gate.ts"), "flip block must run the AC completion gate (判据3 兼容不互斥)");
  assert.ok(flip.includes("flip_count=$(grep -c '^status: ready$'"), "flip block must still run the ③ line-shape pre-check");
  assert.ok(flip.indexOf("fan-in-ac-completion-gate.ts") > flip.indexOf("flip_count="), "AC gate must come AFTER the line-shape pre-check");
  assert.ok(flip.indexOf("fan-in-ac-completion-gate.ts") < flip.indexOf("sed -i"), "AC gate must come BEFORE the sed flip");
});

// ── ⑤ anti-drift-touches 守卫（gap-anti-drift-touches-zero-coverage-fast-mode, REAL git + REAL prompt）──

/** A real temp git repo replaying the fan-in workflow's step-1 post-merge state: develop holds a
 *  doc-only commit, the task worktree (`main`) holds the task file + the task's changed files, and
 *  develop has been MERGED in (so `git diff --name-only develop...HEAD` = exactly the files the
 *  fan-in would land — develop's own doc change excluded). The REAL `plugin/` tree is symlinked in
 *  AFTER the final commit/merge so it is never part of the git diff. */
function makeAntiDriftRepo({ taskId, body, files }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-antidrift-"));
  const run = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
  };
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "test@test"]);
  run(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  run(["add", "README.md"]);
  run(["commit", "-qm", "base"]);
  run(["checkout", "-q", "-b", "develop"]);
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "note.md"), "dev\n");
  run(["add", "docs/note.md"]);
  run(["commit", "-qm", "develop-doc"]);
  run(["checkout", "-q", "main"]);
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), body, "utf8");
  for (const [p, content] of Object.entries(files)) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  run(["add", "-A"]);
  run(["commit", "-qm", "task-changes"]);
  run(["merge", "-q", "develop", "-m", "merge-develop"]);
  return dir;
}

async function antiDriftBlockFor(task, worktree) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root: REPO_ROOT, runId: "fm-ad", mergeTarget: "develop" },
  });
  return extractBlockFromPrompts(prompts, "# anti-drift-block-start", "# anti-drift-block-end");
}

test("⑤ wiring — step 1 runs anti-drift-touches-check with the actual diff after the merge", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-ad-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-ad-wire", mergeTarget: "develop" },
  });
  const step1 = extractBlockFromPrompts(prompts, "【无锁段 step 1", "【无锁段 step 2");
  assert.ok(step1.includes("# anti-drift-block-start"), "anti-drift check must run inside step 1 (after the merge)");
  assert.ok(step1.includes("anti-drift-touches-check.ts --task"), "prompt must invoke the anti-drift driver");
  assert.ok(step1.includes("--merge-target develop"), "driver must receive the merge target");
});

test("⑤ driver unit — buildTaskManifest extracts declared Touches as globs (ONE touches-parser)", () => {
  const body = "---\nid: x\n---\n## Touches\n- tasks/x.md\n- plugin/test/**\n";
  const builds = buildTaskManifest(body, ["tasks/x.md", "plugin/test/a.test.mjs"]);
  assert.equal(builds.length, 1);
  assert.deepEqual(builds[0].declaredGlobs, ["tasks/x.md", "plugin/test/**"]);
  assert.deepEqual(builds[0].actualFiles, ["tasks/x.md", "plugin/test/a.test.mjs"]);
});

test("⑤ driver unit — a legitimately scoped task build is OK; a stray write is HARD-FAIL (judgment unchanged)", () => {
  const ok = checkTaskAntiDrift("## Touches\n- pkg/a/**\n", ["pkg/a/x.js", "pkg/a/y.js"]);
  assert.equal(ok.ok, true, "actual ⊆ declared must be clean");
  const stray = checkTaskAntiDrift("## Touches\n- pkg/a/**\n", ["pkg/a/x.js", "pkg/OTHER/stray.js"]);
  assert.equal(stray.ok, false, "out-of-declared write must be a violation");
  assert.ok(stray.violations.find((v) => v.type === "out-of-declared" && v.file === "pkg/OTHER/stray.js"));
});

test("⑤ REAL negative control — a task whose ACTUAL diff touches a file OUTSIDE its declared Touches ⇒ HARD-FAIL (AC2)", async (t) => {
  const repo = makeAntiDriftRepo({
    taskId: "gap-test-ad",
    body: "---\nid: gap-test-ad\nstatus: ready\n---\n## Touches\n- tasks/gap-test-ad.md\n- pkg/a/**\n",
    files: { "pkg/a/x.js": "x\n", "pkg/OTHER/stray.js": "stray\n" },
  });
  t.after(() => cleanup(repo));
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(repo, "plugin"), "dir");
  const block = await antiDriftBlockFor("gap-test-ad", repo);
  const r = runBash(block, { cwd: repo });
  assert.notEqual(r.status, 0, `out-of-scope touch must HARD-FAIL (exit non-zero), got ${r.status}`);
  assert.match(r.stdout, /ANTI-DRIFT HARD FAIL/, "driver must print ANTI-DRIFT HARD FAIL");
  assert.match(r.stdout, /pkg\/OTHER\/stray\.js/, "the out-of-declared file must be named");
  assert.match(r.stderr, /FATAL/, "the block must FATAL on the guardrail bite");
});

test("⑤ REAL positive — a task whose ACTUAL diff is fully within its declared Touches ⇒ stays green (AC3)", async (t) => {
  const repo = makeAntiDriftRepo({
    taskId: "gap-test-ad-ok",
    body: "---\nid: gap-test-ad-ok\nstatus: ready\n---\n## Touches\n- tasks/gap-test-ad-ok.md\n- pkg/a/**\n",
    files: { "pkg/a/x.js": "x\n", "pkg/a/y.js": "y\n" },
  });
  t.after(() => cleanup(repo));
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(repo, "plugin"), "dir");
  const block = await antiDriftBlockFor("gap-test-ad-ok", repo);
  const r = runBash(block, { cwd: repo });
  assert.equal(r.status, 0, `legitimate scoped change must stay green, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /ANTI-DRIFT OK/, "driver must print ANTI-DRIFT OK");
});

// ── ⑨ land 前 anti-drift 重跑（gap-fan-in-fix-commit-delta-escapes-touches-coverage）────────────────
// THE DEFECT: step-1's anti-drift check runs right after the merge; fix-agent commits (suite red → fix
// patch → re-run) land AFTER it, so their touched files are never re-checked against ## Touches (real:
// gap-worktree-remove-orphans-probes's fix commit c2917261 modified full-suite-runner.test.mjs — outside
// Touches — and landed unnoticed). FIX: re-run the SAME driver at land time (持锁段 step 5, before flip
// done / ff), where `git diff --name-only ${mergeTarget}...HEAD` now includes the fix commits. Judgment
// logic UNCHANGED (AC3); only a call site is added. Normal fan-in (no fix, or fix within Touches) must
// not false-positive (AC2).

async function antiDriftLandBlockFor(task, worktree) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root: REPO_ROOT, runId: "fm-adland", mergeTarget: "develop" },
  });
  return extractBlockFromPrompts(prompts, "# anti-drift-land-block-start", "# anti-drift-land-block-end");
}

/** Symlink the REAL plugin/ tree into a temp repo as a RUNTIME-ONLY tree, and keep it OUT of git.
 *  The real fan-in worktree has plugin/ as a TRACKED real dir; here it is only a runtime-resolution
 *  symlink (the driver resolves ${worktree}/plugin/scripts/…). Without the .git/info/exclude entry a
 *  later `git add -A` (a fix-agent commit) would stage the symlink and pollute `git diff`.
 *  ⛔ HAZARD: because this symlink points at the REAL repo's plugin/, any test that WRITES a file under
 *  <temp>/plugin/… writes through the symlink into the real worktree (the recorded
 *  full-suite-runner.test.mjs truncation, 2026-08-17). Fix-agent commit fixtures in this file must use
 *  a NON-plugin path (e.g. packages/quay/test/…) to model the out-of-scope file. */
function symlinkPluginForGit(dir) {
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(dir, "plugin"), "dir");
  fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), "\nplugin\n");
}

function commitFiles(dir, files, msg) {
  const run = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
  };
  for (const [p, content] of Object.entries(files)) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  run(["add", "-A"]);
  run(["commit", "-qm", msg]);
}

test("⑨ wiring — the phase-2 prompt carries a land-time anti-drift block BEFORE flip done / ff (持锁段 step 5)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-adland-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-adland-wire", mergeTarget: "develop" },
  });
  const block = extractBlockFromPrompts(prompts, "# anti-drift-land-block-start", "# anti-drift-land-block-end");
  assert.ok(block.includes("anti-drift-touches-check.ts --task"), "land block must invoke the anti-drift driver");
  assert.ok(block.includes("--merge-target develop"), "land block must pass the merge target");
  assert.ok(block.includes("exit 2"), "land block must fail closed (exit 2) on violation");
  // Placement: the block runs in the phase-2 prompt, in the持锁段 step 5, BEFORE the flip done and the ff.
  const p2 = promptContaining(prompts, "# anti-drift-land-block-start");
  const step5Idx = p2.indexOf("【持锁段 step 5");
  const landIdx = p2.indexOf("# anti-drift-land-block-start");
  const flipIdx = p2.indexOf("# flip-block-start");
  const ffIdx = p2.indexOf("fan-in-ff-merge.sh --task");
  assert.ok(step5Idx !== -1, "phase-2 prompt must carry 持锁段 step 5");
  assert.ok(landIdx > step5Idx, "land block must be inside step 5 (持锁段)");
  assert.ok(flipIdx > landIdx, "land block must come BEFORE the flip block (flip done)");
  assert.ok(ffIdx > landIdx, "land block must come BEFORE the ff-merge");
});

test("⑨ REAL fix commit out-of-bounds ⇒ HARD FAIL — step-1 passes, the land re-check bites (AC1 取假)", async (t) => {
  // The falsifiable case: step-1's anti-drift (the ONLY check in the pre-fix flow) passes on the pre-fix
  // state; the fix agent then commits a file OUTSIDE Touches (the c2917261 shape: a test file not
  // declared); the land-time re-check must HARD-FAIL (no flip done, no ff).
  const repo = makeAntiDriftRepo({
    taskId: "gap-test-adland",
    body: "---\nid: gap-test-adland\nstatus: ready\n---\n## Touches\n- tasks/gap-test-adland.md\n- pkg/a/**\n",
    files: { "pkg/a/x.js": "x\n", "pkg/a/y.js": "y\n" },
  });
  t.after(() => cleanup(repo));
  symlinkPluginForGit(repo);
  // 1. The step-1 anti-drift check (the pre-fix flow's only guard) passes on the in-scope state.
  const step1 = await antiDriftBlockFor("gap-test-adland", repo);
  const r1 = runBash(step1, { cwd: repo });
  assert.equal(r1.status, 0, `step-1 anti-drift must pass pre-fix, got ${r1.status}: ${r1.stderr}`);
  assert.match(r1.stdout, /ANTI-DRIFT OK/, "step-1 must print ANTI-DRIFT OK pre-fix");
  // 2. The fix agent commits a file OUTSIDE Touches (the recorded defect shape: a test file not
  // declared). NOTE: NOT under plugin/ — the temp repo's plugin/ is a runtime-only symlink excluded
  // from git; the out-of-declared falsifiability is path-independent (the c2917261 shape = a test file
  // outside the declared Touches).
  commitFiles(repo, { "packages/quay/test/full-suite-runner.test.mjs": "import { test } from 'node:test'\n" }, "fix: hermetic seam");
  // 3. The land-time re-check must now HARD-FAIL (the fix commit's file is out-of-declared).
  const land = await antiDriftLandBlockFor("gap-test-adland", repo);
  const r2 = runBash(land, { cwd: repo });
  assert.notEqual(r2.status, 0, `land re-check must HARD-FAIL on the fix commit's out-of-scope file, got ${r2.status}`);
  assert.match(r2.stdout, /ANTI-DRIFT HARD FAIL/, "driver must print ANTI-DRIFT HARD FAIL");
  assert.match(r2.stdout, /packages\/quay\/test\/full-suite-runner\.test\.mjs/, "the fix commit's out-of-declared file must be named");
  assert.match(r2.stderr, /FATAL/, "the block must FATAL (no flip done, no ff)");
});

test("⑨ AC2 idempotent — a fix commit fully WITHIN Touches does not false-positive (land re-check passes)", async (t) => {
  const repo = makeAntiDriftRepo({
    taskId: "gap-test-adland-ok",
    body: "---\nid: gap-test-adland-ok\nstatus: ready\n---\n## Touches\n- tasks/gap-test-adland-ok.md\n- pkg/a/**\n",
    files: { "pkg/a/x.js": "x\n", "pkg/a/y.js": "y\n" },
  });
  t.after(() => cleanup(repo));
  symlinkPluginForGit(repo);
  // The fix agent commits a file WITHIN Touches (a legit in-scope fix — must NOT false-positive).
  commitFiles(repo, { "pkg/a/z.js": "z\n" }, "fix: in-scope");
  const land = await antiDriftLandBlockFor("gap-test-adland-ok", repo);
  const r = runBash(land, { cwd: repo });
  assert.equal(r.status, 0, `legitimate in-scope fix must stay green, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /ANTI-DRIFT OK/, "driver must print ANTI-DRIFT OK");
});

test("⑨ AC2 idempotent — a normal fan-in with NO fix commit passes the land re-check (repeat of step 1)", async (t) => {
  const repo = makeAntiDriftRepo({
    taskId: "gap-test-adland-none",
    body: "---\nid: gap-test-adland-none\nstatus: ready\n---\n## Touches\n- tasks/gap-test-adland-none.md\n- pkg/a/**\n",
    files: { "pkg/a/x.js": "x\n", "pkg/a/y.js": "y\n" },
  });
  t.after(() => cleanup(repo));
  symlinkPluginForGit(repo);
  const land = await antiDriftLandBlockFor("gap-test-adland-none", repo);
  const r = runBash(land, { cwd: repo });
  assert.equal(r.status, 0, `no-fix normal fan-in must pass the land re-check, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /ANTI-DRIFT OK/, "driver must print ANTI-DRIFT OK");
});

// ── ⑥ bracket-close (gap-fan-in-auto-close-telemetry-bracket, occurrence 3) ─────────────────────────
// The fan-in flow's step 5.5 closes the fanned-in task's telemetry bracket AFTER the ff succeeds
// (dispatch's --task-start was never closed on land ⇒ stale bracket until a manual/outer reconcile).
// The closure goes through closure-lag-check.sh --close-task (the A16 unified closure point) keyed by
// --taskId — it must target ONLY the task being fanned in, never a global --reconcile scan (判据2:
// in-flight / not-landed brackets must be preserved).

/** A temp "workspace root" for bracket-close tests: a real `tasks/` dir (closure-lag-check requires
 *  one) + a symlinked real `plugin/` tree (the closure command resolves `${root}/plugin/scripts/…`).
 *  The telemetry store lives under `<root>/.workflow-events/` written by the REAL fast-mode-telemetry.ts. */
function makeTelemetryFakeRoot(prefix = "fan-in-bracket-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(dir, "plugin"), "dir");
  return dir;
}

/** Open ONE real telemetry bracket via the REAL --task-start. Returns the runId. */
function startBracket(root, taskId) {
  const r = runBash(
    `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --task-start --taskId ${taskId} --root "${root}"`,
    { cwd: REPO_ROOT },
  );
  assert.equal(r.status, 0, `--task-start failed for ${taskId}: ${r.stderr}`);
  const runId = r.stdout.trim();
  assert.ok(runId, `--task-start must print a runId for ${taskId}`);
  return runId;
}

async function bracketCloseBlockFor(task, worktree, root, runId) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root, runId, mergeTarget: "develop" },
  });
  return extractBlockFromPrompts(prompts, "# bracket-close-block-start", "# bracket-close-block-end");
}

test("⑥ wiring — the fan-in prompt carries a bracket-close block targeting ONLY the fanned-in task (no global --reconcile scan)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-close", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-close", mergeTarget: "develop" },
  });
  const block = extractBlockFromPrompts(prompts, "# bracket-close-block-start", "# bracket-close-block-end");
  assert.ok(block.includes("closure-lag-check.sh --close-task"), "block must call the A16 unified closure point");
  assert.ok(block.includes("--taskId gap-test-close"), "block must target the fanned-in task by id");
  assert.ok(block.includes("--outcome done"), "block must close with outcome done");
  assert.ok(block.includes("--root "), "block must pass the workspace root");
  // 判据2: the block must not INVOKE a global --reconcile scan (only the comment mentions it to forbid
  // it). The executable lines (non-#-comment) must be free of a --reconcile invocation.
  const execLines = block.split("\n").filter((l) => !l.trim().startsWith("#"));
  assert.ok(!execLines.some((l) => l.includes("--reconcile")), "executable lines must not run a global --reconcile scan (判据2: in-flight brackets preserved)");
  // The return contract (bracketClosed) and placement checks live in the PHASE-2 prompt (the block's own prompt).
  const p2 = promptContaining(prompts, "# bracket-close-block-start");
  assert.ok(p2.includes("bracketClosed"), "the return contract must carry the bracket-closure result");
  // placement: the block runs AFTER the ff-merge call and BEFORE the worktree cleanup.
  const ffIdx = p2.indexOf("fan-in-ff-merge.sh --task");
  const blockIdx = p2.indexOf("# bracket-close-block-start");
  const cleanupIdx = p2.indexOf("ff 成功后清理");
  assert.ok(ffIdx !== -1, "ff-merge call present");
  assert.ok(blockIdx > ffIdx, "bracket-close must come after the ff-merge call");
  assert.ok(cleanupIdx > blockIdx, "bracket-close must come before the worktree cleanup");
});

test("⑥ REAL bracket-close — closes the fanned-in task's bracket AND preserves an in-flight task's bracket (判据2)", async (t) => {
  const root = makeTelemetryFakeRoot();
  t.after(() => cleanup(root));
  const runIdA = startBracket(root, "gap-test-close-a");
  const runIdB = startBracket(root, "gap-test-close-b");
  // worktree arg = the telemetry fake root (has plugin/ symlinked) — the block now resolves the
  // closure-lag-check.sh SCRIPT from ${worktree} (gap-fan-in-orchestration-bootstrap-self-fix).
  const block = await bracketCloseBlockFor("gap-test-close-a", root, root, runIdA);
  const r = runBash(block, { cwd: REPO_ROOT });
  assert.equal(r.status, 0, `bracket-close block must exit 0: ${r.stderr}`);
  const rep = runBash(`node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json --root "${root}"`, { cwd: REPO_ROOT });
  assert.equal(rep.status, 0, `report failed: ${rep.stderr}`);
  const report = JSON.parse(rep.stdout);
  const inProgressIds = (report.inProgress || []).map((p) => p.taskId);
  const completedIds = (report.tasks || []).map((c) => c.taskId);
  assert.ok(!inProgressIds.includes("gap-test-close-a"), `task A (landed) must leave inProgress after close; inProgress=${JSON.stringify(inProgressIds)}`);
  assert.ok(completedIds.includes("gap-test-close-a"), `task A must be a completed start+end pair; completed=${JSON.stringify(completedIds)}`);
  assert.ok(inProgressIds.includes("gap-test-close-b"), `task B (in-flight, not landed) must KEEP its bracket; inProgress=${JSON.stringify(inProgressIds)}`);
  assert.ok(!completedIds.includes("gap-test-close-b"), `task B must NOT be closed`);
});

test("⑥ REAL idempotent — a task with NO open bracket is a no-op (exit 0, no write)", async (t) => {
  const root = makeTelemetryFakeRoot();
  t.after(() => cleanup(root));
  const runIdA = startBracket(root, "gap-test-close-a");
  const block = await bracketCloseBlockFor("gap-test-close-a", root, root, runIdA);
  // Close once (writes the end event)…
  assert.equal(runBash(block, { cwd: REPO_ROOT }).status, 0);
  // …then close again: no open bracket ⇒ --close-task exits 0, no second end event.
  assert.equal(runBash(block, { cwd: REPO_ROOT }).status, 0, "second close must be an idempotent no-op");
  const rep = runBash(`node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json --root "${root}"`, { cwd: REPO_ROOT });
  const report = JSON.parse(rep.stdout);
  assert.ok(!(report.inProgress || []).some((p) => p.taskId === "gap-test-close-a"), "bracket must stay closed");
  assert.equal((report.tasks || []).filter((c) => c.taskId === "gap-test-close-a").length, 1, "exactly one completed pair");
});

// ── ⑦ verification-round 入账 (gap-preverified-suite-bypasses-verification-round-ledger) ────────────
// The pre-verified path (step 4 reuses a caller-produced capture) must ALSO write verification-round.jsonl
// (含 preverified 标记) — the trend ledger (the /tests page + suite-cost analysis data source) was blind
// to the most-used landing path. The write lives in step 4.5 as # preverified-round-block, guarded by
// suite_preverified=1 (the marker step 4 appends to the reused capture). These tests run the REAL block
// from the emitted prompt against a real temp git repo + a real pre-verified capture file.

/** A temp git repo acting as the task "worktree": the real plugin/ tree is symlinked so the writer's
 *  `node plugin/scripts/pre-verified-round-record.ts` resolves through the real files. The writer
 *  resolves the shared checkout from git common-dir — for a plain repo the shared checkout IS the repo,
 *  so the record lands in <repo>/.quay/verification-round.jsonl. */
function makePreVerifiedWorktree(prefix = "fan-in-pvr-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const run = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
  };
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "test@test"]);
  run(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  run(["add", "README.md"]);
  run(["commit", "-qm", "base"]);
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(dir, "plugin"), "dir");
  return dir;
}

async function preVerifiedBlockFor(task, worktree, root) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root, runId: "fm-pvr-1", mergeTarget: "develop" },
  });
  return extractBlockFromPrompts(prompts, "# preverified-round-block-start", "# preverified-round-block-end");
}

test("⑦ wiring — the fan-in prompt carries a verification-round write block guarded by full_suite_ran=true (both branches, shared writer + --preverified flag)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-pvr", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-pvr", mergeTarget: "develop" },
  });
  const block = extractBlockFromPrompts(prompts, "# preverified-round-block-start", "# preverified-round-block-end");
  assert.ok(block.includes("pre-verified-round-record.ts"), "block must invoke the verification-round writer");
  // Shared guard (AC3, gap-fan-in-realsuite-bypasses-verification-round-ledger): full_suite_ran=true ⇒ a
  // full suite RAN in this fan-in (either this fan-in's detached run OR a pre-verified reuse) ⇒ write.
  assert.ok(block.includes('[ "$full_suite_ran" = "true" ]'), "block must be guarded by full_suite_ran=true (the shared both-branch guard)");
  assert.ok(block.includes('preverified_flag="${suite_preverified:-0}"'), "block must derive the preverified flag from the suite_preverified marker");
  assert.ok(block.includes('--preverified "$preverified_flag"'), "block must pass the preverified flag to the shared writer");
  assert.ok(block.includes("--commit \"$suite_head\""), "block must pin the verified suite_head as commit");
  assert.ok(block.includes("--duration-ms \"$wall_ms\""), "block must reuse the capture's wall-clock (AC2)");
  // gap-fan-in-verification-round-thin-schema-phase-gap AC1/AC2 — the block passes the capture's
  // suite_log_file so the writer can parse the phase fields (real-run capture always carries it; a
  // pre-verified capture only when the caller recorded its log path — the "单独定案" seam).
  assert.ok(block.includes('--suite-log "${suite_log_file:-}"'), "block must pass the suite log path to the shared writer");
  // gap-verification-round-cpu-split-not-recorded AC1 — the block passes the gnu-time user/sys split
  // (parsed by the poll block into the capture) so the verification-round record carries cpu_user_s /
  // cpu_sys_s (the finding's sys=61% lever is then measurable round-over-round).
  assert.ok(block.includes('--cpu-user-s "$cpu_user_s"'), "block must pass the gnu-time USER cpu seconds to the writer");
  assert.ok(block.includes('--cpu-sys-s "$cpu_sys_s"'), "block must pass the gnu-time SYSTEM cpu seconds to the writer");
  // Placement: the write runs in step 4.5 (suite-record-block), BEFORE the capture is removed — all in the phase-2 prompt.
  const p2 = promptContaining(prompts, "# preverified-round-block-start");
  const blockIdx = p2.indexOf("# preverified-round-block-start");
  const recordIdx = p2.indexOf("# suite-record-block-start");
  const rmIdx = p2.indexOf('rm -f "$suite_capture"');
  assert.ok(blockIdx > recordIdx, "verification-round write runs inside step 4.5's suite-record-block");
  assert.ok(blockIdx < rmIdx, "verification-round write runs BEFORE the capture file is removed");
});

test("⑦ REAL pre-verified round — a reused capture (suite_preverified=1) writes ONE verification-round record (preverified:true) to the shared checkout's ledger", async (t) => {
  const dir = makePreVerifiedWorktree();
  t.after(() => cleanup(dir));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  const task = "gap-test-pvr-real";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  fs.writeFileSync(capture, [
    "full_suite_ran=true",
    "skip_reason=",
    "cpu_s=null",
    "cpu_source=not-wired",
    "start_iso=2026-08-17T04:30:00.000Z",
    "end_iso=2026-08-17T04:45:36.519Z",
    "wall_ms=936519",
    "load=8.03",
    "lane_count=8",
    "suite_exit=0",
    `suite_head=${head}`,
    "suite_preverified=1",
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(capture, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await preVerifiedBlockFor(task, dir, REPO_ROOT);
  const r = runBash(`suite_capture="${capture}"; . "$suite_capture"; ${block}`, { cwd: dir });
  assert.equal(r.status, 0, `pre-verified write must exit 0: ${r.stderr}`);
  const ledger = path.join(dir, ".quay", "verification-round.jsonl");
  assert.ok(fs.existsSync(ledger), "verification-round.jsonl was written");
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, "exactly one record");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.preverified, true, "the record carries the pre-verified marker (AC1)");
  assert.equal(rec.state, "green");
  assert.equal(rec.durationMs, 936519, "durationMs = the reused capture's wall-clock");
  assert.equal(rec.startedAt, "2026-08-17T04:30:00.000Z");
  assert.equal(rec.laneCount, 8);
  assert.equal(rec.load, 8.03);
  assert.equal(rec.commit, head, "commit = the pinned suite_head");
  assert.equal(rec.scope, "worktree");
  assert.equal(rec.taskId, task);
  assert.equal(rec.round, 1, "round = prior line count + 1");
});

test("⑦ REAL real-suite — a NON-pre-verified capture (full_suite_ran=true, NO suite_preverified marker) writes ONE verification-round record with preverified:false (gap-fan-in-realsuite-bypasses-verification-round-ledger AC1)", async (t) => {
  // THE DEFECT THIS TASK FIXES: the real-suite branch (a full suite that RAN inside this fan-in via the
  // detached `setsid bash scripts/test.sh` path) left ZERO verification-round records (three real landings
  // at 19:45/20:36/20:52, all 0 records — 2026-08-17). The shared guard (full_suite_ran=true) + shared
  // writer (--preverified 0) must now produce a record for such a capture.
  const dir = makePreVerifiedWorktree();
  t.after(() => cleanup(dir));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  const task = "gap-test-realsuite";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  // A real detached run's capture: full_suite_ran=true, NO suite_preverified marker (this fan-in's own run).
  fs.writeFileSync(capture, [
    "full_suite_ran=true",
    "skip_reason=",
    "cpu_s=42.5",
    "cpu_source=gnu-time",
    "start_iso=2026-08-17T19:45:00.000Z",
    "end_iso=2026-08-17T20:02:00.000Z",
    "wall_ms=1020000",
    "load=12.3",
    "lane_count=16",
    "suite_exit=0",
    `suite_head=${head}`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(capture, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await preVerifiedBlockFor(task, dir, REPO_ROOT);
  const r = runBash(`suite_capture="${capture}"; . "$suite_capture"; ${block}`, { cwd: dir });
  assert.equal(r.status, 0, `real-suite write must exit 0: ${r.stderr}`);
  const ledger = path.join(dir, ".quay", "verification-round.jsonl");
  assert.ok(fs.existsSync(ledger), "verification-round.jsonl was written for the real-suite branch");
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, "exactly one record");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.preverified, false, "a real-suite round carries preverified:false (distinct from a reused-capture round)");
  assert.equal(rec.state, "green");
  assert.equal(rec.durationMs, 1020000, "durationMs = the REAL suite's wall-clock (this fan-in's run)");
  assert.equal(rec.startedAt, "2026-08-17T19:45:00.000Z");
  assert.equal(rec.laneCount, 16);
  assert.equal(rec.load, 12.3);
  assert.equal(rec.commit, head, "commit = the pinned suite_head");
  assert.equal(rec.scope, "worktree");
  assert.equal(rec.taskId, task);
  assert.equal(rec.cpu_time_s, 42.5);
  assert.equal(rec.cpu_source, "gnu-time");
  assert.equal(rec.round, 1, "round = prior line count + 1");
});

test("⑦ REAL skip — a doc-only capture (full_suite_ran=false) writes NO verification-round record (no suite ran, nothing to account)", async (t) => {
  const dir = makePreVerifiedWorktree();
  t.after(() => cleanup(dir));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  const task = "gap-test-pvr-skip";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  // A doc-only skip's capture (step 4 wrote skip_reason=doc-only-delta, full_suite_ran=false) — no suite
  // ran, so there is NO verification-round record to write (the shared guard reads full_suite_ran=true).
  fs.writeFileSync(capture, [
    "full_suite_ran=false",
    "skip_reason=doc-only-delta",
    "cpu_s=null",
    "cpu_source=not-wired",
    "start_iso=2026-08-17T05:00:00.000Z",
    "end_iso=2026-08-17T05:00:00.000Z",
    "wall_ms=0",
    "load=4.5",
    "lane_count=1",
    "suite_exit=0",
    `suite_head=${head}`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(capture, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await preVerifiedBlockFor(task, dir, REPO_ROOT);
  const r = runBash(`suite_capture="${capture}"; . "$suite_capture"; ${block}`, { cwd: dir });
  assert.equal(r.status, 0, `doc-only skip must exit 0 (no write): ${r.stderr}`);
  assert.equal(fs.existsSync(path.join(dir, ".quay", "verification-round.jsonl")), false, "no verification-round record for a doc-only skip (no suite ran)");
});

// ── ⑦b full-suite-state.json mirror-write (gap-full-suite-state-stale-no-writer AC1/AC3) ─────────────
// The detached suite (setsid bash scripts/test.sh) never goes through full-suite-runner.ts (the ONLY
// full-suite-state.json writer) ⇒ the state file went stale (the /tests page read a stale currentState;
// collectFailureFiles carried a latent unbounded-union of a stale state's failures[]). The fix: step 4.5
// mirror-writes the terminal GREEN state (reusing full-suite-runner's mirrorStateFile pattern) via
// plugin/scripts/mirror-full-suite-state.ts, guarded by full_suite_ran=true (a doc-only skip never
// fabricates a green). These tests run the REAL block against a real temp repo + a real capture.

async function mirrorBlockFor(task, worktree, root) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root, runId: "fm-mirror-1", mergeTarget: "develop" },
  });
  return extractBlockFromPrompts(prompts, "# mirror-state-block-start", "# mirror-state-block-end");
}

test("⑦b wiring — the fan-in prompt carries a full-suite-state.json mirror-write block (mirror-full-suite-state.ts, guarded by full_suite_ran=true, inside the preverified-round-block)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-mirror", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-mirror", mergeTarget: "develop" },
  });
  const block = extractBlockFromPrompts(prompts, "# mirror-state-block-start", "# mirror-state-block-end");
  assert.ok(block.includes("mirror-full-suite-state.ts"), "block must invoke the mirror writer");
  assert.ok(block.includes("--state green"), "the mirror writes the terminal GREEN state (phase 2 only runs green)");
  assert.ok(block.includes('--finished-at "$end_iso"'), "block must pass the capture's real end time (end_iso)");
  assert.ok(block.includes('--commit "$suite_head"'), "block must pin the verified suite_head as commit");
  assert.ok(block.includes('--duration-ms "$wall_ms"'), "block must reuse the capture's wall-clock");
  assert.ok(block.includes('--lane-count "$lane_count"'), "block must reuse the capture's lane count");
  assert.ok(block.includes('--load "$load"'), "block must reuse the capture's load");
  assert.ok(block.includes("--task-id gap-test-mirror"), "block must carry the fan-in task id (traceability)");
  assert.ok(block.includes("--run-id fm-mirror"), "block must carry the fan-in runId (traceability)");
  // The mirror write lives INSIDE the full_suite_ran=true guard (the same shared guard as the
  // verification-round write) — a doc-only skip must not fabricate a green state.
  const p2 = promptContaining(prompts, "# mirror-state-block-start");
  const guardIdx = p2.indexOf('[ "$full_suite_ran" = "true" ]');
  const blockIdx = p2.indexOf("# mirror-state-block-start");
  const guardEndIdx = p2.indexOf("# preverified-round-block-end");
  assert.ok(guardIdx >= 0, "the full_suite_ran=true guard must be present in the phase-2 prompt");
  assert.ok(blockIdx > guardIdx && blockIdx < guardEndIdx, "the mirror write runs INSIDE the full_suite_ran=true guard");
});

test("⑦b REAL mirror — a green fan-in capture writes a FRESH full-suite-state.json to the shared checkout (gap-full-suite-state-stale-no-writer AC1/AC3)", async (t) => {
  const dir = makePreVerifiedWorktree();
  t.after(() => cleanup(dir));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  const task = "gap-test-mirror-real";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  fs.writeFileSync(capture, [
    "full_suite_ran=true",
    "skip_reason=",
    "cpu_s=42.5",
    "cpu_source=gnu-time",
    "start_iso=2026-08-18T04:30:00.000Z",
    "end_iso=2026-08-18T04:45:36.519Z",
    "wall_ms=936519",
    "load=8.03",
    "lane_count=8",
    "suite_exit=0",
    `suite_head=${head}`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(capture, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await mirrorBlockFor(task, dir, REPO_ROOT);
  const r = runBash(`suite_capture="${capture}"; . "$suite_capture"; ${block}`, { cwd: dir });
  assert.equal(r.status, 0, `mirror write must exit 0: ${r.stderr}`);
  const stateFile = path.join(dir, ".quay", "full-suite-state.json");
  assert.ok(fs.existsSync(stateFile), "full-suite-state.json was written");
  const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(st.state, "green");
  assert.equal(st.startedAt, "2026-08-18T04:30:00.000Z");
  assert.equal(st.finishedAt, Math.floor(Date.parse("2026-08-18T04:45:36.519Z") / 1000), "finishedAt is EPOCH SECONDS (full-suite-runner convention)");
  assert.equal(st.durationMs, 936519);
  assert.equal(st.laneCount, 8);
  assert.equal(st.load, 8.03);
  assert.equal(st.commit, head, "commit = the pinned suite_head");
  assert.equal(st.runner, "inner", "the fan-in suite is an inner-layer run");
  assert.equal(st.scope, "worktree");
  assert.equal(st.taskId, task);
  assert.equal(st.runId, "fm-mirror-1");
});

test("⑦b REAL skip — a doc-only capture (full_suite_ran=false) writes NO full-suite-state.json (no suite ran ⇒ no fabricated green)", async (t) => {
  const dir = makePreVerifiedWorktree();
  t.after(() => cleanup(dir));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  const task = "gap-test-mirror-skip";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  fs.writeFileSync(capture, [
    "full_suite_ran=false",
    "skip_reason=doc-only-delta",
    "cpu_s=null",
    "cpu_source=not-wired",
    "start_iso=2026-08-18T05:00:00.000Z",
    "end_iso=2026-08-18T05:00:00.000Z",
    "wall_ms=0",
    "load=4.5",
    "lane_count=1",
    "suite_exit=0",
    `suite_head=${head}`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(capture, { force: true }); } catch (_) { /* best-effort */ } });

  // Run the FULL preverified-round-block (which wraps the mirror block in the full_suite_ran=true
  // guard) so the guard is what excludes the write — not a manually-skipped block.
  const block = await preVerifiedBlockFor(task, dir, REPO_ROOT);
  const r = runBash(`suite_capture="${capture}"; . "$suite_capture"; ${block}`, { cwd: dir });
  assert.equal(r.status, 0, `doc-only skip must exit 0 (no write): ${r.stderr}`);
  assert.equal(fs.existsSync(path.join(dir, ".quay", "full-suite-state.json")), false, "no full-suite-state.json for a doc-only skip (the full_suite_ran=true guard excludes it)");
});

// ── ⑦c measure-history.jsonl mirror-write (gap-measure-history-detached-suite-mirror-write AC1/AC3) ──
// The detached suite (setsid bash scripts/test.sh) never goes through full-suite-runner.ts (the ONLY
// measure-history.jsonl writer) ⇒ the per-file duration ledger went stale (last record 2026-08-17T04:29:08Z;
// two days of detached-suite rounds with no records). The fix: step 4.5 mirror-appends a round parsed from
// THIS round's REAL suite log (the __PERFILE__ lines measure-suite-reporter.mjs already emitted) via
// plugin/scripts/mirror-measure-history.ts (reusing landMeasureHistory — the SAME function the runner
// calls, so the data format is identical), guarded by full_suite_ran=true (a doc-only skip never fabricates
// a round). These tests run the REAL block against a real temp repo + a real capture + a real suite log.

async function mirrorHistoryBlockFor(task, worktree, root) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root, runId: "fm-mhist-1", mergeTarget: "develop" },
  });
  return extractBlockFromPrompts(prompts, "# mirror-history-block-start", "# mirror-history-block-end");
}

test("⑦c wiring — the fan-in prompt carries a measure-history.jsonl mirror-write block (mirror-measure-history.ts, guarded by full_suite_ran=true, inside the preverified-round-block)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-mhist", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-mhist", mergeTarget: "develop" },
  });
  const block = extractBlockFromPrompts(prompts, "# mirror-history-block-start", "# mirror-history-block-end");
  assert.ok(block.includes("mirror-measure-history.ts"), "block must invoke the mirror writer");
  assert.ok(block.includes('--log "$suite_log_file"'), "block must pass the capture's REAL suite log path (the __PERFILE__ source)");
  assert.ok(block.includes('--lane-count "$lane_count"'), "block must reuse the capture's lane count");
  assert.ok(block.includes('--run-at "$end_iso"'), "block must pass the capture's real end time as runAt");
  assert.ok(block.includes("--task-id gap-test-mhist"), "block must carry the fan-in task id (traceability)");
  assert.ok(block.includes("--run-id fm-mhist"), "block must carry the fan-in runId (traceability)");
  // The mirror write lives INSIDE the full_suite_ran=true guard (the same shared guard as the
  // verification-round write) — a doc-only skip must not fabricate a round.
  const p2 = promptContaining(prompts, "# mirror-history-block-start");
  const guardIdx = p2.indexOf('[ "$full_suite_ran" = "true" ]');
  const blockIdx = p2.indexOf("# mirror-history-block-start");
  const guardEndIdx = p2.indexOf("# preverified-round-block-end");
  assert.ok(guardIdx >= 0, "the full_suite_ran=true guard must be present in the phase-2 prompt");
  assert.ok(blockIdx > guardIdx && blockIdx < guardEndIdx, "the mirror write runs INSIDE the full_suite_ran=true guard");
});

test("⑦c REAL mirror — a green fan-in capture with a REAL suite log appends a measure-history.jsonl round to the shared checkout (gap-measure-history-detached-suite-mirror-write AC1/AC3)", async (t) => {
  const dir = makePreVerifiedWorktree();
  t.after(() => cleanup(dir));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  const task = "gap-test-mhist-real";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const suiteLog = `/tmp/fan-in-suite-${task}.log`;
  fs.writeFileSync(suiteLog, [
    "__PERFILE__ duration_ms=1204.5 /home/yale/work/quay-worktrees/gap-demo/plugin/test/a.test.mjs passed=true",
    "__PERFILE__ duration_ms=842.25 /home/yale/work/quay-worktrees/gap-demo/plugin/test/b.test.mjs passed=true",
    "__PERFILE__ duration_ms=999999.5 /home/yale/work/quay-worktrees/gap-demo/plugin/test/c.test.mjs passed=false",
  ].join("\n") + "\n", "utf8");
  t.after(() => { for (const f of [capture, suiteLog]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  fs.writeFileSync(capture, [
    "full_suite_ran=true",
    "skip_reason=",
    "cpu_s=42.5",
    "cpu_source=gnu-time",
    "start_iso=2026-08-18T04:30:00.000Z",
    "end_iso=2026-08-18T04:45:36.519Z",
    "wall_ms=936519",
    "load=8.03",
    "lane_count=8",
    "suite_exit=0",
    `suite_head=${head}`,
    `suite_log_file=${suiteLog}`,
  ].join("\n") + "\n", "utf8");

  const block = await mirrorHistoryBlockFor(task, dir, REPO_ROOT);
  const r = runBash(`suite_capture="${capture}"; . "$suite_capture"; ${block}`, { cwd: dir });
  assert.equal(r.status, 0, `mirror write must exit 0: ${r.stderr}`);
  const historyFile = path.join(dir, ".quay", "measure-history.jsonl");
  assert.ok(fs.existsSync(historyFile), "measure-history.jsonl was written to the shared checkout");
  const lines = fs.readFileSync(historyFile, "utf8").trim().split("\n");
  assert.equal(lines.length, 3, "one record per test file in the round");
  const rec = JSON.parse(lines[0]);
  // The record shape is IDENTICAL to full-suite-runner's direct writes (AC3 — the measure-trend-check.ts
  // consumer reads this exact shape; no worktree-root prefix on the key).
  assert.equal(typeof rec.round, "number");
  assert.equal(rec.runAt, "2026-08-18T04:45:36.519Z", "runAt = the capture's end_iso");
  assert.equal(rec.file, "plugin/test/a.test.mjs", "file key is normalized repo-root-relative");
  assert.equal(rec.durationMs, 1204.5);
  assert.equal(rec.passed, true);
  assert.equal(rec.laneCount, 8);
  assert.equal(typeof rec.logDigest, "string");
});

test("⑦c REAL no-op — a green fan-in capture whose suite log has NO __PERFILE__ lines writes NO round (exit 0, never a fabricated measure-history round)", async (t) => {
  const dir = makePreVerifiedWorktree();
  t.after(() => cleanup(dir));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  const task = "gap-test-mhist-nop";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const suiteLog = `/tmp/fan-in-suite-${task}.log`;
  fs.writeFileSync(suiteLog, "__OVERHEAD__ run_static_checks_ms=100\nno perfile lines here\n", "utf8");
  t.after(() => { for (const f of [capture, suiteLog]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  fs.writeFileSync(capture, [
    "full_suite_ran=true",
    "skip_reason=",
    "cpu_s=42.5",
    "cpu_source=gnu-time",
    "start_iso=2026-08-18T05:00:00.000Z",
    "end_iso=2026-08-18T05:15:00.000Z",
    "wall_ms=900000",
    "load=4.5",
    "lane_count=8",
    "suite_exit=0",
    `suite_head=${head}`,
    `suite_log_file=${suiteLog}`,
  ].join("\n") + "\n", "utf8");

  const block = await mirrorHistoryBlockFor(task, dir, REPO_ROOT);
  const r = runBash(`suite_capture="${capture}"; . "$suite_capture"; ${block}`, { cwd: dir });
  assert.equal(r.status, 0, `no-perfile-lines must exit 0 (benign no-op, never blocks the fan-in): ${r.stderr}`);
  assert.equal(fs.existsSync(path.join(dir, ".quay", "measure-history.jsonl")), false, "no measure-history.jsonl for a suite with no __PERFILE__ lines (no fabricated round)");
});

test("⑦ REAL real-suite WITH a suite log — the fan-in landing row carries the phase fields + concurrency variables (gap-fan-in-verification-round-thin-schema-phase-gap AC1/AC4)", async (t) => {
  // THE DEFECT THIS TASK FIXES: fan-in landing rows were thin — no serial/main/static phase ms, no
  // nproc/concurrentSuiteSlots/concurrentSuitesRunning — so AC101's lane-concurrency control round
  // (S=1) could not compare the fan-in baseline against a full-suite-runner control round at the same
  // 口径. The real-run capture now records suite_log_file, and the block passes it via --suite-log.
  const dir = makePreVerifiedWorktree();
  t.after(() => cleanup(dir));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  const task = "gap-test-phases";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const suiteLog = `/tmp/fan-in-suite-${task}.log`;
  fs.writeFileSync(suiteLog, [
    "__OVERHEAD__ run_static_checks_ms=12345",
    "__OVERHEAD__ serial_phase_ms=301234",
    "__OVERHEAD__ lowconc_phase_ms=0",
    "__OVERHEAD__ main_phase_ms=512345",
  ].join("\n") + "\n", "utf8");
  t.after(() => { for (const f of [capture, suiteLog]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  fs.writeFileSync(capture, [
    "full_suite_ran=true",
    "skip_reason=",
    "cpu_s=42.5",
    "cpu_source=gnu-time",
    "start_iso=2026-08-17T19:45:00.000Z",
    "end_iso=2026-08-17T20:02:00.000Z",
    "wall_ms=1020000",
    "load=12.3",
    "lane_count=16",
    "suite_exit=0",
    `suite_head=${head}`,
    `suite_log_file=${suiteLog}`,
  ].join("\n") + "\n", "utf8");

  const block = await preVerifiedBlockFor(task, dir, REPO_ROOT);
  const r = runBash(`suite_capture="${capture}"; . "$suite_capture"; ${block}`, { cwd: dir });
  assert.equal(r.status, 0, `phase-bearing write must exit 0: ${r.stderr}`);
  const ledger = path.join(dir, ".quay", "verification-round.jsonl");
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, "exactly one record");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.preverified, false, "real-suite round carries preverified:false");
  assert.equal(rec.static_phase_ms, 12345, "static_phase_ms ← run_static_checks_ms");
  assert.equal(rec.serial_phase_ms, 301234, "serial_phase_ms ← serial_phase_ms");
  assert.equal(rec.lowconc_phase_ms, 0, "lowconc_phase_ms ← lowconc_phase_ms (0 is a real value)");
  assert.equal(rec.main_phase_ms, 512345, "main_phase_ms ← main_phase_ms");
  assert.equal(typeof rec.nproc, "number", "nproc present on the fan-in landing row");
  assert.equal(typeof rec.concurrentSuiteSlots, "number", "concurrentSuiteSlots present");
  assert.equal(typeof rec.concurrentSuitesRunning, "number", "concurrentSuitesRunning present");
});

test("⑦ preverified=1 分支单独定案 — a reused capture WITH a recorded suite log carries phases; WITHOUT one records NONE (gap-fan-in-verification-round-thin-schema-phase-gap AC2)", async (t) => {
  const dir = makePreVerifiedWorktree();
  t.after(() => cleanup(dir));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();

  // (a) caller recorded its suite log path ⇒ the preverified landing row carries phase data.
  const taskA = "gap-test-pvr-ph-a";
  const captureA = `/tmp/fan-in-suite-${taskA}.env`;
  const suiteLogA = `/tmp/fan-in-suite-${taskA}.log`;
  fs.writeFileSync(suiteLogA, ["__OVERHEAD__ serial_phase_ms=301234", "__OVERHEAD__ main_phase_ms=512345"].join("\n") + "\n", "utf8");
  fs.writeFileSync(captureA, [
    "full_suite_ran=true", "skip_reason=", "cpu_s=null", "cpu_source=not-wired",
    "start_iso=2026-08-17T04:30:00.000Z", "end_iso=2026-08-17T04:45:36.519Z",
    "wall_ms=936519", "load=8.03", "lane_count=8", "suite_exit=0",
    `suite_head=${head}`, "suite_preverified=1", `suite_log_file=${suiteLogA}`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { for (const f of [captureA, suiteLogA]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  const blockA = await preVerifiedBlockFor(taskA, dir, REPO_ROOT);
  const rA = runBash(`suite_capture="${captureA}"; . "$suite_capture"; ${blockA}`, { cwd: dir });
  assert.equal(rA.status, 0, `preverified-with-log write must exit 0: ${rA.stderr}`);
  const recA = JSON.parse(fs.readFileSync(path.join(dir, ".quay", "verification-round.jsonl"), "utf8").trim().split("\n").filter(Boolean)[0]);
  assert.equal(recA.preverified, true);
  assert.equal(recA.serial_phase_ms, 301234, "preverified=1 WITH a caller-recorded log carries phase data");
  assert.equal(recA.main_phase_ms, 512345);

  // (b) reused capture WITHOUT a suite log ⇒ the row is EXPLICITLY phase-less (AC2: 不伪造, 不两分支一概而论).
  const taskB = "gap-test-pvr-ph-b";
  const captureB = `/tmp/fan-in-suite-${taskB}.env`;
  fs.writeFileSync(captureB, [
    "full_suite_ran=true", "skip_reason=", "cpu_s=null", "cpu_source=not-wired",
    "start_iso=2026-08-17T04:30:00.000Z", "end_iso=2026-08-17T04:45:36.519Z",
    "wall_ms=936519", "load=8.03", "lane_count=8", "suite_exit=0",
    `suite_head=${head}`, "suite_preverified=1",
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(captureB, { force: true }); } catch (_) { /* best-effort */ } });
  const blockB = await preVerifiedBlockFor(taskB, dir, REPO_ROOT);
  const rB = runBash(`suite_capture="${captureB}"; . "$suite_capture"; ${blockB}`, { cwd: dir });
  assert.equal(rB.status, 0, `preverified-without-log write must exit 0: ${rB.stderr}`);
  const linesB = fs.readFileSync(path.join(dir, ".quay", "verification-round.jsonl"), "utf8").trim().split("\n").filter(Boolean);
  const recB = JSON.parse(linesB[linesB.length - 1]);
  assert.equal(recB.preverified, true);
  assert.equal(recB.serial_phase_ms, undefined, "preverified=1 WITHOUT a recorded log ⇒ phase-less (honest, not fabricated)");
  assert.equal(recB.main_phase_ms, undefined, "preverified=1 WITHOUT a recorded log ⇒ phase-less");
});

// ── ⑦ fan-in orchestration bootstrap (gap-fan-in-orchestration-bootstrap-self-fix) ───────────────────
// THE DEFECT: fan-in orchestration files resolve from the MAIN checkout, so a task that modifies one of
// them (fan-in-execute.js / select-static-checks-for-touches.ts / fan-in-ff-merge.sh / per-task-suite-
// record.ts / full-suite-runner.ts) has its own fan-in run by the OLD main version — its fix is never
// exercised (self-reference). FIX: (a) the A6 dispatch rule uses the WORKTREE scriptPath when the branch
// modifies an orchestration file (driven by --bootstrap-orchestration, tested below); (b) every fan-in
// orchestration script call in the prompt resolves from ${worktree} (not cwd, not ${root}).

async function bootstrapBlockFor(task, worktree, root) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root, runId: "fm-bootstrap", mergeTarget: "develop" },
  });
  return extractBlockFromPrompts(prompts, "【无锁段 step 0", "【无锁段 step 1");
}

test("⑦ worktree-resolution — every fan-in orchestration script call is ${worktree}-rooted (not cwd, not ${root})", async (t) => {
  const WT = "/tmp/wt"; // the interpolated worktree value in the emitted prompts
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-bs", worktree: WT, root: REPO_ROOT, runId: "fm-bs", mergeTarget: "develop" },
  });
  const all = prompts.join("\n\n----PROMPT----\n\n");
  // The orchestration scripts a task can modify MUST resolve from the worktree — the branch's own fix
  // must be what the fan-in runs (gap-fan-in-orchestration-bootstrap-self-fix). Across the split fan-in,
  // some live in phase 1 (classify/anti-drift/ts-typecheck) and some in phase 2 (record/flip/ff/bracket).
  const mustBeWorktreeRooted = [
    "select-static-checks-for-touches.ts --classify-delta", // step 2 (phase 1)
    "per-task-suite-record.ts",                             // step 4.5 (phase 2)
    "pre-verified-round-record.ts",                         // step 4.5 (phase 2, both fan-in branches)
    "mirror-full-suite-state.ts",                           // step 4.5 (phase 2, gap-full-suite-state-stale-no-writer)
    "fan-in-ac-completion-gate.ts",                         // step 5 (phase 2)
    "fan-in-ff-merge.sh",                                   // step 5 (phase 2)
    "closure-lag-check.sh",                                 // step 5.5 (phase 2)
    "anti-drift-touches-check.ts",                          // step 1 (phase 1)
    "fan-in-ts-typecheck-gate.ts",                          // step 3 (phase 1)
  ];
  for (const frag of mustBeWorktreeRooted) {
    // Match the EXECUTABLE line (not a comment that merely mentions the frag): the line must carry
    // both the frag and the worktree-rooted path.
    const line = all.split("\n").find((l) => l.includes(frag) && l.includes(`${WT}/plugin/scripts/`));
    assert.ok(line, `a prompt must carry a ${WT}-rooted call to ${frag}`);
    assert.doesNotMatch(line, /bash \$\{?root\}?\/plugin\/scripts/, `call must NOT be root-rooted: ${line}`);
  }
  // full-suite-runner.ts is reached via `cd ${worktree} && bash scripts/test.sh` (step 4) — already
  // worktree-rooted; assert the explicit cd survives in the phase-1 prompt.
  assert.ok(all.includes(`cd ${WT} && bash scripts/test.sh --for-task`), "step-4 scoped run must cd into the worktree");
  // step-2 classify carries the worktree-rooted registry (--root <worktree>) so a branch-modified
  // scripts/test.sh @static-object annotation is what the classification reads.
  const classifyLine = all.split("\n").find((l) => l.includes("--classify-delta") && l.includes(`--root ${WT}`));
  assert.ok(classifyLine, `classify must carry the worktree-rooted --root, got none among:\n${all.split("\n").filter((l) => l.includes("--classify-delta")).join("\n")}`);
  assert.ok(classifyLine.includes(`${WT}/plugin/scripts/`), `classify must be ${WT}-rooted, got: ${classifyLine}`);
});

test("⑦ 取假一 — a branch modifying .claude/workflows/fan-in-execute.js ⇒ step-0 verdict HIT + WARN (dispatch must use the worktree scriptPath)", async (t) => {
  const repo = makeRepoWithDelta({ ".claude/workflows/fan-in-execute.js": "export const meta = { name: 'fan-in-execute-branch-version' }\n" });
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { ".claude/workflows/fan-in-execute.js": "" });
  const block = await bootstrapBlockFor("gap-test-bs-hit", repo, REPO_ROOT);
  const r = runBash(block, { cwd: repo });
  assert.equal(r.status, 0, `step-0 bash failed: ${r.stderr}`);
  assert.match(r.stdout, /FAN-IN-BOOTSTRAP=hit/, `branch modifying fan-in-execute.js must be detected as a hit, got stdout:\n${r.stdout}`);
  assert.match(r.stdout, /\.claude\/workflows\/fan-in-execute\.js/, "the hit must name the modified orchestration file");
  // 取假一 WARN (falsifiable): the running workflow is the ROOT version (REPO_ROOT), which differs from
  // the branch's committed fan-in-execute.js ⇒ the self-bootstrap gap is detected at runtime (if the A6
  // dispatcher followed the hit and used the worktree scriptPath, this WARN would NOT fire).
  assert.match(r.stderr, /FAN-IN-BOOTSTRAP-WARN/, `root workflow running against a modified branch copy must warn, got stderr:\n${r.stderr}`);
});

test("⑦ 取假一 negative — a branch modifying only tasks/*.md ⇒ step-0 verdict MISS (main-checkout scriptPath is correct)", async (t) => {
  const repo = makeRepoWithDelta({ "tasks/gap-test-bs-miss.md": "status: ready\n" });
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "tasks/gap-test-bs-miss.md": "" });
  const block = await bootstrapBlockFor("gap-test-bs-miss", repo, REPO_ROOT);
  const r = runBash(block, { cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /FAN-IN-BOOTSTRAP=miss/, `doc-only branch must be a miss, got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /FAN-IN-BOOTSTRAP=hit/, "a doc-only branch must NOT be a hit");
  assert.doesNotMatch(r.stderr, /FAN-IN-BOOTSTRAP-WARN/, "a doc-only branch must not warn");
});

test("⑦ 取假二 — a branch modifying an orchestration script AND carrying a checker-read .md ⇒ HIT + the .md classifies as CODE (old regex called it doc)", async (t) => {
  // The branch modifies plugin/scripts/fan-in-ff-merge.sh (an orchestration file, not the classify
  // script — so the symlinked REAL classify runs) AND carries orchestration/manager-tick-core.md in
  // its delta. 取假二: the OLD hand-written `[.]md$` regex called that .md doc ⇒ the fan-in skipped the
  // full suite; the worktree-resolved registry classify must call it CODE.
  const repo = makeRepoWithDelta({
    "plugin/scripts/fan-in-ff-merge.sh": "export const x = 1\n",
    "orchestration/manager-tick-core.md": "## (src:N) violation\n",
  });
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "plugin/scripts/fan-in-ff-merge.sh": "", "orchestration/manager-tick-core.md": "" });
  // step 0: the branch modifies an orchestration file ⇒ HIT (dispatcher must use the worktree scriptPath).
  const block = await bootstrapBlockFor("gap-test-bs-two", repo, REPO_ROOT);
  const r0 = runBash(block, { cwd: repo });
  assert.equal(r0.status, 0, r0.stderr);
  assert.match(r0.stdout, /FAN-IN-BOOTSTRAP=hit/, `orchestration-script modification must be a hit, got stdout:\n${r0.stdout}`);
  assert.match(r0.stdout, /fan-in-ff-merge\.sh/, "the hit must name the modified orchestration file");
  // step 2: the worktree-resolved classify (--root ${worktree}) must classify the checker-read .md as CODE.
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-bs-two", worktree: repo, root: REPO_ROOT, runId: "fm-bs-two", mergeTarget: "develop" },
  });
  const step2 = extractBlockFromPrompts(prompts, "【无锁段 step 2", "【无锁段 step 3");
  const bashLines = step2.split("\n").filter((l) => /^(fork=|delta=|code_delta=)/.test(l));
  const r2 = runBash(bashLines.join("\n") + '\necho "RESULT_CODE_DELTA=[$code_delta]"', { cwd: REPO_ROOT });
  assert.equal(r2.status, 0, `step-2 bash failed: ${r2.stderr}`);
  const m = r2.stdout.match(/RESULT_CODE_DELTA=\[([\s\S]*)\]/);
  assert.ok(m, `code_delta echo missing:\n${r2.stdout}`);
  assert.match(m[1], /orchestration\/manager-tick-core\.md/, `checker-read .md must classify as code (取假二), got: ${m[1]}`);
  assert.match(m[1], /plugin\/scripts\/fan-in-ff-merge\.sh/, `the modified orchestration script must also be code, got: ${m[1]}`);
});

// ── ⑦b bootstrap worktree sync (gap-bootstrap-worktree-stale-fan-in-execute) ─────────────────────────
// THE DEFECT: a bootstrap-HIT task's fan-in is dispatched with the WORKTREE's fan-in-execute.js as
// scriptPath; if the worktree forked BEFORE a fan-in orchestration fix landed on develop (e.g. the
// poll-bounded `timeout 540` wait), that file is STALE and the fix never takes effect for the task.
// FIX: before dispatching (A6 rule) AND at the workflow's step 0 (before step-1 merge develop), run
// `select-static-checks-for-touches.ts --bootstrap-sync --worktree <wt> --merge-target <develop>` —
// `git merge develop` brings the latest orchestration files into the worktree while PRESERVING the
// branch's own modifications (self-validation). Informational: a conflict aborts (step-1 resolves),
// a dirty worktree / unresolvable ref skips.
const SEL_CLI = path.join(REPO_ROOT, "plugin", "scripts", "select-static-checks-for-touches.ts");

/** A hermetic repo modeling the stale-bootstrap shape: develop carries an OLD fan-in-execute.js, then
 *  advances with the POLL-BOUNDED fix; a task branch forks from the OLD base and modifies a DIFFERENT
 *  orchestration file (bootstrap-HIT) — so its own fan-in-execute.js is stale. Returns the dir. */
function makeStaleBootstrapRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-bs-sync-"));
  const run = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
  };
  run(["init", "-q", "-b", "develop"]);
  run(["config", "user.email", "test@test"]);
  run(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  fs.mkdirSync(path.join(dir, ".claude", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "workflows", "fan-in-execute.js"), "OLD-fan-in-execute\n");
  run(["add", "-A"]);
  run(["commit", "-qm", "old-base"]);
  // develop advances with the poll-bounded fix to fan-in-execute.js
  fs.writeFileSync(path.join(dir, ".claude", "workflows", "fan-in-execute.js"), "POLL-BOUNDED-fan-in-execute\n");
  run(["add", "-A"]);
  run(["commit", "-qm", "poll-bounded-fix"]);
  // task branch forks from the OLD base (HEAD~1) and modifies a DIFFERENT orchestration file
  run(["checkout", "-q", "-b", "task/gap-bs-stale", "HEAD~1"]);
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "scripts", "fan-in-ff-merge.sh"), "branch-modified-ff-merge\n");
  run(["add", "-A"]);
  run(["commit", "-qm", "branch modifies orchestration"]);
  return dir;
}

function runSyncCli(dir, extraArgs = []) {
  const r = spawnSync("node", ["--experimental-strip-types", SEL_CLI, "--bootstrap-sync", "--worktree", dir, ...extraArgs], {
    encoding: "utf8", timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

test("⑦b wiring — the step-0 prompt carries the --bootstrap-sync call (worktree-first, root fallback) BEFORE step-1 merge develop", async (t) => {
  const WT = "/tmp/wt-bs-sync";
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-bs-sync", worktree: WT, root: REPO_ROOT, runId: "fm-bs-sync", mergeTarget: "develop" },
  });
  const step0 = extractBlockFromPrompts(prompts, "【无锁段 step 0", "【无锁段 step 1");
  const syncLines = step0.split("\n").filter((l) => l.includes("--bootstrap-sync"));
  assert.ok(syncLines.length >= 1, `step-0 prompt must carry a --bootstrap-sync call, got none among:\n${step0}`);
  // worktree-first with root fallback (a worktree forked before this mode landed cannot run it from itself)
  const assignLine = step0.split("\n").find((l) => l.trim().startsWith("sync_helper="));
  assert.ok(assignLine, `step-0 must resolve the sync helper (sync_helper=...), got none among:\n${step0}`);
  assert.ok(assignLine.includes(`${WT}/plugin/scripts/select-static-checks-for-touches.ts`),
    `the sync helper must resolve worktree-first, got: ${assignLine}`);
  const fallbackLine = step0.split("\n").find((l) => l.includes('[ -f "$sync_helper" ]'));
  assert.ok(fallbackLine && fallbackLine.includes(path.join(REPO_ROOT, "plugin", "scripts", "select-static-checks-for-touches.ts")),
    `the sync helper must fall back to root, got: ${fallbackLine ?? "(missing)"}`);
  const execLine = syncLines.find((l) => l.includes("--bootstrap-sync --worktree"));
  assert.ok(execLine, "the sync executable line must be present");
  assert.ok(execLine.includes(`--worktree ${WT}`) && execLine.includes("--merge-target develop"),
    `the sync call must carry the worktree + merge-target, got: ${execLine}`);
  // It must precede step-1's `git merge develop` (the "在 merge develop 前先同步" requirement)
  const step1 = extractBlockFromPrompts(prompts, "【无锁段 step 1", "【无锁段 step 2");
  assert.ok(step0.includes("--bootstrap-sync") && step0.length > 0, "sync must live in step 0 (before merge develop)");
  assert.ok(step1.includes("git merge ${mergeTarget}") || step1.includes("git merge develop") || step1.includes("git merge"),
    "step 1 must still carry the merge-develop step");
});

test("⑦b REAL stale sync — a bootstrap-HIT worktree forked before the poll-bounded fix lands: --bootstrap-sync merges develop ⇒ fan-in-execute.js becomes the latest", async (t) => {
  const repo = makeStaleBootstrapRepo();
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "plugin/scripts/fan-in-ff-merge.sh": "", ".claude/workflows/fan-in-execute.js": "" });
  // Before: the worktree's fan-in-execute.js is the OLD (fork-time) version.
  assert.equal(fs.readFileSync(path.join(repo, ".claude", "workflows", "fan-in-execute.js"), "utf8").trim(), "OLD-fan-in-execute");
  const r = runSyncCli(repo, ["--merge-target", "develop"]);
  assert.equal(r.status, 0, `sync cli failed: ${r.stderr}`);
  assert.match(r.stdout, /merged=1/, `the stale worktree must merge develop, got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /conflict=1/, "a non-overlapping merge must not conflict");
  // After: the worktree's fan-in-execute.js is the develop-latest (POLL-BOUNDED).
  assert.equal(fs.readFileSync(path.join(repo, ".claude", "workflows", "fan-in-execute.js"), "utf8").trim(), "POLL-BOUNDED-fan-in-execute");
  // The branch's OWN orchestration modification is preserved (self-validation survives the sync).
  assert.equal(fs.readFileSync(path.join(repo, "plugin", "scripts", "fan-in-ff-merge.sh"), "utf8").trim(), "branch-modified-ff-merge");
});

test("⑦b REAL conflict — branch AND develop both modify fan-in-execute.js ⇒ conflict=1 + abort (worktree clean, branch version preserved; step-1 will resolve)", async (t) => {
  const repo = makeStaleBootstrapRepo();
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "plugin/scripts/fan-in-ff-merge.sh": "", ".claude/workflows/fan-in-execute.js": "" });
  // Branch also modifies fan-in-execute.js (overlapping with develop's poll-bounded fix ⇒ conflict)
  fs.writeFileSync(path.join(repo, ".claude", "workflows", "fan-in-execute.js"), "BRANCH-CHANGED-fan-in-execute\n");
  runBash("git add .claude/workflows/fan-in-execute.js && git commit -qm 'branch also changes fan-in-execute'", { cwd: repo });
  const r = runSyncCli(repo, ["--merge-target", "develop"]);
  assert.equal(r.status, 0, `sync cli failed: ${r.stderr}`);
  assert.match(r.stdout, /conflict=1/, `overlapping fan-in-execute.js edits must conflict, got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /merged=1/, "a conflicting merge must not report merged");
  // Abort left the worktree clean and the branch version intact.
  const status = runBash("git status --porcelain --untracked-files=no", { cwd: repo });
  assert.equal(status.stdout.trim(), "", `worktree must be clean after abort, got: ${status.stdout}`);
  assert.equal(fs.readFileSync(path.join(repo, ".claude", "workflows", "fan-in-execute.js"), "utf8").trim(), "BRANCH-CHANGED-fan-in-execute");
});

test("⑦b REAL dirty — a worktree with a tracked modification ⇒ skipped (step-1 merge handles it; never clobbers local work)", async (t) => {
  const repo = makeStaleBootstrapRepo();
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "plugin/scripts/fan-in-ff-merge.sh": "", ".claude/workflows/fan-in-execute.js": "" });
  fs.writeFileSync(path.join(repo, "README.md"), "uncommitted local edit\n");
  const r = runSyncCli(repo, ["--merge-target", "develop"]);
  assert.equal(r.status, 0, `sync cli failed: ${r.stderr}`);
  assert.match(r.stdout, /skipped=1/, `a dirty worktree must be skipped, got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /merged=1/, "a dirty worktree must not be merged by the sync");
});

test("⑦b REAL json — the sync reports a machine-readable outcome (merged/conflict/skipped) for the dispatch rule", async (t) => {
  const repo = makeStaleBootstrapRepo();
  t.after(() => cleanup(repo));
  symlinkRuntimeTrees(repo, { "plugin/scripts/fan-in-ff-merge.sh": "", ".claude/workflows/fan-in-execute.js": "" });
  const r = spawnSync("node", ["--experimental-strip-types", SEL_CLI, "--bootstrap-sync", "--worktree", repo, "--merge-target", "develop", "--json"], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.merged, true, JSON.stringify(parsed));
  assert.equal(parsed.conflict, false, JSON.stringify(parsed));
  assert.ok(parsed.head, `merged result must carry the new HEAD, got: ${JSON.stringify(parsed)}`);
});

// ── ⑧ suite 等待 + 阶段 2 承载 (gap-fan-in-turn-budget-suite-timeout → gap-subagent-turn-budget-13min-falsified) ──
// AC1 取假: 构造 step2 code_delta 非空 ⇒ 全量 suite 必跑且机械步骤必完成（flip/ff/bracket 全执行）。
// 2026-08-20 证伪: 旧设计假设「subagent ~13min 回合预算硬超时」⇒ 每轮起一个新短命轮询 agent + 脚本
// setTimeout。该数字是假的（真实限制仅 Bash 单次 600s 硬顶 + suite 实测 19+ min）⇒ 修复: suite 交给
// 【长生命周期载体】(detached setsid 进程)，【等待】由【单个阶段 2 agent】在本回合内多次 <600s Bash
// 循环承担（有界阻塞等待 timeout 540 + sleep 15，最多 maxSuitePolls 次），suite 绿后执行机械步骤；
// suite 红 ⇒ 返回 suite-red，脚本派 Fix agent 重启动后重派阶段 2。这些测试用脚本化的 agent 序列驱动
// vm 实执行的工作流, 断言控制流 (绿/红→修/轮询上限/ff-retry) 与 phase 1/2 的 prompt 结构。

test("⑧ turn-budget 取假 — phase-1 suite-launch DETACHES (setsid + & + disown), NOT foreground, NOT Bash(run_in_background:true)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-tb-detach", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-detach", mergeTarget: "develop" },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  assert.ok(launch.includes("setsid"), "suite-launch must use setsid (detached session — survives subagent exit)");
  assert.ok(launch.includes("& disown"), "suite-launch must background + disown (long-lived carrier)");
  assert.ok(launch.includes("suite_exit_marker"), "suite-launch must define the exit marker (the script-owned wait signal)");
  assert.ok(launch.includes('rc=$?'), "the detached wrapper must capture the suite exit code");
  assert.ok(launch.includes('printf "exit=%s'), "the detached wrapper must write the exit code to the marker");
  // gap-suite-wait-bash-stale-pid-poll：suite_pid 必须是 wrapper 自写的真实 PID（pidfile），NOT 瞬态
  // setsid 父进程（$! fork 即退——kill -0 恒失败误报死进程，生产实测 2026-08-21，负控制 3 行确认）。
  assert.ok(launch.includes("suite_pid_file="), "suite-launch must write the wrapper PID to a pidfile (kill -0 polls a live process — gap-suite-wait-bash-stale-pid-poll)");
  assert.ok(launch.includes('printf "%s %s\\n" "$$"'), "the detached wrapper must self-record its PID + start timestamp (`pid started_ms`) into the pidfile (kill -0 polls a live process + the cross-relaunch stuck-holder detector needs the held duration — gap-suite-lock-holder-stuck-detection)");
  assert.ok(launch.includes('suite_pid=$(cut -d\' \' -f1 "$suite_pid_file"'), "suite-launch must parse the pid from the 2-field pidfile record (pid = field 1, gap-suite-lock-holder-stuck-detection)");
  assert.ok(!launch.includes("suite_pid=$!"), "suite-launch must NOT record the transient setsid parent PID ($! is dead — fork-and-exit)");
  // ⛔ NOT the two forbidden forms (f6b824b5 实证: Bash(run_in_background:true) 死于 subagent 退出; 前台 bash 超 10min 上限).
  // Only the EXECUTABLE lines matter — the comments legitimately name the forbidden form to forbid it.
  const execLines = launch.split("\n").filter((l) => !l.trim().startsWith("#"));
  assert.ok(!execLines.some((l) => l.includes("run_in_background")), "suite-launch executable lines must NOT use Bash(run_in_background:true)");
  // Phase 1 must instruct immediate return (no suite wait in the subagent turn).
  const phase1 = prompts[0];
  assert.ok(phase1.includes("不等待 suite") || phase1.includes("立即返回"), "phase-1 must instruct the agent NOT to wait for the suite (立即返回)");
  assert.ok(phase1.includes("bash scripts/test.sh --for-task"), "scoped gate stays in phase 1");
  assert.ok(phase1.includes("bash scripts/test.sh --static-checks-doc"), "doc check stays in phase 1");
});

test("⑧ turn-budget 取假 — suite-launch block decides by code_delta: non-empty ⇒ full suite starts; empty ⇒ doc-only skip", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-tb-delta", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-delta", mergeTarget: "develop" },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  // step 2 hands code_delta to step 4 via a file (bash vars don't persist across Bash calls).
  assert.ok(launch.includes("/tmp/fan-in-code-delta-"), "launch must read the code_delta handoff written by step 2");
  assert.ok(launch.includes('[ "$code_delta" != "" ]'), "launch must branch on code_delta non-empty ⇒ start the full suite");
  assert.ok(launch.includes("full_suite_ran=true"), "the full-suite branch must write full_suite_ran=true");
  assert.ok(launch.includes("skip_reason=doc-only-delta"), "the doc-only branch must write skip_reason=doc-only-delta");
  assert.ok(launch.includes("PRE-VERIFIED-SUITE"), "the pre-verified reuse branch must be present (suite_head-pinned)");
});

test("AC126 AC1 — the fan-in suite launch command passes --buckets <task-id> (production bucket-execution wiring)", async () => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-ac126-wiring", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-ac126", mergeTarget: "develop" },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  // The suite-launch command string must carry `--buckets <task-id>` — the task id is interpolated at
  // workflow-build time, so the literal task id must appear (AC1: 生产 suite 路径真正传). test.sh is
  // the selection authority (P-only⇒P, M-only⇒M, hub/no-bucket⇒full).
  assert.ok(launch.includes("--buckets gap-ac126-wiring"), "suite-launch must pass --buckets <task-id> (the interpolated task id)");
  const setsidLine = launch.split("\n").find((l) => l.includes("setsid bash -c"));
  assert.ok(setsidLine, "suite-launch must contain the detached setsid launch line");
  assert.ok(setsidLine.includes("bash scripts/test.sh --buckets gap-ac126-wiring"), "the detached launch command must pass --buckets <task-id> to scripts/test.sh");
});

test("gap-suite-load-sampler-bypassed-by-fan-in-execute AC1 wiring — the detached suite-launch spawns the state-driven load sampler keyed to the fan-in runId", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-sampler-wiring", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-test-sampler-wiring", mergeTarget: "develop" },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  // The sampler must be spawned from the detached launch (the direct run otherwise bypasses the ONLY
  // spawner, full-suite-runner.ts) and keyed to the SAME runId mirror-full-suite-state.ts writes into
  // full-suite-state.json at step 4.5 (so the /tests page joins them: readCurrentSuiteRunId → readSuiteLoadSamples).
  assert.ok(launch.includes("suite-load-sampler.ts"), "suite-launch must spawn suite-load-sampler.ts");
  assert.ok(launch.includes("--out-file"), "the sampler spawn must carry an explicit --out-file");
  assert.ok(launch.includes("suite-load-fm-test-sampler-wiring.jsonl"), "sampler out-file must be suite-load-<runId>.jsonl keyed to the fan-in runId");
  assert.ok(launch.includes('--run-id "fm-test-sampler-wiring"'), "sampler must receive the fan-in runId (joins the step-4.5 mirror-write)");
  assert.ok(launch.includes("--interval 5"), "sampler must sample at the 5s default interval");
  // State-driven stop: the outer launch establishes a running state file (single-quoted JSON, so bash
  // does not strip the quotes — the template-literal quoting pitfall), the wrapper rm's it after the suite.
  assert.ok(launch.includes(`printf '{"state":"running"}`), "the outer launch must establish a valid-JSON running state file before the detached suite starts");
  assert.ok(launch.includes(`rm -f "/tmp/fan-in-suite-sampler-gap-test-sampler-wiring.state.json"`), "the wrapper must remove the state file after the suite so the sampler stops (state-driven, never a resident idle-spin)");
  // 取假: the sampler spawn must NOT sit in the doc-only skip branch (no suite ran ⇒ no sampler).
  const skipBranch = launch.slice(launch.indexOf("skip_reason=doc-only-delta"));
  assert.ok(!skipBranch.includes("suite-load-sampler.ts"), "the doc-only skip branch must NOT spawn a sampler (no suite ran)");
});

test("gap-suite-load-sampler-bypassed-by-fan-in-execute AC1 REAL — the emitted sampler spawn samples while running and stops when the state file is removed", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-sampler-"));
  const wt = path.join(tmp, "wt");
  fs.mkdirSync(wt, { recursive: true });
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-sampler-real", worktree: wt, root: tmp, runId: "fm-test-sampler-real", mergeTarget: "develop" },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  // Extract the EXACT sampler spawn command the phase-1 agent would run — verbatim, so the test catches
  // the template-literal \n / quoting pitfalls the workflow header warns about (not a re-typed copy).
  // Slice between `node …` and the wrapper's ` & cd "$1"` (the `&` that backgrounds the sampler) — a
  // regex `[^&]*` would stop at the `&` inside `2>&1` and truncate the redirect.
  const nodeIdx = launch.indexOf("node --no-warnings --experimental-strip-types");
  const cdIdx = launch.indexOf(" & cd", nodeIdx);
  assert.ok(nodeIdx !== -1 && cdIdx !== -1, "suite-launch must emit a suite-load-sampler.ts spawn command followed by the suite `cd`");
  const samplerCmd = launch.slice(nodeIdx, cdIdx).replace(/--interval \d+(\.\d+)?/, "--interval 0.2");
  // The sampler resolves through ${worktree}/plugin/scripts/… — symlink the REAL runtime tree so the
  // temp worktree has a resolvable suite-load-sampler.ts (same pattern as the other REAL tests).
  symlinkRuntimeTrees(wt, {});
  const stateFile = "/tmp/fan-in-suite-sampler-gap-test-sampler-real.state.json";
  const outFile = path.join(tmp, ".quay", "suite-load-fm-test-sampler-real.jsonl");
  cleanup(stateFile); cleanup(outFile); cleanup(`${outFile}.pid`);
  fs.writeFileSync(stateFile, JSON.stringify({ state: "running" }));
  const child = spawn("bash", ["-c", samplerCmd], { stdio: "ignore", detached: true });
  child.unref();
  try {
    let lines = [];
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try { lines = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean); } catch { lines = []; }
      if (lines.length >= 1) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(lines.length >= 1, "the emitted sampler spawn wrote >=1 sample while the state was running");
    const o = JSON.parse(lines[0]);
    assert.equal(typeof o.t, "number", "every sample carries a numeric timestamp");
    assert.ok("loadavg" in o, "every sample carries loadavg");
    assert.ok("cpu_stall" in o, "every sample carries cpu_stall");
    assert.ok("mem_avail" in o, "every sample carries mem_avail");
    // The wrapper's terminal stop: remove the state file ⇒ the sampler exits on its next poll.
    fs.rmSync(stateFile, { force: true });
    const pidFile = `${outFile}.pid`;
    assert.ok(fs.existsSync(pidFile), "sampler wrote its pid sidecar");
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    let gone = false;
    const stopDeadline = Date.now() + 10_000;
    while (Date.now() < stopDeadline) {
      try { process.kill(pid, 0); } catch { gone = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(gone, "the sampler exited after the state file was removed (never a resident idle-spin)");
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    cleanup(stateFile); cleanup(outFile); cleanup(`${outFile}.pid`); cleanup(tmp);
  }
});

test("⑧ stage-2 wait block — completes the capture post-fields (cpu/end/wall/load/lane/suite_exit) on exit-marker hit", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-tb-poll", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-poll", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  assert.ok(poll.includes("suite_exit_marker"), "wait block must read the exit marker");
  assert.ok(poll.includes("POLL=done SUITE_EXIT"), "wait block must emit the done + exit result");
  assert.ok(poll.includes("cpu_source"), "wait block must compute cpu_source (gnu-time or not-wired)");
  assert.ok(poll.includes("cpu_user_s"), "wait block must compute cpu_user_s (the gnu-time %U column — gap-verification-round-cpu-split-not-recorded)");
  assert.ok(poll.includes("cpu_sys_s"), "wait block must compute cpu_sys_s (the gnu-time %S column)");
  assert.ok(poll.includes("wall_ms"), "wait block must compute wall_ms from the pre-suite start_ms");
  assert.ok(poll.includes("lane_count"), "wait block must compute lane_count");
  assert.ok(poll.includes("suite_exit"), "wait block must record suite_exit into the capture");
  assert.ok(poll.includes("不要做任何等待决策"), "wait block must not make any waiting decision (fixed command)");
});

test("⑧ stage-2 wait — the SINGLE stage-2 agent drives the GREEN path: suite-started → wait-loop → mechanical steps (flip/ff/bracket)", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-tb-green", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-green", mergeTarget: "develop", maxSuitePolls: 5 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { outcome: "green", ffOk: true, developHead: "d1", worktreeHead: "h1", agentIdUsed: "a1", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 (wait loop + mechanicals)
    ],
  });
  assert.equal(result.outcome, "green", "stage-2 wait must land a green suite through the mechanical steps");
  assert.equal(result.ffOk, true);
  // The stage-2 prompt (the ONE agent) must carry BOTH the wait block AND all mechanical steps
  // (gap-subagent-turn-budget-13min-falsified: the wait lives in the stage-2 agent, not a separate
  // short-lived poll agent per round).
  const p2 = promptContaining(prompts, "# flip-block-start");
  assert.ok(p2.includes("POLL=not-done"), "stage-2 prompt must carry the wait block (single agent loops <600s Bash)");
  assert.ok(p2.includes("per-task-suite-record.ts"), "stage-2 must write the per-task-suite record (step 4.5)");
  assert.ok(p2.includes("fan-in-ff-merge.sh --task"), "stage-2 must run the ff-merge (step 5)");
  assert.ok(p2.includes("--worktree /tmp/wt"), "stage-2 must pass --worktree to the ff-merge (stale-lock reclaim scope, gap-worktree-remove-orphans-probes)");
  assert.ok(p2.includes("# bracket-close-block-start"), "stage-2 must close the telemetry bracket (step 5.5)");
  assert.ok(p2.includes("worktree-process-reaper.ts"), "stage-2 must reap live processes under the worktree before removal (gap-worktree-remove-orphans-probes)");
  assert.ok(p2.includes('"$reaper" --worktree /tmp/wt'), "stage-2 must scope the reaper to the worktree being removed");
  assert.ok(p2.includes("git worktree remove"), "stage-2 must clean up the worktree after ff");
  // 取假: the old shape spawned a SEPARATE short-lived poll agent per round (prompts.length >= 3 with a
  // standalone poll prompt); the new shape has the wait block INSIDE the stage-2 prompt (2 prompts total).
  assert.equal(prompts.length, 2, "green path = phase1 + stage2 (no separate poll agent)");
});

test("⑧ stage-2 wait — RED suite ⇒ stage-2 returns suite-red ⇒ Fix agent relaunches detached ⇒ re-dispatched stage-2 lands", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-tb-red", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-red", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },                 // phase 1
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                                          // stage 2: suite RED (no mechanicals)
      { relaunched: true, worktreeHead: "h2", failuresFixed: ["fix-x"], note: "" },                                 // Fix agent
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 re-dispatched (waits again + mechanicals)
    ],
  });
  assert.equal(result.outcome, "green", "a red suite must be fixed + re-verified before landing");
  assert.ok(prompts.some((p) => p.includes("suite-fix 阶段")), "a Fix-agent prompt must be emitted for a red suite");
  assert.ok(prompts.some((p) => p.includes("你读失败日志")), "the Fix prompt must read the suite log failures");
});

test("⑧ stage-2 wait — suite process dies before writing .exit ⇒ stage-2 returns suite-pid-dead ⇒ relaunch agent re-starts detached ⇒ re-dispatched stage-2 lands (gap-suite-wait-bash-stale-pid-poll AC2)", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-tb-piddead", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-piddead", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },                 // phase 1
      { outcome: "suite-pid-dead", suiteExit: null, ffOk: false },                                                   // stage 2: pid dead, no exit marker
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "relaunch after silent death" },             // relaunch agent
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 re-dispatched
    ],
  });
  assert.equal(result.outcome, "green", "a silently-dead suite must be relaunched + re-verified before landing");
  assert.ok(prompts.some((p) => p.includes("suite-relaunch 阶段")), "a relaunch-agent prompt must be emitted for a dead-pid suite");
  assert.ok(prompts.some((p) => p.includes("静默死亡")), "the relaunch prompt must name the silent-death reason");
  assert.ok(prompts.some((p) => p.includes("FIX_SCOPE_VERDICT")), "the relaunch prompt must still carry the fix-scope gate");
});

test("⑧ stage-2 wait — suite never completes within the stage-2 poll cap ⇒ stage-2 returns suite-not-done ⇒ red (bounded wait, no infinite hang)", async (t) => {
  const { result } = await runWorkflow({
    args: { task: "gap-test-tb-cap", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-cap", mergeTarget: "develop", maxSuitePolls: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },  // phase 1
      { outcome: "suite-not-done", suiteExit: null, ffOk: false },                                    // stage 2: never completed within its loop cap
    ],
  });
  assert.equal(result.outcome, "red", "a suite that never completes must fail closed");
  assert.equal(result.ffOk, false);
  assert.ok(result.message.includes("poll cap"), `message must cite the poll cap: ${result.message}`);
});

test("⑧ stage-2 wait — ff failure (develop advanced during suite) ⇒ script re-runs phase 1 (bounded) and lands on the retry", async (t) => {
  const { prompts, result, logs } = await runWorkflow({
    args: { task: "gap-test-tb-ff", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-ff", mergeTarget: "develop", maxSuitePolls: 5, maxFfRetries: 2 },
    agentResults: [
      // attempt 1
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { outcome: "ff-retry", ffOk: false, note: "develop advanced" },                               // stage 2 ff FAILED
      // attempt 2 (script re-runs phase 1)
      { outcome: "suite-started", suitePid: 222, codeDelta: "code", worktreeHead: "h2", note: "" }, // phase 1 (retry)
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2
    ],
  });
  assert.equal(result.outcome, "green", "a develop-advanced ff failure must retry from phase 1 and land");
  assert.equal(prompts.length, 4, "2× (phase1 + stage2)");
  assert.ok(logs.some((l) => l.includes("ff-retry")), "log must record the ff-retry re-run");
  // The phase-1 prompt (retry) must carry the stale-flip revert preamble.
  assert.ok(prompts[2].includes("重试遗留翻转处理"), "the retry phase-1 prompt must carry the stale-flip revert");
});

test("⑧ stage-2 wait — ff-retry exhausted (maxFfRetries) ⇒ red + anti-livelock message (SPEC §7 bound)", async (t) => {
  const { result } = await runWorkflow({
    args: { task: "gap-test-tb-ffx", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-ffx", mergeTarget: "develop", maxSuitePolls: 5, maxFfRetries: 2 },
    agentResults: [
      // attempt 1
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "ff-retry", ffOk: false, note: "develop advanced" },
      // attempt 2 — ffAttempts becomes 2, 2 >= maxFfRetries(2) ⇒ red
      { outcome: "suite-started", suitePid: 222, codeDelta: "code", worktreeHead: "h2", note: "" },
      { outcome: "ff-retry", ffOk: false, note: "develop advanced again" },
    ],
  });
  assert.equal(result.outcome, "red", "exhausted ff retries must fail closed");
  assert.equal(result.ffOk, false);
  assert.ok(result.message.includes("anti-livelock"), `message must cite anti-livelock: ${result.message}`);
});

test("⑧ turn-budget REAL — a real detached suite (setsid) + the real poll block complete the capture (code_delta 非空 ⇒ suite 跑 + 机械步骤的输入齐备)", async (t) => {
  // AC1 取假 REAL invocation: 构造 step2 code_delta 非空 ⇒ 阶段 1 的 suite-launch 块把 suite 以 detached
  // 方式跑起来（长生命周期载体），轮询块补全 capture post 字段（suite_exit=0）——阶段 2 据此能执行
  // flip/ff/bracket。整条链用【真实 bash】驱动（判据3，不是 fixture mock）。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-reallaunch-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-tb-real-launch";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  // A fake suite that exits 0 (sleeps 1s so the detached launch + marker both have time to work).
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), "#!/usr/bin/env bash\nsleep 1\nexit 0\n");
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add test.sh"]);

  const codeDeltaFile = `/tmp/fan-in-code-delta-${task}.txt`;
  fs.writeFileSync(codeDeltaFile, "plugin/workflows/fan-in-execute.js\n");
  t.after(() => { for (const f of [`/tmp/fan-in-suite-${task}.env`, `/tmp/fan-in-suite-${task}.exit`, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`, `/tmp/fan-in-suite-${task}.pid`, codeDeltaFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: REPO_ROOT, runId: "fm-tb-real", mergeTarget: "develop" },
  });
  const launchBlock = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");

  // Run the REAL launch block (cwd = the worktree). code_delta 非空 ⇒ the full-suite branch must fire.
  const launchRun = runBash(launchBlock, { cwd: dir, timeout: 30_000 });
  assert.equal(launchRun.status, 0, `launch block failed: ${launchRun.stderr}`);
  assert.match(launchRun.stdout, /SUITE_OUTCOME=started/, `code_delta non-empty must start the full suite, got: ${launchRun.stdout}`);

  // Real poll: wait for the exit marker (the suite is detached; ~1s fake + the launch's ~3s confirm).
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  let seen = false;
  for (let i = 0; i < 50 && !seen; i++) { if (fs.existsSync(marker)) seen = true; else await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(seen, "the detached suite must write its exit marker");

  // Run the REAL poll block (completes the capture post-fields).
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const pollRun = runBash(pollBlock, { cwd: dir, timeout: 15_000 });
  assert.equal(pollRun.status, 0, `poll block failed: ${pollRun.stderr}`);
  assert.match(pollRun.stdout, /POLL=done SUITE_EXIT=0/, `poll must report done exit 0, got: ${pollRun.stdout}`);

  // Source the completed capture and verify every field the phase-2 record needs.
  const capture = fs.readFileSync(`/tmp/fan-in-suite-${task}.env`, "utf8");
  for (const [re, name] of [
    [/^full_suite_ran=true$/m, "full_suite_ran"],
    [/^suite_exit=0$/m, "suite_exit"],
    [/^start_iso=/m, "start_iso"],
    [/^end_iso=/m, "end_iso"],
    [/^wall_ms=\d+$/m, "wall_ms"],
    [/^cpu_s=/m, "cpu_s"],
    [/^cpu_source=/m, "cpu_source"],
    [/^cpu_user_s=/m, "cpu_user_s"],
    [/^cpu_sys_s=/m, "cpu_sys_s"],
    [/^load=/m, "load"],
    [/^lane_count=\d+$/m, "lane_count"],
    [/^suite_head=/m, "suite_head"],
  ]) {
    assert.match(capture, re, `capture must carry ${name} (phase-2 入账输入)`);
  }
});

test("⑧ log-rotation REAL — relaunching the detached suite ROTATES /tmp/fan-in-suite-<task>.log to .prev and marks the current round (gap-fan-in-suite-log-cross-relaunch-reuse AC1/AC2)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-logrot-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-logrot";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  // A fake suite that emits a ROUND-TAGGED __PERFILE__ line (round-1 vs round-2 output distinguishable),
  // sleeps 1s (so the detached launch + exit marker both have time to work), and exits 0. The round tag
  // is a /tmp counter the test reads back to know which round the CURRENT log represents.
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"),
    `#!/usr/bin/env bash
count=$(cat /tmp/fan-in-suite-${task}.round 2>/dev/null || echo 0)
count=$((count+1))
echo "$count" > /tmp/fan-in-suite-${task}.round
echo "__PERFILE__ duration_ms=1.\${count} \${PWD}/round\${count}.test.mjs passed=true"
echo "__GROUP__ concurrency=2 files=1 sum_ms=10 floor_ms=10 capped=0"
sleep 1
exit 0
`);
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add test.sh"]);

  const roundFile = `/tmp/fan-in-suite-${task}.round`;
  const suiteLog = `/tmp/fan-in-suite-${task}.log`;
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  t.after(() => { for (const f of [`/tmp/fan-in-suite-${task}.env`, marker, `/tmp/fan-in-suite-${task}.time`, suiteLog, `${suiteLog}.prev`, roundFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

  const codeDeltaFile = `/tmp/fan-in-code-delta-${task}.txt`;
  fs.writeFileSync(codeDeltaFile, "plugin/workflows/fan-in-execute.js\n");
  t.after(() => { try { fs.rmSync(codeDeltaFile, { force: true }); } catch (_) { /* best-effort */ } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: REPO_ROOT, runId: "fm-logrot", mergeTarget: "develop" },
  });
  const launchBlock = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");

  const waitRound = async (round) => {
    for (let i = 0; i < 150; i++) {
      const c = fs.existsSync(roundFile) ? Number(fs.readFileSync(roundFile, "utf8").trim()) : 0;
      if (c >= round && fs.existsSync(marker)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timeout waiting for round ${round} marker`);
  };

  // Round 1 (initial launch).
  const r1 = runBash(launchBlock, { cwd: dir, timeout: 30_000 });
  assert.equal(r1.status, 0, `round-1 launch failed: ${r1.stderr}`);
  assert.match(r1.stdout, /SUITE_OUTCOME=started/, "code_delta non-empty must start the full suite");
  await waitRound(1);
  const log1 = fs.readFileSync(suiteLog, "utf8");
  assert.ok(log1.startsWith("__FANIN_SUITE_START__"), "round-1 log must start with the __FANIN_SUITE_START__ marker");
  assert.match(log1, /round=full/, "round-1 marker is round=full");
  assert.ok(log1.includes("__PERFILE__ duration_ms=1.1 "), "round-1 suite output follows the marker");
  assert.ok(log1.includes("__GROUP__ concurrency=2"), "round-1 __GROUP__ lane line present");

  // Round 2 (relaunch — the contaminated path this task fixes: same path reused without rotation).
  const r2 = runBash(launchBlock, { cwd: dir, timeout: 30_000 });
  assert.equal(r2.status, 0, `round-2 launch failed: ${r2.stderr}`);
  assert.match(r2.stdout, /SUITE_OUTCOME=started/, "relaunch must start the suite again");
  await waitRound(2);

  const log2 = fs.readFileSync(suiteLog, "utf8");
  assert.ok(log2.startsWith("__FANIN_SUITE_START__"), "round-2 log must start fresh with a new marker");
  assert.ok(log2.includes("__PERFILE__ duration_ms=1.2 "), "round-2 suite output is in the CURRENT log");
  assert.ok(!log2.includes("__PERFILE__ duration_ms=1.1 "), "round-1 output must NOT be in the current log (rotated away — 误读旧轮 eliminated)");

  // The .prev file preserves the PREVIOUS round (diagnostics + the marker-slicing contrast).
  const prev = fs.readFileSync(`${suiteLog}.prev`, "utf8");
  assert.ok(prev.includes("__PERFILE__ duration_ms=1.1 "), ".prev preserves round-1 content");
  assert.ok(!prev.includes("__PERFILE__ duration_ms=1.2 "), ".prev must NOT contain the current round");

  // AC2 negative control ON THE PRODUCTION CARRIER: reader slicing by marker distinguishes current vs
  // historical round from the REAL rotated log (parsePerFileLines reads only the last-marker round).
  const { parsePerFileLines } = await import("../scripts/measure-trend-check.ts");
  const recs = parsePerFileLines(log2);
  assert.deepEqual(
    recs.map((r) => [r.file.split("/").pop(), r.passed]),
    [["round2.test.mjs", true]],
    "the reader slices to the current (round-2) round from the real relaunched log",
  );
});


test("⑧ split — the poll block parses a gnu-time '%U %S' line into cpu_user_s/cpu_sys_s (real values, not estimates)", async (t) => {
  // gap-verification-round-cpu-split-not-recorded AC1/AC3 — the poll block splits the SAME gnu-time line
  // whose sum becomes cpu_time_s. Seeded with the finding's real values (user=4414.230 sys=6899.653):
  // the capture must carry both columns and the writer's record must satisfy user+sys ≈ cpu_time_s.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-split-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-tb-split";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const timeFile = `/tmp/fan-in-suite-${task}.time`;
  const logFile = `/tmp/fan-in-suite-${task}.log`;
  t.after(() => { for (const f of [capture, marker, timeFile, logFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  // Seed the pre-suite capture fields, a green exit marker, a readable suite log, and a REAL gnu-time line.
  fs.writeFileSync(capture, [
    "full_suite_ran=true",
    "skip_reason=",
    "start_iso=2026-08-20T00:00:00.000Z",
    "start_ms=1755652800000",
    "suite_head=" + "0".repeat(40),
    `suite_log_file=${logFile}`,
  ].join("\n") + "\n", "utf8");
  fs.writeFileSync(marker, "exit=0\nend_ms=1755652801000\nend_iso=2026-08-20T00:00:01.000Z\n", "utf8");
  fs.writeFileSync(timeFile, "4414.230 6899.653\n", "utf8");
  fs.writeFileSync(logFile, "ok\n", "utf8");

  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: REPO_ROOT, runId: "fm-tb-split", mergeTarget: "develop" },
  });
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const r = runBash(pollBlock, { cwd: dir });
  assert.equal(r.status, 0, `poll block failed: ${r.stderr}`);
  assert.match(r.stdout, /POLL=done SUITE_EXIT=0/, `poll must report done exit 0, got: ${r.stdout}`);

  const out = fs.readFileSync(capture, "utf8");
  assert.match(out, /^cpu_user_s=4414\.230$/m, "capture carries cpu_user_s from the gnu-time %U column");
  assert.match(out, /^cpu_sys_s=6899\.653$/m, "capture carries cpu_sys_s from the gnu-time %S column");
  assert.match(out, /^cpu_s=11313\.883$/m, "cpu_s stays the sum (user+sys) — AC1 keeps the existing field");
  assert.match(out, /^cpu_source=gnu-time$/m, "cpu_source=gnu-time for a real measurement");
});



// ── ⑧⑩ 锁等待负控制（gap-single-flight-lock-timeout-double-value AC1/AC2）────────────────────────
// THE DEFECT: test.sh 的 single-flight 锁有两套超时值（FULL_SUITE_LOCK_TIMEOUT 默认 600 + fan-in 的
// suiteLockTimeoutSecs 900 覆盖），且 600s 线已被常态化的 819-1619s full-bucket suite 跨越 ⇒ 活 suite
// 被 fail-closed「not starting」误杀 + 重试放大。
// FIX: test.sh 的锁等待改为【无界排队】（flock crash-autorelease 保证死持有者不泄漏槽），fan-in 不再经
// env 传 FULL_SUITE_LOCK_TIMEOUT（无双值、无 900 字面量）。
// ① 结构负控制（本缺陷的负控制）：launch/isolate 块不得携带 FULL_SUITE_LOCK_TIMEOUT / suite_lock_timeout
//    —— revert 本修复（重新经 env 传 / 重引入 suiteLockTimeoutSecs）⇒ 此断言红。
// ② REAL 机制（wait-and-acquire）：fake test.sh 忠实复现 test.sh 的【无界】锁等待语义（S=2 槽、非阻塞
//    try + 无界等待 + 永不 fail-closed）。两槽全忙时套件【等待】释放而【非】fail-closed。
test("⑧⑩ 锁等待负控制 — suite-launch 不再携带 FULL_SUITE_LOCK_TIMEOUT (无双值); REAL 槽忙→释放后获取而非 fail-closed", async (t) => {
  // RED 序列驱动 vm 实执行：fix agent prompt 携带 ISOLATE_LAUNCH 块（SUITE_LAUNCH 在 phase-1 prompt）。
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-lockwait", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-lockwait", mergeTarget: "develop" },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                          // stage 2: RED
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "" },                       // Fix agent (carries ISOLATE_LAUNCH)
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 re-dispatched
    ],
  });

  // ── ① 结构负控制（无双值）──
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  assert.ok(!launch.includes("FULL_SUITE_LOCK_TIMEOUT"), "suite-launch must NOT pass FULL_SUITE_LOCK_TIMEOUT (single source = test.sh unbounded queue wait)");
  assert.ok(!launch.includes("suite_lock_timeout"), "suite-launch must NOT define a suite_lock_timeout override");
  const isolate = extractBlockFromPrompts(prompts, "# isolate-launch-block-start", "# isolate-launch-block-end");
  assert.ok(!isolate.includes("FULL_SUITE_LOCK_TIMEOUT"), "isolate-rerun launch must NOT pass FULL_SUITE_LOCK_TIMEOUT");
  assert.ok(!isolate.includes("suite_lock_timeout"), "isolate-rerun launch must NOT define a suite_lock_timeout override");

  // ── ② REAL wait-and-acquire ──
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-lockwait-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-lockwait-real";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);

  // Fake test.sh: faithful single-flight lock semantics (S=2 slots, non-blocking try, UNBOUNDED wait —
  // never fail-closed). The REAL scripts/test.sh is far too heavy for a unit test.
  const fakeTest = [
    "#!/usr/bin/env bash",
    "set -u",
    'lock_base="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)/full-suite.lock"',
    "fds=()",
    'for i in 0 1; do exec {fd}>"${lock_base}.${i}"; fds+=("$fd"); done',
    'held=""',
    "idx=0",
    'for fd in "${fds[@]}"; do if flock -n "$fd"; then held="$idx"; break; fi; idx=$((idx+1)); done',
    'if [ -z "$held" ]; then',
    '  while [ -z "$held" ]; do',
    "    idx=0",
    '    for fd in "${fds[@]}"; do if flock -w 1 "$fd"; then held="$idx"; break; fi; idx=$((idx+1)); done',
    "  done",
    "fi",
    'echo "acquired full-suite single-flight slot $held"',
    "sleep 1",
    "exit 0",
    "",
  ].join("\n");
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), fakeTest);
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add fake test.sh"]);

  const codeDeltaFile = `/tmp/fan-in-code-delta-${task}.txt`;
  fs.writeFileSync(codeDeltaFile, "plugin/workflows/fan-in-execute.js\n");
  const tmpFiles = [`/tmp/fan-in-suite-${task}.env`, `/tmp/fan-in-suite-${task}.exit`, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`, codeDeltaFile];
  t.after(() => { for (const f of tmpFiles) { try { fs.rmSync(f, { force: true }); } catch (_) {} } });

  const { prompts: prompts2 } = await runWorkflow({
    args: { task, worktree: dir, root: REPO_ROOT, runId: "fm-lockwait-real", mergeTarget: "develop" },
  });
  const launchBlock = extractBlockFromPrompts(prompts2, "# suite-launch-block-start", "# suite-launch-block-end");

  // Hold BOTH slots in a detached holder; killing it releases the flock (fd close auto-releases).
  const holder = spawn("bash", ["-c",
    `cd ${dir}; exec 8>"${dir}/.git/full-suite.lock.0"; flock -n 8 || exit 8; ` +
    `exec 9>"${dir}/.git/full-suite.lock.1"; flock -n 9 || exit 9; ` +
    `touch ${dir}/slots-held; sleep 30`], { stdio: "ignore" });
  t.after(() => { try { holder.kill("SIGKILL"); } catch (_) {} });
  for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, "slots-held")); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(fs.existsSync(path.join(dir, "slots-held")), "holder must hold both slots before the suite launch");

  // Launch the REAL SUITE_LAUNCH block (no env seam — the unbounded wait lives in test.sh). Spawn
  // asynchronously (spawnSync would block until the detached suite's inherited stdout pipe closes), verify
  // the suite is STILL WAITING (no exit marker — it did NOT fail-closed), free a slot, then await the
  // block's ~1s confirm. The suite must acquire the freed slot and run to exit 0.
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const launchProc = spawn("bash", ["-c", launchBlock], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let launchOut = "";
  launchProc.stdout.on("data", (d) => { launchOut += d; });
  launchProc.stderr.on("data", (d) => { launchOut += d; });
  await new Promise((r) => setTimeout(r, 1500)); // let the suite start waiting
  assert.ok(!fs.existsSync(marker), "the suite must WAIT while both slots are held — no exit marker (never fail-closed)");
  holder.kill("SIGKILL");                       // free a slot WHILE the suite is waiting
  const launchExit = await new Promise((resolve) => { launchProc.on("exit", (code, sig) => resolve({ code, sig })); });
  assert.equal(launchExit.code, 0, `launch block failed: ${launchOut}`);

  let seen = false;
  for (let i = 0; i < 50 && !seen; i++) { if (fs.existsSync(marker)) seen = true; else await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(seen, "the waiting suite must acquire the freed slot and write its exit marker");
  const markerText = fs.readFileSync(marker, "utf8");
  const log = fs.readFileSync(`/tmp/fan-in-suite-${task}.log`, "utf8");
  assert.match(markerText, /exit=0/, `the suite must run to exit 0 after acquiring the freed slot, got: ${markerText.trim()}`);
  assert.match(log, /acquired full-suite single-flight slot/, "the suite must log its slot acquisition");
  assert.ok(!log.includes("not starting"), "the suite must NOT fail-closed (no 'not starting' lock refusal)");
});

// ── ⑧ durationMs 真墙钟一致性（gap-fan-in-suite-duration-poll-granularity-inflation）─────────────────
// THE DEFECT: wall_ms = end_ms − start_ms where end_ms was captured at POLL-DISCOVERY time (when the
// poll agent first sees the exit marker). Under a 60s poll interval the suite's true end lands between
// polls ⇒ durationMs systematically inflated 0-60s (round232: marker mtime 23:07:41.89, true 609.1s,
// ledger recorded 674.2s — +65.1s, straddling the AC101 600s gate). FIX: the detached suite writes its
// TRUE end (end_ms/end_iso) into the exit marker at the moment it exits; the poll only READS it.

test("⑧ duration-wiring — the poll block reads end_ms/end_iso from the marker (the suite TRUE end), falling back to poll-discovery only for an old-format marker", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-tb-poll", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-poll", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  // The fix: the poll reads the suite's TRUE end from the exit marker (written by the detached suite).
  assert.ok(poll.includes("marker_end_ms=$(sed -n 's/^end_ms=//p'"), "poll must read end_ms from the exit marker (the suite's TRUE end, not poll-discovery)");
  assert.ok(poll.includes("marker_end_iso=$(sed -n 's/^end_iso=//p'"), "poll must read end_iso from the exit marker");
  // ...and falls back to poll-discovery ONLY when the marker has no end_ms (old-format marker).
  assert.match(poll, /end_ms=\$\{marker_end_ms:-/, "end_ms must default to marker_end_ms (fallback = poll-discovery)");
  assert.match(poll, /end_iso=\$\{marker_end_iso:-/, "end_iso must default to marker_end_iso");
  // The OLD buggy form (end_ms = date +%s%3N unconditionally at poll time) must NOT be the assignment.
  assert.ok(!/^end_ms=\$\(date \+%s%3N\)$/m.test(poll), "end_ms must NOT be taken unconditionally from poll-discovery time");
  // The capture write must still record end_ms/end_iso/wall_ms.
  assert.ok(poll.includes("end_ms=%s"), "poll must still write end_ms into the capture");
  assert.ok(poll.includes("wall_ms"), "poll must still compute wall_ms");
});

test("⑧ duration REAL — wall_ms equals the suite TRUE wall clock (marker end_ms − start_ms), NOT inflated by poll-discovery latency (AC1 取假)", async (t) => {
  // THE FALSIFICATION: a real detached suite (sleep 1s → exit 0); AFTER its marker already exists we
  // deliberately delay the poll ~5s (a poll interval gap). The OLD code's poll-time `date +%s%3N` would
  // fold that whole 5s gap into wall_ms (the 0-60s inflation). The FIX must yield wall_ms ≈ the suite's
  // true duration, not the poll-discovery time.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-duration-"));
  t.after(() => cleanup(dir));
  const task = "gap-test-tb-duration";
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "-A"]); git(["commit", "-qm", "base"]);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), "#!/usr/bin/env bash\nsleep 1\nexit 0\n");
  fs.chmodSync(path.join(dir, "scripts", "test.sh"), 0o755);
  git(["add", "-A"]); git(["commit", "-qm", "add test.sh"]);

  const codeDeltaFile = `/tmp/fan-in-code-delta-${task}.txt`;
  fs.writeFileSync(codeDeltaFile, "plugin/workflows/fan-in-execute.js\n");
  t.after(() => { for (const f of [`/tmp/fan-in-suite-${task}.env`, `/tmp/fan-in-suite-${task}.exit`, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`, `/tmp/fan-in-suite-${task}.pid`, codeDeltaFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: dir, root: REPO_ROOT, runId: "fm-tb-duration", mergeTarget: "develop" },
  });
  const launchBlock = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  const launchRun = runBash(launchBlock, { cwd: dir, timeout: 30_000 });
  assert.equal(launchRun.status, 0, `launch block failed: ${launchRun.stderr}`);
  assert.match(launchRun.stdout, /SUITE_OUTCOME=started/, `code_delta non-empty must start the full suite, got: ${launchRun.stdout}`);

  const marker = `/tmp/fan-in-suite-${task}.exit`;
  const capture = `/tmp/fan-in-suite-${task}.env`;
  let seen = false;
  for (let i = 0; i < 50 && !seen; i++) { if (fs.existsSync(marker)) seen = true; else await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(seen, "the detached suite must write its exit marker");

  // Read the TRUE end the detached suite recorded in the marker + the start from the capture.
  const markerText = fs.readFileSync(marker, "utf8");
  const markerEndMs = Number((markerText.match(/^end_ms=(\d+)/m) || [])[1]);
  const markerEndIso = (markerText.match(/^end_iso=(.+)$/m) || [])[1];
  assert.ok(Number.isFinite(markerEndMs), `marker must carry the suite's TRUE end_ms (the fix's source of truth), got:\n${markerText}`);
  assert.ok(markerEndIso, `marker must carry the suite's TRUE end_iso, got:\n${markerText}`);
  const captureText = fs.readFileSync(capture, "utf8");
  const startMs = Number((captureText.match(/^start_ms=(\d+)/m) || [])[1]);
  assert.ok(Number.isFinite(startMs), "capture must carry start_ms");
  const trueDurationMs = markerEndMs - startMs;
  assert.ok(trueDurationMs > 0, `true suite duration must be positive, got ${trueDurationMs}`);

  // ⛔ THE FALSIFICATION: deliberately delay the poll ~5s AFTER the suite already ended. The OLD poll
  // would add this whole gap to wall_ms (the recorded +65.1s class of inflation).
  await new Promise((r) => setTimeout(r, 5000));

  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const pollRun = runBash(pollBlock, { cwd: dir, timeout: 15_000 });
  assert.equal(pollRun.status, 0, `poll block failed: ${pollRun.stderr}`);
  assert.match(pollRun.stdout, /POLL=done SUITE_EXIT=0/, `poll must report done exit 0, got: ${pollRun.stdout}`);

  const after = fs.readFileSync(capture, "utf8");
  const wallMs = Number((after.match(/^wall_ms=(\d+)/m) || [])[1]);
  const recordedEndIso = (after.match(/^end_iso=(.+)$/m) || [])[1];
  assert.ok(Number.isFinite(wallMs), "capture must carry wall_ms");
  assert.equal(wallMs, trueDurationMs, `wall_ms must equal the suite's TRUE duration (marker end_ms − start_ms); the ~5s deliberate poll delay must NOT inflate it (old code would record ≈ ${trueDurationMs + 5000})`);
  assert.equal(recordedEndIso, markerEndIso, `end_iso must be the suite's TRUE end (marker), not the poll time`);
  // Sanity: the true 1s-sleep suite's wall_ms must sit in the seconds-range, NOT the ~6s inflated range.
  assert.ok(wallMs < trueDurationMs + 2000, `wall_ms ${wallMs} must not exceed the true duration ${trueDurationMs} by more than a small margin (no poll-latency inflation)`);
});

test("⑧ AC3 记录面真实化 REAL — the poll reads lane_count from the suite log's __GROUP__ concurrency= (真实 lane, NOT nproc)", async (t) => {
  // gap-suite-concurrency-ff-gate-and-slot-ssot AC3: lane_count 取 suite 日志的 __GROUP__ concurrency=
  // (measure-suite-reporter 每 phase 一行; 主 phase 跑最后 ⇒ 取最后一行 = 套件真实 lane)。旧实现记
  // nproc（实跑 concurrency=8 记成 16 — 记录面伪造）。This runs the REAL poll block against a capture
  // + exit marker + a log carrying serial(2) + main(8) __GROUP__ lines ⇒ lane_count must be 8.
  const task = "gap-test-lane-real";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const exitMarker = `/tmp/fan-in-suite-${task}.exit`;
  const log = `/tmp/fan-in-suite-${task}.log`;
  const nowMs = Date.now();
  fs.writeFileSync(log, [
    "selected 3 files (groups=serial)",
    "__GROUP__ concurrency=2 files=3 sum_ms=100 floor_ms=60 capped=0",
    "selected 17 files (groups=product,engine)",
    "__GROUP__ concurrency=8 files=17 sum_ms=3000 floor_ms=1200 capped=0",
  ].join("\n") + "\n");
  fs.writeFileSync(capture, [
    "full_suite_ran=true",
    "skip_reason=",
    `start_ms=${nowMs}`,
    `suite_log_file=${log}`,
    "suite_head=abc123",
  ].join("\n") + "\n");
  fs.writeFileSync(exitMarker, `exit=0\nend_ms=${nowMs + 1500}\nend_iso=2026-08-18T00:00:01.500Z\n`);
  t.after(() => { for (const f of [capture, exitMarker, log]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-lane-real", mergeTarget: "develop" },
  });
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const pollRun = runBash(pollBlock, { timeout: 15_000 });
  assert.equal(pollRun.status, 0, `poll block failed: ${pollRun.stderr}`);
  assert.match(pollRun.stdout, /POLL=done SUITE_EXIT=0/, `poll must report done exit 0, got: ${pollRun.stdout}`);

  const after = fs.readFileSync(capture, "utf8");
  const lane = (after.match(/^lane_count=(\d+)$/m) || [])[1];
  assert.equal(lane, "8", `lane_count must be the MAIN phase's real concurrency (the last __GROUP__ line), got: ${after.match(/^lane_count=.*$/m)?.[0]}`);
});

// ── ⑩ 阶段 2 agent 内单次有界阻塞等待（gap-fan-in-execute-poll-bounded-blocking-wait）────────────
// THE DEFECT: 旧「每轮起一个新短命轮询 agent + 脚本 setTimeout 60s」下每次 agent 只看一眼 marker 就返回
// not-done ⇒ suite 11-19min ⇒ 头 11-15 次结构上必然 not-done 纯空转。修复（在 stage-2 单 agent 内）：
// 等待块带【有界阻塞等待】（timeout 540 + sleep 15）——单次 Bash 最多阻塞 540s（硬边界 < Bash 600s
// 上限），每 15s 看一眼 marker，把 ~21 次空转压到 ~3 次。决策权在固定命令（timeout 540 是脚本给的硬
// 边界、maxSuitePolls 是循环上限），agent 不自决「等多久」（ab380c5e 是 agent 自决等待，这里是固定命令
// 的有界等待，agent 只是重跑它；gap-subagent-turn-budget-13min-falsified）。

test("⑩ 有界阻塞等待 wiring — 阶段 2 等待块带 timeout 540（< Bash 600s 上限）+ sleep 15 循环（能取假）", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-poll-bounded", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-poll-bounded", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  // 有界阻塞等待必须存在（能取假：把 timeout 去掉 ⇒ 此断言红）。
  const m = poll.match(/timeout (\d+) bash -c/);
  assert.ok(m, "poll must carry `timeout <N> bash -c` (the bounded blocking wait)");
  const timeoutSecs = Number(m[1]);
  // 硬边界 < Bash 600s 上限（能取假：放宽 >600s ⇒ 此断言红）。
  assert.ok(timeoutSecs < 600, `the blocking-wait hard bound must be < Bash 600s limit, got ${timeoutSecs}s`);
  assert.equal(timeoutSecs, 540, "the hard bound must be exactly 540s (AC1: < 600s with safety margin)");
  // sleep 15 检查粒度 + 循环等 marker 而非 agent 自决时长。
  assert.ok(poll.includes('while [ ! -f "$1" ]; do'), "the bounded wait must loop on the marker existence with sleep, not an agent-decided duration");
  assert.ok(poll.includes('sleep 15'), "the bounded wait must carry the sleep 15 poll granularity");
  // 存活核验（gap-suite-wait-bash-stale-pid-poll AC1）：内层循环必须 kill -0 核验 suite_pid，不纯靠 .exit 存在性。
  assert.ok(poll.includes('kill -0 "$2"'), "the bounded wait must liveness-check suite_pid with kill -0");
  // 决策权在固定命令（不是 agent 自决等待）——阶段 2 prompt 明示「不要做任何等待决策」。
  assert.ok(poll.includes("不要做任何等待决策"), "the wait block must refuse to make any waiting decision (fixed command, ab380c5e 反面)");
});

test("⑩ REAL 有界阻塞等待 — marker 中途出现时，轮询在【一次】阻塞内等到它（阻塞等待生效，非 N 次空转）", async (t) => {
  const task = "gap-test-poll-bounded-real";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  fs.rmSync(marker, { force: true });
  fs.writeFileSync(capture, ["full_suite_ran=true", "skip_reason=", `start_ms=${Date.now()}`, "suite_head=abc", `suite_log_file=/tmp/fan-in-suite-${task}.log`].join("\n") + "\n");
  t.after(() => { for (const f of [capture, marker, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });
  // marker 在 ~1s 后由【后台进程】写入（spawnSync 阻塞 Node 事件循环，Node setTimeout 不会在期间触发）。
  // 测试用 pollBlockSleep=0.2 覆盖生产 sleep 15，证明阻塞等待本身会等——不是 fixture，是真实 bash 执行。
  spawn("bash", ["-c", `sleep 1; echo exit=0 > "${marker}"; echo "end_ms=$(date +%s%3N)" >> "${marker}"; echo end_iso=2026-08-18T00:00:01.000Z >> "${marker}"`], { detached: true, stdio: "ignore" }).unref();

  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-poll-bounded-real", mergeTarget: "develop", pollBlockSeconds: 10, pollBlockSleep: 0.2 },
  });
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const t0 = Date.now();
  const r = runBash(pollBlock, { cwd: "/tmp", timeout: 15_000 });
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 0, `poll block failed: ${r.stderr}`);
  assert.match(r.stdout, /POLL=done SUITE_EXIT=0/, `poll must find the marker mid-block (bounded wait), got: ${r.stdout}`);
  assert.ok(elapsed >= 800, `the poll must have BLOCKED waiting (elapsed ${elapsed}ms); an instant not-done return is the N-empty-poll shape this fixes`);
});

test("⑩ REAL 死进程负控制 — suite 进程在写 .exit 前静默死亡 ⇒ poller 快速 emit POLL=suite-pid-dead + 写可区分失败态（gap-suite-wait-bash-stale-pid-poll AC1/AC2）", async (t) => {
  const task = "gap-test-piddead";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  const marker = `/tmp/fan-in-suite-${task}.exit`;
  fs.rmSync(marker, { force: true });
  // 真实死亡 pid（非 fixture 数字）：spawn 一个短命进程、等它被 reap，然后断言 kill -0 失败。
  const deadPid = Number(spawnSync("bash", ["-c", "echo $$; sleep 0.1"], { encoding: "utf8" }).stdout.trim());
  assert.ok(Number.isInteger(deadPid) && deadPid > 0, `dead pid precondition: got ${deadPid}`);
  const alive = spawnSync("bash", ["-c", `kill -0 ${deadPid} 2>/dev/null; echo $?`], { encoding: "utf8" }).stdout.trim();
  assert.equal(alive, "1", `test precondition: pid ${deadPid} must be provably dead (kill -0 exit 1), got ${alive}`);
  // capture 模拟已启动 suite（含 suite_pid）但 .exit 从未被写（进程静默死亡）。
  fs.writeFileSync(capture, ["full_suite_ran=true", "skip_reason=", `start_ms=${Date.now()}`, "suite_head=abc", `suite_log_file=/tmp/fan-in-suite-${task}.log`, `suite_pid=${deadPid}`].join("\n") + "\n");
  t.after(() => { for (const f of [capture, marker, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

  // 测试用 pollBlockSleep=0.2 + pollBlockSeconds=30：若 poller 仍只查 .exit 存在性，会在 30s 硬边界内
  // 空转（旧谓词）；新谓词在第一次 sleep 间隔就 kill -0 发现 pid 死亡 ⇒ 立即返回。
  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-piddead", mergeTarget: "develop", pollBlockSeconds: 30, pollBlockSleep: 0.2 },
  });
  const pollPrompt = promptContaining(prompts, "POLL=not-done");
  const pollBlock = pollPrompt.slice(pollPrompt.indexOf("suite_capture="), pollPrompt.indexOf("返回 { done: bool"));
  const t0 = Date.now();
  const r = runBash(pollBlock, { cwd: "/tmp", timeout: 15_000 });
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 0, `poll block failed: ${r.stderr}`);
  assert.match(r.stdout, /POLL=suite-pid-dead/, `must emit the distinguishable suite-pid-dead state, got: ${r.stdout}`);
  assert.ok(elapsed < 10_000, `must fail fast (kill -0 on first sleep interval), NOT spin the ${30}s bound: elapsed ${elapsed}ms`);
  // AC2: 可区分失败态落在生产载体（capture），不是只有 agent stdout 一句。
  const cap = fs.readFileSync(capture, "utf8");
  assert.match(cap, /^suite_pid_dead=1$/m, "capture must carry suite_pid_dead=1 (AC2 distinguishable failure state)");
});

// ── ⑩b 阶段 2 agent 循环等待覆盖（gap-subagent-turn-budget-13min-falsified：取代旧 firstDelayMs/pollIntervalMs）──
// 旧设计的「首轮起轮延迟 firstDelayMs（660s）+ 脚本 setTimeout 循环 + 每轮起一个新短命轮询 agent」已随
// 证伪（无 subagent 回合预算超时）一起删除——阶段 2 agent 在本回合内循环运行【单个有界阻塞等待块】
// （timeout 540 + sleep 15，< 600s 硬顶）直到 exit marker 出现（最多 maxSuitePolls 次）。覆盖判据从
// 「firstDelayMs + pollBlockSeconds ≥ 时长」改为「maxSuitePolls × pollBlockSeconds ≥ 时长」
// （默认 60×540=32400s ≫ 1140s）。

test("⑩b stage-2 wait wiring — the stage-2 prompt carries the bounded-wait block (timeout 540 + sleep 15) AND the maxSuitePolls loop bound (能取假)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-firstdelay", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-firstdelay", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  const m = poll.match(/timeout (\d+) bash -c/);
  assert.ok(m, "the stage-2 wait block must carry `timeout <N> bash -c` (the bounded blocking wait)");
  const pollBlockSeconds = Number(m[1]);
  assert.ok(pollBlockSeconds < 600, `the blocking-wait hard bound must be < Bash 600s limit, got ${pollBlockSeconds}s`);
  assert.equal(pollBlockSeconds, 540, "the hard bound must be exactly 540s (AC1: < 600s with safety margin)");
  assert.ok(poll.includes('while [ ! -f "$1" ]; do'), "the bounded wait must loop on the marker existence with sleep");
  assert.ok(poll.includes('kill -0 "$2"'), "the bounded wait must liveness-check suite_pid with kill -0 (gap-suite-wait-bash-stale-pid-poll AC1)");
  // The agent-loop bound (gap-subagent-turn-budget-13min-falsified): the SAME stage-2 agent re-runs the
  // block up to maxSuitePolls times — 取假: 删掉「最多 N 次」循环说明 ⇒ 此断言红。
  const cap = poll.match(/最多 (\d+) 次/);
  assert.ok(cap, "the stage-2 wait instructions must carry the maxSuitePolls loop bound ('最多 N 次')");
  const maxSuitePolls = Number(cap[1]);
  const totalCoverageSecs = maxSuitePolls * pollBlockSeconds;
  assert.ok(totalCoverageSecs >= SUITE_FLOOR_SECS, `stage-2 loop coverage (${maxSuitePolls}×${pollBlockSeconds}s = ${totalCoverageSecs}s) must ≥ suite 时长 ${SUITE_FLOOR_SECS}s`);
});

test("⑩b stage-2 wait args override — pollBlockSeconds / pollBlockSleep / maxSuitePolls are args-overridable and reflected in the prompt (AC1 seam)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-firstdelay0", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-firstdelay0", mergeTarget: "develop", pollBlockSeconds: 123, pollBlockSleep: 0.5, maxSuitePolls: 7 },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  assert.match(poll, /timeout 123 bash -c/, "pollBlockSeconds override must render in the wait block");
  assert.ok(poll.includes('sleep 0.5'), "pollBlockSleep override must render in the wait block");
  assert.ok(poll.includes('kill -0 "$2"'), "the liveness check must render in the wait block");
  assert.match(poll, /最多 7 次/, "maxSuitePolls override must render in the loop bound");
});

// ── ⑩d 单次硬边界 + 循环覆盖 ≥ suite 时长（gap-agent-no-timeout-option AC1/AC3，2026-08-20 外层裁定）────
// THE DEFECT (b187d84a 回退教训): 把 pollBlockSeconds 收到 100（< Bash 工具默认 120s）曾被当成
// 「让等待落在默认时限内 ⇒ 等待即代码保证」——但单次等待的硬边界 × 循环次数必须覆盖 suite 时长（实测
// 19+ min ≈ 1140s）。agent() 无 timeout 旋钮（opts 仅 {label,phase,schema,model,effort,isolation,agentType}）
// ——「加旋钮」是 Claude Code 特性请求、仓库改不了。兜底 = suite detached 运行（setsid+&+disown）：
// 阶段 2 agent 的 Bash 即使被默认 120s kill、提前返回 not-done，suite 继续跑，agent 重跑等待块即可——
// detached 让「agent 内长阻塞」成为纯优化而非正确性要求。

const SUITE_FLOOR_SECS = 1140; // 实测 19+ min ≈ 1140s（2026-08-20 外层裁定）

test("⑩d stage-2 loop 覆盖 ≥ suite 时长 — 默认 maxSuitePolls × pollBlockSeconds 覆盖单次 suite（AC1 机械判据，读真实 prompt）", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-poll-boundary", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-poll-boundary", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  const m = poll.match(/timeout (\d+) bash -c/);
  assert.ok(m, "the wait block must carry `timeout <N> bash -c` (the bounded blocking wait)");
  const pollBlockSeconds = Number(m[1]);
  const cap = poll.match(/最多 (\d+) 次/);
  assert.ok(cap, "the wait instructions must carry the maxSuitePolls loop bound");
  const maxSuitePolls = Number(cap[1]);
  const totalCoverageSecs = maxSuitePolls * pollBlockSeconds;
  assert.ok(
    totalCoverageSecs >= SUITE_FLOOR_SECS,
    `stage-2 loop 覆盖（maxSuitePolls ${maxSuitePolls} × pollBlockSeconds ${pollBlockSeconds}s = ${totalCoverageSecs}s）必须 ≥ suite 时长 ${SUITE_FLOOR_SECS}s；取假：把 pollBlockSeconds 收到 100 且 maxSuitePolls=1 ⇒ 100 < 1140 ⇒ 本断言红（b187d84a 回退教训）`
  );
});

test("⑩d falsification — 单次覆盖 < suite 时长时判据红（pollBlockSeconds=100 + maxSuitePolls=1 override，AC3 取假）", async (t) => {
  // 取假：同一个「覆盖度 ≥ 地板」谓词喂给一个【已知为坏的】配置（100s 单次 × 1 次循环，b187d84a 回退值）
  // ⇒ 谓词必须判它为不及格（断言通过 = 谓词能红，证明「≥ 地板」不是恒真——硬规则 4）。
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-poll-boundary-bad", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-poll-boundary-bad", mergeTarget: "develop", pollBlockSeconds: 100, maxSuitePolls: 1 },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  const m = poll.match(/timeout (\d+) bash -c/);
  assert.ok(m, "the wait block must carry `timeout <N> bash -c`");
  const pollBlockSeconds = Number(m[1]);
  assert.equal(pollBlockSeconds, 100, "sanity: the pollBlockSeconds=100 override must be applied");
  const cap = poll.match(/最多 (\d+) 次/);
  assert.ok(cap, "the wait instructions must carry the maxSuitePolls loop bound");
  const maxSuitePolls = Number(cap[1]);
  assert.equal(maxSuitePolls, 1, "sanity: the maxSuitePolls=1 override must be applied");
  const totalCoverageSecs = maxSuitePolls * pollBlockSeconds;
  assert.ok(
    totalCoverageSecs < SUITE_FLOOR_SECS,
    `取假谓词：${totalCoverageSecs}s < ${SUITE_FLOOR_SECS}s 必须成立（100s × 1 = 100 < 1140，覆盖不到 suite 时长）；若此断言红则「≥ 地板」判据是恒真/错测`
  );
});

// ── ⑩c suite-poller agentType（gap-fan-in-execute-poll-cost-firstdelay-agenttype AC2 + wiring 审计 A）──
// agentType='suite-poller' 的 wiring 已 revert（7b917cd1：.claude/agents 新目录 watcher 不加载、fan-in
// bootstrap 当场 crash）；d1338f95 重写后【没有短命轮询 agent 可挂它】——阶段 2 agent 承担机械步骤
// （per-task-suite 入账 / flip / ff / bracket），套 Bash-only 会砍掉其必需工具 ⇒ 恢复接线架构上不成立。
// 处置：删除零消费者孤儿（gap-wiring-A-fan-in-execute-suite-poller-impl-complete），不留孤儿。

test("⑩c suite-poller orphan removed — .claude/agents/suite-poller.md no longer exists (wiring revoked, no restorable consumer)", () => {
  const agentFile = path.join(REPO_ROOT, ".claude", "agents", "suite-poller.md");
  assert.ok(!fs.existsSync(agentFile), "the suite-poller orphan must be REMOVED (no zero-consumer orphan left)");
  // 没有 live wiring 引用 agentType suite-poller（阶段 2 不是 poll-only agent，套它会砍掉机械步骤工具）。
  const wf = fs.readFileSync(path.join(REPO_ROOT, "plugin", "workflows", "fan-in-execute.js"), "utf8");
  assert.ok(!wf.includes("agentType: 'suite-poller'"), "fan-in-execute must NOT wire agentType suite-poller");
});

// ── fix-scope gate（gap-fix-scope-gate-wired-to-wrong-path）───────────────────────────────────────
// THE DEFECT: 上一版 fix-scope gate（gap-suite-fix-workflow-no-load-sensitive-branch）落在
// execute-suite-fix.js（standalone 死工作流）零效果——生产 suite-fix 是 fan-in-execute.js 的内联
// subagent（suite-fix 阶段 prompt），直接修根因、不经 execute-suite-fix.js。越界修已复发第 8+ 例
// （b0aa31c2 修 quay-init.sh / eb77b17e 修 supervisor-observe.test.mjs / 43153e58 修
// session-liveness-helpers.mjs——全不在各自任务 Touches）。FIX：gate 接线到内联 suite-fix prompt，
// fix 前判红是否本任务 Touches 内回归——inScope 修 / load-sensitive 释放 / 别任务 bug defer。
// 负控制（AC2）用【真实 bash】跑 gate 块（vm 实执行 workflow 发出的 prompt 分类），判越界红被
// defer/release、零越界 fix。判定复用 touches-orthogonality-check.ts（parseTouches/matchGlob）+
// known-load-sensitive.ts（scanFamily/kindForFile），与 execute-suite-fix.js 同源。

/** Drive the RED path so the workflow emits the suite-fix (Fix-agent) prompt, then extract the
 *  fix-scope gate block from that prompt. */
async function fixScopeGateBlockFor(task, worktree) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root: REPO_ROOT, runId: "fm-fixscope", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                          // stage 2: suite RED
      { relaunched: true, worktreeHead: "h2", failuresFixed: ["x"], note: "" },                     // Fix agent
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 re-dispatched
    ],
  });
  return extractBlockFromPrompts(prompts, "# fix-scope-gate-block-start", "# fix-scope-gate-block-end");
}

/** A fake worktree: real plugin/ symlinked (the gate imports touches-orthogonality-check.ts /
 *  known-load-sensitive.ts and scanFamily against the real manifest) + a real tasks/<id>.md. */
function makeFixScopeDir(prefix, task, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(dir, "plugin"), "dir");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", `${task}.md`), body, "utf8");
  return dir;
}

test("fix-scope wiring — the inline suite-fix prompt carries the gate (判红 Touches 内/越界), NOT execute-suite-fix.js", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-fixscope-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-fixscope-wire", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 1 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },
      { relaunched: true, worktreeHead: "h2", failuresFixed: ["x"], note: "" },
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true },
    ],
  });
  const fixPrompt = promptContaining(prompts, "suite-fix 阶段");
  assert.ok(fixPrompt.includes("# fix-scope-gate-block-start"), "the fix prompt must carry the fix-scope gate block");
  assert.ok(fixPrompt.includes("FIX_SCOPE_VERDICT"), "the gate must emit a FIX_SCOPE_VERDICT");
  assert.ok(fixPrompt.includes("known-load-sensitive.ts"), "the gate must partition by the load-sensitive manifest");
  assert.ok(fixPrompt.includes("touches-orthogonality-check.ts"), "the gate must reuse parseTouches/matchGlob");
  assert.ok(fixPrompt.includes("只修 inScope"), "the fix instruction must scope to inScope (Touches 内回归)");
  assert.ok(fixPrompt.includes("越界"), "the fix instruction must forbid out-of-scope fixes");
});

test("fix-scope REAL negative control — in-Touches red → inScope(fix); out-of-Touches red → other-task defer; load-sensitive red → release", async (t) => {
  const task = "gap-test-fixscope-real";
  const dir = makeFixScopeDir("fan-in-fixscope-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=1.2 ${dir}/pkg/a/x.test.mjs passed=false`,
    `__PERFILE__ duration_ms=2.3 ${dir}/pkg/OTHER/stray.test.mjs passed=false`,
    `__PERFILE__ duration_ms=3.4 ${dir}/plugin/test/cold-start-skill.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
  assert.equal(r.status, 0, `gate block failed: ${r.stderr}`);
  const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
  assert.ok(m, `gate JSON echo missing:\n${r.stdout}`);
  const verdict = JSON.parse(m[1]);
  assert.equal(verdict.scoped, true, "a task with a ## Touches section is scoped");
  assert.deepEqual(verdict.inScope, ["pkg/a/x.test.mjs"], "an in-Touches red must be inScope (fix)");
  const reasons = Object.fromEntries(verdict.outOfScope.map((f) => [f.file, f.reason]));
  assert.equal(reasons["pkg/OTHER/stray.test.mjs"], "other-task", "an out-of-Touches red must defer as other-task");
  assert.equal(reasons["plugin/test/cold-start-skill.test.mjs"], "load-sensitive", "a load-sensitive family red must release (not fix)");
});

test("fix-scope REAL machine-partition — a task WITHOUT a ## Touches section ⇒ scoped=false, load-sensitive still released, rest inScope", async (t) => {
  const task = "gap-test-fixscope-noscope";
  const dir = makeFixScopeDir("fan-in-fixscope-ns-", task, "---\nid: gap-test-fixscope-noscope\nstatus: ready\n---\n## Plan\nno touches section\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=1.2 ${dir}/plugin/test/cold-start-skill.test.mjs passed=false`,
    `__PERFILE__ duration_ms=2.3 ${dir}/pkg/a/x.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  const block = await fixScopeGateBlockFor(task, dir);
  const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
  assert.ok(m, `gate JSON echo missing:\n${r.stdout}`);
  const verdict = JSON.parse(m[1]);
  assert.equal(verdict.scoped, false, "no ## Touches section ⇒ scoped=false (machine-partition only)");
  const loadSensitive = verdict.outOfScope.find((f) => f.reason === "load-sensitive");
  assert.equal(loadSensitive.file, "plugin/test/cold-start-skill.test.mjs", "load-sensitive family is released even unscoped");
  assert.ok(verdict.inScope.includes("pkg/a/x.test.mjs"), "unscoped: non-family failures stay inScope (machine-partition only)");
});

test("fix-scope REAL leak-residual — a tmux-leak-scan: FAIL on a LATER line of the multi-line log (with no per-file failure) ⇒ outOfScope leak-residual (never fixed as a Touches regression)", async (t) => {
  const task = "gap-test-fixscope-leak";
  const dir = makeFixScopeDir("fan-in-fixscope-leak-", task, "---\nid: gap-test-fixscope-leak\nstatus: ready\n---\n## Touches\n- tasks/gap-test-fixscope-leak.md\n- pkg/a/**\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  // gap-fan-in-leak-fail-regex-missing-m-flag (AC1/AC2): the gate tests TMUX_LEAK_FAIL_RE against
  // the WHOLE multi-line logText, not one line. Put the FAIL on a LATER line — without the `m`
  // flag `^` anchors only to string start and this would be misclassified (leak-residual dead
  // code). A normal passing line above it keeps this a real multi-line-log reproduction.
  fs.writeFileSync(log, "✔ some passing test (1.2ms)\ntmux-leak-scan: FAIL\nresidual tmux server skv-1234\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  const block = await fixScopeGateBlockFor(task, dir);
  const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
  const verdict = JSON.parse(m[1]);
  assert.deepEqual(verdict.inScope, [], "no per-file failure ⇒ no inScope fix");
  assert.ok(verdict.outOfScope.some((f) => f.reason === "leak-residual"), "tmux-leak residual must be outOfScope (env residual, not a Touches regression)");
});

test("fix-scope NEGATIVE control — a PASSING '✔'-prefixed test whose NAME quotes `tmux-leak-scan: FAIL` must NOT be classified leak-residual (^ anchor; gap-fan-in-execute-tmux-leak-scan-unanchored AC2)", async (t) => {
  const task = "gap-test-fixscope-leak-neg";
  const dir = makeFixScopeDir("fan-in-fixscope-leakneg-", task, "---\nid: gap-test-fixscope-leak-neg\nstatus: ready\n---\n## Touches\n- tasks/gap-test-fixscope-leak-neg.md\n- pkg/a/**\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  // The runner's own AC5 e2e NAME quotes the `tmux-leak-scan: FAIL` shape; as a PASSING line it is
  // `✔`-prefixed, so the unanchored `/tmux-leak-scan: FAIL/` used to match it and trigger a phantom
  // leak-residual on every suite-fix relaunch. Only a column-0 REAL residual is leak-residual.
  fs.writeFileSync(log, "✔ AC5 e2e — a 'tmux-leak-scan: FAIL' residual line flips red\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  const block = await fixScopeGateBlockFor(task, dir);
  const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
  assert.ok(m, `gate JSON echo missing:\n${r.stdout}`);
  const verdict = JSON.parse(m[1]);
  assert.ok(!verdict.outOfScope.some((f) => f.reason === "leak-residual"), "a PASSING '✔'-prefixed test whose NAME quotes `tmux-leak-scan: FAIL` must NOT be leak-residual (only a column-0 REAL residual is)");
});

// ── fix-scope gate release persistence（gap-fix-scope-gate-release-not-persistent）───────────────────
// THE DEFECT: 上一版 gate 的 load-sensitive release 是一次性 relaunch——relaunch 后仍红，第二轮
// suite-fix 不再走 release、直接越界修（a76959c8 session-liveness teardown 第 9+ 例）。release 无跨
// 轮持久状态 ⇒ 第二轮 agent 无记忆、把「隔离重跑确认」读成「重跑后仍红就该修」。FIX：gate 把每个
// load-sensitive 红的连续 release 轮数 releasedRounds 持久化到 fix_scope_release ledger，第二轮读到
// 递增；内联 prompt 显式写「releasedRounds ≥ 1 的 load-sensitive 红一律继续 release，⛔ 不得转 fix」。
// 负控制（AC2/AC3）：同一 load-sensitive 红 run 两轮 gate（relaunch-fail 路径）⇒ 两轮都 release、
// 零越界 fix。取假：把「第二轮仍 release」改成「第二轮转 fix」（删 ledger 读 / 把 load-sensitive
// 挪进 inScope / releasedRounds 不递增）⇒ 测试红。

test("fix-scope release persistence wiring — relaunch-fail 2nd suite-fix prompt still carries the idempotent-release instruction", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-fixscope-persist-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-fixscope-persist-wire", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 3 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },                 // phase 1
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                                           // stage 2: RED
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "load-sensitive 释放（第1轮）" },              // fix round 1: release
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                                           // stage 2 re-dispatched: STILL RED (relaunch-fail)
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "load-sensitive 释放（第2轮，幂等持久）" },      // fix round 2: STILL release
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // stage 2 re-dispatched: green
    ],
  });
  const fixPrompts = prompts.filter((p) => p.includes("suite-fix 阶段"));
  assert.equal(fixPrompts.length, 2, "relaunch-fail must emit TWO suite-fix prompts (round 1 + round 2)");
  const round2 = fixPrompts[1];
  assert.ok(round2.includes("# fix-scope-gate-block-start"), "round-2 fix prompt must still carry the gate");
  assert.ok(round2.includes("幂等持久"), "round-2 fix prompt must carry the idempotent-persistent instruction");
  assert.ok(round2.includes("不得转 fix"), "round-2 fix prompt must forbid converting release → fix");
  assert.ok(round2.includes("releasedRounds"), "round-2 fix prompt must carry the releasedRounds counter");
});

test("fix-scope release persistence — relaunch-fail path: same load-sensitive red releases on BOTH rounds (releasedRounds increments, zero越界 fix)", async (t) => {
  const task = "gap-test-fixscope-persist";
  const dir = makeFixScopeDir("fan-in-fixscope-persist-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  const release = `/tmp/fan-in-scope-release-${task}.json`;
  // 同一 load-sensitive 红 + 一个本任务 Touches 内回归（inScope 修，证 gate 不是一律 release）：
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=1.2 ${dir}/pkg/a/x.test.mjs passed=false`,
    `__PERFILE__ duration_ms=3.4 ${dir}/plugin/test/cold-start-skill.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(release, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const script = block + '\necho "GATE_OUT=[$fix_scope_out]"';
  const r1 = runBash(script, { cwd: dir }); // round 1: release（relaunch, 无 fix）
  const r2 = runBash(script, { cwd: dir }); // round 2: relaunch-fail → 仍 release、零越界 fix
  assert.equal(r1.status, 0, `round-1 gate failed: ${r1.stderr}`);
  assert.equal(r2.status, 0, `round-2 gate failed: ${r2.stderr}`);
  const v1 = JSON.parse(r1.stdout.match(/GATE_OUT=\[(.*)\]/s)[1]);
  const v2 = JSON.parse(r2.stdout.match(/GATE_OUT=\[(.*)\]/s)[1]);

  const ls1 = v1.outOfScope.find((f) => f.reason === "load-sensitive" && f.file === "plugin/test/cold-start-skill.test.mjs");
  const ls2 = v2.outOfScope.find((f) => f.reason === "load-sensitive" && f.file === "plugin/test/cold-start-skill.test.mjs");
  assert.ok(ls1, "round 1: the load-sensitive red must be outOfScope release");
  assert.equal(ls1.releasedRounds, 1, "round 1: first release ⇒ releasedRounds=1");
  assert.ok(ls2, "round 2 (relaunch-fail): the SAME load-sensitive red must STILL be outOfScope release");
  assert.equal(ls2.releasedRounds, 2, "round 2: ledger persisted ⇒ releasedRounds increments to 2 (NOT reset to 1)");
  // 零越界 fix：两轮的 inScope 都不得含 load-sensitive 文件；inScope 只含本任务 Touches 内回归。
  assert.ok(!v1.inScope.includes("plugin/test/cold-start-skill.test.mjs"), "round 1: load-sensitive red never inScope (零越界 fix)");
  assert.ok(!v2.inScope.includes("plugin/test/cold-start-skill.test.mjs"), "round 2: load-sensitive red never inScope (零越界 fix)");
  assert.deepEqual(v2.inScope, ["pkg/a/x.test.mjs"], "in-Touches regression still inScope (gate is not release-everything)");
});

// ── release 隔离重跑 + anti-livelock（gap-gate-release-no-isolate-rerun-no-livelock）────────────────
// THE DEFECT: load-sensitive release 此前是【全量 relaunch】——高 load 常驻下全量 relaunch 不减 load，
// load-sensitive 族反复红 ⇒ 收敛失败（2026-08-19 ac101 实证 3 RED + 3 全量 relaunch，靠低 load 单飞
// 侥幸收敛）；release 侧无 anti-livelock 兜底（attempt≥3）⇒ out-of-scope → release → 全量 relaunch
// 循环无界（ac101 曾 ~2h）。FIX（AC1/AC2）：release 接 C11 隔离重跑（只重跑失败家族文件、低并发，
// 非全量 relaunch）+ anti-livelock 兜底（同一 load-sensitive 红 releasedRounds ≥ 3 ⇒ escalate、不再
// relaunch）。负控制（真实 bash，非 fixture）：① 纯 load-sensitive 释放的 gate verdict 携带
// isolateRerun + livelock=false，且隔离文件列表被 gate 机械写入 /tmp/fan-in-scope-isolate-<task>.files；
// ② 同一 load-sensitive 红连跑 3 轮 gate ⇒ 第 3 轮 livelock=true（attempt≥3 escalate）；③ 内联 fix
// prompt 携带 ISOLATE_LAUNCH 块与三态 release 决策（有 inScope ⇒ 全量 relaunch / 纯释放 ⇒ 隔离重跑 /
// livelock ⇒ escalate 不 relaunch）；④ workflow 层：fix agent 返回 relaunched:false（livelock escalate）
// ⇒ 工作流立即 red 停止，不再进入第 2 个 fix round（无界循环被打破）。

test("release isolation wiring — the fix prompt carries ISOLATE_LAUNCH + the three-state release decision (isolate-rerun ≠ full relaunch; livelock ⇒ escalate)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-release-iso-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-release-iso-wire", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "load-sensitive 释放（第1轮）" },
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true },
    ],
  });
  const fixPrompt = promptContaining(prompts, "suite-fix 阶段");
  assert.ok(fixPrompt.includes("# isolate-launch-block-start"), "the fix prompt must carry the ISOLATE_LAUNCH block (C11 隔离重跑)");
  assert.ok(fixPrompt.includes("隔离重跑"), "the fix prompt must instruct the C11 isolated-rerun path");
  assert.ok(fixPrompt.includes("非全量 relaunch"), "the release must be isolation rerun, NOT full relaunch (AC1)");
  assert.ok(fixPrompt.includes("livelock"), "the fix prompt must carry the anti-livelock flag");
  assert.ok(fixPrompt.includes("anti-livelock") || fixPrompt.includes("不再 relaunch"), "the fix prompt must instruct the anti-livelock escalation (AC2)");
  assert.ok(fixPrompt.includes("relaunched: false"), "the anti-livelock escalation must return relaunched:false (no relaunch)");
  assert.ok(fixPrompt.includes("rerunMode"), "the fix prompt must return rerunMode (full|isolated|null) for production evidence");
  assert.ok(fixPrompt.includes("bash scripts/test.sh"), "the full relaunch block is still carried (inScope-fix case)");
});

test("release isolation REAL — pure load-sensitive red ⇒ verdict carries isolateRerun (family files, low-conc) + livelock=false; gate writes the isolate files list", async (t) => {
  const task = "gap-test-release-iso-real";
  const dir = makeFixScopeDir("fan-in-release-iso-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  const release = `/tmp/fan-in-scope-release-${task}.json`;
  const isolate = `/tmp/fan-in-scope-isolate-${task}.files`;
  // 纯 load-sensitive 红（无 inScope 回归）：两个家族成员同时红。
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=3.4 ${dir}/plugin/test/cold-start-skill.test.mjs passed=false`,
    `__PERFILE__ duration_ms=4.5 ${dir}/plugin/test/runner-grouping-flags-only.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(release, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(isolate, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
  assert.equal(r.status, 0, `gate block failed: ${r.stderr}`);
  const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
  assert.ok(m, `gate JSON echo missing:\n${r.stdout}`);
  const verdict = JSON.parse(m[1]);
  assert.equal(verdict.livelock, false, "round 1: releasedRounds=1 < 3 ⇒ no livelock");
  assert.ok(verdict.isolateRerun, "pure load-sensitive release must carry the isolateRerun command (AC1)");
  assert.ok(verdict.isolateRerun.includes("bash scripts/test.sh"), "isolateRerun is a low-concurrency test.sh command (only family files)");
  assert.ok(verdict.isolateRerun.includes("plugin/test/cold-start-skill.test.mjs"), "isolateRerun includes the family failing file");
  // 隔离文件列表被 gate 机械写入（每行一个 worktree 相对路径）——机制，不是靠 agent 记性：
  const files = fs.existsSync(isolate) ? fs.readFileSync(isolate, "utf8").trim().split("\n").filter(Boolean) : [];
  assert.ok(files.includes("plugin/test/cold-start-skill.test.mjs"), "gate wrote the isolate files list (mechanism)");
  assert.ok(files.includes("plugin/test/runner-grouping-flags-only.test.mjs"), "gate wrote BOTH family files to the isolate list");
  // 零越界 fix：load-sensitive 文件不在 inScope：
  assert.ok(!verdict.inScope.includes("plugin/test/cold-start-skill.test.mjs"), "load-sensitive red never inScope (零越界 fix)");
});

test("release anti-livelock REAL — same load-sensitive red 3 rounds ⇒ round-3 verdict livelock=true (attempt≥3 escalate)", async (t) => {
  const task = "gap-test-release-ll-real";
  const dir = makeFixScopeDir("fan-in-release-ll-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  const release = `/tmp/fan-in-scope-release-${task}.json`;
  const isolate = `/tmp/fan-in-scope-isolate-${task}.files`;
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=3.4 ${dir}/plugin/test/cold-start-skill.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(release, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(isolate, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const gate = (round) => {
    const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
    assert.equal(r.status, 0, `round ${round} gate failed: ${r.stderr}`);
    const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
    assert.ok(m, `round ${round} gate JSON echo missing:\n${r.stdout}`);
    return JSON.parse(m[1]);
  };
  const v1 = gate(1);
  const v2 = gate(2);
  const v3 = gate(3);
  assert.equal(v1.livelock, false, "round 1: releasedRounds=1 < 3 ⇒ no livelock");
  assert.equal(v2.livelock, false, "round 2: releasedRounds=2 < 3 ⇒ no livelock");
  assert.equal(v3.livelock, true, "round 3: releasedRounds=3 ≥ 3 ⇒ livelock=true (attempt≥3 escalate, AC2)");
  const ls3 = v3.outOfScope.find((f) => f.reason === "load-sensitive" && f.file === "plugin/test/cold-start-skill.test.mjs");
  assert.ok(ls3, "round 3 still releases (幂等持久, never转 fix)");
  assert.equal(ls3.releasedRounds, 3, "round 3 releasedRounds=3");
  assert.equal(ls3.livelock, true, "round 3 item carries the per-item livelock flag");
});

test("release anti-livelock — fix agent escalation (relaunched:false) ⇒ workflow stops red with the anti-livelock message (no infinite relaunch)", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-release-ll-wf", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-release-ll-wf", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 4 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                                                                 // stage 2: RED
      { relaunched: false, rerunMode: null, worktreeHead: "h2", failuresFixed: [], note: "load-sensitive anti-livelock（releasedRounds≥3）：停止无界 relaunch，escalate → quiet-window / needs-human" },  // Fix agent: livelock escalate
    ],
  });
  const fixPrompts = prompts.filter((p) => p.includes("suite-fix 阶段"));
  assert.equal(fixPrompts.length, 1, "livelock escalation emits ONE fix prompt, then stops (no round-2 relaunch)");
  assert.equal(result.outcome, "red", "escalation must be terminal (red), not another relaunch round");
  assert.ok(result.message.includes("anti-livelock"), `the workflow message names the anti-livelock escalation, got: ${result.message}`);
  assert.equal(result.ffOk, false, "no ff on livelock escalation");
});

// ── defer 侧 anti-livelock（gap-fan-in-relaunch-retry-cap）──────────────────────────────────────────
// THE DEFECT: 非 load-sensitive「other-task defer → 全量 relaunch」无上限——hub-strip 因 PHASE_OVERLAP
// flake（非 load-sensitive、非本任务 Touches）每轮都判 other-task defer ⇒ 「照旧全量 relaunch」循环无界
// （06:12→08:00 ~2h，占 suite 锁阻塞 3 个在飞任务）。releaseLivelockRounds 只覆盖 load-sensitive，不覆盖
// 确定性失败。FIX（AC1/AC2）：defer 侧 anti-livelock——连续纯 defer 轮（inScope 空 + 无 load-sensitive +
// 只有 other-task/leak/checker）≥ maxDeferRelaunches ⇒ deferLivelock=true ⇒ fix agent escalate
// （relaunched:false, escalate='defer-livelock'）⇒ workflow 返回 needs-human（retreat，交 outer），不再
// 无界 relaunch。与 releaseLivelockRounds（load-sensitive）互补不冲突（AC3）。负控制（真实 bash，非
// fixture）：① 同一确定性 other-task 红连跑 3 轮 gate ⇒ 第 3 轮 deferLivelock=true；② 有 inScope 修复
// 或 load-sensitive 释放 ⇒ defer 计数归零；③ 内联 fix prompt 携带 defer escalation 指令；④ workflow 层
// fix agent 返回 escalate='defer-livelock' ⇒ needs-human 停止，不进入第 2 个 fix round。

test("defer anti-livelock wiring — the fix prompt carries the defer escalation state (deferLivelock ⇒ escalate='defer-livelock' → needs-human)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-defer-ll-wire", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-defer-ll-wire", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "" },
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true },
    ],
  });
  const fixPrompt = promptContaining(prompts, "suite-fix 阶段");
  assert.ok(fixPrompt.includes("deferLivelock"), "the fix prompt must carry the defer anti-livelock flag");
  assert.ok(fixPrompt.includes("defer anti-livelock"), "the fix prompt must instruct the defer anti-livelock escalation");
  assert.ok(fixPrompt.includes("escalate: 'defer-livelock'"), "the defer escalation must return escalate='defer-livelock' (mechanism, not note-string)");
  assert.ok(fixPrompt.includes("needs-human"), "the defer escalation must retreat to needs-human / hand to outer");
});

test("defer anti-livelock REAL — same non-load-sensitive other-task red 3 rounds ⇒ round-3 verdict deferLivelock=true (deterministic flake escalates)", async (t) => {
  const task = "gap-test-defer-ll-real";
  const dir = makeFixScopeDir("fan-in-defer-ll-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  const defer = `/tmp/fan-in-scope-defer-${task}.json`;
  // 确定性 flake（PHASE_OVERLAP 类）：非 load-sensitive、非本任务 Touches —— 每轮都红，无根因可修。
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=1.2 ${dir}/pkg/OTHER/stray.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(defer, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const gate = (round) => {
    const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
    assert.equal(r.status, 0, `round ${round} gate failed: ${r.stderr}`);
    const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
    assert.ok(m, `round ${round} gate JSON echo missing:\n${r.stdout}`);
    return JSON.parse(m[1]);
  };
  const v1 = gate(1);
  const v2 = gate(2);
  const v3 = gate(3);
  assert.equal(v1.deferRounds, 1, "round 1: deferRounds=1");
  assert.equal(v1.deferLivelock, false, "round 1: deferRounds=1 < 3 ⇒ no defer livelock");
  assert.equal(v2.deferRounds, 2, "round 2: deferRounds=2");
  assert.equal(v2.deferLivelock, false, "round 2: deferRounds=2 < 3 ⇒ no defer livelock");
  assert.equal(v3.deferRounds, 3, "round 3: deferRounds=3");
  assert.equal(v3.deferLivelock, true, "round 3: deferRounds=3 ≥ 3 ⇒ deferLivelock=true (escalate, AC2)");
});

test("defer anti-livelock reset — an in-scope fix (or load-sensitive release) resets the defer counter (progress ⇒ not a livelock)", async (t) => {
  const task = "gap-test-defer-ll-reset";
  const dir = makeFixScopeDir("fan-in-defer-ll-r-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  const defer = `/tmp/fan-in-scope-defer-${task}.json`;
  // round 1 / round 3: 纯 defer（out-of-Touches 确定性红）；round 2: in-scope 回归（有进展）。
  const deferLog = `__PERFILE__ duration_ms=1.2 ${dir}/pkg/OTHER/stray.test.mjs passed=false\n`;
  const fixLog = `__PERFILE__ duration_ms=1.2 ${dir}/pkg/a/x.test.mjs passed=false\n`;
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(defer, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const gate = () => {
    const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
    assert.equal(r.status, 0, `gate failed: ${r.stderr}`);
    const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
    assert.ok(m, `gate JSON echo missing:\n${r.stdout}`);
    return JSON.parse(m[1]);
  };
  fs.writeFileSync(log, deferLog, "utf8");
  const v1 = gate();
  assert.equal(v1.deferRounds, 1, "round 1 (pure defer): deferRounds=1");
  fs.writeFileSync(log, fixLog, "utf8");
  const v2 = gate();
  assert.equal(v2.deferRounds, 0, "round 2 (in-scope fix): deferRounds reset to 0");
  assert.equal(v2.deferLivelock, false, "round 2 (in-scope fix): no defer livelock");
  fs.writeFileSync(log, deferLog, "utf8");
  const v3 = gate();
  assert.equal(v3.deferRounds, 1, "round 3 (pure defer again): deferRounds=1 (not 2 — reset by progress)");
});

test("defer anti-livelock — fix agent escalation (escalate='defer-livelock') ⇒ workflow returns needs-human (retreat, no infinite relaunch)", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-defer-ll-wf", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-defer-ll-wf", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 4, maxDeferRelaunches: 3 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },
      { relaunched: false, rerunMode: null, escalate: "defer-livelock", worktreeHead: "h2", failuresFixed: [], note: "other-task defer anti-livelock（deferRounds≥3）：停止无界 relaunch，escalate → needs-human / 交 outer" },
    ],
  });
  const fixPrompts = prompts.filter((p) => p.includes("suite-fix 阶段"));
  assert.equal(fixPrompts.length, 1, "defer escalation emits ONE fix prompt, then stops (no round-2 relaunch)");
  assert.equal(result.outcome, "needs-human", "defer anti-livelock must retreat to needs-human (not another relaunch, not red)");
  assert.ok(result.message.includes("defer anti-livelock"), `the workflow message names the defer anti-livelock, got: ${result.message}`);
  assert.ok(result.message.includes("hand to outer"), "the defer escalation message must hand off to outer");
  assert.equal(result.ffOk, false, "no ff on defer escalation");
});

// ── ⑨ impl-complete event (gap-inflight-states-missing-impl-complete-event) ─────────────────────────
// fan-in writes the THIRD lifecycle event (`--impl-complete`) after impl completes (suite green) and
// BEFORE land (step 4.4, between step 4's suite and step 5's flip+ff). The block is runId-guarded
// (no --task-start bracket ⇒ no event). AC5 负控制: the write lives in phase 2, fires only when
// runId is set, and idempotency is handled by fast-mode-telemetry's hasImplCompleteEvent guard.

test("⑨ impl-complete — phase-2 prompt writes the event after suite green, before land; runId-guarded", async () => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-implc", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-implc-1", mergeTarget: "develop" },
  });
  const p2 = promptContaining(prompts, "# impl-complete-block-start");
  // The block lives in phase 2 (the prompt that also carries the suite-record + flip blocks), i.e.
  // AFTER the suite is green and BEFORE land (step 5 flip+ff).
  assert.ok(p2.includes("# suite-record-block-start"), "impl-complete sits with the phase-2 mechanical steps");
  assert.ok(p2.includes("# flip-block-start"), "impl-complete precedes the flip block (land) in phase 2");
  // The write is the real telemetry CLI, worktree-rooted, carrying task + runId + root.
  assert.ok(p2.includes("fast-mode-telemetry.ts --impl-complete"), "phase-2 must write the impl-complete event");
  assert.ok(p2.includes("--taskId gap-test-implc") && p2.includes("--runId fm-implc-1"), "the event carries taskId + runId");
  assert.ok(p2.includes(`--root ${REPO_ROOT}`), "the event writes to the main checkout's event store");
  assert.ok(p2.includes(`/tmp/wt/plugin/scripts/`), "the CLI resolves from the worktree (orchestration-bootstrap)");
  // The block is runId-guarded: no bracket ⇒ no event (AC5 负控制 for a runId-less fan-in). The
  // `${runId}` is INTERPOLATED by the workflow's template literal at build time.
  assert.ok(p2.includes('if [ -n "fm-implc-1" ]; then'), `the impl-complete write is guarded by the runId presence, got guard: ${p2.split("\n").find((l) => l.includes("if [ -n"))}`);
});

test("⑨ impl-complete — runId-less fan-in skips the write (AC5 负控制)", async () => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-implc-norid", worktree: "/tmp/wt", root: REPO_ROOT, runId: null, mergeTarget: "develop" },
  });
  const p2 = promptContaining(prompts, "# impl-complete-block-start");
  // With runId null the block still emits (the CLI call is inside the guard), but the guard branch
  // is falsy (the interpolated runId is the empty string) — the event write must NOT fire.
  assert.ok(p2.includes('if [ -n "" ]; then'), `the runId guard is present even when runId is empty, got guard: ${p2.split("\n").find((l) => l.includes("if [ -n"))}`);
  // The step-4.4 block's own comment names the skip condition for a runId-less write.
  assert.ok(p2.includes("runId 为空") || p2.includes("未走 --task-start 留痕"), "the block documents the runId-less skip");
});

// ── ⑪ 跨 relaunch 锁持有者卡死/失联检测（gap-suite-lock-holder-stuck-detection）──────────────────────
// THE DEFECT: hub-strip 无限 relaunch 期间，suite 锁被上一轮 hung 的 detached suite 持续持有——fan-in 的
// detached 直跑（setsid bash scripts/test.sh）不经 full-suite-runner.ts ⇒ SUITE_MAX_RUNTIME_MS(45min)/
// SUITE_SILENCE_MS(15min) 管不到它，且每次 relaunch 新起进程、单次超时重置 ⇒ 跨 relaunch 无限持有。
// FIX: SUITE_LAUNCH/ISOLATE_LAUNCH 在 relaunch 前读上一轮 pidfile（`pid started_ms`）；上一轮【应已死亡】，
// 仍存活 = 卡死 ⇒ 存活且持有 ≥ stuckHolderGraceSecs ⇒ SIGKILL 整进程组释放槽 + 告警（谁/多久/动作）；
// 未超阈值 ⇒ 告警不杀；已死 ⇒ 陈旧 pidfile 静默清理（正常路径，非持有）。

test("⑪ stuck-holder wiring — launch blocks carry the cross-relaunch reap (kill + alert + pid started_ms record)", async () => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-stuck-wiring", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-stuck-wiring", mergeTarget: "develop" },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1 (carries SUITE_LAUNCH)
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                           // stage 2 red
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "" },                          // Fix agent (carries ISOLATE_LAUNCH)
    ],
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  assert.ok(launch.includes("# suite-stale-holder-reap-block-start"), "suite-launch must carry the cross-relaunch stale-holder reap");
  assert.ok(launch.includes("__FANIN_STUCK_LOCK_HOLDER__"), "the reap must emit the loud alert marker (非静默)");
  assert.ok(launch.includes('kill -9 -"$_holder_pid"'), "the reap must SIGKILL the whole process group (release the single-flight slot)");
  assert.ok(launch.includes("action=SIGKILL-released"), "the reap must record the release action");
  assert.ok(launch.includes("held_s="), "the reap must record the held duration (多久)");
  assert.ok(launch.includes("pid="), "the reap must record the holder pid (谁)");
  assert.ok(launch.includes("suite_stuck_file="), "the reap must persist the alert to a ledger file (非静默)");
  const isolate = extractBlockFromPrompts(prompts, "# isolate-launch-block-start", "# isolate-launch-block-end");
  assert.ok(isolate.includes("# suite-stale-holder-reap-block-start"), "isolate-rerun launch must also carry the reap");
});

test("⑪ REAL stuck holder — alive holder with stale start ⇒ SIGKILL + __FANIN_STUCK_LOCK_HOLDER__ action=SIGKILL-released (AC1)", async (t) => {
  const task = "gap-test-stuck-real";
  const pidfile = `/tmp/fan-in-suite-${task}.pid`;
  const ledger = `/tmp/fan-in-stuck-holder-${task}.log`;
  fs.rmSync(ledger, { force: true });
  // 真实存活 holder（detached ⇒ 自身为 session leader/pgid，与生产 setsid detached suite 同形）。
  const holder = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  t.after(() => { try { process.kill(-holder.pid, "SIGKILL"); } catch (_) { try { holder.kill("SIGKILL"); } catch (_) {} } });
  // 10s 前的 start ⇒ held_s ≈ 10 ≥ 阈值(2) ⇒ 杀 + 告警。
  fs.writeFileSync(pidfile, `${holder.pid} ${Date.now() - 10_000}\n`);
  t.after(() => { for (const f of [pidfile, ledger]) { try { fs.rmSync(f, { force: true }); } catch (_) {} } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-stuck-real", mergeTarget: "develop", stuckHolderGraceSecs: 2 },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  const reap = extractBlock(launch, "# suite-stale-holder-reap-block-start", "# suite-stale-holder-reap-block-end");
  const r = runBash(`suite_pid_file="${pidfile}"; ${reap}`, { cwd: "/tmp", timeout: 10_000 });
  assert.match(r.stdout, /__FANIN_STUCK_LOCK_HOLDER__ .*action=SIGKILL-released/, `must alert + release, got: ${r.stdout}`);
  // SIGKILL 后进程先转 zombie、再被本测试进程（holder 的父进程）reap——kill -0 对 zombie 仍返回 0 ⇒
  // 轮询等待被 reap（每次 await 让事件循环跑起来 reap 子进程），而不是单点 kill -0（zombie 误判为存活）。
  let alive = "0";
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    alive = spawnSync("bash", ["-c", `kill -0 ${holder.pid} 2>/dev/null; echo $?`], { encoding: "utf8" }).stdout.trim();
    if (alive === "1") break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(alive, "1", `the stuck holder must be SIGKILLed (kill -0 exit 1 after reap), got alive=${alive}`);
  const ledgerText = fs.readFileSync(ledger, "utf8");
  assert.match(ledgerText, /action=SIGKILL-released/, "the alert must persist to the ledger (非静默)");
});

test("⑪ REAL under-grace — alive holder with recent start ⇒ NOT killed + action=alive-under-grace-not-killed (AC1 负控制)", async (t) => {
  const task = "gap-test-stuck-grace";
  const pidfile = `/tmp/fan-in-suite-${task}.pid`;
  const ledger = `/tmp/fan-in-stuck-holder-${task}.log`;
  fs.rmSync(ledger, { force: true });
  const holder = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  t.after(() => { try { process.kill(-holder.pid, "SIGKILL"); } catch (_) { try { holder.kill("SIGKILL"); } catch (_) {} } });
  fs.writeFileSync(pidfile, `${holder.pid} ${Date.now()}\n`);  // 刚启动 ⇒ held_s ≈ 0 < 阈值(2)
  t.after(() => { for (const f of [pidfile, ledger]) { try { fs.rmSync(f, { force: true }); } catch (_) {} } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-stuck-grace", mergeTarget: "develop", stuckHolderGraceSecs: 2 },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  const reap = extractBlock(launch, "# suite-stale-holder-reap-block-start", "# suite-stale-holder-reap-block-end");
  const r = runBash(`suite_pid_file="${pidfile}"; ${reap}`, { cwd: "/tmp", timeout: 10_000 });
  assert.match(r.stdout, /action=alive-under-grace-not-killed/, `under-grace holder must alert but NOT kill, got: ${r.stdout}`);
  const alive = spawnSync("bash", ["-c", `kill -0 ${holder.pid} 2>/dev/null; echo $?`], { encoding: "utf8" }).stdout.trim();
  assert.equal(alive, "0", "an under-grace holder must NOT be killed (kill -0 exit 0)");
});

test("⑪ REAL dead holder — stale pidfile pointing at a dead pid ⇒ silent (no alert; normal completion path)", async (t) => {
  const task = "gap-test-stuck-dead";
  const pidfile = `/tmp/fan-in-suite-${task}.pid`;
  const ledger = `/tmp/fan-in-stuck-holder-${task}.log`;
  fs.rmSync(ledger, { force: true });
  const deadPid = Number(spawnSync("bash", ["-c", "echo $$; sleep 0.1"], { encoding: "utf8" }).stdout.trim());
  assert.ok(Number.isInteger(deadPid) && deadPid > 0, `dead pid precondition: got ${deadPid}`);
  fs.writeFileSync(pidfile, `${deadPid} ${Date.now() - 10_000}\n`);
  t.after(() => { for (const f of [pidfile, ledger]) { try { fs.rmSync(f, { force: true }); } catch (_) {} } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-stuck-dead", mergeTarget: "develop", stuckHolderGraceSecs: 2 },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  const reap = extractBlock(launch, "# suite-stale-holder-reap-block-start", "# suite-stale-holder-reap-block-end");
  const r = runBash(`suite_pid_file="${pidfile}"; ${reap}`, { cwd: "/tmp", timeout: 10_000 });
  assert.ok(!r.stdout.includes("__FANIN_STUCK_LOCK_HOLDER__"), `a dead holder must NOT alert (normal completion path), got: ${r.stdout}`);
});
