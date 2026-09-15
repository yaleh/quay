// build-plugin-dist.mjs — gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact.
//
// Bundle the plugin's consumer-referenced TypeScript into per-entry ESM `dist/<name>.js`
// files, mirroring Core's own bundling (packages/quay/scripts/build-dist.mjs:
// bundle:true, platform:"node", format:"esm", createRequire banner for yaml's CJS-interop shim).
//
// WHY (human ruling 2026-08-06 17:0xZ): the shipped npm-pack artifact must carry "a small number
// of executable files", not 80 raw .ts that every invocation strips via
// `node --experimental-strip-types` (the consumer's Node must support that flag). Core is already
// bundled (`package/dist/quay.js`) and the vendored runtimes are already bundled
// (`package/plugin/vendor/*/dist/*.js`) — plugin/scripts was the one unbundled island.
//
// WHAT is bundled: every plugin .ts that a shipped invoker references by path or bare name —
// loop tick docs, skills, probes, .sh wrappers, quay-init's explicit mechanism additions,
// Core's mcp-server instrument entry, and the plugin source's OWN spawns (driver-runtime.ts's
// DRIVER_KINDS `driver: "X.ts"` table fields + `path.join(…,"plugin","scripts","X.ts")` helpers +
// `resolveKernelSibling("X.ts")` calls, AND — gap-dist-closure-missing-driver-anchor-js — modules
// resolved as a sibling of a directory VARIABLE, `path.join(<dirExpr>, "X.ts")`, which carries no
// literal path segment for the other scans to key on: see scanPluginSiblingReferences).
// The entry set is DERIVED at build time by scanning the shipped surface for `<name>.ts` basenames
// that match an existing plugin .ts — never a hand-maintained list: when a new tool is referenced
// by a tick doc/skill the next package.sh run bundles it. Libraries (gate-script-base.ts,
// task-schema.ts, touches-parser.ts, …) are therefore bundled too (quay-init's mechanism layout
// still lists them as transitive deps); standalone execution of a library bundle is a no-op, but
// every rewritten reference resolves to a shipped executable.
//
// OUTPUT: <pluginRoot>/scripts/dist/<name>.js and <pluginRoot>/gate-scripts/dist/<name>.js.
// The bundles are ESM and run on a bare Node >=20 with NO --experimental-strip-types.
//
// Invoked by scripts/package.sh (after staging plugin/ into packages/quay/plugin/), and runnable
// standalone:
//   node --experimental-strip-types packages/quay/scripts/build-plugin-dist.mjs [pluginRoot]

import * as esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const DEFAULT_PLUGIN_ROOT = path.resolve(pkgDir, "..", "..", "plugin");

// Load-bearing banner (identical rationale to Core's build-dist.mjs): yaml's CJS-interop shim
// performs a dynamic require() that an ESM esbuild bundle cannot satisfy without a real `require`
// in scope. cap-from-gate.ts / read-probe-spec.ts / drivable-workspace-check.ts import yaml, so
// the banner is required for the bundles to boot on bare Node.
export const REQUIRE_BANNER =
  'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);';

// Directories of the shipped surface scanned for `<name>.ts` references. The consumer surface =
// the shipped docs + shell wrappers + quay-init's mechanism lists that actually reference plugin
// tools by path or bare name.
const CONSUMER_DIRS = ["skills", "loop", "probes", "agents", "workflows", "scripts", "gate-scripts"];

// A `<name>.ts` basename that appears in an INVOCATION context — after `node [flags]`, inside
// `gate_delegate_ts "<name>.ts"`, or after a `${SCRIPT_DIR}` / `$(dirname "$0")` path prefix.
// This deliberately EXCLUDES prose mentions and catalogs (capability-catalog.sh documents every
// instrument as `[name.ts]="…"` with no invocation prefix — those are NOT entrypoints).
// The basename is intersected with existing plugin .ts files, so references to experiments/ or
// docs/ .ts are ignored.
const INVOCATION_RE =
  /node\s+(?:--[a-z-]+\s+)*[^"\n]*?([A-Za-z0-9_.-]+\.ts)|gate_delegate_ts\s+"([A-Za-z0-9_.-]+\.ts)"|(?:\$\{SCRIPT_DIR\}|\$SCRIPT_DIR|\$\(dirname "\$0"\))\/[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+\.ts)|(?:\$\{SCRIPT_DIR\}|\$SCRIPT_DIR|\$\(dirname "\$0"\))\/([A-Za-z0-9_.-]+\.ts)/g;

// In markdown docs the probes/skills ALSO invoke tools by a PATH-PREFIXED `<name>.ts` reference
// with no reachable `node`-prefix match (e.g. probes/architecture-analysis.md lists
// `plugin/scripts/git-lens-l-d-code-doc-ratio.ts <base> <head>` as a runnable line; the skills run
// them as `node "${CLAUDE_PLUGIN_ROOT}/scripts/X.ts"`, which INVOCATION_RE's first branch cannot
// reach because `[^"\n]*?` excludes the opening quote and the basename must follow immediately).
// Every `.ts` path-prefixed in a shipped .md is a reference that must resolve after the raw .ts are
// removed, so it is an entry regardless of anchor spelling: BOTH spellings are the same reference
// shape, and covering only the repo-relative one is what left `serial-fanin-absorb.ts` and
// `routine-file-gate.ts` (loop-driver / routines) missing from the bundle set — publish's strip
// step then deleted their raw .ts and the skills pointed at files that never shipped. Measured
// 2026-09-15 on the artifact: those two are the dangling refs AC-260 reports once the cwd-relative
// offenders are gone. Fifth instance of "the entry set is blind to a reference SHAPE"
// (gap-dist-closure-missing-driver-anchor-js was the fourth) — the shape, not the filename.
// Deliberately `.md`-only (the caller gates on the extension): a fixture .sh that spells a checker
// path with a shell variable is a hermetic harness, not a shipped invoker.
const MD_PATH_PREFIXED_RE =
  /(?:\$\{CLAUDE_PLUGIN_ROOT\}\/|plugin\/)(scripts|gate-scripts)\/([A-Za-z0-9_.-]+\.ts)/g;

// Core code (packages/quay/src) spawns plugin .ts by relative path and ships inside dist/quay.js —
// cli/driver.ts + plugin-root.ts's KERNEL_RELS anchor reference driver-runtime.ts, mcp-server.ts
// references runtime-usage-inventory.ts, observation.ts references task-status-drift-check.ts,
// serve-send.ts references transcript-delivery-check.ts. These must resolve to a shipped executable
// after the raw .ts are removed, so every Core-referenced plugin .ts is an entry. The set is DERIVED
// by scanning Core's source for the SPAWN form only — `path.join("scripts", "X.ts")` /
// `path.join("plugin", "scripts", "X.ts")` (never a hand-maintained list — the former
// CORE_REFERENCED list silently missed driver-runtime.ts). ⛔ Deliberately NOT the prose/comment
// `plugin/scripts/X.ts` mention: some dev-repo-only scripts (e.g. meta-driver.ts) import Core source
// via `../../packages/quay/src/…` relative paths that resolve ONLY in the repo-root layout and break
// esbuild in the staged packages/quay/plugin/ layout — a comment mention is not a runtime spawn.
const CORE_SRC_DIR = path.resolve(pkgDir, "src");
const CORE_PATH_JOIN_TS_RE = /path\.join\([^)]*"scripts"[^)]*"([A-Za-z0-9_.-]+\.ts)"/g;

// A shipped table/list row that names a bundled entry by its dist path (`dist/<name>.js`), e.g.
// deliver-verify-usage.sh's VERIFY_SET row `"suite-execution-form-counter|js|dist/suite-execution-form-counter.js|…"`.
// Reverse-looked-up to the same-named `.ts` (if it exists) so the entry ships as `dist/<name>.js`.
const DIST_JS_RE = /dist\/([A-Za-z0-9_.-]+)\.js/g;

