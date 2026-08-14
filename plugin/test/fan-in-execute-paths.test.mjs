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
  const captured = { prompt: null, schema: null, phases: [], logs: [] };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    args: JSON.stringify(opts.args),
    phase: (...a) => captured.phases.push(...a),
    log: (...a) => captured.logs.push(...a),
    agent: async (prompt, schema) => {
      captured.prompt = prompt;
      captured.schema = schema;
      return opts.agentResult ?? { outcome: "red", ffOk: false };
    },
  };
  const ctx = vm.createContext(sandbox);
  const script = new vm.Script(wrapped, { filename: WORKFLOW });
  const promise = script.runInContext(ctx);
  if (!promise || typeof promise.then !== "function") {
    throw new Error(`vm execution of ${WORKFLOW} did not return a promise (got ${typeof promise})`);
  }
  const result = await promise;
  return { ...captured, result };
}

function extractBlock(text, start, end) {
  const s = text.indexOf(start);
  const e = text.indexOf(end, s);
  if (s === -1 || e === -1) {
    throw new Error(`block markers not found in emitted prompt: start=${start} end=${end}`);
  }
  return text.slice(s, e);
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
function makeRepoWithDelta(files) {
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
  for (const [p, content] of Object.entries(files)) {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  run(["add", "-A"]);
  run(["commit", "-qm", "delta"]);
  run(["checkout", "-q", "main"]); // HEAD = the task worktree view (fork point = base)
  return dir;
}

// Run the REAL step-2 bash (fork/delta/code_delta) from the workflow's emitted prompt against a real
// temp git repo holding `files` on develop. Returns the computed code_delta string.
async function classifyRealDelta(files) {
  const repo = makeRepoWithDelta(files);
  try {
    const { prompt } = await runWorkflow({
      args: { task: "gap-test-delta", worktree: repo, root: REPO_ROOT, runId: "fm-test-1", mergeTarget: "develop" },
    });
    const step2 = extractBlock(prompt, "【无锁段 step 2", "【无锁段 step 3");
    const bashLines = step2
      .split("\n")
      .filter((l) => /^(fork=|delta=|code_delta=)/.test(l));
    assert.ok(bashLines.length >= 3, `step-2 bash lines found: ${bashLines.length}`);
    const r = runBash(bashLines.join("\n") + '\necho "RESULT_CODE_DELTA=[$code_delta]"', { cwd: repo });
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
  // This is the AC78 承重点 file itself — editing it MUST trigger the full suite. If someone adds
  // `^[.]claude/` to the exclude list, this goes RED.
  const codeDelta = await classifyRealDelta({ ".claude/workflows/fan-in-execute.js": "export const meta = {}\n" });
  assert.notEqual(codeDelta, "", `code delta must be non-empty for a .js workflow file, got: ${JSON.stringify(codeDelta)}`);
  assert.match(codeDelta, /\.claude\/workflows\/fan-in-execute\.js/);
});

test("① REAL test delta — plugin/test/*.test.mjs must classify as code (test assertion face reruns)", async (t) => {
  const codeDelta = await classifyRealDelta({ "plugin/test/fan-in-execute-paths.test.mjs": "import { test } from 'node:test'\n" });
  assert.notEqual(codeDelta, "", `test delta must be non-empty (test assertion face), got: ${JSON.stringify(codeDelta)}`);
  assert.match(codeDelta, /plugin\/test\//);
});

test("① REAL doc delta — tasks/ + docs/ + .md only must classify as doc (skip full suite)", async (t) => {
  // 判据2 ① 镜像: a pure-doc delta classified as code would WASTE a full-suite run (该跳却重跑).
  const files = {
    "tasks/gap-fan-in-execute-three-unverified-paths.md": "status: ready\n",
    "docs/proposals/exp5-crystallization-strategy.md": "x\n",
    "adr/ADR-010-scheduled-milestone-e2e-incl-browser-tests.md": "y\n",
    "orchestration/fast-mode-tick-core.md": "z\n",
    ".quay/config.yml": "providers: {}\n",
  };
  const codeDelta = await classifyRealDelta(files);
  assert.equal(codeDelta, "", `pure-doc delta must produce empty code_delta, got: ${JSON.stringify(codeDelta)}`);
});

test("① REAL decision — code delta ⇒ rerun decision, doc delta ⇒ skip decision (AC75 semantics)", async (t) => {
  // The workflow's OWN prose (from the emitted prompt) states the decision mapping; the real regex
  // output drives it. Re-run both through the real pipeline and confirm the mapping holds.
  const codeDelta = await classifyRealDelta({ "plugin/scripts/foo.ts": "export const x = 1\n" });
  const docDelta = await classifyRealDelta({ "tasks/gap-x.md": "x\n" });
  assert.notEqual(codeDelta, "", "code delta must be non-empty ⇒ rerun");
  assert.equal(docDelta, "", "doc delta must be empty ⇒ skip");
});

// ── REAL-INVOCATION smoke (判据3 / AC78 实调 protection) ──────────────────────────────────────────

test("REAL-INVOCATION — the workflow file vm-executes and emits the full subagent prompt (AC78)", async (t) => {
  const { prompt, phases, result } = await runWorkflow({
    args: { task: "gap-test-smoke", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-test-1", mergeTarget: "develop" },
  });
  assert.ok(prompt.includes("【无锁段 step 1"), "prompt must carry step 1");
  assert.ok(prompt.includes("【持锁段 step 5"), "prompt must carry step 5");
  assert.ok(prompt.includes("# flip-block-start"), "flip block marker present");
  assert.ok(prompt.includes("# selfloc-block-start"), "selfloc block marker present");
  assert.deepEqual(phases, ["FanIn"]);
  assert.equal(result.outcome, "red"); // mock agent returns red; workflow maps it through
});

// ── ② --agent-id self-location determinism (REAL bash over a fake ~/.claude tree) ────────────────

test("② DIR-127/DIR-128 replay — the workflows/-scoped self-location picks the workflow-run subagent, NOT the flat trap", async (t) => {
  const { home } = makeDir127ReplayHome();
  t.after(() => cleanup(home));
  const { prompt } = await runWorkflow({
    args: { task: "gap-dir-127", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-dir127", mergeTarget: "develop" },
  });
  const selfloc = extractBlock(prompt, "# selfloc-block-start", "# selfloc-block-end");
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
  const { prompt } = await runWorkflow({
    args: { task: "gap-no-such-task", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-none", mergeTarget: "develop" },
  });
  const selfloc = extractBlock(prompt, "# selfloc-block-start", "# selfloc-block-end");
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
  const { prompt } = await runWorkflow({
    args: { task: "gap-dir-127", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-retry", mergeTarget: "develop" },
  });
  const selfloc = extractBlock(prompt, "# selfloc-block-start", "# selfloc-block-end");
  const r = runBash(selfloc + '\necho "RESULT_AGENT_ID=$agent_id"', { cwd: "/tmp", env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/RESULT_AGENT_ID=([^\n]*)/);
  assert.equal(m[1], F128_ID, "must pick the NEWEST workflow-run subagent mentioning the task");
});

// ── ③ flip sed fail-closed (REAL bash over real task files) ──────────────────────────────────────

async function flipBlockFor(task, worktree) {
  const { prompt } = await runWorkflow({
    args: { task, worktree, root: REPO_ROOT, runId: "fm-flip", mergeTarget: "develop" },
  });
  return extractBlock(prompt, "# flip-block-start", "# flip-block-end");
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
  const { prompt } = await runWorkflow({
    args: { task: "gap-test-both", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-both", mergeTarget: "develop" },
  });
  const flip = extractBlock(prompt, "# flip-block-start", "# flip-block-end");
  assert.ok(flip.includes("fan-in-ac-completion-gate.ts"), "flip block must run the AC completion gate (判据3 兼容不互斥)");
  assert.ok(flip.includes("flip_count=$(grep -c '^status: ready$'"), "flip block must still run the ③ line-shape pre-check");
  assert.ok(flip.indexOf("fan-in-ac-completion-gate.ts") > flip.indexOf("flip_count="), "AC gate must come AFTER the line-shape pre-check");
  assert.ok(flip.indexOf("fan-in-ac-completion-gate.ts") < flip.indexOf("sed -i"), "AC gate must come BEFORE the sed flip");
});
