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

await esbuild.build({
  entryPoints: [path.resolve(pkgDir, "bin/quay-native.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.resolve(pkgDir, "dist-sea/quay-native-bundle.cjs"),
  plugins: [redirectManifestPlugin],
  loader: { ".yml": "text" },
});

console.log("esbuild: quay-native bundle written (manifest.js -> sea-shim redirected).");
