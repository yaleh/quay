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
// DRIVER_KINDS `driver: "X.ts"` table fields + `path.join(…,"plugin","scripts","X.ts")` helpers).
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

// In markdown docs the probes/skills ALSO invoke tools by bare `plugin/scripts/<name>.ts` path
// with no `node` prefix (e.g. probes/architecture-analysis.md lists
// `plugin/scripts/git-lens-l-d-code-doc-ratio.ts <base> <head>` as a runnable line). Every
// `.ts` path-prefixed in a shipped .md is a reference that must resolve after the raw .ts are
// removed, so it is an entry regardless of invocation spelling.
const MD_PATH_PREFIXED_RE = /(?:plugin\/scripts|plugin\/gate-scripts)\/([A-Za-z0-9_.-]+\.ts)/g;

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
          const rel = existing.get(m[1]);
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
 */
function coreSrcAliasPlugin() {
  return {
    name: "core-src-alias",
    setup(build) {
      build.onResolve({ filter: /packages\/quay\/src\/[A-Za-z0-9_.-]+\.ts$/ }, (args) => {
        return { path: path.join(pkgDir, "src", args.path.split("/").pop()) };
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

/** Rewrite a markdown doc's plugin .ts references to the bundled dist entrypoints. */
export function rewriteMarkdown(text) {
  // node --no-warnings --experimental-strip-types [<prefix>/]plugin/{scripts,gate-scripts}/X.ts
  text = text.replace(
    /node --no-warnings --experimental-strip-types (([^\s"'`]*\/)?)(plugin\/scripts|plugin\/gate-scripts)\/([A-Za-z0-9_.-]+)\.ts/g,
    "node --no-warnings $1$3/dist/$4.js"
  );
  // node --experimental-strip-types [<prefix>/]plugin/{scripts,gate-scripts}/X.ts
  text = text.replace(
    /node --experimental-strip-types (([^\s"'`]*\/)?)(plugin\/scripts|plugin\/gate-scripts)\/([A-Za-z0-9_.-]+)\.ts/g,
    "node $1$3/dist/$4.js"
  );
  // any remaining plugin/{scripts,gate-scripts}/X.ts path reference (prose + bare-path invocations)
  text = text.replace(/(plugin\/scripts|plugin\/gate-scripts)\/([A-Za-z0-9_.-]+)\.ts/g, "$1/dist/$2.js");
  return text;
}

/**
 * Rewrite a shell file's plugin .ts delegation references to the bundled dist entrypoints.
 * @param {string} text
 * @param {boolean} isQuayInit apply quay-init.sh's derivation/mechanism-specific fixes
 */
export function rewriteShell(text, isQuayInit = false) {
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
  // any remaining plugin/{scripts,gate-scripts}/X.ts path reference in shell text (comments/refs)
  text = text.replace(/(plugin\/scripts|plugin\/gate-scripts)\/([A-Za-z0-9_.-]+)\.ts/g, "$1/dist/$2.js");
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
      const text = fs.readFileSync(f, "utf8");
      const out = rewriteMarkdown(text);
      if (out !== text) {
        fs.writeFileSync(f, out);
        filesTouched++;
      }
    }
  }
  for (const dir of shDirs) {
    for (const f of walk(path.join(pluginRoot, dir))) {
      if (!f.endsWith(".sh")) continue;
      const isQuayInit = path.basename(f) === "quay-init.sh";
      const text = fs.readFileSync(f, "utf8");
      const out = rewriteShell(text, isQuayInit);
      if (out !== text) {
        fs.writeFileSync(f, out);
        filesTouched++;
      }
    }
  }
  console.log(`build-plugin-dist: rewrote ${filesTouched} staged invokers to reference dist bundles`);
  return filesTouched;
}

/** Build the plugin dist bundles for a plugin root. Returns the entry count. */
export async function buildPluginDist(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const { scripts, gateScripts } = deriveEntries(pluginRoot);
  const all = [...scripts, ...gateScripts];
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
    } else {
      await buildPluginDist(pluginRoot);
    }
  })().catch((err) => {
    console.error("build-plugin-dist failed:", err);
    process.exit(1);
  });
}
