// @test-group engine
// build-plugin-dist.test.mjs — gap-delivery-laydown-dist-closure-gap: the rewrite surface that
// keeps the PACKAGED quay-init's laydown derivation in sync with package.sh's dist rewrite.
//
// package.sh stages plugin/ → packages/quay/plugin/, bundles every consumer-referenced .ts into
// dist/<name>.js, DELETES the raw .ts, and rewrites the staged invokers to reference the bundles.
// Three invariants must hold in the packaged form or the installed plugin's mechanism breaks:
//   AC1 — the packaged quay-init.sh's ${SCRIPT_DIR} closure + closure-check regexes tolerate the
//         two-segment `${SCRIPT_DIR}/dist/X.js` form (package.sh rewrites .ts refs to dist/X.js).
//         Source regex is multi-segment (allow `/`) and strips ONLY the ${SCRIPT_DIR}/ prefix so
//         the scripts/-relative path `dist/X.js` resolves under scripts/; rewriteShell must
//         PRESERVE it in the packaged copy (it did NOT before this task — the closure regex stayed
//         single-segment and never matched dist paths).
//   AC-workflows — rewriteInvokers rewrites plugin/workflows/*.js's `plugin/scripts/X.ts` refs.
//         The shipped workflow FILES are invokers too (fan-in-execute.js runs
//         `node --experimental-strip-types plugin/scripts/X.ts`); without the rewrite the packaged
//         artifact's workflows point at raw .ts that package.sh deleted, and verify_referenced_landed
//         (whose refs scan covers workflows/*.js) fails the install referenced-not-landed.
//   AC5 — rewriteMarkdown rewrites the cold-start SKILL.md PRECONDITION's path form
//         (`plugin/scripts/fast-mode-telemetry.ts` → `plugin/scripts/dist/fast-mode-telemetry.js`).
//         The precondition is the fail-closed checklist an installed project reads; a bare
//         `fast-mode-telemetry.ts` token (no plugin/scripts/ prefix) is NOT rewritten by
//         rewriteMarkdown and names a file that does not exist after .ts deletion.
//
// Run: node --test packages/quay/test/build-plugin-dist.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  rewriteMarkdown,
  rewriteJs,
  bindPluginRootInJsCarrier,
  JS_PLUGIN_ROOT_BINDING,
  scanJsCarrierAnchors,
  assertJsCarrierAnchorsInert,
  rewriteShell,
  rewriteInvokers,
  deriveEntries,
  scanCoreReferences,
  scanPluginSelfReferences,
  scanPluginSiblingReferences,
  closureMissing,
  bundleEntries,
  topLevelIfConditions,
  activeFileIdentityGuards,
  staticImportClosure,
  findEntryGuardHijacks,
  findUnnamedEntryGuards,
  REQUIRE_BANNER,
} from "../scripts/build-plugin-dist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function tmp(prefix = "build-plugin-dist-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── the Workflow sandbox (AC1) ─────────────────────────────────────────────────────────────────────
// A shipped workflow is evaluated with ONLY the globals its own probe recorded
// (plugin/workflows/manager-tick-core.js:38-42, probe wf_af76a6df-2c3). There is no
// CLAUDE_PLUGIN_ROOT binding and no `process`, so `${CLAUDE_PLUGIN_ROOT}` inside a template literal
// is a ReferenceError at load. This harness reproduces exactly that evaluation surface.
const WORKFLOW_SANDBOX_GLOBALS = [
  "log", "phase", "budget", "setTimeout", "clearTimeout", "agent", "parallel", "pipeline", "workflow", "args",
];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** The exact failure the defect produced: not "some error", THIS error. */
function isAnchorReferenceError(err) {
  return err instanceof ReferenceError && /CLAUDE_PLUGIN_ROOT is not defined/.test(err.message);
}

/** A stub that answers every shape the workflows ask of a sandbox global — called, destructured,
 *  awaited, property-read — so the body runs to its own `return` instead of dying on the harness. */
function universalSandboxStub() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "then") return undefined; // `await proxy` yields the proxy, not a thenable
      if (prop === "length") return 0;
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "toString") return () => "";
      return proxy;
    },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}

/**
 * Evaluate a workflow file's body with only the sandbox globals in scope. Returns the error (if
 * any) so the caller classifies it instead of collapsing "evaluated" and "harness gave up" into one
 * pass-shaped result (硬规则 3b).
 */
