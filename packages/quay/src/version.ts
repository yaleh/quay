// version.ts — QUAY_VERSION is EMBEDDED at build time, not read from disk at
// runtime, so the bundled dist is truly self-contained.
//
// The `import pkg from "../package.json"` below is inlined by esbuild's `json`
// loader when scripts/build-dist.mjs bundles bin/quay.ts -> dist/quay.js — the
// same build-time-embed mechanism the SEA build's scripts/version-sea-shim.js
// uses. The resulting bundle carries the version string INSIDE the file, so it
// never readFileSyncs a sibling package.json at startup.
//
// That is the fix for gap-dist-runtime-not-self-contained-reads-external-package-json:
// the vendored plugin/vendor/quay/dist/quay.js (and any path-2 install that
// lays down dist/quay.js ALONE) runs standalone — `node <bundle> --version`
// returns the real version with no ENOENT, even with zero package.json beside
// it. In the source dev path (`node --experimental-strip-types bin/quay.ts`)
// Node resolves the same JSON import the same way, so the dev CLI keeps
// printing the real version too.
import pkg from "../package.json" with { type: "json" };

export const QUAY_VERSION: string = pkg.version;
