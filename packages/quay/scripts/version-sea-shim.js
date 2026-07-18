// version-sea-shim.js — SEA-build-only replacement for src/version.js.
//
// M01-dist (exp5, iteration 0): Node SEA bundling flattens ESM into CJS
// (esbuild --format=cjs), which makes `import.meta.url` empty. This breaks
// version.js's `__dirname`-relative `readFileSync(...package.json)` read at
// module-init time (QX-035, ENV-001 mitigation: reads `version` for the MCP
// tool description / _version field) — and even if import.meta.url had
// resolved, the SEA binary is not actually located at the source tree path
// at runtime, so a relative-file read would never work there either.
//
// Packaging-only fix: embed package.json's version at BUILD time via
// esbuild's `json` loader (see scripts/esbuild-sea.mjs) instead of reading
// it from disk at runtime. Substituted in only for the SEA build via an
// esbuild plugin that redirects ./version.js -> this file; the normal
// `node bin/quay.js` path is unchanged — src/version.js (the real module)
// is unmodified.
import pkg from "../package.json";

export const QUAY_VERSION = pkg.version;