async function loadWorkflowInSandbox(text, argsValue = { workspaceRoot: "/w" }) {
  const body = text.replace(/^export const meta =/m, "const meta =");
  // args.workspaceRoot is what a real caller passes: manager-tick-core.js now fail-closes with an
  // early `return { evaluated:false }` when it is missing (gap-manager-tick-core-hardcodes-quay-
  // dev-root-silently-wrong-repo, develop a84cc33bb) — without it the workflow returns BEFORE the
  // poisoned template literal is evaluated, so the AC1/AC4/AC5 anchor controls would go vacuous
  // (a "no error" that measures a skipped literal, not a safe one). The other carriers ignore args.
  const values = WORKFLOW_SANDBOX_GLOBALS.map((n) => (n === "args" ? argsValue : universalSandboxStub()));
  try {
    await new AsyncFunction(...WORKFLOW_SANDBOX_GLOBALS, body)(...values);
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

const WORKFLOW_DIR = path.join(REPO_ROOT, "plugin", "workflows");
const readWorkflow = (f) => fs.readFileSync(path.join(WORKFLOW_DIR, f), "utf8");
const countActive = (text) => (text.match(/(?<!\\)\$\{CLAUDE_PLUGIN_ROOT\}/g) || []).length;
// The two spellings a `.js` carrier must NOT contain after the rewrite: the live anchor a JS engine
// evaluates (ReferenceError at load) AND the inert-fold spelling `${"$"}{CLAUDE_PLUGIN_ROOT}` that
// gap-dist-rewrite-injects-live-interpolation-into-workflow-js emitted (loads, but the string it
// produces is still the env-var literal, which a plain session's shell expands to the EMPTY string
// ⇒ /scripts/dist/…). Both must be 0 in the built carriers — the binding form replaces them.
const FOLDED_ANCHOR_SPELLING = '${"$"}{CLAUDE_PLUGIN_ROOT}';
const countFolded = (text) => text.split(FOLDED_ANCHOR_SPELLING).length - 1;
const countBindingRefs = (text) => (text.match(/\$\{PLUGIN_ROOT\}\/(?:scripts|gate-scripts)\/dist\//g) || []).length;

// ── AC1: the closure regex survives rewriteShell multi-segment + prefix-strip ──────────────────────
test("AC1 — rewriteShell(isQuayInit=true) preserves the two-segment closure regex (dist/X.js tolerant + ${SCRIPT_DIR} prefix-strip)", () => {
  // A faithful slice of quay-init.sh's derive_loop_scripts (d) closure line AS THE SOURCE NOW HAS
  // IT (multi-segment char class + prefix-only strip). rewriteShell must not downgrade it.
  const snippet = [
    'for dep in $(grep -oE \'\\$\\{SCRIPT_DIR\\}/[a-zA-Z0-9][a-zA-Z0-9._/-]*|\\$SCRIPT_DIR/[a-zA-Z0-9][a-zA-Z0-9._/-]*\' "$PLUGIN_ROOT/scripts/$s" 2>/dev/null | sed -E \'s#^\\$\\{SCRIPT_DIR\\}/##; s#^\\$SCRIPT_DIR/##\' | sort -u || true); do',
    '  [ -f "$PLUGIN_ROOT/scripts/$dep" ] || continue',
    'done',
  ].join("\n");
  const out = rewriteShell(snippet, true);
  // The packaged copy must still allow `/` in the matched path …
  assert.match(out, /\\\$\\\{SCRIPT_DIR\\\}\/\[a-zA-Z0-9\]\[a-zA-Z0-9\._\/-\]\*/,
    "closure regex must tolerate the two-segment dist/X.js path in the packaged quay-init.sh");
  // … and must strip ONLY the ${SCRIPT_DIR}/ or $SCRIPT_DIR/ prefix (never the basename-strip
  // s#.*/## which truncated dist/X.js to X.js).
  assert.match(out, /sed -E 's#\^\\\$\\\{SCRIPT_DIR\\\}\/##; s#\^\\\$SCRIPT_DIR\/##'/,
    "closure must keep the scripts/-relative path (prefix-strip, not basename-strip)");
});

test("AC1 — the packaged closure regex extracts dist/X.js from a ${SCRIPT_DIR}/dist/X.js reference (end-to-end shell semantics)", () => {
  // Simulate the packaged quay-init's derive closure grep+sed on a REAL rewritten reference.
  const dir = tmp();
  try {
    const script = path.join(dir, "send-keys-reliable.sh");
    fs.writeFileSync(script, 'CHECKER="${SCRIPT_DIR}/dist/transcript-delivery-check.js"\n', "utf8");
    const refs = execFileSync(
      "bash",
      ["-c",
        "grep -oE '\\$\\{SCRIPT_DIR\\}/[a-zA-Z0-9][a-zA-Z0-9._/-]*|\\$SCRIPT_DIR/[a-zA-Z0-9][a-zA-Z0-9._/-]*' \"$1\" | sed -E 's#^\\$\\{SCRIPT_DIR\\}/##; s#^\\$SCRIPT_DIR/##' | sort -u",
        "bash",
        script,
      ],
      { encoding: "utf8" },
    ).trim();
    assert.equal(refs, "dist/transcript-delivery-check.js",
      "the closure grep must extract the scripts/-relative two-segment path, not the basename");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC-workflows: rewriteInvokers rewrites the shipped workflow FILES' plugin/scripts/X.ts refs ─────
test("AC-workflows — rewriteInvokers rewrites plugin/workflows/*.js plugin/scripts/X.ts refs to the PLUGIN_ROOT-binding dist form", () => {
  const dir = tmp();
  try {
    const wfDir = path.join(dir, "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    // The staged root carries the bundles the build would have produced — rewriteInvokers decides
    // "is this reference bundlable?" from the FILESYSTEM, not from a guess (see rewritePluginPaths).
    fs.mkdirSync(path.join(dir, "scripts", "dist"), { recursive: true });
    for (const n of ["anti-drift-touches-check", "per-task-suite-record"]) {
      fs.writeFileSync(path.join(dir, "scripts", "dist", `${n}.js`), "export const x = 1;\n", "utf8");
    }
    fs.writeFileSync(path.join(wfDir, "fan-in-execute.js"), [
      "// comment referencing plugin/scripts/per-task-suite-record.ts",
      "if ! node --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts --task ${task}; then",
      "  echo ok",
      "fi",
      "// dev-repo path must be left alone",
      "node experiments/quay-perpetual-stream/scripts/drain-scheduler.ts",
    ].join("\n"), "utf8");
    const touched = rewriteInvokers(dir);
    assert.equal(touched, 1, "the workflow .js must be counted as a rewritten invoker");
    const out = fs.readFileSync(path.join(wfDir, "fan-in-execute.js"), "utf8");
    // A `.js` carrier gets a reference to its OWN `${PLUGIN_ROOT}` binding — a real JS const the
    // carrier defines from args.pluginRoot — NOT the `${CLAUDE_PLUGIN_ROOT}` env-var text, which a
    // plain session's shell expands to the empty string (⇒ /scripts/dist/…). See
    // JS_PLUGIN_ROOT_BINDING's docstring.
    assert.ok(out.includes(`${JS_PLUGIN_ROOT_BINDING}/scripts/dist/anti-drift-touches-check.js`),
      "the node --experimental-strip-types invocation must point at the binding-prefixed dist bundle");
    assert.ok(out.includes(`${JS_PLUGIN_ROOT_BINDING}/scripts/dist/per-task-suite-record.js`),
      "the comment reference must point at the binding-prefixed dist bundle");
    assert.equal(countActive(out), 0,
      "no env-var anchor may appear in a .js carrier — a JS engine evaluates it (0.14.0 ReferenceError)");
    assert.equal(countFolded(out), 0,
      "no inert-fold anchor may survive either — its evaluated string is still the env-var literal");
    assert.ok(!out.includes("anti-drift-touches-check.ts"),
      "no plugin/scripts/*.ts reference may survive in the shipped workflow");
    assert.ok(!/plugin\/(scripts|gate-scripts)\/dist\//.test(out),
      "no cwd-relative plugin/ prefix may survive — in a consuming project the plugin IS the tree root");
    assert.ok(out.includes("experiments/quay-perpetual-stream/scripts/drain-scheduler.ts"),
      "a dev-repo experiments/...ts path (not a plugin mechanism) must be left untouched");
    // The flag is dropped only because the target really became a bundle.
    assert.ok(out.includes(`node ${JS_PLUGIN_ROOT_BINDING}/scripts/dist/anti-drift-touches-check.js`),
      "the strip-types flag must be gone once the reference names a bundled .js");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC1/AC4/AC5: the `.js` carrier must not hand a JS engine (or an agent's shell) an anchor ──────
// Two findings, one surface. gap-dist-rewrite-injects-live-interpolation-into-workflow-js: the
// publish rewrite injected the env-var anchor into plugin/workflows/*.js, where a JS engine evaluates
// it — 4/6 loaded to `ReferenceError`. gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-
// that-is-unset-in-plain-sessions: the fix for THAT emitted the inert fold spelling, which loads but
// evaluates to the env-var literal — handed to an agent's shell, it expands to the EMPTY string
// (no such variable in a plain session) ⇒ `/scripts/dist/…`. Both spellings must be 0 in a built
// `.js` carrier; the reference is the carrier's own `${PLUGIN_ROOT}` binding.

test("AC1 — the PRODUCTION rewrite of the real manager-tick-core.js evaluates end-to-end under the sandbox globals", async () => {
  const out = rewriteJs(readWorkflow("manager-tick-core.js"), () => true);
  const { error } = await loadWorkflowInSandbox(out);
  assert.equal(error, null, `the rewritten workflow must evaluate — got ${error ? `${error.name}: ${error.message}` : "no error"}`);
  // Non-vacuous: the reference is still THERE (as a binding), just no longer an env-var anchor.
  assert.ok(countBindingRefs(out) >= 1, "the rewritten carrier must still name the tick read command's script");
  assert.ok(out.includes("const PLUGIN_ROOT ="), "the carrier must define the binding its references interpolate");
  assert.ok(out.includes("const DEV_PLUGIN_ROOT_DEFAULT = ''"),
    "the shipped carrier's dev-tree default must be BLANKED (a consumer has no <worktree>/plugin)");
});

test("AC2 — both template-literal flavors interpolate the BINDING to an absolute path (no shell-expandable residue, no String.raw backslash leak)", async () => {
  // Both tag flavors appear in the shipped set: manager-tick-core.js builds its tick command block
  // with String.raw (:85) and its returned instruction block with an untagged template (:247). The
  // evaluated text is what the consumer's shell runs, so it must name an absolute bundle path in
  // both — and must NOT carry a `${…}` for the shell to expand (that is the defect).
  const src = [
    "export const meta = { name: 'x' }",
    "const PLUGIN_ROOT = '/plug'",
    "const READ_CMD = String.raw`# A0 node --experimental-strip-types plugin/scripts/quay-session.ts manager-tick-readings`",
    "const TPL = `run: node --experimental-strip-types plugin/scripts/quay-session.ts --root /w`",
    "return { READ_CMD, TPL }",
  ].join("\n");
  const out = rewriteJs(src, () => true);
  assert.equal(countActive(out), 0);
  assert.equal(countFolded(out), 0);
  const r = await new AsyncFunction(out.replace(/^export const meta =/m, "const meta ="))();
  assert.equal(r.READ_CMD, "# A0 node /plug/scripts/dist/quay-session.js manager-tick-readings");
  assert.equal(r.TPL, "run: node /plug/scripts/dist/quay-session.js --root /w");
  assert.doesNotMatch(r.READ_CMD, /\\/, "a backslash here means an escape leaked through String.raw — the shell would not expand it");
  assert.doesNotMatch(r.READ_CMD, /\$\{/, "the emitted command must carry NO shell-expandable ${…} — that is the defect (expands to /scripts/dist/…)");
  assert.doesNotMatch(r.TPL, /\$\{/);
  // Negative control for THIS contract: if the rewriter emitted an ESCAPED binding (`\${PLUGIN_ROOT}`)
  // instead of a live interpolation, String.raw would leak the backslash — silent wrongness, not a
  // load failure. That is why the binding is a real `const`, not text.
  const escaped = out.replace(/\$\{PLUGIN_ROOT\}/g, "\\${PLUGIN_ROOT}");
  const rEsc = await new AsyncFunction(escaped.replace(/^export const meta =/m, "const meta ="))();
  assert.equal(rEsc.TPL, "run: node ${PLUGIN_ROOT}/scripts/dist/quay-session.js --root /w", "untagged: the escape cooks to a shell-expandable ${…}");
  assert.equal(rEsc.READ_CMD, "# A0 node \\${PLUGIN_ROOT}/scripts/dist/quay-session.js manager-tick-readings",
    "String.raw: the escape LEAKS — silent wrongness, not a load failure");
});

test("AC4 — negative control: the PRE-FIX rule (rewriteMarkdown on a .js carrier) reproduces `ReferenceError: CLAUDE_PLUGIN_ROOT is not defined`", async () => {
  const preFix = rewriteMarkdown(readWorkflow("manager-tick-core.js"), () => true);
  assert.ok(countActive(preFix) > 0, "the pre-fix rule must produce active anchors (otherwise this control is vacuous)");
  const { error } = await loadWorkflowInSandbox(preFix);
  assert.ok(isAnchorReferenceError(error),
    `the pre-fix carrier must fail loudly with the recorded error, got ${error ? `${error.name}: ${error.message}` : "NO ERROR"}`);
  // …and the fix removes exactly that outcome, leaving one binding reference per pre-fix anchor.
  const fixed = rewriteJs(readWorkflow("manager-tick-core.js"), () => true);
  assert.equal(countActive(fixed), 0);
  assert.equal(countFolded(fixed), 0);
  assert.equal(countBindingRefs(fixed), countActive(preFix), "every pre-fix anchor must become a binding reference, none dropped");
  assert.ok(!isAnchorReferenceError((await loadWorkflowInSandbox(fixed)).error));
});

test("AC5 — all five shipped workflows rewrite to ZERO env-var anchors and evaluate in the sandbox", async () => {
  const expected = {
    "manager-tick-core.js": 2,
    // 4 in the finding's artifact; 3 in the source after this change moved the meta phase-detail
    // mention to the literal token `<pluginRoot>/scripts/…` (a description, not a runnable reference).
    "pool-quality-judge.js": 3,
    // 25 occurrences on 24 lines (re-measured for gap-fan-in-execute-semantic-fallback-telemetry-
    // blind, which added two real `plugin/scripts/worker-driver.ts` invocations — the phase=start /
    // phase=end --record-semantic-fallback writes — plus one AC3 rationale comment naming
    // plugin/scripts/worker-fan-in.ts). The finding's original 22 counted the published artifact,
    // built with the real bundle predicate (one reference there is not a bundle entry); the
    // unit-level rewrite with bundleExists=()=>true folds that one too.
    "fan-in-execute.js": 25,
    // gap-delete-dead-execute-suite-fix-workflow (2026-10-07): the standalone suite-fix workflow was
    // DELETED (zero production callers) — it is no longer a shipped carrier.
    "drain-directives.js": 0,
    "run-routines.js": 0,
  };
  for (const [file, n] of Object.entries(expected)) {
    const src = readWorkflow(file);
    const pre = rewriteMarkdown(src, () => true);   // the OLD .md rule — the pre-fix baseline
    const post = rewriteJs(src, () => true);        // the .js rule — the binding form
    assert.equal(countActive(pre), n, `${file}: pre-fix anchor count changed — the measurement drifted`);
    assert.equal(countActive(post), 0, `${file}: no env-var anchor may survive the rewrite`);
    assert.equal(countFolded(post), 0, `${file}: no inert-fold anchor may survive either`);
    assert.equal(countBindingRefs(post), n, `${file}: the ${n} pre-fix anchor(s) must become binding references, not deleted`);
    assert.equal((await loadWorkflowInSandbox(post)).error, null, `${file}: the rewritten carrier must evaluate cleanly`);
  }
  // AC1's baseline, re-measured on the two carriers whose poisoned literals execute eagerly: the
  // pre-fix rule really does stop them at load (the other two hold theirs behind control flow the
  // stub never enters — that is a static-count measurement, not an execution one).
  for (const file of ["manager-tick-core.js", "pool-quality-judge.js"]) {
    const { error } = await loadWorkflowInSandbox(rewriteMarkdown(readWorkflow(file), () => true));
    assert.ok(isAnchorReferenceError(error), `${file}: pre-fix must reproduce the recorded ReferenceError`);
  }
  // The baseline side of the same measurement: the SOURCE (unrewritten) forms carry no anchor at
  // all, so the predicate above only fires on the rewrite — proving it measures the rewrite, not
  // something every workflow already satisfies.
  for (const file of Object.keys(expected)) {
    assert.equal(countActive(readWorkflow(file)), 0, `${file}: source form must be anchor-free`);
    assert.equal(countFolded(readWorkflow(file)), 0, `${file}: source form must carry no folded anchor either`);
  }
});

test("AC4(task) — the BUILT workflows/*.js carry ZERO ${CLAUDE_PLUGIN_ROOT} in EITHER spelling; .md/.sh carriers keep the anchor", () => {
  // The predicate (exactly the AC's): count the live anchor and the inert-fold spelling in the
  // REWRITTEN carrier. Baseline first (the pre-fix rewrite of the real sources), so a zero on the
  // built side is distinguishable from a predicate that never fires (硬规则 2 / 3b).
  const CARRIER_RE = /\$(?:\{CLAUDE_PLUGIN_ROOT\}|\{"\$"\}\{CLAUDE_PLUGIN_ROOT\})/g;
  const countAnchors = (text) => (text.match(CARRIER_RE) || []).length;
  const preFixCounts = {};
  const firstHits = [];
  for (const file of ["manager-tick-core.js", "pool-quality-judge.js", "fan-in-execute.js", "drain-directives.js", "run-routines.js"]) {
    const pre = rewriteMarkdown(readWorkflow(file), () => true);
    preFixCounts[file] = countAnchors(pre);
    for (const line of pre.split("\n")) {
      if (firstHits.length < 3 && CARRIER_RE.test(line)) firstHits.push(`${file}: ${line.trim().slice(0, 100)}`);
      CARRIER_RE.lastIndex = 0;
    }
  }
  // Print the baseline (0.16.0's fan-in-execute.js had 20 occurrences in the published artifact; the
  // unit-level pure rewrite folds 25) and the first 3 hits — "proof the predicate CAN hit the
  // pre-fix product", not just that it returns 0 now.
  console.log("[AC4-task] pre-fix anchor counts:", JSON.stringify(preFixCounts));
  console.log("[AC4-task] first 3 pre-fix hits:\n" + firstHits.map((h) => "  " + h).join("\n"));
  assert.ok(preFixCounts["fan-in-execute.js"] >= 20, "the pre-fix fan-in-execute.js must carry >=20 anchors (the 0.16.0 baseline)");
  assert.equal(firstHits.length, 3, "the predicate must hit real pre-fix lines — a zero-hit predicate proves nothing (硬规则 2)");

  for (const file of Object.keys(preFixCounts)) {
    const built = rewriteJs(readWorkflow(file), () => true);
    assert.equal(countAnchors(built), 0, `${file}: a built .js carrier must carry ZERO ${"${CLAUDE_PLUGIN_ROOT}"} in either spelling`);
  }
  // The `.md`/`.sh` carriers are a DIFFERENT mechanism: their anchor is real Skill/shell text
  // expansion, so the rule must NOT have been applied to them. Measured on the real shipped docs.
  const mdSrc = "run `node ${CLAUDE_PLUGIN_ROOT}/scripts/fast-mode-telemetry.ts`";
  const mdOut = rewriteMarkdown(mdSrc, () => true);
  assert.ok(mdOut.includes("${CLAUDE_PLUGIN_ROOT}/scripts/dist/fast-mode-telemetry.js"),
    "the .md carrier keeps the env-var anchor (the shell/Skill expands it there) and only swaps the child");
  const shSrc = 'exec node --experimental-strip-types "$SCRIPT_DIR/foo.ts"';
  assert.match(rewriteShell(shSrc), /"\$SCRIPT_DIR\/dist\/foo\.js"/, "the .sh carrier keeps its ${SCRIPT_DIR} anchor");
});

test("AC3 — the guard takes FALSE on an active anchor, TRUE on the folded form, and refuses NOT-EVALUATED", () => {
  const dir = tmp();
  try {
    const wfDir = path.join(dir, "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    const carrier = path.join(wfDir, "x.js");
    // (a) the defect shape — fail loud
    fs.writeFileSync(carrier, 'const cmd = `node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/y.js`;\n', "utf8");
    const bad = scanJsCarrierAnchors(dir);
    assert.equal(bad.scanned, 1, "the guard must report how many carriers it actually read");
    assert.equal(bad.violations.length, 1, "an ACTIVE anchor is a violation");
    assert.throws(() => assertJsCarrierAnchorsInert(dir), /js-carrier anchor gate FAILED/);
    // (b) the shipped shape — pass
    fs.writeFileSync(carrier, `const cmd = \`node ${JS_PLUGIN_ROOT_BINDING}/scripts/dist/y.js\`;\n`, "utf8");
    assert.equal(scanJsCarrierAnchors(dir).violations.length, 0);
    assert.equal(assertJsCarrierAnchorsInert(dir), 1);
    // (c) the legacy escape is inert (a JS engine does not interpolate `\${…}` in an untagged
    //     template) — tolerated by the "active" predicate, though the rewriter emits a real binding
    //     because String.raw defeats the escape.
    fs.writeFileSync(carrier, "const cmd = `node \\${CLAUDE_PLUGIN_ROOT}/scripts/dist/y.js`;\n", "utf8");
    assert.equal(scanJsCarrierAnchors(dir).violations.length, 0);
    // (d) NOT-EVALUATED is its own outcome: zero carriers must never read as "clean"
    fs.rmSync(wfDir, { recursive: true, force: true });
    assert.equal(scanJsCarrierAnchors(dir).scanned, 0);
    assert.throws(() => assertJsCarrierAnchorsInert(dir), /NOT-EVALUATED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — positive control on the REAL plugin root: the guard reads every shipped carrier and reports inert", () => {
  const pluginRoot = path.join(REPO_ROOT, "plugin");
  const { scanned, violations } = scanJsCarrierAnchors(pluginRoot);
  // gap-delete-dead-execute-suite-fix-workflow (2026-10-07): was 6 — the standalone suite-fix
  // workflow was deleted, so the real surface ships one fewer .js carrier.
  assert.equal(scanned, 5, "the real surface ships five .js carriers — a different count means the guard is blind or vacuous");
  assert.deepEqual(violations, []);
  assert.equal(assertJsCarrierAnchorsInert(pluginRoot), 5);
});

test("AC2 — bindPluginRootInJsCarrier folds BOTH env-var spellings onto the binding and leaves an escaped anchor alone", () => {
  assert.equal(bindPluginRootInJsCarrier("run ${CLAUDE_PLUGIN_ROOT}/scripts/dist/x.js"), `run ${JS_PLUGIN_ROOT_BINDING}/scripts/dist/x.js`);
  assert.equal(bindPluginRootInJsCarrier(`run ${FOLDED_ANCHOR_SPELLING}/scripts/dist/x.js`), `run ${JS_PLUGIN_ROOT_BINDING}/scripts/dist/x.js`);
  assert.equal(bindPluginRootInJsCarrier(`run ${JS_PLUGIN_ROOT_BINDING}/scripts/dist/x.js`), `run ${JS_PLUGIN_ROOT_BINDING}/scripts/dist/x.js`);
  assert.equal(bindPluginRootInJsCarrier("run \\${CLAUDE_PLUGIN_ROOT}/scripts/dist/x.js"), "run \\${CLAUDE_PLUGIN_ROOT}/scripts/dist/x.js");
  // A `.md` carrier is untouched by the fold (its `${…}` is expanded by the shell, not a JS engine).
  const md = rewriteMarkdown("`${CLAUDE_PLUGIN_ROOT}/scripts/dist/x.js`");
  assert.equal(md, "`${CLAUDE_PLUGIN_ROOT}/scripts/dist/x.js`");
});

// ── AC5: rewriteMarkdown rewrites the cold-start SKILL.md PRECONDITION's path form ─────────────────
test("AC5 — rewriteMarkdown rewrites the cold-start precondition plugin/scripts/fast-mode-telemetry.ts to the anchored dist form", () => {
  const precondition =
    "| loop mechanism laid down | `<root>/plugin/scripts/session-liveness.sh`, `<root>/plugin/scripts/fast-mode-telemetry.ts` exist |";
  const out = rewriteMarkdown(precondition);
  // AC-260: the `<root>/plugin/…` spelling is the defect — `<root>` is the CONSUMER's cwd, and the
  // plugin is the tree root there, so `<root>/plugin/scripts/…` resolves to nothing. Both the
  // repo-root expression AND the `plugin/` segment are replaced by the plugin-root anchor.
  assert.ok(out.includes("`${CLAUDE_PLUGIN_ROOT}/scripts/dist/fast-mode-telemetry.js`"),
    "the precondition's .ts reference must become the bundled, plugin-root-anchored form the install lays down");
  assert.ok(!out.includes("fast-mode-telemetry.ts"),
    "no raw .ts reference may survive the precondition after packaging");
  assert.ok(!out.includes("<root>/plugin/scripts/dist/"),
    "the repo-root prefix must be dropped, not kept in front of the anchor");
});

test("AC5 — the REAL cold-start SKILL.md precondition table carries no raw .ts reference after rewriteMarkdown (C-machine 'entire .ts layer missing' zeroed)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "..", "plugin", "skills", "cold-start", "SKILL.md"), "utf8");
  // The PRECONDITION TABLE is the section between `## Preconditions (fail-closed)` and the next
  // `##` heading (`## Observable consequences`). The later sections legitimately carry bare .ts
  // prose references (e.g. the Intentional transcript-delivery-check.ts mechanism-name refs) —
  // those are NOT preconditions and must NOT be counted here.
  const preEnd = (s) => s.indexOf("\n## ", s.indexOf("## Preconditions"));
  const pre = src.slice(src.indexOf("## Preconditions"), preEnd(src));
  assert.match(pre, /fast-mode-telemetry\.ts/, "the SOURCE precondition must still reference the source .ts (readable dev form)");
  const out = rewriteMarkdown(src);
  const preOut = out.slice(out.indexOf("## Preconditions"), preEnd(out));
  assert.doesNotMatch(preOut, /[a-zA-Z0-9_-]+\.ts/,
    "after packaging the precondition table must carry NO raw .ts reference (every one rewritten to the executable dist form)");
  assert.match(preOut, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/dist\/fast-mode-telemetry\.js/,
    "the precondition must reference the bundled, plugin-root-anchored form the packaged install lays down");
  assert.doesNotMatch(preOut, /plugin\/scripts\/dist\//,
    "AC-260: the packaged precondition must not carry a cwd-relative plugin/ prefix (the consuming project's plugin IS the tree root)");
});

test("AC5 — a BARE .ts token (no plugin/scripts/ prefix) is deliberately NOT rewritten (prose/mechanism-name references stay)", () => {
  // The task judged the cold-start precondition as a same-root dist-closure defect and fixed it via
  // the path form — NOT by teaching rewriteMarkdown to rewrite every bare `.ts` token (which would
  // corrupt the INTENTIONAL bare-name mechanism references, e.g. `transcript-delivery-check.ts` in
  // cold-start SKILL.md prose).
  const prose = "the mechanism `transcript-delivery-check.ts` is resolved by quay-init's laydown derivation";
  const out = rewriteMarkdown(prose);
  assert.ok(out.includes("transcript-delivery-check.ts"),
    "a bare-name .ts token without a plugin/scripts/ prefix must stay untouched");
});

// ── AC-260 (gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths) ──────────────────────
// Every reference the rewriter EMITS must resolve in a CONSUMING project: a plugin-level marketplace
// source supports no `path` parameter (publish-dist-branch.sh:106-107), so the dist-plugin branch's
// ROOT is the plugin — a repo-relative `plugin/scripts/…` there names `<plugin>/plugin/scripts/…`,
// which does not exist. Measured baseline before this task (2026-09-15, dist-plugin branch): 96 .md
// + 134 .sh + 30 .js = 260 references of that form, plus 11 `${CLAUDE_PLUGIN_ROOT}/scripts/X.ts`
// refs whose anchor was right but whose target the publish strip step (publish-dist-branch.sh:133)
// had deleted. Field order mirrors the goal criterion's BAD_RE exactly.
const CWD_RELATIVE_RE = /(^|[^A-Za-z0-9_${}.-])(\.?\/)?plugin\/(scripts|gate-scripts)\/dist\/[A-Za-z0-9_.-]+\.js/m;

test("AC1 — rewriteMarkdown anchors BOTH input shapes and emits no cwd-relative plugin/ prefix", () => {
  const input = [
    "node --experimental-strip-types plugin/scripts/task-status-drift-check.ts", // ① repo-relative, bare
    "| laid down | `<root>/plugin/scripts/fast-mode-telemetry.ts` exists |", // ① with a repo-root expr
    "call `${CLAUDE_PLUGIN_ROOT}/scripts/concurrent-batch-scheduler.ts` now", // ② anchor right, child stale
    "prose `plugin/gate-scripts/gate-script-base.ts`", // ① the gate-scripts branch
  ].join("\n");
  const out = rewriteMarkdown(input);
  for (const [name, kind] of [
    ["task-status-drift-check", "scripts"],
    ["fast-mode-telemetry", "scripts"],
    ["concurrent-batch-scheduler", "scripts"],
    ["gate-script-base", "gate-scripts"],
  ]) {
    assert.match(out, new RegExp(`\\$\\{CLAUDE_PLUGIN_ROOT\\}/${kind}/dist/${name}\\.js`),
      `${name} must take the plugin-root-anchored bundled form`);
  }
  assert.ok(!/<root>\$\{CLAUDE_PLUGIN_ROOT\}/.test(out),
    "no repo-root expression may survive in front of the anchor (that is the doubled, unresolvable form)");
  assert.doesNotMatch(out, CWD_RELATIVE_RE, "no cwd-relative plugin/ prefix may survive");
  assert.doesNotMatch(out, /\.ts\b/, "no raw .ts reference may survive when every target is bundled");
});

test("AC1 — negative control: a non-plugin path is left byte-identical (the anchor rule is not vacuous)", () => {
  const prose = "run node experiments/quay-perpetual-stream/scripts/drain-scheduler.ts and node packages/quay/bin/quay.js";
  assert.equal(rewriteMarkdown(prose), prose,
    "a dev-tree experiments/… or packages/… path names no plugin script and must survive verbatim");
});

test("AC1 — a plugin script that is NOT bundled keeps its raw .ts reference (no dist/ path is invented)", () => {
  // runner-static-gate.ts ships verbatim (publish-dist-branch.sh:130): it is the static-check
  // REGISTRY, a bash library, never a bundler entry — so dist/runner-static-gate.js does not exist
  // and rewriting to it would be exactly the referenced-not-landed defect this rewrite removes.
  const src = "node --experimental-strip-types plugin/scripts/runner-static-gate.ts";
  const guarded = rewriteMarkdown(src, () => false);
  assert.equal(guarded, src, "an unbundled plugin script must keep its raw .ts form AND its flag");
  // Positive control: the SAME input with the bundle present takes the anchored dist form — the
  // guard is the only difference, so the assertion above is about the guard, not about the input.
  assert.match(rewriteMarkdown(src, () => true),
    /^node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/dist\/runner-static-gate\.js$/);
});

test("AC1 — rewriteShell anchors repo-relative plugin/ refs too (the .sh half of the same defect)", () => {
  const out = rewriteShell('probe "x" "$REPO_ROOT/plugin/scripts/dist/transcript-delivery-check.js"\n');
  assert.match(out, /"\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/dist\/transcript-delivery-check\.js"/,
    "the .sh carriers must take the same anchored form as .md/.js");
  assert.doesNotMatch(out, CWD_RELATIVE_RE, "no cwd-relative plugin/ prefix may survive in shell text");
});

test("AC1 — checker-mutation-cases fixtures are NOT rewritten (their plugin/ means their OWN fake root)", () => {
  const dir = tmp();
  try {
    const fx = path.join(dir, "scripts", "checker-mutation-cases");
    fs.mkdirSync(fx, { recursive: true });
    fs.mkdirSync(path.join(dir, "scripts", "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "dist", "full-suite-runner.js"), "export const x = 1;\n", "utf8");
    // The fixture constructs its OWN throwaway `<workdir>/plugin/scripts/…` tree — a `plugin/` here
    // is that tree's root marker, NOT this plugin, so the anchor rule must not touch it.
    const body = 'cat > "${workdir}/plugin/scripts/full-suite-runner.ts" <<\'EOF\'\n';
    fs.writeFileSync(path.join(fx, "x.sh"), body, "utf8");
    assert.equal(rewriteInvokers(dir), 0, "fixture files must not be counted as rewritten invokers");
    assert.equal(fs.readFileSync(path.join(fx, "x.sh"), "utf8"), body,
      "the fixture must stay byte-identical — rewriting it re-points it at the installed plugin");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — deriveEntries DERIVES a script named by a ${CLAUDE_PLUGIN_ROOT}-anchored .md reference (the 5th blind-shape instance)", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(dir, "skills", "s"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "anchored-only.ts"), "export const x = 1;\n", "utf8");
    // The ONLY reference is the anchor-anchored, quoted spelling a shipped SKILL.md uses — the
    // node-invocation scan cannot reach it (`[^"\n]*?` excludes the opening quote), so if this rule
    // does not cover it, nothing derives the entry and publish's strip step deletes the raw .ts.
    const doc = path.join(dir, "skills", "s", "SKILL.md");
    fs.writeFileSync(doc, 'Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/anchored-only.ts"`\n', "utf8");
    assert.ok(deriveEntries(dir).scripts.includes("scripts/anchored-only.ts"),
      "an anchored .md path reference must derive its entry — no other scan form names it");
    // Negative control: the SAME filename as a bare prose token (no path prefix, no invocation)
    // names no entrypoint — the scan keys on the reference SHAPE, not on the filename appearing.
    fs.writeFileSync(doc, "the mechanism `anchored-only.ts` runs\n", "utf8");
    assert.ok(!deriveEntries(dir).scripts.includes("scripts/anchored-only.ts"),
      "a bare prose mention must not derive an entry (the rule is about the reference shape)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — the REAL plugin root derives the anchored-only SKILL.md entries (serial-fanin-absorb, routine-file-gate)", () => {
  const { scripts } = deriveEntries(PLUGIN_ROOT);
  for (const n of ["serial-fanin-absorb", "routine-file-gate"]) {
    assert.ok(scripts.includes(`scripts/${n}.ts`),
      `${n}.ts is named ONLY by a quoted ${"${CLAUDE_PLUGIN_ROOT}"}-anchored SKILL.md reference — ` +
      `without this rule publish deletes its raw .ts and the skill points at a file that never ships`);
  }
});

// ── gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs ────────────────────────────────
// The entry set was previously hand-maintained for Core references (CORE_REFERENCED, 2 items) and
// blind to table/list rows (`dist/<name>.js`) — so driver-runtime.ts and suite-execution-form-counter.ts
// never shipped, and `quay driver` died in any installed project. These tests pin the mechanical
// derivation (Core scan + dist reverse-lookup) and the fail-able reference-closure gate.

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..", "..", "plugin");

test("AC1/AC6 — deriveEntries DERIVES driver-runtime.ts from Core refs (no hand-maintained CORE_REFERENCED)", () => {
  const { scripts } = deriveEntries(PLUGIN_ROOT);
  assert.ok(scripts.includes("scripts/driver-runtime.ts"),
    "Core-referenced driver-runtime.ts (cli/driver.ts + plugin-root.ts KERNEL_RELS) must be a derived entry");
  // The former CORE_REFERENCED members must STILL be derived (mechanical, not dropped).
  assert.ok(scripts.includes("scripts/runtime-usage-inventory.ts"), "former CORE_REFERENCED member still derived");
  assert.ok(scripts.includes("scripts/task-status-drift-check.ts"), "former CORE_REFERENCED member still derived");
});

test("AC2 — deriveEntries DERIVES suite-execution-form-counter.ts from deliver-verify-usage.sh's dist/*.js table row", () => {
  const { scripts } = deriveEntries(PLUGIN_ROOT);
  assert.ok(scripts.includes("scripts/suite-execution-form-counter.ts"),
    "a table-row `dist/<name>.js` reference must reverse-lookup the same-named .ts into the entry set");
});

test("AC6 — scanCoreReferences derives driver-runtime.ts from Core source (the list is a scan expression, not a literal)", () => {
  const core = scanCoreReferences();
  assert.ok(core.has("driver-runtime.ts"), "Core scan must find the driver-runtime.ts reference");
  assert.ok(core.has("runtime-usage-inventory.ts"), "Core scan must find runtime-usage-inventory.ts");
  assert.ok(core.has("task-status-drift-check.ts"), "Core scan must find task-status-drift-check.ts");
});

test("AC5 — the closure gate takes false (removing an entry makes closureMissing flag it)", () => {
  // Positive control: a referenced bundle present in the tarball → closure holds.
  assert.deepEqual(
    closureMissing(["suite-execution-form-counter"], ["package/plugin/scripts/dist/suite-execution-form-counter.js"]),
    [],
    "a referenced bundle present in the tarball must satisfy the closure"
  );
  // Negative control: the SAME reference with the bundle absent → flagged (the gate is not恒绿).
  assert.deepEqual(
    closureMissing(["suite-execution-form-counter"], ["package/plugin/scripts/dist/other.js"]),
    ["suite-execution-form-counter"],
    "a referenced bundle absent from the tarball must be flagged missing"
  );
  // gate-scripts layout resolves too.
  assert.deepEqual(
    closureMissing(["gate-script-base"], ["package/plugin/gate-scripts/dist/gate-script-base.js"]),
    [],
    "a gate-scripts/dist/<name>.js entry must resolve under the gate-scripts layout"
  );
});

test("AC5 — a Core-referenced bundle (driver-runtime) is part of the closure; removing it flags red", () => {
  const required = [...scanCoreReferences()].map((t) => t.replace(/\.ts$/, ""));
  assert.ok(required.includes("driver-runtime"), "the closure's required set derives driver-runtime from Core source");
  const missing = closureMissing(required, ["package/plugin/scripts/dist/suite-execution-form-counter.js"]);
  assert.ok(missing.includes("driver-runtime"),
    "a tarball without dist/driver-runtime.js must be flagged (the gate sees Core's reference)");
});

// ── gap-driver-kinds-table-literal-not-in-dist-entry ────────────────────────────────────────────
// The entry set was blind to plugin SOURCE's own spawn references: driver-runtime.ts's DRIVER_KINDS
// `driver: "X.ts"` data-table fields (the 6 driver kinds) and its `path.join(…,"plugin","scripts",
// "X.ts")` spawn helpers (send-to-session.ts / ready-pool-check.ts). A third-party
// `quay driver start --kind promotion` resolves `<root>/plugin/scripts/promotion-driver.ts`, which
// never shipped → GOAL-009's `driver not found`. These tests pin the mechanical derivation
// (scanPluginSelfReferences over driver-runtime.ts) and the criterion's fail-ability.

const REQUIRED_DRIVER_KINDS = [
  "promotion-driver.ts",
  "worker-driver.ts",
  "outer-driver.ts",
  "quality-gate-driver.ts",
  "meta-driver.ts",
  "goal-driver.ts",
];

/** Replicate the AC-202 criterion's required-vs-shipped check (the goal file's inline script). */
function ac202Missing(pluginRoot) {
  const { scripts, gateScripts } = deriveEntries(pluginRoot);
  const shipped = new Set([...scripts, ...gateScripts].map((p) => p.split("/").pop()));
  const rt = fs.readFileSync(path.join(pluginRoot, "scripts", "driver-runtime.ts"), "utf8");
  const required = new Set();
  for (const x of rt.matchAll(/driver:\s*"([A-Za-z0-9_.-]+\.ts)"/g)) required.add(x[1]);
  for (const x of rt.matchAll(/"plugin",\s*"scripts",\s*"([A-Za-z0-9_.-]+\.ts)"/g)) required.add(x[1]);
  for (const x of rt.matchAll(/resolveKernelSibling\(\s*"([A-Za-z0-9_.-]+\.ts)"\s*\)/g)) required.add(x[1]);
  return [...required].filter((n) => !shipped.has(n));
}

test("AC1/AC3 — deriveEntries DERIVES the 6 driver kinds + send-to-session.ts from driver-runtime.ts (plugin-self scan)", () => {
  const { scripts } = deriveEntries(PLUGIN_ROOT);
  for (const n of [...REQUIRED_DRIVER_KINDS, "send-to-session.ts"]) {
    assert.ok(scripts.includes(`scripts/${n}`),
      `${n} (a driver-runtime.ts spawn) must be a derived entry`);
  }
  assert.ok(scripts.includes("scripts/ready-pool-check.ts"),
    "ready-pool-check.ts (defaultReadyPoolArgv) must be a derived entry");
  // The AC-202 criterion's own check: shipped ⊇ required → no missing → exit 0.
  assert.deepEqual(ac202Missing(PLUGIN_ROOT), [], "the AC-202 criterion must be satisfied (exit 0)");
});

test("AC5 — scanPluginSelfReferences derives by regex over driver-runtime.ts, not a literal list", () => {
  const self = scanPluginSelfReferences(PLUGIN_ROOT);
  assert.deepEqual([...self].sort(), [...REQUIRED_DRIVER_KINDS, "ready-pool-check.ts", "send-to-session.ts"].sort(),
    "the scan must return exactly the two regex forms' matches from driver-runtime.ts");
});

test("AC4 — negative control: the 6 drivers + send-to-session are NOT derivable from the Core scan alone (the scan is load-bearing)", () => {
  const core = scanCoreReferences();
  for (const n of [...REQUIRED_DRIVER_KINDS, "send-to-session.ts"]) {
    assert.ok(!core.has(n),
      `${n} must NOT be derivable from the Core scan — disabling the plugin-self scan leaves it missing (criterion exit 1)`);
  }
});

test("AC4 — negative control: the criterion takes false when a driver-runtime.ts reference names no shipped script", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    // A driver field naming a script that has no .ts file in the plugin root: the scan derives it
    // but the `existing` intersection drops it, so shipped lacks it while the criterion's required
    // set has it → missing → the criterion reports a defect rather than passing恒绿.
    fs.writeFileSync(path.join(dir, "scripts", "driver-runtime.ts"),
      'export const K = { promotion: { driver: "promotion-driver.ts" } };\n', "utf8");
    assert.deepEqual(ac202Missing(dir), ["promotion-driver.ts"],
      "a driver field whose target script does not exist must be reported missing (criterion exit 1)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — negative control: removing the driver field empties the derived set (the scan reads the source, not a hardcoded list)", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "driver-runtime.ts"),
      'export const K = { promotion: { driver: "promotion-driver.ts" } };\n', "utf8");
    assert.deepEqual([...scanPluginSelfReferences(dir)], ["promotion-driver.ts"],
      "a driver field must be derived");
    fs.writeFileSync(path.join(dir, "scripts", "driver-runtime.ts"), "export const K = {};\n", "utf8");
    assert.deepEqual([...scanPluginSelfReferences(dir)], [],
      "removing the driver field empties the derived set — the derivation is mechanical, not a literal");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-ac205-session-delivery-channel-transcript-confirmed ──────────────────────────────────────
// send-to-session.ts:53 does `await import("../../packages/quay/src/serve-send.ts")` — a dev-tree
// relative path. The shipped dist/send-to-session.js must be SELF-CONTAINED (serve-send inlined,
// no runtime dev-tree dynamic import), or the installed artifact (no packages/ source tree) fails at
// runtime with "共享投递模块不可用" (send-to-session.ts:134). esbuild inlines the dynamic import; the
// `packages/quay/src` tokens that remain in the bundle are esbuild's __esm/__commonJS lazy-init
// registry keys + source-boundary comments (shared by 15 of 76 bundles — meta-driver.js,
// worker-driver.js, …), NOT runtime imports. This test pins the ACTUAL failure mode: the bundle must
// carry sendSessionFrames (inlined) and zero runtime `import("...packages/quay/src...")` /
// `../../packages/quay/src` dev-tree relative path.
test("AC1 (AC-205) — bundled send-to-session.js is self-contained (serve-send inlined, no runtime dev-tree import)", async () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    // Copy send-to-session.ts to a NON-repo-root temp plugin root: its `../../packages/quay/src/`
    // dynamic import can then only resolve via coreSrcAliasPlugin (the dev-tree path does not exist
    // there — this is the STAGED-layout shape the alias plugin must cover).
    // ⛔ Copy the entry's SIBLINGS too — the staged layout ships every scripts/*.ts, and a static
    // `./…` import of one is only resolvable if it is present. Copying the entry alone made this
    // fixture quietly measure a DIFFERENT property ("the entry has no siblings"): when
    // send-to-session.ts adopted the shared arg helper
    // (`import { flagValue } from "./gate-script-base.ts"`, gap-routine-semantic-dedup-scan-arg-parsing-helper-family)
    // esbuild failed to resolve it — while the REAL build, which bundles from the full tree, was
    // verified green on the same commit. Derive the set from the real plugin root rather than listing
    // the one sibling, so a future adoption does not re-pin it.
    for (const e of fs.readdirSync(path.join(PLUGIN_ROOT, "scripts"), { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".ts")) {
        fs.copyFileSync(path.join(PLUGIN_ROOT, "scripts", e.name), path.join(dir, "scripts", e.name));
      }
    }
    const outfiles = await bundleEntries(dir, ["scripts/send-to-session.ts"]);
    assert.equal(outfiles.length, 1, "send-to-session.ts must bundle");
    const bundle = fs.readFileSync(outfiles[0], "utf8");
    assert.ok(bundle.includes("sendSessionFrames"),
      "serve-send.ts must be inlined (sendSessionFrames symbol present)");
    assert.ok(!/import\("[^"]*packages\/quay\/src/.test(bundle),
      "no runtime dynamic import of the dev-tree packages/quay/src may survive (self-contained)");
    assert.ok(!/\.\.\/\.\.\/packages\/quay\/src/.test(bundle),
      "the dev-tree relative path literal must not survive as a runtime reference");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-drivers-yml-interval-not-honored-for-routine-kinds ─────────────────────────────────────────
// The shipped bundles ran the WRONG tool's main. A module's "am I the entry?" guard written as FILE
// identity (`realpath(argv[1]) === import.meta.url`, `fileURLToPath(import.meta.url) === argv[1]`, …)
// is true for EVERY inlined module of a bundle (they share the bundle's import.meta.url). esbuild
// emits imports BEFORE importers, so the first such inlined guard wins: measured 2026-09-13,
// dist/{goal-driver,quality-gate-driver,meta-driver}.js all ran `pool-quality-judge`'s main, printed
// its JSON and exited 0 in <1s — so the supervisor respawned them every --restart-delay (5s) and the
// declared `drivers.yml <kind>.interval_ms` never entered the observed cadence. The tests below pin
// both halves: the static gate (nothing that hijacks may be packaged) and the product-surface
// behaviour (each driver bundle runs its own main).

test("AC1 — topLevelIfConditions reads top-level if conditions only, with balanced parens", () => {
  const text = [
    'if (a && f(b, g(c))) { x(); }',
    '  if (indented()) { y(); }',           // not top-level
    'const s = "if (notACondition) {";',   // inside a string literal, not column 0
    'if (d) { z(); }',
  ].join("\n");
  const conds = topLevelIfConditions(text);
  assert.deepEqual(conds, ["a && f(b, g(c))", "d"]);
});

test("AC1 — activeFileIdentityGuards: file-identity is ACTIVE, basename form is INERT (negative control)", () => {
  const dir = tmp();
  try {
    const bare = path.join(dir, "bare.ts");
    fs.writeFileSync(bare, 'import { isDirectEntry } from "./gate-script-base.ts";\nif (isDirectEntry(import.meta)) {\n  main();\n}\n');
    assert.equal(activeFileIdentityGuards(bare).length, 1,
      "a bare isDirectEntry(import.meta) guard must be ACTIVE (it fires for every inlined module)");

    const handRolled = path.join(dir, "hand.ts");
    fs.writeFileSync(handRolled, 'if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {\n  main();\n}\n');
    assert.equal(activeFileIdentityGuards(handRolled).length, 1,
      "a hand-rolled file-identity guard is the same hazard (it was a real offender)");

    const safe = path.join(dir, "safe.ts");
    fs.writeFileSync(safe, 'import { isDirectEntry } from "./gate-script-base.ts";\nif (isDirectEntry(import.meta, undefined, "safe")) {\n  main();\n}\n');
    assert.equal(activeFileIdentityGuards(safe).length, 0,
      "the named form is bundler-safe and must NOT be flagged (the predicate can take false)");

    // A module that DEFINES its own isDirectEntry is not the shared helper's hazard — two real
    // modules do this (workflow-event-schema.mjs / precommit-guard.ts) and are name-based/inert.
    const localDef = path.join(dir, "local.ts");
    fs.writeFileSync(localDef, 'function isDirectEntry(argv1) { return basename(argv1 || process.argv[1]) === "local"; }\nif (isDirectEntry()) {\n  main();\n}\n');
    assert.equal(activeFileIdentityGuards(localDef).length, 0,
      "a locally-defined guard is judged by its own definition, not by the shared helper's arity");

    const beltAndBraces = path.join(dir, "bb.ts");
    fs.writeFileSync(beltAndBraces, 'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && path.basename(process.argv[1]).replace(/\\.(?:js|ts|mjs)$/, "") === "bb") {\n  main();\n}\n');
    assert.equal(activeFileIdentityGuards(beltAndBraces).length, 0,
      "a file-identity condition that ALSO compares a basename to a literal is inert under bundling");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — the shipped plugin surface carries ZERO inlined entry-guard hijacks", () => {
  const hijacks = findEntryGuardHijacks(PLUGIN_ROOT);
  assert.deepEqual(hijacks, [],
    `every shipped entry must run its OWN main; these inlined modules would hijack it:\n` +
    hijacks.map((h) => `  ${h.entry} <- ${h.module} :: ${h.condition}`).join("\n"));
});

test("AC1 — negative control: the hijack gate TAKES FALSE (a synthetic inlined bare guard is flagged)", () => {
  const dir = tmp();
  try {
    // Named after a QUAY_INIT_EXPLICIT member so deriveEntries() picks it up as a real entry.
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "gate-script-base.ts"),
      'import { helper } from "./helper.ts";\nexport function isDirectEntry(_m, _a, b) { return b === "x"; }\nhelper();\n');
    fs.writeFileSync(path.join(dir, "scripts", "helper.ts"),
      'import { isDirectEntry } from "./gate-script-base.ts";\nif (isDirectEntry(import.meta)) {\n  console.log("hijacked");\n}\n');
    const hijacks = findEntryGuardHijacks(dir);
    assert.equal(hijacks.length, 1, "the gate must flag the synthetic inlined bare guard (it is not vacuous)");
    assert.equal(hijacks[0].module, "scripts/helper.ts");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — the shipped scripts surface carries ZERO unnamed (dead) entry guards", () => {
  const dead = findUnnamedEntryGuards(PLUGIN_ROOT);
  assert.deepEqual(dead, [],
    `expectedBase is REQUIRED, so these top-level blocks can never fire (main() never runs; the ` +
    `process exits 0 with no output — a silent no-op that reads exactly like a pass):\n` +
    dead.map((d) => `  ${d.module} :: ${d.condition}`).join("\n"));
});

test("AC1 — negative control: the unnamed-guard gate TAKES FALSE (bare form flagged, named + local-def not)", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    const write = (name, body) => fs.writeFileSync(path.join(dir, "scripts", name), body);

    // POSITIVE: imports the SHARED helper and calls it with 1 argument — dead after the signature change.
    write("bare.ts", 'import { isDirectEntry } from "./gate-script-base.ts";\nif (isDirectEntry(import.meta)) {\n  main();\n}\n');
    // POSITIVE: the 2-argument form is just as dead (it omits expectedBase too).
    write("twoarg.ts", 'import { isDirectEntry } from "./gate-script-base.ts";\nif (isDirectEntry(import.meta, process.argv[1])) {\n  main();\n}\n');
    // NEGATIVE: the named form.
    write("named.ts", 'import { isDirectEntry } from "./gate-script-base.ts";\nif (isDirectEntry(import.meta, undefined, "named")) {\n  main();\n}\n');
    // NEGATIVE: a module that DEFINES its own isDirectEntry decides its own arity.
    write("local.ts", 'function isDirectEntry(argv1) { return basename(argv1 || process.argv[1]) === "local"; }\nif (isDirectEntry()) {\n  main();\n}\n');
    // NEGATIVE: does not import the shared helper at all.
    write("plain.ts", 'if (isDirectEntry(import.meta)) {\n  main();\n}\n');
    // NEGATIVE: fixture dirs are out of scope — checker-mutation-cases embeds the anti-pattern on purpose.
    fs.mkdirSync(path.join(dir, "scripts", "checker-mutation-cases"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "checker-mutation-cases", "x.ts"),
      'import { isDirectEntry } from "./gate-script-base.ts";\nif (isDirectEntry(import.meta)) {\n  main();\n}\n');

    const dead = findUnnamedEntryGuards(dir);
    assert.deepEqual(dead.map((d) => d.module).sort(), ["scripts/bare.ts", "scripts/twoarg.ts"],
      "only the shared-helper calls with fewer than 3 arguments are dead guards");

    // An UNREADABLE module must be reported, not skipped: "nothing was examined" and "every guard is
    // named" both come back as an empty list, and only one of them is a pass (硬規則 3b).
    fs.symlinkSync(path.join(dir, "does-not-exist.ts"), path.join(dir, "scripts", "dangling.ts"));
    const withDangling = findUnnamedEntryGuards(dir);
    assert.deepEqual(withDangling.map((d) => d.module).sort(), ["scripts/bare.ts", "scripts/dangling.ts", "scripts/twoarg.ts"]);
    assert.match(withDangling.find((d) => d.module === "scripts/dangling.ts").condition, /NOT-EVALUATED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-dist-closure-missing-driver-anchor-js ────────────────────────────────────────────────────
// The 4th instance of "the entry set is blind to a reference SHAPE". driver-runtime.ts's
// preferredAnchorKernel() resolves the anchor as a sibling of a **directory VARIABLE**
// (`path.join(here, "driver-anchor.ts")` / `path.join(mainDir, "driver-anchor.js")`) — no literal
// path segment for any of the earlier scans to key on — so driver-anchor.ts never became an entry,
// `dist/driver-anchor.js` never entered the artifact, and in EVERY installed/packaged layout
// `quay driver start --kind <any>` died at spawnAnchor with "driver-anchor module not found next to
// driver-runtime" (rc=1). Structurally invisible to this repo's own tests: the DEV tree resolves the
// raw .ts sibling that the artifact had deleted. Measured before this task: deriveEntries = 88
// entries, driver-anchor absent.
//
// The tests below pin BOTH halves of the task's DoD: the derivation catches the SHAPE (not the
// filename), and the packaged artifact really starts a driver — a file-existence assertion alone is
// the weaker instrument the task explicitly rejects (a truncated/incompatible file also "exists").

test('AC1/AC2 — scanPluginSiblingReferences derives modules resolved as path.join(<dirExpr>, "X.ts") — the SHAPE, not the filename', () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    // The defect form (a directory VARIABLE, optionally via one call) + the installed-layout twin.
    fs.writeFileSync(path.join(dir, "scripts", "kernel.ts"), [
      'const here = path.dirname(kernelSelfPath());',
      'const a = path.join(here, "sibling-module.ts");',
      'const b = path.join(mainDir, "installed-only.js");',
      'const c = path.join(path.dirname(kernelSelfPath()), "one-call.ts");',
      // NOT this shape: a literal path-segment join (covered by the literal scans; its `,` in the
      // first argument is exactly what keeps this rule false-positive-free — the BASH file
      // runner-static-gate.ts is read as TEXT through `path.join(root,"plugin","scripts",…)`).
      'const d = path.join(root, "plugin", "scripts", "literal-seg.ts");',
      // NOT this shape either: an expression that is not a directory variable.
      'const e = path.join(someVar + "/x", "expression-dir.ts");',
    ].join("\n"), "utf8");
    for (const n of ["sibling-module.ts", "installed-only.ts", "one-call.ts", "literal-seg.ts", "expression-dir.ts"]) {
      fs.writeFileSync(path.join(dir, "scripts", n), "export const x = 1;\n", "utf8");
    }
    assert.deepEqual([...scanPluginSiblingReferences(dir)].sort(),
      ["installed-only.ts", "one-call.ts", "sibling-module.ts"],
      "the scan must derive directory-variable sibling joins (.ts and .js forms), and must NOT match literal-segment or non-dirExpr joins");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — the scan is LOAD-BEARING in deriveEntries (a synthetic root loses the module when the join is not the dirExpr shape)", () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    const kernel = (joinExpr) => `const a = ${joinExpr};\nexport const k = 1;\n`;
    fs.writeFileSync(path.join(dir, "scripts", "sib.ts"), "export const s = 1;\n", "utf8");
    fs.writeFileSync(path.join(dir, "scripts", "kernel.ts"), kernel('path.join(here, "sib.ts")'), "utf8");
    assert.ok(deriveEntries(dir).scripts.includes("scripts/sib.ts"),
      "a module named by the dirExpr sibling join must be a derived entry");
    // Same module, same file, reference spelled so it is NOT this shape ⇒ nothing derives it.
    fs.writeFileSync(path.join(dir, "scripts", "kernel.ts"), kernel('path.join(here + "/x", "sib.ts")'), "utf8");
    assert.ok(!deriveEntries(dir).scripts.includes("scripts/sib.ts"),
      "the entry must disappear when the reference is not a dirExpr sibling join — the scan is the only thing naming it");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — the reference closure on the REAL plugin root derives + requires driver-anchor (the missed entry)", () => {
  assert.ok(scanPluginSiblingReferences(PLUGIN_ROOT).has("driver-anchor.ts"),
    "driver-runtime.ts's `path.join(here, \"driver-anchor.ts\")` must be derived");
  const { scripts, gateScripts } = deriveEntries(PLUGIN_ROOT);
  assert.ok(scripts.includes("scripts/driver-anchor.ts"),
    "driver-anchor.ts must be in the derived entry set (before this task: 88 entries, absent)");
  // Fails-ability at the GATE: the closure now requires dist/driver-anchor.js — an artifact without
  // it fails package.sh instead of shipping broken.
  const required = [...scripts, ...gateScripts].map((p) => path.basename(p).replace(/\.ts$/, ""));
  assert.ok(closureMissing(required, ["package/plugin/scripts/dist/other.js"]).includes("driver-anchor"),
    "the dist-closure gate must flag a tarball that lacks dist/driver-anchor.js");
  // The pre-fix BLINDNESS, mechanically: no other derivation form names it (that is why the shape
  // scan is load-bearing rather than a duplicate of an existing rule).
  const otherForms = new Set([...scanCoreReferences(), ...scanPluginSelfReferences(PLUGIN_ROOT)]);
  assert.ok(!otherForms.has("driver-anchor.ts"),
    "no earlier scan form may name driver-anchor.ts — if one does, this task's rule is not what fixes it");
});

// ── the packaged ARTIFACT (not a fixture): build the real dist closure, run the real driver start.
// Staging mirrors package.sh: raw .ts sources → bundled dist/<name>.js, node_modules resolvable (the
// staged copy lives outside the repo, so link the repo's), and the kernel run FROM its dist form —
// which is what makes the defect reachable at all (a dev-tree run resolves the raw .ts sibling).
// The returned stage is the caller's to rmSync (each call site cleans it in a finally).
async function buildStagedClosure(prefix) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const d of ["scripts", "gate-scripts"]) {
    const src = path.join(PLUGIN_ROOT, d);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(stage, d), { recursive: true, filter: (p) => !/(^|\/)dist(\/|$)/.test(p) });
  }
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(stage, "node_modules"), "dir");
  const { scripts, gateScripts } = deriveEntries(stage);
  await bundleEntries(stage, [...scripts, ...gateScripts]);
  return stage;
}

/** A workspace whose ONLY driver kind is a fake promotion driver (the same seam driver-anchor.test.mjs
 *  uses): the loop writes the kind's `pidSelf` readiness marker and then idles, so `driver start`'s
 *  confirmation is deterministic and no production dispatch logic runs against the fixture root. */
function fakePromotionWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "dist-closure-ws-"));
  const scripts = path.join(ws, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(scripts, "promotion-driver.ts"), [
    'import fs from "node:fs";',
    'import path from "node:path";',
    "export async function main(argv) {",
    "  const args = argv.slice(2);",
    '  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };',
    '  const root = get("--root");',
    '  const pidFile = get("--pid-file");',
    '  if (pidFile) fs.writeFileSync(pidFile, String(process.pid) + "\\n", "utf8");',
    '  const carrier = path.join(root, ".quay", "promotion-round.jsonl");',
    "  for (;;) {",
    '    try { fs.appendFileSync(carrier, JSON.stringify({ ts: Date.now() }) + "\\n"); } catch {}',
    "    await new Promise((r) => setTimeout(r, 150));",
    "  }",
    "}",
    "",
  ].join("\n"), "utf8");
  return ws;
}

function startDriver(distDir, ws) {
  return spawnSync(process.execPath, ["--no-warnings", path.join(distDir, "driver-runtime.js"),
    "start", "--kind", "promotion", "--root", ws, "--confirm-timeout", "20"], {
    encoding: "utf8",
    timeout: 180_000,
    // QUAY_PLUGIN_ROOT = the fixture's plugin dir (where the fake kind module lives).
    // QUAY_ANCHOR_SHUTDOWN_GRACE_MS is the documented test seam (production value is 120s): it makes
    // the anchor's bounded shutdown deterministic.
    env: { ...process.env, QUAY_PLUGIN_ROOT: path.join(ws, "plugin"), QUAY_ANCHOR_SHUTDOWN_GRACE_MS: "3000" },
  });
}

/** The anchor runs DETACHED (production requirement: it outlives the CLI). Kill it by its own pid
 *  carrier — the fake kind loop does not observe stop requests, so SIGKILL is the bounded teardown. */
function killAnchor(ws) {
  const p = path.join(ws, ".quay", "anchor.pid");
  if (!fs.existsSync(p)) return;
  const pid = Number(fs.readFileSync(p, "utf8").trim());
  if (Number.isInteger(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
}

test("AC5 — the packaged dist closure STARTS A DRIVER for real (driver-runtime.js from dist, rc=0, host=anchor)", async () => {
  const stage = await buildStagedClosure("dist-closure-stage-");
  const ws = fakePromotionWorkspace();
  try {
    const dist = path.join(stage, "scripts", "dist");
    // The artifact carries the bundle at all — the entry the closure used to miss.
    assert.ok(fs.existsSync(path.join(dist, "driver-anchor.js")),
      `the built closure must carry dist/driver-anchor.js (got: ${fs.readdirSync(dist).filter((f) => /anchor/.test(f)).join(", ") || "no anchor bundle"})`);
    const r = startDriver(dist, ws);
    const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    assert.doesNotMatch(out, /cannot spawn driver anchor/,
      `the packaged kernel must find its anchor sibling; got:\n${out}`);
    assert.equal(r.status, 0, `quay driver start must succeed on the packaged artifact. Output:\n${out}`);
    assert.match(r.stdout ?? "", /started: anchor pid=\d+ kind=promotion host=anchor|"host":"anchor"/,
      `driver start must report the anchor-hosted loop ready:\n${out}`);
  } finally {
    killAnchor(ws);
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  }
});

test("AC5 — negative control: the SAME packaged artifact minus dist/driver-anchor.js reproduces the production failure (rc=1 + the exact error)", async () => {
  const stage = await buildStagedClosure("dist-closure-noanchor-");
  const ws = fakePromotionWorkspace();
  try {
    const dist = path.join(stage, "scripts", "dist");
    fs.rmSync(path.join(dist, "driver-anchor.js"));
    const r = startDriver(dist, ws);
    const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    assert.equal(r.status, 1, `an artifact whose closure dropped the anchor must fail closed. Output:\n${out}`);
    assert.match(out, /driver-anchor module not found next to driver-runtime/,
      `the production failure signature must be reproduced verbatim:\n${out}`);
  } finally {
    killAnchor(ws);
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  }
});

test("AC1 — product surface: each driver bundle runs its OWN main (routine kinds + controls)", async () => {
  const { build } = await import("esbuild");
  const dir = tmp();
  try {
    // Each tool's own HELP banner is the identity marker; the hijacker's banner is the negative.
    const cases = [
      ["goal-driver", "goal 机械环例程型 driver"],
      ["quality-gate-driver", "AC144"],
      ["meta-driver", "机制演进的观测/提案例程"],
      ["outer-driver", "AC143"],
      ["promotion-driver", "AC130"],
      ["worker-driver", "SPEC §5 阶段 2+3+4"],
    ];
    for (const [name, marker] of cases) {
      const outfile = path.join(dir, `${name}.js`);
      await build({
        entryPoints: [path.join(PLUGIN_ROOT, "scripts", `${name}.ts`)],
        bundle: true, platform: "node", format: "esm", outfile,
        loader: { ".json": "json" }, banner: { js: REQUIRE_BANNER }, logLevel: "silent",
      });
      const r = spawnSync(process.execPath, [outfile, "--help"], { encoding: "utf8", timeout: 120_000 });
      const probe = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
      assert.ok(!probe.includes("pool 任务质量语义闸"),
        `${name}.js must not run the inlined pool-quality-judge main (that is the hijack signature)`);
      assert.ok(probe.includes(marker),
        `dist/${name}.js must run its OWN main — expected marker ${JSON.stringify(marker)} in its output`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