// Plugin source spawns ITSELF in literal forms that none of the other scans cover — they are
// not in Core source (so scanCoreReferences misses them) and carry no `node ` invocation prefix
// (so INVOCATION_RE misses them). All live in driver-runtime.ts, and a third-party
// `quay driver start --kind X` resolves them by path:
//   1. the DRIVER_KINDS data table's `driver: "X.ts"` field — the spawn target of each driver kind
//      (`quay driver start --kind promotion` → `<root>/plugin/scripts/promotion-driver.ts`), a
//      string-literal data table esbuild never inlines into the caller's bundle;
//   2. a `path.join(…, "plugin", "scripts", "X.ts")` spawn helper (notifyManager → send-to-session.ts,
//      defaultReadyPoolArgv → ready-pool-check.ts) — the PRE-AC-203 form, migrated off in
//      gap-driver-runtime-driver-path-anchored-at-project-root-not-dist;
//   3. a `resolveKernelSibling("X.ts")` call (the AC-203 form — the kernel resolves sibling scripts
//      relative to its OWN install location, not opts.root; notifyManager → send-to-session.ts,
//      defaultReadyPoolArgv → ready-pool-check.ts). Kept alongside form 2 so the scan stays
//      derivation-complete across the migration.
// The scan is SCOPED to driver-runtime.ts — the file the AC-202 criterion itself reads — because the
// broad `"plugin", "scripts", "X.ts"` literal ALSO matches non-spawn readFile text-reads elsewhere
// (axis-generator.ts / precommit-guard.ts / rhythm-consumer-check.ts read runner-static-gate.ts — a
// bash script deliberately named `.ts` so the annotation parsers see it — as TEXT; bundling it as an
// esbuild entry is a syntax error). The criterion is the single judge, and it enumerates
// driver-runtime.ts only. Both forms are DERIVED by regex (never a hand-maintained list).
const PLUGIN_DRIVER_FIELD_RE = /driver:\s*"([A-Za-z0-9_.-]+\.ts)"/g;
const PLUGIN_PATH_JOIN_TS_RE = /"plugin",\s*"scripts",\s*"([A-Za-z0-9_.-]+\.ts)"/g;
const PLUGIN_SIBLING_RESOLVER_RE = /resolveKernelSibling\(\s*"([A-Za-z0-9_.-]+\.ts)"\s*\)/g;

// ── the SIBLING-OF-A-DIRECTORY-VARIABLE reference form (4th instance of "the closure scan is blind
//    to a reference SHAPE") ────────────────────────────────────────────────────────────────────────
// gap-dist-closure-missing-driver-anchor-js. Every scan above keys on a LITERAL path segment
// (`"plugin"`, `"scripts"`, `$SCRIPT_DIR`, `dist/<name>.js`, `resolveKernelSibling("…")`). A module
// resolved at runtime as a sibling of a **directory VARIABLE** —
// `path.join(here, "driver-anchor.ts")` / `path.join(mainDir, "driver-anchor.js")` in
// driver-runtime.ts's preferredAnchorKernel() — carries no literal segment at all, so it matched
// none of them: driver-anchor.ts was never an entry, the dist closure never carried
// `dist/driver-anchor.js`, and in ANY installed/packaged layout `quay driver start --kind <任何>`
// died at `spawnAnchor` with "driver-anchor module not found next to driver-runtime" (rc=1). The
// direct量 in that failure is a FILE, which is why no test in the source tree could see it — the
// dev tree resolves the .ts sibling that the artifact had deleted.
//
// The fix is the SHAPE, not the filename (硬規則 5b: the previous three instances — Core spawn refs,
// dist-table rows, driver-runtime's own spawn refs — were each fixed only where the defect surfaced):
// a 2-argument `path.join(<dirExpr>, "<name>.ts")` names a module that must ship as its sibling
// `dist/<name>.js`. Any future `path.join(SOME_DIR, "x.ts")` is captured by the same rule.
//
// ⛔ The DIR EXPRESSION is restricted to a dotted identifier path, optionally with ONE call —
// `here`, `SCRIPT_DIR`, `mainDir`, `resolveKernelScriptsDir()`, `path.dirname(x)` — i.e. a variable
// (or a call) holding a directory. That restriction is what keeps the rule false-positive-free:
// `path.join(root, "plugin", "scripts", "X.ts")` cannot match (the expression must be a single
// identifier-led term, so `"plugin"` — a string literal — is not one, and the `"X.ts"` alternative
// then lands where `"plugin"` sits), so the non-module readFile targets that forced the
// driver-runtime.ts scoping above (`runner-static-gate.ts`, a BASH file deliberately named `.ts`, read
// as TEXT) are not dragged in. Measured over the whole plugin source (scripts/ + gate-scripts/):
// exactly two basenames match — driver-anchor.ts (the defect) and fast-mode-telemetry.ts (already an
// entry). A future match against a non-module file fails LOUDLY at the esbuild step (a .sh parsed as
// TS is a syntax error ⇒ package.sh exits 1), never silently.
//
// The `.js` half is the same shape seen from the INSTALLED side: the artifact probes
// `path.join(here, "X.js")`, so a `.js`-only sibling probe names `X.ts` too (reverse-mapped; ignored
// when no such `.ts` exists — the caller intersects with the plugin tree).
const SIBLING_DIR_EXPR = String.raw`[A-Za-z_$][A-Za-z0-9_$.]*(?:\([^;]*?\))?(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*`;
const PLUGIN_SIBLING_JOIN_TS_RE = new RegExp(
  String.raw`path\.join\(\s*${SIBLING_DIR_EXPR}\s*,\s*"([A-Za-z0-9_.-]+\.ts)"\s*\)`,
  "g"
);
const PLUGIN_SIBLING_JOIN_JS_RE = new RegExp(
  String.raw`path\.join\(\s*${SIBLING_DIR_EXPR}\s*,\s*"([A-Za-z0-9_.-]+\.js)"\s*\)`,
  "g"
);

// quay-init.sh's EXPLICIT mechanism additions (plugin/scripts/quay-init.sh `derive_loop_scripts`
// step (c)) name .ts files by BARE basename with no invocation prefix. These must ship as
// executable bundles so quay-init's lay-down set resolves after the raw .ts are removed. The list
// is a copy of that function's explicit additions — a source-repo mirror, kept in lockstep.
const QUAY_INIT_EXPLICIT = [
  "inner-idle-log.ts",
  "it0-split-or-commit-check.ts",
  "gate-script-base.ts",
  "workflow-event-schema.mjs", // .mjs — not bundled, included for completeness (unused here)
  "task-schema.ts",
  "touches-parser.ts",
  "wiring-coverage-check.ts",
  "l1-delivery-surface-check.ts",
];

/** Walk a dir, return all file paths (recursive). */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Derive the set of plugin `.ts` basenames referenced by Core source (packages/quay/src). Replaces
 * the former hand-maintained `CORE_REFERENCED` list — the mechanical form of "every Core→plugin
 * script spawn ships". Scans Core `.ts` for the SPAWN form only (`path.join("scripts", "X.ts")` /
 * `path.join("plugin", "scripts", "X.ts")` — the resolvePluginScript/resolvePluginScriptExec call
 * sites + KERNEL_RELS); the caller intersects the result with existing plugin `.ts`. Returns empty
 * when Core source is absent (an installed artifact carries dist/quay.js, not src/ — the scan is a
 * SOURCE-repo derivation only).
 * @returns {Set<string>} `.ts` basenames (e.g. "driver-runtime.ts")
 */
export function scanCoreReferences() {
  const basenames = new Set();
  if (!fs.existsSync(CORE_SRC_DIR)) return basenames;
  for (const f of walk(CORE_SRC_DIR)) {
    if (!f.endsWith(".ts")) continue;
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(CORE_PATH_JOIN_TS_RE)) if (m[1]) basenames.add(m[1]);
  }
  return basenames;
}

