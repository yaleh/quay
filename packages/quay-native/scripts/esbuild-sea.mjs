// esbuild-sea.mjs — programmatic esbuild build for the quay-native SEA bundle.
// Invoked by build-sea.sh. Uses an esbuild plugin (not the CLI --alias flag,
// which only supports bare package-name aliasing, not relative paths) to
// redirect src/manifest.js -> scripts/manifest.sea-shim.js for this build
// only. See build-sea.sh's header comment for why.
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const manifestReal = path.resolve(pkgDir, "src/manifest.js");
const manifestShim = path.resolve(pkgDir, "scripts/manifest.sea-shim.js");

const redirectManifestPlugin = {
  name: "redirect-manifest-to-sea-shim",
  setup(build) {
    build.onResolve({ filter: /manifest\.js$/ }, (args) => {
      const resolved = path.resolve(args.resolveDir, args.path);
      if (resolved === manifestReal) {
        return { path: manifestShim };
      }
      return null;
    });
  },
};

const outfile = path.resolve(pkgDir, "dist-sea/quay-native-bundle.cjs");

try {
  const result = await esbuild.build({
    entryPoints: [path.resolve(pkgDir, "bin/quay-native.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    plugins: [redirectManifestPlugin],
    loader: { ".yml": "text" },
    logLevel: "info",
  });
  if (result.errors && result.errors.length > 0) {
    console.error("esbuild reported errors but did not throw:", result.errors);
    process.exit(1);
  }
} catch (err) {
  // M01-dist iteration-1: mirrors the same hardening added to
  // packages/quay/scripts/esbuild-sea.mjs after a Windows CI failure where
  // the SEA config step reported a missing outfile with no visible esbuild
  // error in the log. See that file's comment for the full rationale.
  console.error("esbuild.build() threw:", err);
  process.exit(1);
}

const fs = await import("node:fs");
if (!fs.existsSync(outfile)) {
  console.error(`esbuild reported success but outfile is missing: ${outfile}`);
  process.exit(1);
}
console.log(`esbuild: quay-native bundle written to ${outfile} (manifest.js -> sea-shim redirected).`);
