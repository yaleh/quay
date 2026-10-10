// build-dist.mjs — M120 (DIR-060): build a bundled **ESM** `dist/quay.js` for
// packages/quay (the Core CLI), the sibling of the SEA build's
// scripts/esbuild-sea.mjs.
//
// Why: M116 made every CLI entrypoint a `.ts` file run directly via shebang,
// which only Node >=23 executes natively (type-stripping). But the distributed
// npm-pack tarball's `bin` must run on the declared floor (Node 20). This
// script transpiles+bundles bin/quay.ts into a single self-contained ESM
// `dist/quay.js` that runs on Node 20, WITHOUT raising the whole project's
// `engines` floor (DIR-060's lower-blast-radius default).
//
// Output format is ESM (not the SEA build's CJS): a plain npm-pack tarball has
// none of Node-SEA's ESM-main-module constraint, and every package already
// declares `"type": "module"` + uses `import.meta.url`, which ESM output
// preserves unmodified (so src/version.ts's own __dirname/package.json read is
// safe here without the SEA shim — dist/ and src/ are direct siblings under
// packages/quay/).
//
// LOAD-BEARING `banner`: a naive ESM bundle crashes at runtime with
// `Error: Dynamic require of "process" is not supported` from yaml's CJS-interop
// shim — esbuild's ESM-output `__require` polyfill cannot satisfy yaml's dynamic
// require() without a real `require` in scope. The banner injects a
// createRequire-backed `require`, which resolves it (empirically verified).
//
// Invoked by scripts/build-dist.sh (and, transitively, package.sh + CI).

import * as esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");

const DEFAULT_ENTRY = path.resolve(pkgDir, "bin/quay.ts");
const DEFAULT_OUTFILE = path.resolve(pkgDir, "dist/quay.js");

// The load-bearing banner (see header comment). Exported so tests can pin it.
export const REQUIRE_BANNER =
  'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);';

/**
 * Extra node_modules roots for the bundle's bare specifiers, in addition to esbuild's normal
 * walk-up from each file's own directory.
 *
 * WHY IT WAS ADDED (GOAL-017/AC-251): the Core bundle used to INLINE sources living outside the
 * product package — `src/serve.ts` imported `serveControlPlane` from
 * `plugin/scripts/driver-shared.ts`, which dynamic-imports `@modelcontextprotocol/sdk/*` and
 * `zod`. esbuild resolves a bundled file's bare specifiers relative to THAT FILE's directory, and a
 * plugin-layer source has no node_modules between it and the filesystem root: it happened to work in
 * a real checkout (npm hoists to `<repo>/node_modules`, an ancestor of `plugin/scripts/`), while in
 * a *packaging copy* that gives the deps only to the package (`<copy>/packages/quay/node_modules` —
 * the layout `npm-pack-e2e.test.mjs` builds) resolution failed and `package.sh` died with
 * `Could not resolve "@modelcontextprotocol/sdk/server/mcp.js"`.
 *
 * ⚠️ THAT REASON NO LONGER HOLDS (tasks/gap-arch-reverse-edges-zero): every source this bundle
 * inlines is now under `packages/quay/src/`, so there is no longer an out-of-package importer. The
 * function is RETAINED deliberately rather than deleted: it is additive (esbuild still tries each
 * importer's own directory first, so nothing that resolved before resolves differently), and it
 * pins the property that a SELF-CONTAINED bundle's bare specifiers resolve against the BUNDLE'S
 * package — the dependencies it ships against (`@modelcontextprotocol/sdk` and `zod` are declared
 * deps of `packages/quay/package.json`). The load-bearing assertion for the current tree is the
 * import-graph checker's `reverseEdges === 0`
 * (`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json`), not this flag.
 */
export function bundleNodePaths(pkgRoot = pkgDir) {
  return [path.join(pkgRoot, "node_modules")];
}

