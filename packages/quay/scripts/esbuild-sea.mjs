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
const versionReal = path.resolve(pkgDir, "src/version.js");
const versionShim = path.resolve(pkgDir, "scripts/version-sea-shim.js");

const redirectVersionPlugin = {
  name: "redirect-version-to-sea-shim",
  setup(build) {
    build.onResolve({ filter: /version\.js$/ }, (args) => {
      const resolved = path.resolve(args.resolveDir, args.path);
      if (resolved === versionReal) {
        return { path: versionShim };
      }
      return null;
    });
  },
};

await esbuild.build({
  entryPoints: [path.resolve(pkgDir, "bin/quay.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.resolve(pkgDir, "dist-sea/quay-bundle.cjs"),
  plugins: [redirectVersionPlugin],
  loader: { ".json": "json" },
});

console.log("esbuild: quay bundle written (version.js -> sea-shim redirected).");
