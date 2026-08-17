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
import { spawnSync } from "node:child_process";
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
  const captured = { prompts: [], schemas: [], phases: [], logs: [] };
  // Default agent sequence: drive the GREEN path (phase1 suite-started → poll done exit0 → phase2 green),
  // so tests that only extract blocks from the emitted prompts still exercise the full multi-agent flow.
  const defaultResults = [
    { outcome: "suite-started", suitePid: 4242, codeDelta: "mock-code", worktreeHead: "mockhead", note: "mock-prep" },
    { done: true, suiteExit: 0 },
    { outcome: "green", ffOk: true, developHead: "dhead", worktreeHead: "whead", agentIdUsed: "mockagent", codeDelta: "mock-code", note: "bracketClose=OK", bracketClosed: true },
  ];
  const sandbox = {
    console,
    // Fast-forward the script-owned suite waits (the workflow's setTimeout IS the poll interval;
    // the turn-budget fix moves the wait out of subagent turns into script control flow).
    setTimeout: (fn, _ms) => setTimeout(fn, 0),
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
    for (const f of ["select-static-checks-for-touches.ts", "task-schema.ts", "touches-parser.ts",
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

test("REAL-INVOCATION — the workflow file vm-executes and emits the multi-agent prompt set (AC78 + turn-budget split)", async (t) => {
  const { prompts, phases, result } = await runWorkflow({
    args: { task: "gap-test-smoke", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-test-1", mergeTarget: "develop" },
  });
  assert.ok(prompts.length >= 3, `split fan-in emits phase1 + poll + phase2 prompts, got ${prompts.length}`);
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

test("⑦ wiring — the fan-in prompt carries a verification-round write block guarded by suite_preverified=1", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-pvr", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-pvr", mergeTarget: "develop" },
  });
  const block = extractBlockFromPrompts(prompts, "# preverified-round-block-start", "# preverified-round-block-end");
  assert.ok(block.includes("pre-verified-round-record.ts"), "block must invoke the verification-round writer");
  assert.ok(block.includes('"${suite_preverified:-0}" = "1"'), "block must be guarded by the pre-verified marker");
  assert.ok(block.includes("--commit \"$suite_head\""), "block must pin the verified suite_head as commit");
  assert.ok(block.includes("--duration-ms \"$wall_ms\""), "block must reuse the capture's wall-clock (AC2)");
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

test("⑦ REAL skip — a NON-pre-verified capture (no suite_preverified marker) writes NO verification-round record (normal full-suite path is full-suite-runner's job)", async (t) => {
  const dir = makePreVerifiedWorktree();
  t.after(() => cleanup(dir));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  const task = "gap-test-pvr-skip";
  const capture = `/tmp/fan-in-suite-${task}.env`;
  // A capture WITHOUT the suite_preverified marker — a fresh full-suite run in this fan-in (no reuse).
  fs.writeFileSync(capture, [
    "full_suite_ran=true",
    "skip_reason=",
    "cpu_s=null",
    "cpu_source=not-wired",
    "start_iso=2026-08-17T05:00:00.000Z",
    "end_iso=2026-08-17T05:08:00.000Z",
    "wall_ms=480000",
    "load=4.5",
    "lane_count=8",
    "suite_exit=0",
    `suite_head=${head}`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(capture, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await preVerifiedBlockFor(task, dir, REPO_ROOT);
  const r = runBash(`suite_capture="${capture}"; . "$suite_capture"; ${block}`, { cwd: dir });
  assert.equal(r.status, 0, `non-pre-verified must exit 0 (no write): ${r.stderr}`);
  assert.equal(fs.existsSync(path.join(dir, ".quay", "verification-round.jsonl")), false, "no verification-round record for a non-pre-verified round (the normal path writes it via full-suite-runner)");
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

// ── ⑧ 回合预算承载 (gap-fan-in-turn-budget-suite-timeout) ────────────────────────────────────────
// AC1 取假: 构造 step2 code_delta 非空 ⇒ 全量 suite 必跑且机械步骤必完成（flip/ff/bracket 全执行）。
// 旧设计: step4 把全量 suite 启动为后台后, subagent 等 suite 时【回合预算耗尽被强制收尾】——
// suite 未完成/capture 未写/flip/ff/bracket 全缺 (release-timeout 实证 + AC95 复发)。
// 修复: suite 交给【长生命周期载体】(detached setsid 进程)，【等待】从 subagent 回合搬到脚本控制流
// (setTimeout + 轮询 agent 读 exit marker, ab380c5e/execute-suite-fix.js 同源)。这些测试用脚本化的
// agent 序列驱动 vm 实执行的工作流, 断言控制流 (绿/红→修/轮询上限/ff-retry) 与 phase 1/2 的 prompt 结构。

test("⑧ turn-budget 取假 — phase-1 suite-launch DETACHES (setsid + & + disown), NOT foreground, NOT Bash(run_in_background:true)", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-tb-detach", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-detach", mergeTarget: "develop" },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  assert.ok(launch.includes("setsid"), "suite-launch must use setsid (detached session — survives subagent exit)");
  assert.ok(launch.includes("& disown"), "suite-launch must background + disown (long-lived carrier)");
  assert.ok(launch.includes("suite_exit_marker"), "suite-launch must define the exit marker (the script-owned wait signal)");
  assert.ok(launch.includes('echo "exit=$?"'), "the detached wrapper must write the exit code to the marker");
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

test("⑧ turn-budget — the poll agent completes the capture post-fields (cpu/end/wall/load/lane/suite_exit) on exit-marker hit", async (t) => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-tb-poll", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-poll", mergeTarget: "develop" },
  });
  const poll = promptContaining(prompts, "POLL=not-done");
  assert.ok(poll.includes("suite_exit_marker"), "poll must read the exit marker");
  assert.ok(poll.includes("POLL=done SUITE_EXIT"), "poll must emit the done + exit result");
  assert.ok(poll.includes("cpu_source"), "poll must compute cpu_source (gnu-time or not-wired)");
  assert.ok(poll.includes("wall_ms"), "poll must compute wall_ms from the pre-suite start_ms");
  assert.ok(poll.includes("lane_count"), "poll must compute lane_count");
  assert.ok(poll.includes("suite_exit"), "poll must record suite_exit into the capture");
  assert.ok(poll.includes("不要做任何等待决策"), "poll must not make any waiting decision (script-owned)");
});

test("⑧ turn-budget — script-owned wait drives the GREEN path: suite-started → poll(done exit0) → phase-2 mechanical steps (flip/ff/bracket)", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-tb-green", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-green", mergeTarget: "develop", pollIntervalMs: 0, maxSuitePolls: 5 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { done: false, suiteExit: null },                                                             // poll: still running
      { done: true, suiteExit: 0 },                                                                 // poll: suite green
      { outcome: "green", ffOk: true, developHead: "d1", worktreeHead: "h1", agentIdUsed: "a1", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // phase 2
    ],
  });
  assert.equal(result.outcome, "green", "script-owned wait must land a green suite through phase 2");
  assert.equal(result.ffOk, true);
  // Phase-2 prompt must carry ALL mechanical steps (AC1: flip/ff/bracket all execute).
  const p2 = promptContaining(prompts, "# flip-block-start");
  assert.ok(p2.includes("per-task-suite-record.ts"), "phase-2 must write the per-task-suite record (step 4.5)");
  assert.ok(p2.includes("fan-in-ff-merge.sh --task"), "phase-2 must run the ff-merge (step 5)");
  assert.ok(p2.includes("# bracket-close-block-start"), "phase-2 must close the telemetry bracket (step 5.5)");
  assert.ok(p2.includes("git worktree remove"), "phase-2 must clean up the worktree after ff");
});

test("⑧ turn-budget — RED suite ⇒ Fix agent relaunches detached ⇒ script re-waits ⇒ phase-2 lands", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-tb-red", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-red", mergeTarget: "develop", pollIntervalMs: 0, maxSuitePolls: 5, maxFixRounds: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { done: true, suiteExit: 1 },                                                                 // poll: suite RED
      { relaunched: true, worktreeHead: "h2", failuresFixed: ["fix-x"], note: "" },                 // Fix agent
      { done: true, suiteExit: 0 },                                                                 // poll: suite green after fix
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // phase 2
    ],
  });
  assert.equal(result.outcome, "green", "a red suite must be fixed + re-verified before landing");
  assert.ok(prompts.some((p) => p.includes("suite-fix 阶段")), "a Fix-agent prompt must be emitted for a red suite");
  assert.ok(prompts.some((p) => p.includes("你读失败日志")), "the Fix prompt must read the suite log failures");
});

