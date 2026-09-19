// Shared harness for the fan-in-execute-paths shards (split of fan-in-execute-paths.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../fan-in-execute-paths.test.mjs", import.meta.url).href;

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

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { buildTaskManifest, checkTaskAntiDrift } from "../../scripts/anti-drift-touches-check.ts";




/** Search ALL emitted prompts for the block between `start` and `end` markers (the split fan-in emits
 *  multiple agent prompts: phase 1 = prep/launch, poll = suite wait, phase 2 = record/flip/ff/bracket).
 *  Returns the FIRST prompt that contains the start marker and slices to the end marker. */

/** The single prompt containing `marker` (e.g. "# flip-block-start"). Fails if none. */




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




/** Replays the DIR-127/DIR-128 concurrency: a FLAT subagent (the trap, newest mtime) mentions the
 *  task 41×, while the task's OWN workflow-run subagent also mentions it. The trap sits at the
 *  ONE-level flat subagents path (`<slug>/subagents/`) so the OLD flat-glob heuristic (判据2 ②
 *  canary) matches it; the workflow-run subagents sit at the REAL two-level path
 *  (`<slug>/<session>/subagents/workflows/<run>/`). Returns { home, files }. */

// ── ① code_delta regex classification (REAL git execution, 判据3) ─────────────────────────────────

const __dirname = path.dirname(fileURLToPath(SRC_URL));

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const WORKFLOW = path.join(REPO_ROOT, "plugin", "workflows", "fan-in-execute.js");

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

// Hermetic runner env for the REAL launch tests: the detached suite now runs full-suite-runner.ts
// (gap-fan-in-red-bucket-run-not-recorded), which consults the resource gate + single-flight + systemd
// scope by default. These seams make a temp-repo fake suite deterministic (same family as
// full-suite-runner.test.mjs runRunner — QUAY_TEST_SKIP_RESOURCE_GATE skips the gate AND single-flight).
function runnerHermeticEnv(extra = {}) {
  return { ...process.env, QUAY_TEST_SKIP_RESOURCE_GATE: "1", QUAY_TEST_SKIP_SYSTEMD_RUN: "1", ...extra };
}

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
  run(["checkout", "-q", "-b", "develop"]); // develop forks from main ⇒ main is an ancestor of develop
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "note.md"), "dev\n");
  run(["add", "docs/note.md"]);
  run(["commit", "-qm", "develop-doc"]);
  run(["checkout", "-q", "-b", `task/${taskId}`, "develop"]); // the task branch forks from the baseline
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), body, "utf8");
  for (const [p, content] of Object.entries(files)) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  run(["add", "-A"]);
  run(["commit", "-qm", "task-changes"]);
  // develop advances while the task runs — so the merge below is a REAL merge (the fan-in's own step 1).
  run(["checkout", "-q", "develop"]);
  fs.writeFileSync(path.join(dir, "docs", "dev-2.md"), "dev-2\n");
  run(["add", "docs/dev-2.md"]);
  run(["commit", "-qm", "develop-moves"]);
  run(["checkout", "-q", `task/${taskId}`]);
  run(["merge", "-q", "develop", "-m", "merge-develop"]);
  return dir;
}

async function antiDriftBlockFor(task, worktree) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root: REPO_ROOT, runId: "fm-ad", mergeTarget: "develop" },
  });
  return extractBlockFromPrompts(prompts, "# anti-drift-block-start", "# anti-drift-block-end");
}

async function antiDriftLandBlockFor(task, worktree) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root: REPO_ROOT, runId: "fm-adland", mergeTarget: "develop" },
  });
  return extractBlockFromPrompts(prompts, "# anti-drift-land-block-start", "# anti-drift-land-block-end");
}

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

function makeTelemetryFakeRoot(prefix = "fan-in-bracket-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(dir, "plugin"), "dir");
  return dir;
}

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

async function bootstrapBlockFor(task, worktree, root) {
  const { prompts } = await runWorkflow({
    args: { task, worktree, root, runId: "fm-bootstrap", mergeTarget: "develop" },
  });
  // ADR-034（gap-adr034-fan-in-lock-holder-supervised）：step 0.5（获取 fan-in 锁）已从 prompt 废除，
  // step 0（bootstrap-sync）现在直接以 step 1 为界。
  return extractBlockFromPrompts(prompts, "【无锁段 step 0", "【无锁段 step 1");
}

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
  fs.mkdirSync(path.join(dir, "plugin", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "workflows", "fan-in-execute.js"), "OLD-fan-in-execute\n");
  run(["add", "-A"]);
  run(["commit", "-qm", "old-base"]);
  // develop advances with the poll-bounded fix to fan-in-execute.js
  fs.writeFileSync(path.join(dir, "plugin", "workflows", "fan-in-execute.js"), "POLL-BOUNDED-fan-in-execute\n");
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

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; }
}