/**
 * Derive the set of plugin `.ts` basenames that driver-runtime.ts references by path — the
 * DRIVER_KINDS `driver: "X.ts"` data-table fields and the `path.join(…, "plugin", "scripts",
 * "X.ts")` spawn helpers (see the regex constants above). The third instance of "the entry set is
 * blind to a reference form": the first two (Core spawn refs, dist/*.js table rows) are already
 * mechanical; this closes the last blind spot by scanning the plugin source itself, NOT Core. The
 * caller intersects the result with existing plugin `.ts` (so a table field naming a dev-only or
 * nonexistent script is ignored). Scanned from the plugin root (raw `.ts` present — the staged copy
 * has them deleted only AFTER the build runs). ⛔ Scoped to driver-runtime.ts on purpose — the
 * broad `"plugin", "scripts", "X.ts"` literal matches non-spawn readFile reads elsewhere (see the
 * constant comment), and the AC-202 criterion enumerates driver-runtime.ts only.
 * @param {string} pluginRoot
 * @returns {Set<string>} `.ts` basenames (e.g. "promotion-driver.ts", "send-to-session.ts")
 */
export function scanPluginSelfReferences(pluginRoot) {
  const basenames = new Set();
  const driverRuntime = path.join(pluginRoot, "scripts", "driver-runtime.ts");
  if (!fs.existsSync(driverRuntime)) return basenames;
  const text = fs.readFileSync(driverRuntime, "utf8");
  for (const m of text.matchAll(PLUGIN_DRIVER_FIELD_RE)) if (m[1]) basenames.add(m[1]);
  for (const m of text.matchAll(PLUGIN_PATH_JOIN_TS_RE)) if (m[1]) basenames.add(m[1]);
  for (const m of text.matchAll(PLUGIN_SIBLING_RESOLVER_RE)) if (m[1]) basenames.add(m[1]);
  return basenames;
}

/**
 * Derive the plugin `.ts` basenames referenced as a SIBLING OF A DIRECTORY VARIABLE —
 * `path.join(<dirExpr>, "X.ts")` (and its installed-layout twin `path.join(<dirExpr>, "X.js")`,
 * reverse-mapped to `X.ts`). See the PLUGIN_SIBLING_JOIN_* constants for why this is a SHAPE rule
 * (any directory-variable join, not the `driver-anchor` filename) and why the restricted
 * `<dirExpr>` keeps it false-positive-free.
 *
 * Scanned over the WHOLE plugin source (scripts/ + gate-scripts/, build/fixture dirs skipped) —
 * not just driver-runtime.ts. Unlike the literal `"plugin","scripts","X.ts"` form (which matches
 * non-spawn readFile text-reads elsewhere and is therefore scoped to driver-runtime.ts), this shape
 * has no such collision: measured, it matches exactly driver-anchor.ts + fast-mode-telemetry.ts
 * across the whole surface.
 *
 * The caller intersects the result with existing plugin `.ts` (a `.js`-only probe with no matching
 * `.ts` source, or a name that names nothing, is ignored).
 * @param {string} pluginRoot
 * @returns {Set<string>} `.ts` basenames (e.g. "driver-anchor.ts")
 */
export function scanPluginSiblingReferences(pluginRoot) {
  const basenames = new Set();
  const roots = [path.join(pluginRoot, "scripts"), path.join(pluginRoot, "gate-scripts")];
  for (const root of roots) {
    for (const f of walk(root)) {
      if (!f.endsWith(".ts")) continue;
      const rel = path.relative(root, f);
      // Build output / deps / fixtures / archived copies are not the shipped source surface.
      if (rel.split(path.sep).some((seg) => SURFACE_SKIP_DIRS.has(seg))) continue;
      const text = fs.readFileSync(f, "utf8");
      for (const m of text.matchAll(PLUGIN_SIBLING_JOIN_TS_RE)) if (m[1]) basenames.add(m[1]);
      for (const m of text.matchAll(PLUGIN_SIBLING_JOIN_JS_RE)) {
        if (m[1]) basenames.add(`${m[1].replace(/\.js$/, "")}.ts`);
      }
    }
  }
  return basenames;
}

/**
 * Derive the consumer-referenced entry set for a plugin root.
 * @param {string} pluginRoot
 * @returns {{ scripts: string[], gateScripts: string[] }} relative entry paths
 */
