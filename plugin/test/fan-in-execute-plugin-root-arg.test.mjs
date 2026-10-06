// @test-group engine
// fan-in-execute-plugin-root-arg.test.mjs —
// gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions.
//
// WHAT this proves. A shipped workflow `.js` used to hand an agent's SHELL a command carrying the
// literal `${CLAUDE_PLUGIN_ROOT}`. That variable has no value in a plain session's Bash (measured
// 2026-10-06: `${CLAUDE_PLUGIN_ROOT:-UNSET}` ⇒ UNSET in the session AND its subagents — it is set
// only for SKILL text expansion / hooks / MCP config), so the path silently degraded to
// `/scripts/dist/…` and failed only at run time — the same shape as "file not found" (硬规则 3b).
// 0.14.0 was worse: a LIVE interpolation in the Workflow sandbox ⇒ `ReferenceError:
// CLAUDE_PLUGIN_ROOT is not defined` at load and no agent ever started.
//
// The fix: the workflow takes `args.pluginRoot` (the caller knows the scriptPath, whose grandparent
// is the plugin root), defines a REAL JS binding `PLUGIN_ROOT`, and every command names an ABSOLUTE
// path through it. This file exercises the BUILT artifact (via the production rewriteJs, the same
// rule the publish path runs) through the real invocation path — vm-execute the built file with the
// Workflow sandbox globals mocked, capture the exact prompts it emits — never a source-read.
//
// Run:
//   node --experimental-strip-types --test plugin/test/fan-in-execute-plugin-root-arg.test.mjs
//   env -u CLAUDE_PLUGIN_ROOT node --experimental-strip-types --test plugin/test/fan-in-execute-plugin-root-arg.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { rewriteJs, JS_PLUGIN_ROOT_BINDING } from "../../packages/quay/scripts/build-plugin-dist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS = path.join(REPO_ROOT, "plugin", "workflows");

