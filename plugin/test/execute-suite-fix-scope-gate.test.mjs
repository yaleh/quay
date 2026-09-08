// @test-group engine
// execute-suite-fix-scope-gate.test.mjs — RED/GREEN tests for the suite-fix fix-scope gate
// (gap-suite-fix-workflow-no-load-sensitive-branch).
//
// Defect: execute-suite-fix.js was a branchless "red ⇒ fix ALL failures + rerunning" path — it never
// judged "is this red a regression INSIDE this task's ## Touches?", fixed whatever failed, and
// escaped to non-Touches files (4×: inner-blocked-signal / outer-cron-registry /
// session-liveness+tmux-leak-scan (load-sensitive family) / fan-in-ff-protocol-check (checker
// cross-task misreport)). The fix-scope gate classifies each failures[] entry BEFORE fixing:
//   in_family   ⇒ load-sensitive ⇒ release (isolated rerun), do NOT fix;
//   staticCheck ⇒ checker misreport ⇒ defer independent task, do NOT fix;
//   file ∈ ## Touches ⇒ this-task regression ⇒ fix;
//   file ∉ ## Touches (or no file) ⇒ other-task bug ⇒ defer, do NOT fix.
// Only in-scope (Touches-internal) failures get fixed — zero out-of-scope fix commits.
//
// Covered here (REAL-INVOCATION — the workflow file is vm-executed and its gate bash block is run
// against real files, never a fixture-asserted verdict):
//   - AC1 (structural): both Fix prompts carry the fix-scope gate block, and the two workflow copies
//     (plugin/workflows + .claude/workflows) stay byte-identical.
//   - AC2 (negative control): an out-of-scope red (load-sensitive / checker-misreport / other-task)
//     classifies to ZERO inScope (⇒ zero out-of-scope fix commit), and the emitted prompt FORBIDS
//     touching out-of-scope files.
//   - AC3: a genuine Touches-internal regression still classifies inScope (fixable).
//   - fail-closed: a missing state.json ⇒ FIX_SCOPE_NOT_EVALUATED=1 (无法评估 ≠ 合格 — defer all).
//   - no-task degradation: with no `task` arg, machine-partition (in_family/staticCheck) still defers,
//     but a plain unattributed file stays inScope (no Touches scoping to over-defer against).
//
// Run:
//   scripts/test.sh plugin/test/execute-suite-fix-scope-gate.test.mjs
//   scripts/test.sh --for-task gap-suite-fix-workflow-no-load-sensitive-branch

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

const COPIES = [
  path.join(REPO_ROOT, "plugin", "workflows", "execute-suite-fix.js"),
];

// ── REAL-INVOCATION harness: vm-execute the actual workflow file ────────────────────────────────
// execute-suite-fix.js is workflow-runtime-only (top-level `return`), so it is NOT importable — strip
// `export ` from the meta line, wrap in an async function, run in a vm context with the workflow-runtime
// globals mocked. The script's own code runs and `agent()` captures the exact prompt it would emit.
// NOTE: unlike fan-in-execute.js, execute-suite-fix.js destructures `args` DIRECTLY (no JSON.parse),
// so the sandbox passes `args` as an OBJECT (matching its production dispatch shape).
async function runWorkflow(opts) {
  const src = fs.readFileSync(COPIES[0], "utf8");
  const body = src.replace(/^export\s+const\s+meta/m, "const meta");
  const wrapped = "(async () => {\n" + body + "\n})()";
  const captured = { prompts: [], phases: [], logs: [] };
  // Default agent sequence drives one REAL red round then green (fix → poll(red) → fix(real-red) →
  // poll(green) → freeze-check → merge), so BOTH the initial Fix prompt and the real-red-round Fix
  // prompt are emitted.
  const defaultResults = [
    { launched: true, worktreeHead: "head1", failuresFixed: [], note: "" },
    { state: "red", reason: "failed", tests: 3000, durationMs: 1000, pid: null, worktreeHead: "head1" },
    { failureCount: 2, rootCauses: [], relaunched: true, worktreeHead: "head2", note: "" },
    { state: "green", reason: "passed", tests: 3000, durationMs: 1000, pid: null, worktreeHead: "head2" },
    { worktreeHeadNow: "head2", verifiedCommit: "head2" },
    { batchMergeOk: true, developHead: "d", integrationHead: "i", note: "" },
  ];
  const sandbox = {
    console,
    setTimeout: (fn, _ms) => setTimeout(fn, 0),
    clearTimeout,
    args: opts.args,
    phase: (...a) => captured.phases.push(...a),
    log: (...a) => captured.logs.push(...a),
    agent: async (prompt, schema) => {
      const i = captured.prompts.length;
      captured.prompts.push(prompt);
      if (typeof opts.agentResult === "function") return opts.agentResult(prompt, schema, i);
      if (opts.agentResults && i < opts.agentResults.length) return opts.agentResults[i];
      return i < defaultResults.length ? defaultResults[i] : {};
    },
  };
  const ctx = vm.createContext(sandbox);
  const script = new vm.Script(wrapped, { filename: COPIES[0] });
  const promise = script.runInContext(ctx);
  if (!promise || typeof promise.then !== "function") {
    throw new Error(`vm execution of execute-suite-fix.js did not return a promise (got ${typeof promise})`);
  }
  const result = await promise;
  return { ...captured, result };
}

