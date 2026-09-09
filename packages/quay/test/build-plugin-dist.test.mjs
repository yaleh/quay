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
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  rewriteMarkdown,
  rewriteShell,
  rewriteInvokers,
  deriveEntries,
  scanCoreReferences,
  scanPluginSelfReferences,
  closureMissing,
  bundleEntries,
} from "../scripts/build-plugin-dist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tmp(prefix = "build-plugin-dist-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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
test("AC-workflows — rewriteInvokers rewrites plugin/workflows/*.js plugin/scripts/X.ts refs to dist/X.js", () => {
  const dir = tmp();
  try {
    const wfDir = path.join(dir, "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
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
    assert.ok(out.includes("plugin/scripts/dist/anti-drift-touches-check.js"),
      "the node --experimental-strip-types invocation must point at the dist bundle");
    assert.ok(out.includes("plugin/scripts/dist/per-task-suite-record.js"),
      "the comment reference must point at the dist bundle");
    assert.ok(!out.includes("anti-drift-touches-check.ts"),
      "no plugin/scripts/*.ts reference may survive in the shipped workflow");
    assert.ok(out.includes("experiments/quay-perpetual-stream/scripts/drain-scheduler.ts"),
      "a dev-repo experiments/...ts path (not a plugin mechanism) must be left untouched");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC5: rewriteMarkdown rewrites the cold-start SKILL.md PRECONDITION's path form ─────────────────
test("AC5 — rewriteMarkdown rewrites the cold-start precondition plugin/scripts/fast-mode-telemetry.ts to the dist form", () => {
  const precondition =
    "| loop mechanism laid down | `<root>/plugin/scripts/session-liveness.sh`, `<root>/plugin/scripts/fast-mode-telemetry.ts` exist |";
  const out = rewriteMarkdown(precondition);
  assert.ok(out.includes("<root>/plugin/scripts/dist/fast-mode-telemetry.js"),
    "the precondition's .ts reference must become the bundled executable form the packaged install lays down");
  assert.ok(!out.includes("fast-mode-telemetry.ts"),
    "no raw .ts reference may survive the precondition after packaging");
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
  assert.match(preOut, /plugin\/scripts\/dist\/fast-mode-telemetry\.js/,
    "the precondition must reference the bundled executable form the packaged install lays down");
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
    fs.copyFileSync(path.join(PLUGIN_ROOT, "scripts", "send-to-session.ts"), path.join(dir, "scripts", "send-to-session.ts"));
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