// gap-webui-modernist-css-missing-in-tgz: the dist bundle must be SELF-CONTAINED
// for the Web UI stylesheet. serve-handlers.ts reads the Modernist token sheet
// (webui-modernist.css) relative to its own location — from src/ the file sits
// beside it, but from the bundled dist/quay.js it does NOT (npm pack ships the
// file under src/, never dist/), so every bundled `quay serve` logged
// `webui-modernist.css missing: ENOENT` and served an empty <style>. Rather than
// making every downstream copy (npm-pack tarball, plugin/vendor/quay/dist,
// quay-init's .quay/runtime laydown) drag a sibling .css file around, INLINE the
// stylesheet into the bundle at build time: the banner sets
// globalThis.__WEBUI_MODERNIST_CSS__ before any module executes, and
// serve-handlers.ts prefers that inlined value over its readFileSync fallback
// (which still covers source-tree runs under node --experimental-strip-types).
export function buildBanner() {
  const cssPath = path.resolve(pkgDir, "src", "webui-modernist.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const d3 = readD3MinJs();
  return `${REQUIRE_BANNER}\nglobalThis.__WEBUI_MODERNIST_CSS__ = ${JSON.stringify(css)};\nglobalThis.__WEBUI_D3_JS__ = ${JSON.stringify(d3)};`;
}

/**
 * Read d3.min.js from node_modules (the third-party graph library the retired 「零客户端 JS」
 * invariant now permits on the /git-history page). Inlined into the dist bundle's banner the same
 * way the Modernist CSS is, so dist/quay.js stays self-contained (no sibling .js asset to ship).
 * Returns "" when d3 is not installed — the /git-history page then degrades to the summary table.
 */
export function readD3MinJs() {
  try {
    const require = createRequire(import.meta.url);
    const d3Main = require.resolve("d3");
    return fs.readFileSync(path.join(path.dirname(path.dirname(d3Main)), "dist", "d3.min.js"), "utf8");
  } catch {
    return "";
  }
}

/**
 * Build the ESM dist bundle. Resolves the entrypoint from (in order) the
 * `entry` option, the QUAY_BUILD_DIST_ENTRY env var (a testability hook for the
 * failure path), then bin/quay.ts. Resolves the outfile from (in order) the
 * `outfile` option, the QUAY_BUILD_DIST_OUTFILE env var (a testability hook,
 * sibling of QUAY_BUILD_DIST_ENTRY — lets a test build into its own temp dir
 * instead of the shared packages/quay/dist/quay.js), then dist/quay.js.
 * Throws (loudly, non-zero when run as a script) on any esbuild failure or a
 * reported-success-but-missing outfile. `logLevel` (default "info") is forwarded
 * to esbuild.build(); the failure-path negative-control test passes "silent" so
 * esbuild's `✘ [ERROR] Could not resolve …` never reaches the process stderr —
 * that benign noise is line-content-indistinguishable from a REAL build failure
 * and pollutes worker-driver's extractFailureSummary reason
 * (gap-scoped-gate-m120-negative-control-false-positive).
 * @returns the absolute path of the written bundle.
 */
export async function buildDist(opts = {}) {
  const entry = opts.entry ?? process.env.QUAY_BUILD_DIST_ENTRY ?? DEFAULT_ENTRY;
  const outfile = opts.outfile ?? process.env.QUAY_BUILD_DIST_OUTFILE ?? DEFAULT_OUTFILE;
  const logLevel = opts.logLevel ?? "info";

  let result;
  try {
    result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile,
      // The `json` loader inlines `src/version.ts`'s `import pkg from "../package.json"`
      // INTO the bundle at build time (gap-dist-runtime-not-self-contained-reads-external-
      // package-json). The dist therefore carries the version string inside the file and the
      // runtime never readFileSyncs a sibling package.json — the vendored plugin/vendor/quay/
      // dist/quay.js is truly self-contained (runs standalone with no package.json beside it).
      loader: { ".json": "json" },
      banner: { js: buildBanner() },
      nodePaths: bundleNodePaths(),
      logLevel,
    });
  } catch (err) {
    // ⛔ "silent" must also silence the catch-block console.error — esbuild's `logLevel:"silent"`
    // already suppresses its own `✘ [ERROR]` fd-2 write, but this console.error would still leak
    // the rejection text to stderr (gap-scoped-gate-m120-negative-control-false-positive).
    if (logLevel !== "silent") console.error("esbuild.build() threw:", err);
    throw err;
  }

  if (result.errors && result.errors.length > 0) throw new Error(`esbuild reported errors: ${JSON.stringify(result.errors)}`);
  if (!fs.existsSync(outfile)) throw new Error(`esbuild reported success but outfile is missing: ${outfile}`);

  console.log(`esbuild: quay ESM dist bundle written to ${outfile} (createRequire banner injected).`);
  return outfile;
}