function extractGateBlock(prompt) {
  const s = prompt.indexOf("# fix-scope-gate-block-start");
  const e = prompt.indexOf("# fix-scope-gate-block-end");
  if (s === -1 || e === -1) {
    throw new Error("fix-scope gate block markers not found in emitted prompt");
  }
  return prompt.slice(s, e + "# fix-scope-gate-block-end".length);
}

function runBash(cmd, opts = {}) {
  const r = spawnSync("bash", ["-c", cmd], { encoding: "utf8", timeout: 30_000, ...opts });
  if (r.error) throw new Error(`bash spawn failed: ${r.error.message}\ncmd: ${cmd.slice(0, 200)}`);
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ── real temp "worktree" + state-dir fixtures (REAL files, symlinked real plugin/ tree) ───────────
// The gate's bash block resolves ${worktree}/plugin/scripts/touches-orthogonality-check.ts through the
// symlinked REAL plugin/ tree and reads ${worktree}/tasks/<taskId>.md + ${stateDir}/full-suite-state.json,
// so the classification exercises the real parseTouches + matchGlob + normalizePath (判据3, no fixture
// verdicts).
function makeWorktree(taskId, touchesBullets) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "suite-fix-gate-"));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(dir, "plugin"), "dir");
  const body = ["---", `id: ${taskId}`, "status: ready", "---", "## Touches", ...touchesBullets].join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), body, "utf8");
  return dir;
}

function makeStateDir(failures) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "suite-fix-state-"));
  fs.writeFileSync(
    path.join(dir, "full-suite-state.json"),
    JSON.stringify({ state: "red", reason: "failed", tests: 3000, failures }),
    "utf8",
  );
  return dir;
}

/** Run the gate block against a real worktree + state dir and return the parsed verdict (or null when
 *  the gate emitted FIX_SCOPE_NOT_EVALUATED). */
async function runGate({ task, worktree, stateDir }) {
  const { prompts } = await runWorkflow({ args: { task, worktree, stateDir, root: REPO_ROOT } });
  const block = extractGateBlock(prompts[0]);
  const r = runBash(block);
  assert.equal(r.status, 0, `gate block must exit 0 (fail-closed via marker, not a crash): ${r.stderr}`);
  const notEvaluated = /FIX_SCOPE_NOT_EVALUATED=1/.test(r.stdout);
  const m = r.stdout.match(/FIX_SCOPE_VERDICT=(.*)$/m);
  const verdict = notEvaluated ? null : m ? JSON.parse(m[1]) : null;
  return { notEvaluated, verdict, stdout: r.stdout };
}

// ── AC1 — both Fix prompts carry the fix-scope gate (structural) ────────────────────────────────

