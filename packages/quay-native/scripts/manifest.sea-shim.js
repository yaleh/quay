// manifest.sea-shim.js — SEA-build-only replacement for src/manifest.js.
//
// M01-dist (exp5): Node SEA bundling flattens ESM into CJS, which makes
// `import.meta.url` empty (esbuild warning), breaking manifest.js's
// `__dirname`-relative read of `provider.yml` at module-init time (the SEA
// binary isn't actually located at the source tree path at runtime anyway,
// so a relative-file read would never have worked even if import.meta.url
// had resolved). Packaging-only fix: embed provider.yml's contents at BUILD
// time via esbuild's `text` loader (see scripts/build-sea.sh --alias) so the
// SEA binary needs no filesystem read for its own static manifest.
//
// This file is NEVER used by the normal `node ./bin/quay-native.js` path —
// only substituted in via esbuild --alias:./src/manifest.js=./scripts/manifest.sea-shim.js
// during the SEA build. src/manifest.js (the real module) is unchanged.

import YAML from "yaml";
// esbuild `text` loader (configured in scripts/build-sea.sh) inlines this
// file's contents as a JS string constant at build time — no runtime FS read.
import providerYamlText from "../provider.yml";

export function readManifest(_manifestPath) {
  return YAML.parse(providerYamlText);
}
