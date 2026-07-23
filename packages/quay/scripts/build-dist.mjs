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
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");

const DEFAULT_ENTRY = path.resolve(pkgDir, "bin/quay.ts");
const DEFAULT_OUTFILE = path.resolve(pkgDir, "dist/quay.js");

// The load-bearing banner (see header comment). Exported so tests can pin it.
export const REQUIRE_BANNER =
  'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);';

/**
 * Build the ESM dist bundle. Resolves the entrypoint from (in order) the
 * `entry` option, the QUAY_BUILD_DIST_ENTRY env var (a testability hook for the
 * failure path), then bin/quay.ts. Throws (loudly, non-zero when run as a
 * script) on any esbuild failure or a reported-success-but-missing outfile.
 * @returns the absolute path of the written bundle.
 */
export async function buildDist(opts = {}) {
  const entry = opts.entry ?? process.env.QUAY_BUILD_DIST_ENTRY ?? DEFAULT_ENTRY;
  const outfile = opts.outfile ?? DEFAULT_OUTFILE;

  let result;
  try {
    result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile,
      loader: { ".json": "json" },
      banner: { js: REQUIRE_BANNER },
      logLevel: "info",
    });
  } catch (err) {
    console.error("esbuild.build() threw:", err);
    throw err;
  }

  if (result.errors && result.errors.length > 0) throw new Error(`esbuild reported errors: ${JSON.stringify(result.errors)}`);
  if (!fs.existsSync(outfile)) throw new Error(`esbuild reported success but outfile is missing: ${outfile}`);

  console.log(`esbuild: quay ESM dist bundle written to ${outfile} (createRequire banner injected).`);
  return outfile;
}

// Run as a script (build-dist.sh / CI): build the default target, exit non-zero
// on any failure. Skipped when imported (e.g. by the test), so coverage of the
// build logic is measured in-process.
const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) buildDist().catch(() => process.exit(1));