// The literal anchor a built `.js` carrier must never carry, in EITHER spelling:
//   · the live `\${CLAUDE_PLUGIN_ROOT}` a JS engine evaluates (0.14.0 ReferenceError at load), and
//   · the inert `\${"$"}{CLAUDE_PLUGIN_ROOT}` fold (0.15.0/0.16.0) whose evaluated string is STILL
//     the env-var literal the shell expands to the empty string.
const ENV_ANCHOR_RE = /\$\{CLAUDE_PLUGIN_ROOT\}/;
const ANY_ANCHOR_RE = /\$(?:\{CLAUDE_PLUGIN_ROOT\}|\{"\$"\}\{CLAUDE_PLUGIN_ROOT\})/g;
// "an empty plugin root": `/scripts/dist/` at a token boundary (start, whitespace, quote, `=`).
const EMPTY_ROOT_RE = /(^|[\s"'=])\/scripts\/dist\//m;

const cleanup = [];

/** A throwaway plugin root that LOOKS shipped: it carries `scripts/dist/`. */
function makePluginRoot(prefix = "fanin-pluginroot-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, "scripts", "dist"), { recursive: true });
  for (const n of ["select-static-checks-for-touches", "anti-drift-touches-check", "full-suite-runner", "per-task-suite-record"]) {
    fs.writeFileSync(path.join(dir, "scripts", "dist", `${n}.js`), "export const x = 1;\n", "utf8");
  }
  cleanup.push(dir);
  return dir;
}

function makeEmptyDir(prefix = "fanin-notaplugin-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

test.after(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

/** vm-execute a BUILT workflow with the real Workflow sandbox globals mocked; capture every agent
 *  prompt (these are the exact command blocks a plain session's shell receives). */
async function runBuiltWorkflow(file, args, { agentResult, transform } = {}) {
  const src = fs.readFileSync(path.join(WORKFLOWS, file), "utf8");
  const built = typeof transform === "function" ? transform(rewriteJs(src, () => true)) : rewriteJs(src, () => true);
  const body = built.replace(/^export const meta/m, "const meta");
  const captured = { prompts: [] };
  const sandbox = {
    console,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout,
    budget: () => {},
    args: JSON.stringify(args),
    phase: () => {},
    log: () => {},
    parallel: async (xs, fn) => Promise.all(xs.map(fn)),
    pipeline: async (xs, fn) => Promise.all(xs.map(fn)),
    workflow: async () => ({}),
    agent: async (prompt) => {
      captured.prompts.push(prompt);
      if (typeof agentResult === "function") return agentResult(prompt, captured.prompts.length - 1);
      return { outcome: "suite-started", suitePid: 1 };
    },
  };
  const ctx = vm.createContext(sandbox);
  const result = await new vm.Script("(async () => {\n" + body + "\n})()").runInContext(ctx);
  return { built, prompts: captured.prompts, result };
}

/** All `scripts/dist/<name>` reference tokens in a captured prompt, with the path that precedes each. */
function scriptsDistRefs(text) {
  const out = [];
  let i = text.indexOf("scripts/dist/");
  while (i !== -1) {
    // Walk back over path characters to the start of the reference token (`sync_helper="<path>/…` ⇒ `<path>/…`).
    let j = i;
    while (j > 0 && /[A-Za-z0-9_./-]/.test(text[j - 1])) j--;
    out.push(text.slice(j, i + "scripts/dist/".length));
    i = text.indexOf("scripts/dist/", i + 1);
  }
  return out;
}

/** A directory WITHOUT scripts/dist (and without scripts/*.ts) is not a quay plugin root. */
function runEntryPreflight(prompts, pluginRoot) {
  const joined = prompts.join("\n");
  const s = joined.indexOf("# entry-preflight-block-start");
  const e = joined.indexOf("# entry-preflight-block-end", s);
  assert.ok(s !== -1 && e !== -1, "the phase-1 prompt must carry the entry preflight markers");
  const block = joined.slice(joined.indexOf("\n", s) + 1, e);
  // The block is emitted with ${PLUGIN_ROOT} already interpolated to the caller's absolute path.
  assert.ok(block.includes(pluginRoot), "the preflight must reference the caller's pluginRoot");
  return spawnSync("bash", ["-c", block], { encoding: "utf8" });
}

// ── AC1: the built fan-in-execute emits ONLY absolute pluginRoot-prefixed paths ─────────────────────

test("AC1 — a built fan-in-execute emits no env-var anchor, no empty-root path, and only pluginRoot-prefixed scripts/dist refs", async () => {
  const pluginRoot = makePluginRoot();
  const { built, prompts } = await runBuiltWorkflow("fan-in-execute.js", {
    task: "gap-x",
    worktree: "/tmp/wt-does-not-matter",
    root: "/tmp/root-does-not-matter",
    mergeTarget: "develop",
    pluginRoot,
  });
  assert.ok(prompts.length >= 1, "the built workflow must emit at least one agent prompt (non-vacuous)");

  // The built artifact itself carries no env-var anchor in either spelling.
  assert.equal((built.match(ANY_ANCHOR_RE) || []).length, 0, "the BUILT carrier must carry zero env-var anchors");
  assert.ok(built.includes("const PLUGIN_ROOT ="), "the built carrier must define the binding it interpolates");

  const all = prompts.join("\n\n----PROMPT----\n\n");
  // ① no literal ${CLAUDE_PLUGIN_ROOT} in any emitted command.
  assert.equal(all.match(ENV_ANCHOR_RE), null, "no emitted prompt may contain the literal env-var anchor");
  // ② no path that starts with an EMPTY root — that is the run-time degradation the defect produced.
  assert.doesNotMatch(all, EMPTY_ROOT_RE, "no emitted prompt may contain an empty-root /scripts/dist/ path");
  // ③ every scripts/dist reference is prefixed by the caller's ABSOLUTE pluginRoot.
  const refs = scriptsDistRefs(all);
  assert.ok(refs.length >= 5, `the built workflow must emit several scripts/dist refs, got ${refs.length}`);
  for (const r of refs) {
    assert.ok(r.startsWith(`${pluginRoot}/scripts/dist/`), `a scripts/dist ref is NOT pluginRoot-prefixed: ${r}`);
  }
  // The flag is dropped for the now-bundled .js targets (a raw .ts is gone from the artifact).
  assert.doesNotMatch(all, /--experimental-strip-types\s+\S*scripts\/dist\//, "dist bundles do not need --experimental-strip-types");
});

test("AC1 取假 (negative control) — the OLD 0.15.0 fold spelling degrades to /scripts/dist/… under a plain session's shell", async () => {
  const pluginRoot = makePluginRoot();
  const args = { task: "gap-x", worktree: "/tmp/wt", root: "/tmp/rt", mergeTarget: "develop", pluginRoot };
  // "改回旧拼写": rewrite the binding back to the inert fold spelling the 0.15.0/0.16.0 artifact shipped.
  const { prompts: oldPrompts } = await runBuiltWorkflow("fan-in-execute.js", args, {
    transform: (built) => built.replace(/\$\{PLUGIN_ROOT\}/g, '${"$"}{CLAUDE_PLUGIN_ROOT}'),
  });
  const oldAll = oldPrompts.join("\n");
  // The prompt the agent receives still carries the env-var literal (① red) …
  assert.notEqual(oldAll.match(ENV_ANCHOR_RE), null, "the old spelling must leave the env-var literal in the prompt (① red)");
  // … and a plain session's shell expands it to the EMPTY string ⇒ /scripts/dist/… (② red).
  const emptySessionShell = (t) => t.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, "");
  assert.match(emptySessionShell(oldAll), EMPTY_ROOT_RE, "the old spelling must degrade to an empty-root path (② red)");

  // The FIXED build, run through the SAME shell-expansion simulation, is clean on both.
  const { prompts: newPrompts } = await runBuiltWorkflow("fan-in-execute.js", args);
  const newAll = emptySessionShell(newPrompts.join("\n"));
  assert.equal(newAll.match(ENV_ANCHOR_RE), null, "the fixed build must carry no env-var anchor (①)");
  assert.doesNotMatch(newAll, EMPTY_ROOT_RE, "the fixed build must not degrade to an empty-root path (②)");
});

// ── AC2: entry validation (stable codes, never a silent empty expansion) ────────────────────────────

test("AC2 — a built fan-in-execute without args.pluginRoot rejects with plugin-root-not-provided and never calls an agent", async () => {
  const { prompts, result } = await runBuiltWorkflow("fan-in-execute.js", {
    task: "gap-x",
    worktree: "/tmp/wt",
    root: "/tmp/rt",
    mergeTarget: "develop",
  });
  assert.equal(result.outcome, "plugin-root-not-provided", `got ${JSON.stringify(result)}`);
  assert.equal(prompts.length, 0, "no agent may be spawned when pluginRoot is missing");
});

test("AC2 — a RELATIVE pluginRoot rejects with plugin-root-invalid (a relative path cannot name a plugin root)", async () => {
  const { prompts, result } = await runBuiltWorkflow("fan-in-execute.js", {
    task: "gap-x",
    worktree: "/tmp/wt",
    root: "/tmp/rt",
    mergeTarget: "develop",
    pluginRoot: "plugin",
  });
  assert.equal(result.outcome, "plugin-root-invalid", `got ${JSON.stringify(result)}`);
  assert.equal(prompts.length, 0, "the shape rejection happens before any agent is spawned");
});

test("AC2 — a dir WITH scripts/dist passes the real preflight; an empty dir fails it with PLUGIN_ROOT_INVALID", async () => {
  const good = makePluginRoot();
  const bad = makeEmptyDir();
  const base = { task: "gap-x", worktree: "/tmp/wt", root: "/tmp/rt", mergeTarget: "develop" };

  const { prompts: goodPrompts } = await runBuiltWorkflow("fan-in-execute.js", { ...base, pluginRoot: good });
  const goodRun = runEntryPreflight(goodPrompts, good);
  assert.equal(goodRun.status, 0, `the real preflight must accept a scripts/dist root — stderr: ${goodRun.stderr}`);
  assert.match(goodRun.stdout, /PLUGIN_ROOT_OK=/);

  const { prompts: badPrompts } = await runBuiltWorkflow("fan-in-execute.js", { ...base, pluginRoot: bad });
  const badRun = runEntryPreflight(badPrompts, bad);
  assert.equal(badRun.status, 9, `the real preflight must reject a dir without scripts/dist — stdout: ${badRun.stdout}`);
  assert.match(badRun.stderr, /PLUGIN_ROOT_INVALID/);

  // …and the workflow maps that phase-1 verdict to the STABLE code (the value the agent reports).
  const { result } = await runBuiltWorkflow(
    "fan-in-execute.js",
    { ...base, pluginRoot: bad },
    { agentResult: (prompt) => (prompt.includes("# entry-preflight-block-start") ? { outcome: "plugin-root-invalid" } : { outcome: "suite-started" }) },
  );
  assert.equal(result.outcome, "plugin-root-invalid", `got ${JSON.stringify(result)}`);
  assert.ok(result.message.includes(bad), "the rejection must name the pluginRoot that failed");
});

// ── AC3: environment independence; the sibling carriers use the same mechanism ──────────────────────

test("AC3 — the emitted commands are IDENTICAL whatever CLAUDE_PLUGIN_ROOT holds (the binding never reads it)", async () => {
  const pluginRoot = makePluginRoot();
  const args = { task: "gap-x", worktree: "/tmp/wt", root: "/tmp/rt", mergeTarget: "develop", pluginRoot };
  const prior = process.env.CLAUDE_PLUGIN_ROOT;
  const runs = [];
  try {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    runs.push((await runBuiltWorkflow("fan-in-execute.js", args)).prompts.join("\n"));
    process.env.CLAUDE_PLUGIN_ROOT = "/wrong/one";
    runs.push((await runBuiltWorkflow("fan-in-execute.js", args)).prompts.join("\n"));
    process.env.CLAUDE_PLUGIN_ROOT = "/wrong/two";
    runs.push((await runBuiltWorkflow("fan-in-execute.js", args)).prompts.join("\n"));
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = prior;
  }
  assert.equal(runs[0], runs[1], "the emitted prompts must not depend on CLAUDE_PLUGIN_ROOT (unset vs set)");
  assert.equal(runs[0], runs[2], "the emitted prompts must not depend on the VALUE of CLAUDE_PLUGIN_ROOT");
  assert.ok(runs[0].length > 0 && !ENV_ANCHOR_RE.test(runs[0]), "the captured prompts must be non-empty and anchor-free");
});

test("AC3 — the sibling carriers (execute-suite-fix / pool-quality-judge / manager-tick-core) use the SAME binding and validate pluginRoot", async () => {
  const pluginRoot = makePluginRoot();
  const cases = [
    { file: "execute-suite-fix.js", args: { worktree: "/tmp/wt", stateDir: "/tmp/sd", root: "/tmp/rt" }, bad: "bad-args" },
    { file: "pool-quality-judge.js", args: { root: "/tmp/rt" } },
    { file: "manager-tick-core.js", args: { workspaceRoot: "/tmp/ws" } },
  ];
  for (const c of cases) {
    const src = fs.readFileSync(path.join(WORKFLOWS, c.file), "utf8");
    const built = rewriteJs(src, () => true);
    assert.equal((built.match(ANY_ANCHOR_RE) || []).length, 0, `${c.file}: the built carrier must carry zero env-var anchors`);
    assert.ok(built.includes("const PLUGIN_ROOT ="), `${c.file}: the built carrier must define the binding`);
    assert.ok(built.includes("const DEV_PLUGIN_ROOT_DEFAULT = ''"), `${c.file}: the shipped dev default must be blanked`);

    // Missing pluginRoot ⇒ a stable rejection that the caller can branch on.
    const missing = await runBuiltWorkflow(c.file, c.args);
    const r = missing.result;
    const missingBlob = JSON.stringify(r);
    assert.ok(
      r?.outcome === "plugin-root-not-provided" || /plugin-root-not-provided/.test(r?.reason ?? ""),
      `${c.file}: missing pluginRoot must yield plugin-root-not-provided, got ${missingBlob.slice(0, 120)}`,
    );
    assert.equal(missing.prompts.length, 0, `${c.file}: no agent may be spawned on a missing pluginRoot`);

    // A relative pluginRoot ⇒ plugin-root-invalid (shape rejection, before any agent).
    const relative = await runBuiltWorkflow(c.file, { ...c.args, pluginRoot: "plugin" });
    const rel = relative.result;
    assert.ok(
      rel?.outcome === "plugin-root-invalid" || /plugin-root-invalid/.test(rel?.reason ?? ""),
      `${c.file}: a relative pluginRoot must yield plugin-root-invalid, got ${JSON.stringify(rel).slice(0, 120)}`,
    );
  }
  // pool-quality-judge is fully runnable with a pluginRoot: its FIRST emitted command (the mechanical
  // planner) must name the absolute binding path — the concrete form of "same way" for a sibling.
  const pqj = await runBuiltWorkflow(
    "pool-quality-judge.js",
    { root: pluginRoot, pluginRoot },
    { agentResult: () => ({ triggers: { fired: false, reasons: [], poolCount: 0, oldestUnreviewedAgeMs: 0, roundsSinceLastJudge: 0 }, pool: [] }) },
  );
  assert.ok(pqj.prompts.length >= 1, "pool-quality-judge must emit its Plan prompt");
  assert.ok(pqj.prompts[0].includes(`${pluginRoot}/scripts/dist/pool-quality-judge.js`),
    `the Plan command must use the absolute binding path:\n${pqj.prompts[0].slice(0, 400)}`);
  assert.equal(pqj.prompts[0].match(ENV_ANCHOR_RE), null, "no env-var anchor may appear");
  assert.doesNotMatch(pqj.prompts[0], EMPTY_ROOT_RE);
});