export function deriveEntries(pluginRoot) {
  const scriptsDir = path.join(pluginRoot, "scripts");
  const gateDir = path.join(pluginRoot, "gate-scripts");

  // Existing plugin .ts files, keyed by basename → relative path.
  const existing = new Map();
  for (const f of [...walk(scriptsDir), ...walk(gateDir)]) {
    if (f.endsWith(".ts")) existing.set(path.basename(f), path.relative(pluginRoot, f));
  }
  if (existing.size === 0) return { scripts: [], gateScripts: [] };

  const referenced = new Set();
  for (const dir of CONSUMER_DIRS) {
    for (const f of walk(path.join(pluginRoot, dir))) {
      if (f.endsWith(".ts") || f.endsWith(".mjs") || /\/test\//.test(f)) continue;
      const text = fs.readFileSync(f, "utf8");
      for (const m of text.matchAll(INVOCATION_RE)) {
        const basename = m[1] ?? m[2] ?? m[3] ?? m[4];
        const rel = existing.get(basename);
        if (rel) referenced.add(rel);
      }
      if (f.endsWith(".md")) {
        for (const m of text.matchAll(MD_PATH_PREFIXED_RE)) {
          const rel = existing.get(m[2]);
          if (rel) referenced.add(rel);
        }
      }
      // Table/list rows that name a bundled entry by `dist/<name>.js` (e.g.
      // deliver-verify-usage.sh's VERIFY_SET) → reverse-lookup the same-named .ts so it ships.
      for (const m of text.matchAll(DIST_JS_RE)) {
        const rel = existing.get(`${m[1]}.ts`);
        if (rel) referenced.add(rel);
      }
    }
  }
  for (const core of scanCoreReferences()) {
    const rel = existing.get(core);
    if (rel) referenced.add(rel);
  }
  for (const self of scanPluginSelfReferences(pluginRoot)) {
    const rel = existing.get(self);
    if (rel) referenced.add(rel);
  }
  for (const sibling of scanPluginSiblingReferences(pluginRoot)) {
    const rel = existing.get(sibling);
    if (rel) referenced.add(rel);
  }
  for (const explicit of QUAY_INIT_EXPLICIT) {
    const rel = existing.get(explicit);
    if (rel) referenced.add(rel);
  }

  const scripts = [...referenced].filter((r) => r.startsWith("scripts"));
  const gateScripts = [...referenced].filter((r) => r.startsWith("gate-scripts"));
  return { scripts, gateScripts };
}

/**
 * esbuild plugin that re-points meta-driver.ts's repo-root-relative Core-source imports at the real
 * Core source dir. meta-driver.ts imports `../../packages/quay/src/goal-store.ts` + meta-store.ts —
 * a relative path that resolves ONLY in the repo-root layout (plugin/scripts/ → ../../packages/…).
 * In the STAGED packages/quay/plugin/ layout that same literal resolves to
 * packages/quay/plugin/packages/quay/src/… (nonexistent) and esbuild fails. AC-202 forces
 * meta-driver.ts into the entry set (a DRIVER_KINDS table row), so the bundle step must make that
 * import resolve. The target is always packages/quay/src/<basename> regardless of the importer's
 * depth, so map by basename — a general fallback, not a per-script list.
 *
 * gap-ac205-session-delivery-channel-transcript-confirmed: the SAME onResolve also covers
 * send-to-session.ts's DYNAMIC import — `await import("../../packages/quay/src/serve-send.ts")`
 * (send-to-session.ts:53). onResolve fires for dynamic imports too, the filter
 * `/packages\/quay\/src\/<basename>.ts$/` matches the raw specifier's trailing
 * `packages/quay/src/serve-send.ts`, and esbuild then INLINES it (bundle:true). The shipped
 * dist/send-to-session.js is therefore self-contained: the `packages/quay/src` tokens that remain
 * in the bundle are esbuild's __esm/__commonJS lazy-init registry keys + source-boundary comments
 * (shared by 15 of ~76 bundles), NOT runtime dev-tree imports — a bare-Node run of the installed
 * bundle reaches the socket-write stage, never the `共享投递模块不可用` exit-4 path.
 *
 * gap-resolve-kernel-src-module-strip-types-node-modules: the filter is extended to SUBDIRECTORY
 * Core-src modules (`gate/gate-event-store.ts`, `fan-in/ff-merge.ts` — worker-driver.ts's two dynamic
 * imports). The old `[A-Za-z0-9_.-]+` char class excludes `/`, so a `packages/quay/src/fan-in/ff-merge.ts`
 * specifier did NOT match and esbuild could not re-point/inline it — the shipped dist/worker-driver.js
 * then carried a runtime `import()` of a `.ts` under node_modules, which Node ≥23.7 refuses
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Now `[A-Za-z0-9_./-]+` matches the subdir and the
 * mapping re-points by FULL relative path (not basename), preserving the single-segment behavior
 * (serve-send.ts / goal-store.ts / meta-store.ts map identically to before).
 */
function coreSrcAliasPlugin() {
  return {
    name: "core-src-alias",
    setup(build) {
      // The filter also covers `.mjs` Core-src modules (gap-ac253-session-primitives-shared-layer-
      // adoption): plugin/scripts/*.ts import the shared session primitives at
      // `../../packages/quay/src/primitives/<name>.mjs`, and the SAME repo-root-relative-path
      // problem applies — in the STAGED `packages/quay/plugin/` layout that literal resolves to
      // `packages/quay/plugin/packages/quay/src/primitives/…` (nonexistent) and esbuild fails with
      // "Could not resolve". The mapping below is by the `packages/quay/src/` suffix, so the
      // extension only decides whether the resolver claims the specifier.
      build.onResolve({ filter: /packages\/quay\/src\/[A-Za-z0-9_./-]+\.(?:ts|mjs)$/ }, (args) => {
        const idx = args.path.indexOf("packages/quay/src/");
        const rel = idx >= 0 ? args.path.slice(idx + "packages/quay/src/".length) : args.path.split("/").pop();
        return { path: path.join(pkgDir, "src", rel) };
      });
    },
  };
}

/**
 * Bundle a set of entry .ts files into sibling `dist/<name>.js` files.
 * @param {string} pluginRoot
 * @param {string[]} entries relative paths under pluginRoot (e.g. "scripts/foo.ts")
 */
export async function bundleEntries(pluginRoot, entries) {
  const outfiles = [];
  for (const rel of entries) {
    const entryAbs = path.resolve(pluginRoot, rel);
    if (!fs.existsSync(entryAbs)) continue;
    const outfile = path.join(path.dirname(entryAbs), "dist", path.basename(rel).replace(/\.ts$/, ".js"));
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    await esbuild.build({
      entryPoints: [entryAbs],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile,
      loader: { ".json": "json" },
      banner: { js: REQUIRE_BANNER },
      plugins: [coreSrcAliasPlugin()],
      logLevel: "silent",
    });
    outfiles.push(outfile);
  }
  return outfiles;
}

/**
 * Assert the tarball carries a `dist/<name>.js` for every required bundle name.
 * @param {Iterable<string>} required bundle names WITHOUT `.js` (e.g. "driver-runtime")
 * @param {string[]} tarballEntries `tar tzf` output lines (e.g. "package/plugin/scripts/dist/x.js")
 * @returns {string[]} missing bundle names (empty = reference closure holds)
 */
export function closureMissing(required, tarballEntries) {
  const missing = [];
  const present = (name) =>
    tarballEntries.some(
      (e) => e.endsWith(`/scripts/dist/${name}.js`) || e.endsWith(`/gate-scripts/dist/${name}.js`)
    );
  for (const name of required) if (!present(name)) missing.push(name);
  return missing;
}

/**
 * The reference-closure gate: every plugin script in the DERIVED entry set must be present in the
 * tarball as its `dist/<name>.js` bundle. `deriveEntries` re-derives the SAME set the build used
 * (invocation/md refs + the `dist/<name>.js` table-row reverse-lookup + Core source spawn refs +
 * quay-init's explicit list), intersected with the SOURCE plugin's existing `.ts` — so prose/example
 * `dist/foo.js` mentions (which name no real plugin script) are not part of the closure. Returns
 * `missing` non-empty when a derived bundle was not packed; that is the fail-able form that catches
 * the driver-runtime.ts / suite-execution-form-counter.ts gaps at factory time (a missing bundle =
 * exit 1 in package.sh, not a silent "installed but broken"). ⛔ The assertion lands on the TARBALL
 * LISTING (crossing both the staging copy and `npm pack`), and the entry set is derived from the
 * SOURCE plugin root (raw `.ts` still present — the staged copy has them deleted).
 */
export function verifyDistClosure(pluginRoot, tarballEntries) {
  const { scripts, gateScripts } = deriveEntries(pluginRoot);
  const required = new Set();
  for (const rel of [...scripts, ...gateScripts]) {
    required.add(path.basename(rel).replace(/\.ts$/, ""));
  }
  const missing = closureMissing(required, tarballEntries);
  return { required: [...required].sort(), missing };
}

// ── the MARKETPLACE channel's closure reading: the artifact is a DIRECTORY, not a pack listing ────
// AC-263: the same reference closure was asserted on the npm-tarball channel (package.sh →
// `--verify-closure` above) and NOWHERE on the marketplace channel — `plugin/scripts/publish-dist-
// branch.sh` assembles the orphan-branch tree (rsync → bundle → strip raw .ts → rewrite → commit →
// push) with no equivalent check (grep for `closure` in that script: 0 hits before this task), while
// orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md:139 declares marketplace the
// PRIMARY publish channel. So the guarded channel was the secondary one and the main one was
// unchecked: a bundle the shipped carriers reference could be absent from the published branch, and
// the only symptom would be a consumer-side failure — structurally invisible to this repo's tests,
// which is exactly the class the tarball gate exists to close.
//
// Same predicate (every required `dist/<name>.js` must be present), different READING: the tarball
// verifier eats `npm pack` listing text; here the tree on disk IS the artifact, so the present-set is
// a directory walk and the required-set gains a second, artifact-side half (below).
const PUBLISH_TREE_BUNDLE_REF_RE = /(?:scripts|gate-scripts)\/dist\/([A-Za-z0-9_.-]+)\.js/g;

/**
 * Bundle names referenced by the assembled tree's OWN carrier files (the `CONSUMER_DIRS` surface the
 * rewriter owns; `.md`/`.sh`/`.js`). This is the half a source-side derivation cannot express: it
 * reads what the ARTIFACT says, so a rewrite that emitted `<anchor>/scripts/dist/<name>.js` for a
 * bundle the build never produced registers as "referenced but not landed" instead of staying
 * invisible.
 *
 * ⛔ `knownNames` (the source root's existing `.ts` basenames) filters the result, for the reason the
 * tarball-side docstring gives for its own intersection: a `dist/<name>.js` mentioned in PROSE names
 * no real plugin script and is not part of the closure. MEASURED on the real publish tree
 * 2026-09-15: without the filter this scan reports `X.js` — `plugin/scripts/quay-init.sh`'s four
 * comments spelling the rewritten form as `${SCRIPT_DIR}/dist/X.js` (no `X.ts` exists) — i.e. the
 * unfiltered predicate fails the primary publish channel on a doc placeholder. With it, every name
 * that survives is one the build necessarily bundles, so a surviving name CAN only be missing when
 * the tree genuinely lost a bundle.
 *
 * `runner-static-gate.ts` — the raw-shipped registry, never a bundle entry — is unaffected: the
 * rewriter leaves its `.ts` reference alone (see rewritePluginPaths' bundleExists guard), so it never
 * appears here in `dist/*.js` form.
 *
 * Fixture trees (`scripts/checker-mutation-cases/*.sh`) BUILD their own throwaway `plugin/scripts/…`
 * layout, so a path inside them names the fixture's fake root, not this artifact — the same
 * exclusion rewriteInvokers makes, for the same reason.
 *
 * `vendor/` is deliberately outside the scanned surface: those are separate pre-bundled packages
 * (`vendor/quay/dist/quay.js`), not carriers of this plugin's `dist/` references.
 *
 * @param {string} publishRoot the assembled tree about to be committed to the orphan branch
 * @param {Set<string>|undefined} [knownNames] when given, only these bundle names count (see above)
 * @returns {Set<string>} bundle names (without `.js`)
 */
export function scanPublishTreeReferences(publishRoot, knownNames) {
  const names = new Set();
  const isFixture = (f) => f.includes(`${path.sep}checker-mutation-cases${path.sep}`);
  for (const dir of CONSUMER_DIRS) {
    for (const f of walk(path.join(publishRoot, dir))) {
      if (!/\.(md|sh|js)$/.test(f)) continue;
      if (isFixture(f)) continue;
      for (const m of fs.readFileSync(f, "utf8").matchAll(PUBLISH_TREE_BUNDLE_REF_RE)) {
        if (knownNames && !knownNames.has(m[1])) continue;
        names.add(m[1]);
      }
    }
  }
  return names;
}

/**
 * The reference-closure gate for the marketplace / dist-plugin channel, read off the assembled
 * DIRECTORY. The required set is the union of
 *   ① the SAME derivation the tarball gate uses (`deriveEntries`), when the SOURCE plugin root is
 *      given — the rewritten tree no longer carries raw `.ts`, so that derivation must run against a
 *      root that still has them; and
 *   ② everything the artifact's own carriers reference (scanPublishTreeReferences; names with no
 *      backing `.ts` in the source root are prose, not closure — see that function).
 * The present set is the directory listing, fed through the SAME `closureMissing` predicate as the
 * tarball path (one closure rule, two readings — never a second copy of it).
 *
 * A non-empty `missing` MUST abort the publish: a gate that prints a warning and continues cannot be
 * red, and a check that cannot be red is a false assurance rather than a measurement (硬规则 3b) —
 * the caller (publish-dist-branch.sh) therefore guards the invocation and exits non-zero.
 *
 * @param {string} publishRoot the assembled tree about to be committed to the orphan branch
 * @param {string} [sourcePluginRoot] SOURCE plugin root (raw `.ts` still present); omit to require
 *   only the artifact-side reference set.
 * @returns {{required: string[], missing: string[]}}
 */
export function verifyDistClosureDir(publishRoot, sourcePluginRoot) {
  const required = new Set();
  // The source root's own `.ts` basenames. Two uses: the prose filter for the artifact-side scan
  // (an artifact reference counts only when a real plugin script backs the name) and — via
  // deriveEntries — the same required set the tarball gate computes.
  const knownNames = new Set();
  if (sourcePluginRoot) {
    const { scripts, gateScripts } = deriveEntries(sourcePluginRoot);
    for (const rel of [...scripts, ...gateScripts]) {
      required.add(path.basename(rel).replace(/\.ts$/, ""));
    }
    for (const kind of ["scripts", "gate-scripts"]) {
      for (const f of walk(path.join(sourcePluginRoot, kind))) {
        if (f.endsWith(".ts")) knownNames.add(path.basename(f).replace(/\.ts$/, ""));
      }
    }
  }
  for (const name of scanPublishTreeReferences(publishRoot, sourcePluginRoot ? knownNames : undefined)) {
    required.add(name);
  }
  const listing = [];
  for (const kind of ["scripts", "gate-scripts"]) {
    for (const f of walk(path.join(publishRoot, kind, "dist"))) {
      if (f.endsWith(".js")) listing.push(f);
    }
  }
  const missing = closureMissing(required, listing);
  return { required: [...required].sort(), missing };
}

// ── the plugin-root anchor: every shipped reference must resolve in a CONSUMING project ──────────
// A plugin-level marketplace source (`{"source":"github","repo":"…","ref":"dist-plugin"}`) supports
// no `path` parameter (publish-dist-branch.sh:106-107), so the orphan branch's ROOT *is* the plugin.
// The dev tree's repo-relative `plugin/scripts/X.ts` therefore names `<plugin>/plugin/scripts/X.ts`
// in a consuming project — a path that never exists there. `${CLAUDE_PLUGIN_ROOT}` is the anchor
// Claude Code expands for plugin-borne content, and the spelling the shipped sources already use
// (plugin/skills/routines/SKILL.md:16, asserted by plugin/test/plugin-packaging.test.mjs:333).
// The rewrite rules below used to swap only the EXTENSION and keep whatever prefix they found, so
// the artifact shipped 260 references of the unresolvable form (AC-260, measured 2026-09-15).
const ROOT_ANCHOR = "${CLAUDE_PLUGIN_ROOT}";

/**
 * Rewrite every plugin-script reference in `text` to the plugin-root-anchored bundled form.
 *
 * Three input shapes, one root cause (the rewriter did not know the anchor existed):
 *   ① `plugin/{scripts,gate-scripts}/X.ts` — the dev tree's repo-relative form. Here `plugin/` is
 *      the ANCHOR MARKER, not a path segment to preserve; an optional repo-root expression in front
 *      of it (`${worktree}/plugin/…`, `<root>/plugin/…`) means "that root's plugin subtree", so it
 *      is replaced by the anchor too. Keeping the prefix is what produced the doubled, unresolvable
 *      `<anchor>/plugin/…`, and keeping `plugin/` is what produced `<plugin>/plugin/…`.
 *   ② `${CLAUDE_PLUGIN_ROOT}/{scripts,gate-scripts}/X.ts` — already anchored, but the CHILD is
 *      stale: publish-dist-branch.sh:133 deletes every raw plugin .ts the bundler inlined into
 *      dist/*.js, so the reference points at a file the artifact does not carry (11 refs across 5
 *      SKILL.md, measured 2026-09-15 — invisible to a cwd-relative-prefix predicate alone, 硬规则 5b).
 *   ③ a reference that already carries the bundled extension (authored, or emitted by an earlier
 *      pass) — same prefix problem, no bundling decision to make.
 * ① and ② become `${CLAUDE_PLUGIN_ROOT}/<kind>/dist/<name>.js`.
 *
 * A script that is NOT bundled keeps its `.ts` reference. `runner-static-gate.ts` is the
 * static-check REGISTRY — a bash library shipped verbatim, never a bundler entry (see
 * publish-dist-branch.sh:130) — so `dist/runner-static-gate.js` names a file the build never
 * produces. The predicate is injected rather than assumed: rewriting a raw-shipped script to a
 * bundle path is exactly the referenced-not-landed defect this function exists to remove.
 *
 * @param {string} text
 * @param {(kind: "scripts"|"gate-scripts", name: string) => boolean} bundleExists
 *   Whether the staged plugin root carries `dist/<name>.js` for that directory. Defaults to
 *   "every script is bundled" — the dev-tree SOURCE assumption the pure callers (unit tests)
 *   hold; the production caller (rewriteInvokers) always passes the real filesystem predicate.
 */
export function rewritePluginPaths(text, bundleExists = () => true) {
  const bundled = (kind, name) =>
    bundleExists(kind, name) ? `${ROOT_ANCHOR}/${kind}/dist/${name}.js` : null;
  // ② the anchor is already right — only the child is stale.
  text = text.replace(
    /\$\{CLAUDE_PLUGIN_ROOT\}\/(scripts|gate-scripts)\/([A-Za-z0-9_.-]+)\.ts/g,
    (m, kind, name) => bundled(kind, name) ?? m
  );
  // ① dev-tree repo-relative form, with any repo-root expression in front of it. `<>` are in the
  //    prefix class for the `<root>/plugin/…` spelling the cold-start table uses; every other
  //    boundary (whitespace, backtick, quote, paren, CJK punctuation) simply ends the prefix, which
  //    is empty for the bare `plugin/…` token.
  text = text.replace(
    /[A-Za-z0-9_${}<>./-]*?plugin\/(scripts|gate-scripts)\/([A-Za-z0-9_.-]+)\.ts/g,
    (m, kind, name) => bundled(kind, name) ?? m
  );
  // ③ already-bundled reference carrying the dev-tree prefix.
  text = text.replace(
    /[A-Za-z0-9_${}<>./-]*?plugin\/(scripts|gate-scripts)\/dist\/([A-Za-z0-9_.-]+)\.js/g,
    `${ROOT_ANCHOR}/$1/dist/$2.js`
  );
  return text;
}

/** Drop `--experimental-strip-types` where the target is now a bundled `dist/*.js`. Guarded on the
 *  bundled path form on purpose: a script that kept its `.ts` (the raw-shipped registry) still
 *  NEEDS the flag, so a blanket strip would break exactly the reference the guard preserved. */
function stripTypesFlagForBundles(text) {
  text = text.replace(
    /node --no-warnings --experimental-strip-types (\$\{CLAUDE_PLUGIN_ROOT\}\/(?:scripts|gate-scripts)\/dist\/)/g,
    "node --no-warnings $1"
  );
  return text.replace(
    /node --experimental-strip-types (\$\{CLAUDE_PLUGIN_ROOT\}\/(?:scripts|gate-scripts)\/dist\/)/g,
    "node $1"
  );
}

/** Rewrite a markdown doc's plugin .ts references to the bundled, plugin-root-anchored entrypoints. */
export function rewriteMarkdown(text, bundleExists) {
  return stripTypesFlagForBundles(rewritePluginPaths(text, bundleExists));
}

/**
 * Rewrite a shell file's plugin .ts delegation references to the bundled dist entrypoints.
 * @param {string} text
 * @param {boolean} isQuayInit apply quay-init.sh's derivation/mechanism-specific fixes
 * @param {(kind: "scripts"|"gate-scripts", name: string) => boolean} [bundleExists] see rewritePluginPaths
 */
export function rewriteShell(text, isQuayInit = false, bundleExists) {
  // node "$(dirname "$0")/X.ts" → node "$(dirname "$0")/dist/X.js"
  text = text.replace(/node "\$\(dirname "\$0"\)\/([A-Za-z0-9_.-]+)\.ts"/g, 'node "$(dirname "$0")/dist/$1.js"');
  // exec node --experimental-strip-types "$SCRIPT_DIR/X.ts"
  text = text.replace(
    /exec node --experimental-strip-types "\$SCRIPT_DIR\/([A-Za-z0-9_.-]+)\.ts"/g,
    'exec node "$SCRIPT_DIR/dist/$1.js"'
  );
  // node --no-warnings --experimental-strip-types "$SCRIPT_DIR/X.ts"
  text = text.replace(
    /node --no-warnings --experimental-strip-types "\$SCRIPT_DIR\/([A-Za-z0-9_.-]+)\.ts"/g,
    'node --no-warnings "$SCRIPT_DIR/dist/$1.js"'
  );
  // gate_delegate_ts "X.ts" → gate_delegate_ts "dist/X.js"
  text = text.replace(/gate_delegate_ts "([A-Za-z0-9_.-]+)\.ts"/g, 'gate_delegate_ts "dist/$1.js"');
  // ${SCRIPT_DIR}/X.ts and $SCRIPT_DIR/X.ts → dist/X.js (generic, incl. comments)
  text = text.replace(/(\$\{SCRIPT_DIR\}|\$SCRIPT_DIR)\/([A-Za-z0-9_.-]+)\.ts/g, "$1/dist/$2.js");
  // $PLUGIN_ROOT/scripts/X.ts → $PLUGIN_ROOT/scripts/dist/X.js (quay-init code refs)
  text = text.replace(/(\$PLUGIN_ROOT\/scripts)\/([A-Za-z0-9_.-]+)\.ts/g, "$1/dist/$2.js");
  // every remaining plugin/{scripts,gate-scripts}/… reference (comments, prose refs, and bare-path
  // invocations) → the plugin-root-anchored bundled form. This is the .sh half of the same defect
  // AC-260 counts on the .md/.js side: leaving it as `plugin/scripts/dist/X.js` resolves to
  // <plugin>/plugin/scripts/… in a consuming project.
  text = rewritePluginPaths(text, bundleExists);
  text = stripTypesFlagForBundles(text);
  // node --no-warnings --experimental-strip-types "<var>" → node --no-warnings "<var>" (var now a .js bundle)
  text = text.replace(/node --no-warnings --experimental-strip-types "\$([A-Za-z0-9_]+)"/g, 'node --no-warnings "$$$1"');
  if (isQuayInit) {
    // derivation regex (a): the token after plugin/scripts/ may now be a dist/<name>.js path
    text = text.replace(/plugin\/scripts\/\[a-zA-Z0-9\._-\]\+/g, "plugin/scripts/[a-zA-Z0-9._/-]+");
    // verify_referenced_landed refs regex: same dist/ allowance for the plugin/scripts branch
    text = text.replace(
      /\(plugin\/scripts\|orchestration\|docs\/analysis\)\/\[a-zA-Z0-9\._-\]\+/g,
      "(plugin/scripts/[a-zA-Z0-9._/-]+|orchestration/[a-zA-Z0-9._-]+|docs/analysis/[a-zA-Z0-9._-]+)"
    );
    // bare-name .ts in the explicit mechanism additions + comments → dist/<name>.js
    text = text.replace(/(^|\s)([A-Za-z0-9_.-]+)\.ts(?=\s|$)/g, "$1dist/$2.js");
  }
  return text;
}

/** Rewrite a staged plugin copy's invokers (markdown docs + shell wrappers) to the dist bundles. */
export function rewriteInvokers(pluginRoot) {
  const mdDirs = ["skills", "loop", "probes", "agents", "workflows"];
  const shDirs = ["scripts", "gate-scripts"];
  // Hermetic FIXTURE trees are not invokers. `scripts/checker-mutation-cases/*.sh` BUILD their own
  // throwaway `<workdir>/plugin/scripts/…` layout, so a `plugin/` prefix *inside them* means "the
  // fixture's fake repo root" — not this repo. Rewriting them re-points the fixture at the installed
  // plugin and corrupts what it constructs (the old extension rules already re-targeted the very
  // files they write: `cat > plugin/scripts/X.ts` became `…/dist/X.js`). They reference nothing the
  // artifact ships, so leaving them byte-identical to the source is both correct and the safe
  // default; AC-260's carrier scan reaches them (硬规则 5b) and finds no `dist/*.js` reference in
  // the untouched form.
  const isFixture = (f) => f.includes(`${path.sep}checker-mutation-cases${path.sep}`);
  // Whether the staged root really carries a bundle — the build+strip ran before this, so a `.ts`
  // that survived is one the bundler never inlined (runner-static-gate.ts) and keeps its raw form.
  const bundleExists = (kind, name) => fs.existsSync(path.join(pluginRoot, kind, "dist", `${name}.js`));
  let filesTouched = 0;
  for (const dir of mdDirs) {
    for (const f of walk(path.join(pluginRoot, dir))) {
      // gap-delivery-laydown-dist-closure-gap: the shipped workflow FILES (plugin/workflows/*.js)
      // are invokers too — they reference plugin/scripts/X.ts in their string literals (e.g.
      // fan-in-execute.js runs `node --experimental-strip-types plugin/scripts/X.ts`). Without this
      // rewrite the packaged artifact's workflows point at raw .ts that package.sh DELETED, so the
      // installed `.claude/workflows/*.js` fail AND verify_referenced_landed's refs scan (which
      // covers workflows/*.js) names them referenced-not-landed. rewriteMarkdown's path/node rules
      // are safe on .js (only touch `plugin/{scripts,gate-scripts}/X.ts` and the
      // node --experimental-strip-types invocation forms; dev-repo `experiments/...ts` and bare-name
      // prose refs are deliberately left untouched).
      if (!f.endsWith(".md") && !f.endsWith(".js")) continue;
      if (isFixture(f)) continue;
      const text = fs.readFileSync(f, "utf8");
      const out = rewriteMarkdown(text, bundleExists);
      if (out !== text) {
        fs.writeFileSync(f, out);
        filesTouched++;
      }
    }
  }
  for (const dir of shDirs) {
    for (const f of walk(path.join(pluginRoot, dir))) {
      if (!f.endsWith(".sh")) continue;
      if (isFixture(f)) continue;
      const isQuayInit = path.basename(f) === "quay-init.sh";
      const text = fs.readFileSync(f, "utf8");
      const out = rewriteShell(text, isQuayInit, bundleExists);
      if (out !== text) {
        fs.writeFileSync(f, out);
        filesTouched++;
      }
    }
  }
  console.log(`build-plugin-dist: rewrote ${filesTouched} staged invokers to reference dist bundles`);
  return filesTouched;
}

// ── inlined entry-guard hijack: the hazard this bundler must not ship ──────────────────────────────
// gap-drivers-yml-interval-not-honored-for-routine-kinds. A module's "am I the process entry?" guard
// written as FILE identity (`realpath(argv[1]) === import.meta.url`, `fileURLToPath(import.meta.url)
// === process.argv[1]`, `` import.meta.url === `file://${process.argv[1]}` ``, …) is correct in the
// SOURCE layout but becomes TRUE FOR EVERY INLINED MODULE of a bundle — they all share the bundle's
// `import.meta.url`. esbuild emits imports BEFORE their importers, so the first such inlined guard
// wins and the bundle runs the WRONG tool's main.
//
// Measured 2026-09-13 on the shipped dist: `plugin/scripts/dist/{goal-driver,quality-gate-driver,
// meta-driver}.js` all executed `pool-quality-judge`'s main (an inlined library carrying a bare
// `isDirectEntry(import.meta)`), printing the pool judge's JSON and exiting 0 in <1s. The supervisor
// therefore respawned each routine driver every `--restart-delay` (5s) instead of letting its
// resident loop pace at `drivers.yml <kind>.interval_ms` — the declared interval had no effect on
// the observed cadence. The declared value was read correctly the whole time; the process that
// reads it never ran.
//
// The SAFE form is name identity: the guard compares the executed file's basename to a literal
// (`isDirectEntry(import.meta, undefined, "<name>")` or an explicit `basename(...) === "<name>"`
// clause), which holds for the entry alone in BOTH layouts. This scan is the gate that keeps the
// class from recurring: nothing that still hijacks can be packaged.
const GUARD_IDENTITY_RE = /import\.meta\.url|__filename/;
const GUARD_ARGV_RE = /process\.argv|__filename/;
const GUARD_SAFE_RE = /basename\(/; // + a literal comparison, checked below

/** Every top-level `if (<cond>)` condition in a module's SOURCE (top-level = column 0, balanced args). */
export function topLevelIfConditions(text) {
  const out = [];
  const re = /^if\s*\(/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = text.indexOf("(", m.index);
    let depth = 0;
    let i = start;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(text.slice(start + 1, i));
  }
  return out;
}

/** Argument count of the FIRST `isDirectEntry(...)` call in a condition text; null when absent.
 *  A call with fewer than 3 arguments omits `expectedBase` — the file-identity fallback that made the
 *  guard true for every inlined module (the spelling is not visible in the condition text, which is
 *  exactly why the arity has to be measured rather than pattern-matched). */
function isDirectEntryArity(cond) {
  const m = /isDirectEntry\s*\(/.exec(cond);
  if (!m) return null;
  let depth = 0;
  let commas = 0;
  for (let j = cond.indexOf("(", m.index); j < cond.length; j++) {
    const c = cond[j];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) break; }
    else if (c === "," && depth === 1) commas++;
  }
  return commas + 1;
}

/**
 * Does this module import the SHARED `isDirectEntry` from gate-script-base? The arity rule binds the
 * shared helper only: a module that DEFINES its own isDirectEntry decides its own semantics (two do —
 * workflow-event-schema.mjs and precommit-guard.ts — and both are name-based/inert; flagging them by
 * arity alone would be a false positive).
 */
export function importsSharedEntryHelper(text) {
  return /import\s*\{[^}]*\bisDirectEntry\b[^}]*\}\s*from\s*["'][^"']*gate-script-base\.ts["']/.test(text);
}