test("⑧ turn-budget — suite never completes within the poll cap ⇒ red (bounded wait, no infinite hang)", async (t) => {
  const { result } = await runWorkflow({
    args: { task: "gap-test-tb-cap", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-cap", mergeTarget: "develop", pollIntervalMs: 0, maxSuitePolls: 2 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { done: false, suiteExit: null },                                                             // poll 1
      { done: false, suiteExit: null },                                                             // poll 2
      { done: false, suiteExit: null },                                                             // poll 3 (breaks the cap)
    ],
  });
  assert.equal(result.outcome, "red", "a suite that never completes must fail closed");
  assert.equal(result.ffOk, false);
  assert.ok(result.message.includes("poll cap"), `message must cite the poll cap: ${result.message}`);
});

test("⑧ turn-budget — ff failure (develop advanced during suite) ⇒ script re-runs phase 1 (bounded) and lands on the retry", async (t) => {
  const { prompts, result, logs } = await runWorkflow({
    args: { task: "gap-test-tb-ff", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-ff", mergeTarget: "develop", pollIntervalMs: 0, maxSuitePolls: 5, maxFfRetries: 2 },
    agentResults: [
      // attempt 1
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1
      { done: true, suiteExit: 0 },                                                                 // poll
      { outcome: "ff-retry", ffOk: false, note: "develop advanced" },                               // phase 2 ff FAILED
      // attempt 2 (script re-runs phase 1)
      { outcome: "suite-started", suitePid: 222, codeDelta: "code", worktreeHead: "h2", note: "" }, // phase 1 (retry)
      { done: true, suiteExit: 0 },                                                                 // poll
      { outcome: "green", ffOk: true, developHead: "d2", worktreeHead: "h2", agentIdUsed: "a2", codeDelta: "code", note: "bracketClose=OK", bracketClosed: true }, // phase 2
    ],
  });
  assert.equal(result.outcome, "green", "a develop-advanced ff failure must retry from phase 1 and land");
  assert.equal(prompts.length, 6, "2× (phase1 + poll + phase2)");
  assert.ok(logs.some((l) => l.includes("ff-retry")), "log must record the ff-retry re-run");
  // The phase-1 prompt (retry) must carry the stale-flip revert preamble.
  assert.ok(prompts[3].includes("重试遗留翻转处理"), "the retry phase-1 prompt must carry the stale-flip revert");
});

test("⑧ turn-budget — ff-retry exhausted (maxFfRetries) ⇒ red + anti-livelock message (SPEC §7 bound)", async (t) => {
  const { result } = await runWorkflow({
    args: { task: "gap-test-tb-ffx", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-tb-ffx", mergeTarget: "develop", pollIntervalMs: 0, maxSuitePolls: 5, maxFfRetries: 2 },
    agentResults: [
      // attempt 1
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { done: true, suiteExit: 0 },
      { outcome: "ff-retry", ffOk: false, note: "develop advanced" },
      // attempt 2 — ffAttempts becomes 2, 2 >= maxFfRetries(2) ⇒ red
      { outcome: "suite-started", suitePid: 222, codeDelta: "code", worktreeHead: "h2", note: "" },
      { done: true, suiteExit: 0 },
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
  t.after(() => { for (const f of [`/tmp/fan-in-suite-${task}.env`, `/tmp/fan-in-suite-${task}.exit`, `/tmp/fan-in-suite-${task}.time`, `/tmp/fan-in-suite-${task}.log`, codeDeltaFile]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* best-effort */ } } });

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
    [/^load=/m, "load"],
    [/^lane_count=\d+$/m, "lane_count"],
    [/^suite_head=/m, "suite_head"],
  ]) {
    assert.match(capture, re, `capture must carry ${name} (phase-2 入账输入)`);
  }
});
