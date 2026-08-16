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
// loop tick docs, skills, probes, .sh wrappers, quay-init's explicit mechanism additions, and
// Core's mcp-server instrument entry. The entry set is DERIVED at build time by scanning the
// shipped surface for `<name>.ts` basenames that match an existing plugin .ts — never a
// hand-maintained list: when a new tool is referenced by a tick doc/skill the next package.sh run
// bundles it. Libraries (gate-script-base.ts, task-schema.ts, touches-parser.ts, …) are therefore
// bundled too (quay-init's mechanism layout still lists them as transitive deps); standalone
// execution of a library bundle is a no-op, but every rewritten reference resolves to a shipped
// executable.
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

// Core code that spawns a plugin .ts by relative path and ships inside dist/quay.js.
// mcp-server.ts's instrument tool derives its directory from runtime-usage-inventory.ts;
// observation.ts's /board landing judgment spawns task-status-drift-check.ts. Both must resolve
// to a shipped executable, so both are always entries.
const CORE_REFERENCED = ["runtime-usage-inventory.ts", "task-status-drift-check.ts"];

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
    }
  }
  for (const core of CORE_REFERENCED) {
    const rel = existing.get(core);
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
      logLevel: "silent",
    });
    outfiles.push(outfile);
  }
  return outfiles;
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
  const positional = args.filter((a) => !a.startsWith("--"));
  const pluginRoot = positional[0] ? path.resolve(positional[0]) : DEFAULT_PLUGIN_ROOT;
  (async () => {
    if (rewrite) {
      await rewriteInvokers(pluginRoot);
    } else {
      await buildPluginDist(pluginRoot);
    }
  })().catch((err) => {
    console.error("build-plugin-dist failed:", err);
    process.exit(1);
  });
}