/**
 * The ACTIVE (hijacking) entry guards a module carries: top-level `if` conditions that resolve "am I
 * the entry?" from FILE identity. Two spellings, BOTH measured on the real tree (2026-09-13):
 *   1. an explicit file-identity comparison (`import.meta.url` / `__filename` vs `process.argv[1]`);
 *   2. `isDirectEntry(import.meta)` with fewer than 3 arguments — its URL fallback lives INSIDE the
 *      helper, so the hazard is invisible in the call text and only the arity reveals it.
 * A condition that ALSO compares a basename to a literal is inert under bundling (belt-and-braces
 * form several checkers already use), and the 3-argument named form is inert by construction.
 * @param {string} file absolute path
 * @returns {{condition: string}[]}
 */
export function activeFileIdentityGuards(file) {
  const text = fs.readFileSync(file, "utf8");
  const usesSharedHelper = importsSharedEntryHelper(text);
  const active = [];
  for (const cond of topLevelIfConditions(text)) {
    const explicitFileIdentity =
      GUARD_IDENTITY_RE.test(cond) && GUARD_ARGV_RE.test(cond) &&
      !(GUARD_SAFE_RE.test(cond) && /===\s*["'][^"']*["']/.test(cond));
    const unNamedHelper = usesSharedHelper && isDirectEntryArity(cond) !== null && isDirectEntryArity(cond) < 3;
    if (!explicitFileIdentity && !unNamedHelper) continue;
    active.push({ condition: cond.replace(/\s+/g, " ").trim().slice(0, 120) });
  }
  return active;
}