test("AC1 — both Fix prompts (initial + real-red-round) carry the fix-scope gate block", async () => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-fsg", worktree: "/tmp/wt", stateDir: "/tmp/sd", root: REPO_ROOT },
  });
  assert.equal(result.outcome, "green", "default agent sequence drives to green");
  const fixPrompts = [prompts[0], prompts[2]];
  for (const p of fixPrompts) {
    assert.ok(p.includes("# fix-scope-gate-block-start"), "Fix prompt must carry the gate block start marker");
    assert.ok(p.includes("# fix-scope-gate-block-end"), "Fix prompt must carry the gate block end marker");
    assert.ok(p.includes("touches-orthogonality-check.ts"), "gate must import the single-source parseTouches/matchGlob");
    assert.ok(p.includes("FIX_SCOPE_VERDICT"), "gate must emit a machine-readable verdict");
    assert.ok(p.includes("load-sensitive"), "gate must name the load-sensitive release class");
    assert.ok(p.includes("checker-misreport"), "gate must name the checker-misreport defer class");
    assert.ok(p.includes("other-task"), "gate must name the other-task defer class");
    // 判定 text forbids out-of-scope fixes.
    assert.ok(/outOfScope[^]*一律不修/.test(p), "gate 判定 must forbid fixing out-of-scope failures");
  }
});

test("AC1 — execute-suite-fix.js lives ONLY in plugin/workflows/ (the .claude/workflows/ dual-copy is retired)", () => {
  const a = fs.readFileSync(COPIES[0], "utf8");
  assert.ok(a.length > 0, "plugin/workflows/execute-suite-fix.js must have content");
  assert.ok(!fs.existsSync(path.join(REPO_ROOT, ".claude", "workflows", "execute-suite-fix.js")), ".claude/workflows/execute-suite-fix.js must be retired (archived)");
});

// ── AC2 — negative control: an out-of-scope red classifies to ZERO inScope (REAL files) ──────────

test("AC2 — out-of-scope red (load-sensitive + checker-misreport + other-task) ⇒ zero inScope, zero out-of-scope fix target", async (t) => {
  const task = "gap-test-fsg";
  const wt = makeWorktree(task, ["- tasks/gap-test-fsg.md", "- plugin/test/**"]);
  const sd = makeStateDir([
    { line: "a", file: "plugin/scripts/session-liveness.sh", in_family: true, kind: "wall-clock" },
    { line: "b", file: "plugin/scripts/fan-in-ff-protocol-check.ts", staticCheck: true },
    { line: "c", file: "orchestration/other-task.md" },
    { line: "d", file: "plugin/scripts/tmux-leak-scan.sh", in_family: true },
  ]);
  t.after(() => { cleanup(wt); cleanup(sd); });
  const { notEvaluated, verdict } = await runGate({ task, worktree: wt, stateDir: sd });
  assert.equal(notEvaluated, false, "gate must evaluate (state.json + task file present)");
  assert.equal(verdict.scoped, true, "a task with ## Touches ⇒ scoped classification");
  assert.deepEqual(verdict.inScope, [], "every failure is out-of-scope ⇒ ZERO inScope (⇒ zero out-of-scope fix commit)");
  const byReason = {};
  for (const o of verdict.outOfScope) byReason[o.reason] = (byReason[o.reason] || 0) + 1;
  assert.equal(byReason["load-sensitive"], 2, "the two in_family entries defer as load-sensitive (release)");
  assert.equal(byReason["checker-misreport"], 1, "the staticCheck entry defers as checker-misreport");
  assert.equal(byReason["other-task"], 1, "the file-not-in-Touches entry defers as other-task");
});

test("AC2 — the emitted prompt FORBIDS touching out-of-scope files (no越界 fix-commit allowed)", async () => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-fsg", worktree: "/tmp/wt", stateDir: "/tmp/sd", root: REPO_ROOT },
  });
  const p = prompts[2]; // the real-red-round Fix prompt (the "fix ALL failures" path)
  assert.match(p, /只修 inScope 里的失败/, "Fix prompt must scope fixes to inScope");
  assert.match(p, /outOfScope 的越界红一律不修/, "Fix prompt must forbid out-of-scope fixes");
  assert.match(p, /禁止触碰 outOfScope 里列出的任何文件/, "gate 判定 must forbid touching out-of-scope files");
  assert.match(p, /load-sensitive 释放/, "load-sensitive ⇒ release (not fix)");
  assert.match(p, /checker 误报与别任务 bug defer 独立任务/, "checker/other-task ⇒ defer independent task");
});