/** The completion predicate for a fan-in marker: CONTENT, not existence.
 *
 * gap-fan-in-marker-exists-before-write-reads-empty: the marker used to be published with
 * `printf ... > "$suite_exit_marker"` — open(O_TRUNC) FIRST, write() SECOND — so a reader that opened the
 * path inside that scheduling gap got a 0-byte file, and the heavier the host load the wider that gap
 * (measured: 3/18 in the 09-12 window, 1/56 fan-in suite logs overall). Existence is the WRONG completion
 * event — the marker is finished when its `exit=<rc>` line is on disk. The producers now publish
 * atomically (rename), so producer and predicate agree; this predicate is kept content-based anyway
 * because a predicate that CAN be fooled by a half-written file is not a predicate (its own negative
 * control is the AC1 test in fan-in-execute-paths-s12.test.mjs).
 *
 * Returns the finished marker's TEXT, else null. Unreadable ⇒ null (NOT complete), per 硬规则 3b: an
 * evaluator that cannot read its input must not return the same value as "satisfied" — the caller's
 * hang-guard turns a permanently unreadable marker into a loud `guard` red instead of a silent pass. */
function readFinishedMarker(markerPath) {
  let text;
  try {
    text = fs.readFileSync(markerPath, "utf8");
  } catch {
    return null; // ENOENT (not created yet) or unreadable — either way, not a completion event
  }
  return /^exit=[0-9]+/m.test(text) ? text : null; // same line the suite-wait block's `sed -n 's/^exit=//p'` reads
}

async function waitForMarkerOrDeath(markerPath, pid, guardMs = Number(process.env.FANIN_TEST_MARKER_GUARD_MS ?? 0) || 120_000) {
  // No trustworthy pid ⇒ marker-only wait (the launch block's own documented fallback path:
  // "pidfile 读不到 ⇒ suite_pid 空，poller 退回纯 .exit 轮询（安全兜底）").
  const livenessKnown = Number.isFinite(pid) && pid > 0;
  if (readFinishedMarker(markerPath) !== null) return "marker";
  if (livenessKnown && !pidAlive(pid)) return "dead";
  const deadline = Date.now() + guardMs;
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearInterval(tick);
      try { watcher.close(); } catch { /* best-effort */ }
      resolve(outcome);
    };
    // A create that lands mid-write fires here too — the predicate stays false and the wait continues
    // (the write's own IN_MODIFY / the 250ms tick re-checks, so completion is still an EVENT).
    const watcher = fs.watch(path.dirname(markerPath), () => { if (readFinishedMarker(markerPath) !== null) finish("marker"); });
    const tick = setInterval(() => {
      if (readFinishedMarker(markerPath) !== null) return finish("marker");
      if (livenessKnown && !pidAlive(pid)) return finish("dead");
      if (Date.now() > deadline) return finish("guard");
    }, 250);
  });
}

const SUITE_FLOOR_SECS = 1140; // 实测 19+ min ≈ 1140s（2026-08-20 外层裁定）

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

function makeFixScopeDir(prefix, task, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(dir, "plugin"), "dir");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", `${task}.md`), body, "utf8");
  return dir;
}

export { F127_ID, F128_ID, FLAT_TRAP_ID, REPO_ROOT, SEL_CLI, SESSION, SLUG, SUITE_FLOOR_SECS, WORKFLOW, __dirname, antiDriftBlockFor, antiDriftLandBlockFor, assert, bootstrapBlockFor, bracketCloseBlockFor, buildTaskManifest, checkTaskAntiDrift, classifyRealDelta, cleanup, commitFiles, extractBlock, extractBlockFromPrompts, fileURLToPath, fixScopeGateBlockFor, flipBlockFor, fs, makeAntiDriftRepo, makeDir127ReplayHome, makeFixScopeDir, makeFlipDir, makeRepoWithDelta, makeStaleBootstrapRepo, makeTelemetryFakeRoot, os, path, pidAlive, promptContaining, readFinishedMarker, runBash, runSyncCli, runWorkflow, runnerHermeticEnv, spawn, spawnSync, startBracket, symlinkPluginForGit, symlinkRuntimeTrees, test, vm, waitForMarkerOrDeath, writeAgentFile };