const STATIC_IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+\.(?:ts|mjs|js))["']/g;

/** Resolve a static import specifier to a real file (relative, or Core `packages/quay/src/…`). */
function resolveStaticImport(spec, importer) {
  const pkgSrc = path.resolve(pkgDir, "src");
  const cands = [path.resolve(path.dirname(importer), spec)];
  const idx = spec.indexOf("packages/quay/src/");
  if (idx >= 0) cands.push(path.join(pkgSrc, spec.slice(idx + "packages/quay/src/".length)));
  return cands.find((c) => fs.existsSync(c)) ?? null;
}

/** Depth-first STATIC import closure of an entry (dynamic `import("…")` included by the same regex —
 *  conservative: a lazily-initialised inlined module still runs its top-level body on first access). */
export function staticImportClosure(entryAbs) {
  const seen = new Set();
  const order = [];
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    order.push(f);
    for (const m of fs.readFileSync(f, "utf8").matchAll(STATIC_IMPORT_RE)) {
      const r = resolveStaticImport(m[1], f);
      if (r) walk(r);
    }
  };
  walk(entryAbs);
  return order;
}

/**
 * The hijack gate: entries whose bundle would run an INLINED module's main instead of their own.
 * @param {string} pluginRoot
 * @returns {{entry: string, module: string, condition: string}[]} empty = the shipped surface is safe
 */
