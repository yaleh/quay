// build-dist.mjs — M149 (DIR-094): build a bundled **ESM** `dist/quay-native.js`
// for packages/quay-native (the reference Provider CLI), the sibling of the SEA
// build's scripts/esbuild-sea.mjs.
//
// Why: the `bin` field in package.json currently points at ./bin/quay-native.ts,
// which only Node >=23 executes natively (type-stripping). But the distributed
// npm-pack tarball's `bin` must run on the declared floor (Node 20). This script
// transpiles+bundles bin/quay-native.ts into a single self-contained ESM
// `dist/quay-native.js` that runs on Node 20.
//
// Output format is ESM (not the SEA build's CJS): a plain npm-pack tarball has
// none of Node-SEA's ESM-main-module constraint, and `import.meta.url` is
// preserved by esbuild's ESM output — so src/manifest.ts's __dirname-relative
// read of provider.yml works correctly (dist/ is a sibling of provider.yml in
// the package root; `import.meta.url` in the bundle resolves to dist/quay-native.js,
// so `..` correctly resolves to the package root).
//
// LOAD-BEARING `banner`: a naive ESM bundle crashes at runtime with
// `Error: Dynamic require of "process" is not supported` from yaml's CJS-interop
// shim — esbuild's ESM-output `__require` polyfill cannot satisfy yaml's dynamic
// require() without a real `require` in scope. The banner injects a
// createRequire-backed `require`, which resolves it (empirically verified, same
// pattern as packages/quay/scripts/build-dist.mjs).
//
// Invoked by scripts/build-dist.sh (and, transitively, by CI).

import * as esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");

const DEFAULT_ENTRY = path.resolve(pkgDir, "bin/quay-native.ts");
const DEFAULT_OUTFILE = path.resolve(pkgDir, "dist/quay-native.js");

// The load-bearing banner (see header comment). Exported so tests can pin it.
export const REQUIRE_BANNER =
  'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);';

/**
 * Build the ESM dist bundle. Resolves the entrypoint from (in order) the
 * `entry` option, the QUAY_NATIVE_BUILD_DIST_ENTRY env var (a testability hook),
 * then bin/quay-native.ts. Throws (loudly, non-zero when run as a script) on any
 * esbuild failure or a reported-success-but-missing outfile.
 * @returns the absolute path of the written bundle.
 */
export async function buildDist(opts = {}) {
  const entry = opts.entry ?? process.env.QUAY_NATIVE_BUILD_DIST_ENTRY ?? DEFAULT_ENTRY;
  const outfile = opts.outfile ?? DEFAULT_OUTFILE;

  let result;
  try {
    result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile,
      loader: { ".json": "json", ".yml": "text" },
      banner: { js: REQUIRE_BANNER },
      logLevel: "info",
    });
  } catch (err) {
    console.error("esbuild.build() threw:", err);
    throw err;
  }

  if (result.errors && result.errors.length > 0) throw new Error(`esbuild reported errors: ${JSON.stringify(result.errors)}`);
  if (!fs.existsSync(outfile)) throw new Error(`esbuild reported success but outfile is missing: ${outfile}`);

  console.log(`esbuild: quay-native ESM dist bundle written to ${outfile} (createRequire banner injected).`);
  return outfile;
}

// Run as a script (build-dist.sh / CI): build the default target, exit non-zero
// on any failure. Skipped when imported (e.g. by the test), so coverage of the
// build logic is measured in-process.
const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) buildDist().catch(() => process.exit(1));
