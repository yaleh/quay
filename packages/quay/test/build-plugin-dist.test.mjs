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
