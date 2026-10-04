// @test-group engine
// manager-tick-core.test.mjs — gap-manager-cold-start-no-falsifiable-checklist (AC3/AC4).
//
// Pins the execution core against a retired observation mechanism:
//   no_false_instrument = 1 — the LIVE execution core orchestration/manager-tick-core.md never
//       targets a non-existent script as a check instrument (defect 2). The session-liveness
//       mechanism (session-liveness.sh / monitor-mount-check.sh / idle-watch) was retired 2026-09-03,
//       so the core must no longer reference any of those deleted scripts. The shipped
//       plugin/loop/manager-tick-core.md is a one-line POINTER to this 正本
//       (gap-plugin-loop-manager-drifted-copies-pointerize), so content assertions target the 正本.
//   AC4 — the anchor A19 records cron receipts so registry↔real cron is externally verifiable
//       (defect 3, via manager-arm-loop.sh --verify / --record-cron).
//
// Run:
//   node --test plugin/test/manager-tick-core.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");
const CORE = path.join(repoRoot, "orchestration", "manager-tick-core.md");
const src = fs.readFileSync(CORE, "utf8");

// ── AC3 — no_false_instrument: the core no longer references the retired observer scripts ───────────

test("AC3 no_false_instrument — the execution core no longer targets idle-watch.sh as a check instrument", () => {
  assert.ok(!src.includes("idle-watch.sh"),
    "manager-tick-core.md must not reference idle-watch.sh (the non-existent script, defect 2)");
});

test("AC3 — the core no longer references the retired observer scripts (session-liveness / monitor-mount-check)", () => {
  assert.ok(!/session-liveness\.sh/.test(src), "manager-tick-core.md must not reference session-liveness.sh (retired 2026-09-03)");
  assert.ok(!/session-liveness-mount\.sh/.test(src), "manager-tick-core.md must not reference session-liveness-mount.sh (retired)");
  assert.ok(!/monitor-mount-check\.sh/.test(src), "manager-tick-core.md must not reference monitor-mount-check.sh (retired)");
});

// ── AC4 — the anchor A19 records cron receipts so registry↔real cron is externally verifiable ──────

test("AC4 — the anchor A19 records cron receipts so the registry↔real-cron link is externally verifiable", () => {
  assert.match(src, /--record-cron/, "A19 must carry the record-cron write-back step (the receipt after CronList)");
  assert.match(src, /registry-verified/, "A19 must distinguish registry-verified from registry-only");
  assert.match(src, /manager-arm-loop\.sh --verify/, "A19 must reference the external verifier");
});

// ── AC3 — the live reason archive no longer references the retired observer scripts ───────────────

test("AC3 — the live manager-loop-tick.md no longer references the retired observer scripts", () => {
  const archive = path.resolve(repoRoot, "orchestration", "manager-loop-tick.md");
  assert.ok(fs.existsSync(archive), "orchestration/manager-loop-tick.md must exist");
  const text = fs.readFileSync(archive, "utf8");
  assert.ok(!/monitor-mount-check\.sh/.test(text), "the archive must not reference monitor-mount-check.sh (retired)");
  assert.ok(!/session-liveness\.sh/.test(text), "the archive must not reference session-liveness.sh (retired)");
});

// ── AC3 — touched sibling files do not re-introduce the retired scripts as a live instrument ───────