export function findEntryGuardHijacks(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const { scripts, gateScripts } = deriveEntries(pluginRoot);
  const hijacks = [];
  for (const rel of [...scripts, ...gateScripts]) {
    const entry = path.resolve(pluginRoot, rel);
    if (!fs.existsSync(entry)) continue;
    for (const mod of staticImportClosure(entry)) {
      if (mod === entry) continue;
      for (const g of activeFileIdentityGuards(mod)) {
        hijacks.push({ entry: rel, module: path.relative(pluginRoot, mod), condition: g.condition });
      }
    }
  }
  return hijacks;
}

/** Directories under plugin/scripts that are NOT shipped source: build output, deps, fixtures that
 *  deliberately embed the anti-pattern (checker-mutation-cases), and vendored copies. */
const SURFACE_SKIP_DIRS = new Set(["dist", "node_modules", "test", "tests", "vendor", "archive", "checker-mutation-cases"]);
const SURFACE_SKIP_FILES = /\.test\./;

/**
 * The DEAD entry guards of the shipped scripts surface: any module that imports the SHARED helper and
 * calls it with fewer than 3 arguments. `expectedBase` became REQUIRED on 2026-09-13
 * (gap-drivers-yml-interval-not-honored-for-routine-kinds), so such a call can never be true: the
 * module's top-level main() never runs and the process exits 0 with NO output.
 *
 * This is the STANDALONE sibling of the inlined hijack above, and the more dangerous of the two: the
 * hijack at least makes a bundle run SOME main; an unnamed guard in a module that is never bundled
 * makes it run NO main at all, and a silent no-op is indistinguishable from a pass at every surface
 * (硬規則 3b). Measured 2026-09-13: `plugin/scripts/enum-surface-parity-check.ts` still carried the
 * bare form after the migration sweep — the checker was dead in the static gate while its own row
 * read green, and only its mutation case noticed (STAYED-GREEN).
 *
 * `findEntryGuardHijacks` structurally cannot see this: it walks each bundle entry's import closure,
 * and a standalone checker is not in any bundle's closure. Hence a whole-surface scan.
 * @param {string} pluginRoot
 * @returns {{module: string, condition: string}[]} empty = every guard on the shared helper is named
 */