// ── the published subpath bundle ───────────────────────────────────────────────────────────────────

const DEFAULT_KERNEL_ENTRY = path.resolve(pkgDir, "src/dashboard-kernel.ts");
const DEFAULT_KERNEL_OUTFILE = path.resolve(pkgDir, "dist/dashboard-kernel.js");

/**
 * Build the ESM dist bundle for the package's published `quay/dashboard-kernel` subpath
 * (gap-dashboard-kernel-export-for-cross-project-reuse).
 *
 * ⛔ WHY A SEPARATE JS OUTPUT EXISTS AT ALL — MEASURED, NOT ASSUMED: Node REFUSES to strip
 * TypeScript types for any file resolved under `node_modules` and throws
 * `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Every OTHER `exports` subpath in this package
 * points at `./src/*.ts`, and those resolve only through this monorepo's npm-workspaces SYMLINK
 * (`node_modules/quay -> packages/quay`, whose realpath is outside node_modules) — a genuinely
 * external `npm install` COPIES the file into node_modules and the import then fails outright.
 * quay's first external consumer cannot be handed a `.ts` path; it is handed this plain-JS build,
 * for exactly the reason `bin` points at `dist/quay.js` rather than `bin/quay.ts`. `exports`
 * therefore pairs the runtime path (this file) with a `types` condition pointing at the `.ts`
 * source, so TS consumers still get the real signatures.
 *
 * Unlike `buildDist`, no `banner`/`nodePaths` are needed: the kernel is a ZERO-IMPORT leaf (see its
 * header), so there is no CJS interop shim or out-of-package bare specifier to satisfy.
 * @returns the absolute path of the written bundle.
 */
export async function buildDashboardKernel(opts = {}) {
  const entry = opts.entry ?? DEFAULT_KERNEL_ENTRY;
  const outfile = opts.outfile ?? DEFAULT_KERNEL_OUTFILE;
  const logLevel = opts.logLevel ?? "info";

  let result;
  try {
    result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: "neutral",
      format: "esm",
      target: ["es2022"],
      outfile,
      // ⛔ `absWorkingDir` IS LOAD-BEARING, not a tidiness setting (measured 2026-10-09,
      // gap-dashboard-kernel-not-packaged-in-plugin-artifact). Without it esbuild renders its
      // emitted `// <entry path>` banner relative to `process.cwd()`, so the SAME source produced a
      // 2074-byte bundle when built from the worktree root and a 2060-byte one when built from
      // `packages/quay` (and a third from anywhere else) — differing ONLY in that comment line.
      // That made the artifact's IDENTITY a function of the caller's cwd, which is fatal for the
      // plugin mirror: `plugin/scripts/sync-vendor.sh --check` compares the mirrored
      // `vendor/quay/dist/dashboard-kernel.js` byte-for-byte against the source build, so any
      // out-of-band rebuild from a different cwd reds a check whose subject never changed (observed
      // live: a lone kernel rebuild during a test run desynchronised the mirror). Pinning the
      // working dir makes the bundle a function of its SOURCE alone — reproducible across cwd and
      // across machines (esbuild only uses this to spell paths, never to resolve the entry).
      absWorkingDir: pkgDir,
      logLevel,
    });
  } catch (err) {
    if (logLevel !== "silent") console.error("esbuild.build() threw:", err);
    throw err;
  }

  if (result.errors && result.errors.length > 0) throw new Error(`esbuild reported errors: ${JSON.stringify(result.errors)}`);
  if (!fs.existsSync(outfile)) throw new Error(`esbuild reported success but outfile is missing: ${outfile}`);

  console.log(`esbuild: quay dashboard-kernel ESM bundle written to ${outfile}.`);
  return outfile;
}

// Run as a script (build-dist.sh / CI): build the default target, exit non-zero
// on any failure. Skipped when imported (e.g. by the test), so coverage of the
// build logic is measured in-process.
//
// BOTH dist artifacts are built here (not just the CLI bundle): package.sh calls
// build-dist.sh before `npm pack`, and the exported `./dashboard-kernel` subpath resolves only when
// dist/dashboard-kernel.js exists — a build entry that produced one but not the other would ship a
// tarball whose own `exports` map points at a missing file.
const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  buildDist()
    .then(() => buildDashboardKernel())
    .catch(() => process.exit(1));
}