test("AC3 — the touched sibling files never pgrep idle-watch (defect-2 pattern)", () => {
  for (const rel of ["scripts/manager-start.sh", "scripts/manager-arm-loop.sh"]) {
    const text = fs.readFileSync(path.join(pluginDir, rel), "utf8");
    assert.ok(!/pgrep[^\n]*idle-watch/.test(text),
      `${rel} must not pgrep idle-watch as a live instrument (defect 2)`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// AC2/AC3/AC6 — gap-manager-tick-core-hardcodes-quay-dev-root-silently-wrong-repo
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// The workflow .js was ZERO-covered here before (this file only read orchestration/manager-tick-core.md)
// — that is exactly why the hardcoded ROOT='/home/yale/work/quay' lived undetected in every published
// version. These tests READ AND EXECUTE the .js.
//
// REAL-INVOCATION harness (the AC78 lesson: the only valid verification of a workflow change is a real
// invocation): the workflow .js is workflow-runtime-only (top-level `return`, no import), so it is not
// importable — strip `export ` from the meta line, wrap in an async function, vm-execute it with the
// runtime globals mocked. The script's OWN code runs, so the guard branch / the ROOT interpolation in
// the emitted prompts are exercised, not a prose read.
const WORKFLOW = path.join(pluginDir, "workflows", "manager-tick-core.js");

async function runWorkflow(args) {
  const src = fs.readFileSync(WORKFLOW, "utf8");
  const body = src.replace(/^export\s+const\s+meta/m, "const meta");
  const wrapped = "(async () => {\n" + body + "\n})()";
  const captured = { prompts: [], phases: [], logs: [] };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    args,
    phase: (...a) => captured.phases.push(...a),
    log: (...a) => captured.logs.push(...a),
    // production semantics: parallel runs the thunks; a thunk's return value is that slot's result.
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    // null return ⇒ readings/audit "absent" branch (so the returned 指令 carries the READ_CMD fallback).
    agent: async (prompt) => { captured.prompts.push(prompt); return null; },
  };
  const ctx = vm.createContext(sandbox);
  const promise = new vm.Script(wrapped, { filename: WORKFLOW }).runInContext(ctx);
  if (!promise || typeof promise.then !== "function") {
    throw new Error(`vm execution of manager-tick-core.js did not return a promise (got ${typeof promise})`);
  }
  return { captured, result: await promise };
}

const HARDCODED_HOST_ROOT = "/home/yale/work/quay";

test("AC2 guard — the workflow .js no longer hardcodes a host workspace root", () => {
  // Falsifiable: this assertion was RED before the fix (the literal sat at :57 and :85).
  // POSITION-AWARE (硬规则 2): comments/the history note may MENTION the old literal — only a CODE
  // occurrence is a hit, so strip full-line `//` comments before checking. The code path proves the
  // absence behaviorally through the emitted-prompt assertions below.
  const codeOnly = fs.readFileSync(WORKFLOW, "utf8").split("\n")
    .filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.ok(!codeOnly.includes(HARDCODED_HOST_ROOT),
    `plugin/workflows/manager-tick-core.js must not hardcode ${HARDCODED_HOST_ROOT} in code (comments excluded)`);
});

test("AC2/AC3 arm① (negative control) — missing args.workspaceRoot ⇒ refused with an independent value, NO agent spawned", async () => {
  const { captured, result } = await runWorkflow("{}");
  assert.equal(result.evaluated, false, "a missing workspaceRoot must return the refusal independent value {evaluated:false}, not a normal-run shape");
  assert.match(String(result.reason), /workspaceRoot/, "the refusal reason must name the missing input");
  assert.equal(captured.prompts.length, 0, "refusing must NOT spawn the readings/audit agents (they would read an unknown cwd)");
  assert.ok(!JSON.stringify(result).includes(HARDCODED_HOST_ROOT), "the refusal must not leak the hardcoded host root");
});

test("AC2 fail-closed — a relative or malformed workspaceRoot is refused too (never silently used, never defaulted)", async () => {
  for (const args of ["", "{}", JSON.stringify({ workspaceRoot: "relative/dir" }), "not-json-at-all", JSON.stringify({ workspaceRoot: 123 })]) {
    const { captured, result } = await runWorkflow(args);
    assert.equal(result.evaluated, false, `args=${JSON.stringify(args)} must be refused (fail-closed), got evaluated=${result.evaluated}`);
    assert.equal(captured.prompts.length, 0, `args=${JSON.stringify(args)} must not spawn agents`);
  }
});

test("AC1/AC3 arm② (negative control, other direction) — args.workspaceRoot=<tmp> is USED and ${HARDCODED_HOST_ROOT} never appears", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mgr-tick-ws-"));
  try {
    const { captured, result } = await runWorkflow(JSON.stringify({ workspaceRoot: tmp, managerSessionId: "sess-abc" }));
    assert.equal(result.evaluated, true, "a valid workspaceRoot must take the normal-run branch");
    const whole = JSON.stringify(result) + "\n" + captured.prompts.join("\n");
    assert.ok(whole.includes(tmp), "the passed workspaceRoot must appear in the emitted prompts / returned READ_CMD");
    assert.ok(!whole.includes(HARDCODED_HOST_ROOT), `${HARDCODED_HOST_ROOT} must never appear once workspaceRoot is provided`);
    // the two ROOT interpolation sites: READ_CMD's `cd <root>` and the audit prompt's git-log -- <root>
    assert.ok(whole.includes(`cd ${tmp}`), "READ_CMD fallback must `cd` to the passed workspaceRoot");
    const escaped = tmp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(captured.prompts.join("\n"),
      new RegExp(`--since='40 minutes ago' -- ${escaped}`),
      "the audit prompt's git-log must scope to the passed workspaceRoot");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC1 — the readings subagent prompt targets the passed workspaceRoot (not the quay dev root)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mgr-tick-ws2-"));
  try {
    const { captured } = await runWorkflow(JSON.stringify({ workspaceRoot: tmp, managerSessionId: "sess-abc" }));
    assert.ok(captured.prompts.length >= 2, "the readings + audit agents must both be spawned on the normal path");
    assert.ok(captured.prompts.some((p) => p.includes(`在 ${tmp} 跑`)),
      "the readings prompt must place the command block in the passed workspaceRoot");
    for (const p of captured.prompts) {
      assert.ok(!p.includes(HARDCODED_HOST_ROOT), "no emitted prompt may reference the hardcoded host root");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