// ── AC3 — a genuine Touches-internal regression still classifies inScope (fixable) ───────────────

test("AC3 — a Touches-internal regression classifies inScope (still fixable)", async (t) => {
  const task = "gap-test-fsg-ok";
  const wt = makeWorktree(task, ["- tasks/gap-test-fsg-ok.md", "- plugin/test/**"]);
  const sd = makeStateDir([
    { line: "a", file: "plugin/test/execute-suite-fix-scope-gate.test.mjs" },
    { line: "b", file: "tasks/gap-test-fsg-ok.md" },
  ]);
  t.after(() => { cleanup(wt); cleanup(sd); });
  const { notEvaluated, verdict } = await runGate({ task, worktree: wt, stateDir: sd });
  assert.equal(notEvaluated, false, "gate must evaluate");
  assert.equal(verdict.scoped, true, "scoped classification active");
  assert.deepEqual(verdict.inScope, [
    "plugin/test/execute-suite-fix-scope-gate.test.mjs",
    "tasks/gap-test-fsg-ok.md",
  ], "both Touches-internal failures classify inScope");
  assert.deepEqual(verdict.outOfScope, [], "no out-of-scope classification for in-Touches failures");
});

// ── fail-closed: a missing state.json ⇒ FIX_SCOPE_NOT_EVALUATED=1 (无法评估 ≠ 合格) ──────────────

test("fail-closed — a missing state.json ⇒ FIX_SCOPE_NOT_EVALUATED=1 (defer all, never a silent pass)", async (t) => {
  const task = "gap-test-fsg-nostate";
  const wt = makeWorktree(task, ["- tasks/gap-test-fsg-nostate.md"]);
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), "suite-fix-state-empty-"));
  t.after(() => { cleanup(wt); cleanup(sd); });
  const { notEvaluated, verdict } = await runGate({ task, worktree: wt, stateDir: sd });
  assert.equal(notEvaluated, true, "missing state.json must be NOT-EVALUATED (fail-closed)");
  assert.equal(verdict, null, "no verdict is produced when the gate cannot evaluate");
});

// ── no-task degradation: machine-partition still defers in_family/staticCheck, plain file stays fixable ─

test("no-task — without a task arg, in_family/staticCheck still defer, a plain file stays inScope (no over-defer)", async (t) => {
  const wt = makeWorktree("unused", ["- tasks/unused.md"]);
  const sd = makeStateDir([
    { line: "a", file: "plugin/scripts/session-liveness.sh", in_family: true },
    { line: "b", file: "plugin/scripts/checker.ts", staticCheck: true },
    { line: "c", file: "packages/quay/src/serve.ts" },
  ]);
  t.after(() => { cleanup(wt); cleanup(sd); });
  // no task arg ⇒ no Touches scoping ⇒ only machine-partition (in_family/staticCheck).
  const { prompts } = await runWorkflow({ args: { worktree: wt, stateDir: sd, root: REPO_ROOT } });
  const block = extractGateBlock(prompts[0]);
  const r = runBash(block);
  const m = r.stdout.match(/FIX_SCOPE_VERDICT=(.*)$/m);
  const verdict = JSON.parse(m[1]);
  assert.equal(verdict.scoped, false, "no task arg ⇒ scoped=false (no Touches scope)");
  assert.deepEqual(verdict.inScope, ["packages/quay/src/serve.ts"], "a plain unattributed file stays inScope (general suite-fix)");
  const reasons = verdict.outOfScope.map((o) => o.reason).sort();
  assert.deepEqual(reasons, ["checker-misreport", "load-sensitive"], "machine-partition still defers in_family + staticCheck");
});