export function findUnnamedEntryGuards(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const scriptsDir = path.join(pluginRoot, "scripts");
  const dead = [];
  // A MISSING directory is legitimately empty (synthetic roots in the tests have no scripts/ at all).
  // Any OTHER read failure means modules went unexamined — that is reported as NOT-EVALUATED, never
  // returned as an empty list, because an empty list is exactly what "every guard is named" looks
  // like: swallowing the error would trade a crash (fail-closed) for a silent pass (硬規則 3b).
  const unreadable = (target, e) => {
    if (e.code === "ENOENT" && target === scriptsDir) return; // no scripts/ at all — nothing to scan
    dead.push({ module: path.relative(pluginRoot, target), condition: `UNREADABLE (${e.code ?? "error"}) — NOT-EVALUATED` });
  };
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      unreadable(dir, e);
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SURFACE_SKIP_DIRS.has(e.name)) walk(abs);
        continue;
      }
      if (!/\.(?:ts|mjs|js)$/.test(e.name) || SURFACE_SKIP_FILES.test(e.name)) continue;
      let text;
      try {
        text = fs.readFileSync(abs, "utf8"); // a dangling symlink lands here — report, never skip
      } catch (e) {
        unreadable(abs, e);
        continue;
      }
      if (!importsSharedEntryHelper(text)) continue;
      for (const cond of topLevelIfConditions(text)) {
        const arity = isDirectEntryArity(cond);
        if (arity === null || arity >= 3) continue;
        dead.push({ module: path.relative(pluginRoot, abs), condition: cond.replace(/\s+/g, " ").trim().slice(0, 120) });
      }
    }
  };
  walk(scriptsDir);
  return dead;
}

/** Build the plugin dist bundles for a plugin root. Returns the entry count. */
export async function buildPluginDist(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const { scripts, gateScripts } = deriveEntries(pluginRoot);
  const all = [...scripts, ...gateScripts];
  // FAIL-CLOSED before any bundling: a single active inlined guard silently redirects a bundle's
  // main to the wrong tool (see findEntryGuardHijacks) — that must never reach an artifact.
  const hijacks = findEntryGuardHijacks(pluginRoot);
  if (hijacks.length) {
    console.error(`build-plugin-dist: ${hijacks.length} inlined entry-guard hijack(s) — these modules ` +
      `would run their main() in a bundle that inlines them (use isDirectEntry(import.meta, undefined, "<name>") ` +
      `or add a basename()=== literal clause):`);
    for (const h of hijacks) console.error(`  ${h.entry}  <-  ${h.module}  ::  ${h.condition}`);
    throw new Error("inlined entry-guard hijack: refusing to build a bundle that runs the wrong main");
  }
  // Same fail-closed posture for the standalone sibling: an unnamed guard is dead code, and a dead
  // checker/gate reports exactly like a passing one.
  const unnamed = findUnnamedEntryGuards(pluginRoot);
  if (unnamed.length) {
    console.error(`build-plugin-dist: ${unnamed.length} unnamed entry guard(s) — expectedBase is REQUIRED, ` +
      `so these top-level blocks are DEAD (main() never runs; the process exits 0 with no output):`);
    for (const u of unnamed) console.error(`  ${u.module}  ::  ${u.condition}`);
    throw new Error('unnamed entry guard: refusing to build a surface whose guards can never fire ' +
      '(use isDirectEntry(import.meta, undefined, "<name>"))');
  }
  const built = await bundleEntries(pluginRoot, all);
  console.log(
    `build-plugin-dist: ${built.length} bundled entrypoints → ${path.join(pluginRoot, "scripts", "dist")} (+ gate-scripts/dist)`
  );
  return built.length;
}

// Run as a script.
const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  const args = process.argv.slice(2);
  const rewrite = args.includes("--rewrite");
  const verifyClosure = args.includes("--verify-closure");
  const verifyClosureDir = args.includes("--verify-closure-dir");
  const positional = args.filter((a) => !a.startsWith("--"));
  const pluginRoot = positional[0] ? path.resolve(positional[0]) : DEFAULT_PLUGIN_ROOT;
  (async () => {
    if (rewrite) {
      await rewriteInvokers(pluginRoot);
    } else if (verifyClosure) {
      const tarball = positional[1];
      if (!tarball) {
        console.error("build-plugin-dist --verify-closure requires <sourcePluginRoot> <tarball>");
        process.exit(2);
      }
      const listing = execFileSync("tar", ["tzf", path.resolve(tarball)], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean);
      const { required, missing } = verifyDistClosure(pluginRoot, listing);
      if (missing.length) {
        console.error(
          `dist-closure gate FAILED: ${missing.length} referenced dist bundle(s) missing from ${path.resolve(tarball)}:`
        );
        for (const name of missing) console.error(`  - ${name}.js`);
        process.exit(1);
      }
      console.log(
        `dist-closure gate OK: ${required.length} referenced dist bundles all present in ${path.basename(path.resolve(tarball))}`
      );
    } else if (verifyClosureDir) {
      // AC-263: the marketplace channel's reading of the SAME closure rule. `pluginRoot` here is the
      // assembled publish tree (directory form); the optional second positional is the SOURCE plugin
      // root, whose raw `.ts` the derivation needs (the staged tree's were stripped).
      const sourcePluginRoot = positional[1] ? path.resolve(positional[1]) : undefined;
      const { required, missing } = verifyDistClosureDir(pluginRoot, sourcePluginRoot);
      if (missing.length) {
        console.error(
          `dist-closure gate FAILED: ${missing.length} referenced dist bundle(s) absent from the publish tree ${pluginRoot}:`
        );
        for (const name of missing) console.error(`  - ${name}.js`);
        process.exit(1);
      }
      console.log(
        `dist-closure gate OK (directory): ${required.length} referenced dist bundles all present in ${pluginRoot}`
      );
    } else {
      await buildPluginDist(pluginRoot);
    }
  })().catch((err) => {
    console.error("build-plugin-dist failed:", err);
    process.exit(1);
  });
}
