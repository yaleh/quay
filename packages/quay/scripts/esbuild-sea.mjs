// esbuild-sea.mjs — programmatic esbuild build for the quay (Core) SEA
// bundle. Invoked by build-sea.sh. Uses an esbuild plugin (not the CLI
// --alias flag, which only supports bare package-name aliasing, not
// relative paths) to redirect src/version.js -> scripts/version-sea-shim.js
// for this build only. See version-sea-shim.js's header comment for why.
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const versionReal = path.resolve(pkgDir, "src/version.ts");
const versionShim = path.resolve(pkgDir, "scripts/version-sea-shim.js");

const redirectVersionPlugin = {
  name: "redirect-version-to-sea-shim",
  setup(build) {
    build.onResolve({ filter: /version\.(js|ts)$/ }, (args) => {
      const resolved = path.resolve(args.resolveDir, args.path);
      if (resolved === versionReal) {
        return { path: versionShim };
      }
      return null;
    });
  },
};

const outfile = path.resolve(pkgDir, "dist-sea/quay-bundle.cjs");

try {
  const result = await esbuild.build({
    entryPoints: [path.resolve(pkgDir, "bin/quay.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    plugins: [redirectVersionPlugin],
    loader: { ".json": "json" },
    // Same additional resolution root as build-dist.mjs (see bundleNodePaths there). Its original
    // reason was that this bundle inlined plugin/scripts/driver-shared.ts via src/serve.ts; since
    // tasks/gap-arch-reverse-edges-zero every inlined source is under packages/quay/src/, so no
    // out-of-package importer remains. Kept for the same reason as there: it is additive, and it
    // pins that a self-contained bundle's bare specifiers resolve against the bundle's own package.
    nodePaths: [path.join(pkgDir, "node_modules")],
    logLevel: "info",
  });
  if (result.errors && result.errors.length > 0) {
    console.error("esbuild reported errors but did not throw:", result.errors);
    process.exit(1);
  }
} catch (err) {
  // M01-dist iteration-1: Windows CI hit a silent esbuild.build() failure
  // (SEA config later reported the outfile missing, with no visible esbuild
  // error in the log — the ordering artifact suggested an unhandled/async
  // failure). Make any build failure loud and non-zero-exit explicitly,
  // rather than relying on an unhandled promise rejection's implicit exit
  // code, which can interleave unpredictably with prior stdout under
  // Windows' pipe buffering.
  console.error("esbuild.build() threw:", err);
  process.exit(1);
}

// Fail loudly (not just via SEA's later, less specific error) if esbuild
// reported success but the file genuinely isn't there — narrows the
// diagnosis if this recurs on a platform we can't repro locally.
const fs = await import("node:fs");
if (!fs.existsSync(outfile)) {
  console.error(`esbuild reported success but outfile is missing: ${outfile}`);
  process.exit(1);
}
console.log(`esbuild: quay bundle written to ${outfile} (version.js -> sea-shim redirected).`);
