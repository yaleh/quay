#!/usr/bin/env node
// stamp-version.mjs — the Node-20-safe way IN to `scripts/stamp-version.ts`.
//
// ── WHY THIS FILE EXISTS (it is a RUNNER, not a second implementation) ────────────────────────────
// `stamp-version.ts` is source-form TypeScript, so plain `node` can only run it with
// `--experimental-strip-types`, which landed in Node 22.6. Two of its three callers are pinned to the
// repo's declared floor (`package.json` `engines: >=20`):
//   • `packages/quay/scripts/package.sh` — run by ci.yml's `dist-verify-node-floor` job on Node 20
//     (that job's whole point is that BUILDING the artifact works on the floor, not just running it);
//   • `plugin/scripts/sync-vendor.sh` — its npm-postinstall caller runs on whatever Node the checkout
//     has, i.e. the declared floor.
// Measured, not assumed: `npx node@20 --experimental-strip-types …` ⇒ `node: bad option`.
//
// The floor-safe way to reach TypeScript in this repo is already established: esbuild parses TS with
// its OWN parser, which is exactly why `packages/quay/scripts/build-dist.sh`'s
// `node scripts/build-dist.mjs` runs on Node 20 (see that script's own comment). This runner applies
// the same mechanism to the version generator: bundle the source-form entry with esbuild, then run the
// bundle on whatever Node invoked us. Both callers above already depend on esbuild (package.sh runs
// build-dist.sh before its version gate; sync-vendor.sh runs it as part of the build), so this adds no
// new precondition.
//
// ⛔ It must NOT grow its own copy of the carrier table or the judgment — everything lives in
// `stamp-version.ts` / `version-carriers.ts`, and this file only bundles it, calls its `main(argv)`, and
// forwards the exit code. A second implementation here would be a drift source that no check compares
// against the first.
//
// ⛔ It calls `main` rather than SPAWNING the bundle: the bundled copy's `argv[1]` is a temp path, so a
// bundle whose only entry is an `argv[1]`-sniffing main-guard loads, matches nothing, and exits 0 —
// "the generator ran" for a run that did nothing (measured while building this file, which is why
// `stamp-version.ts` exports `main` at all).
//
// Usage: node scripts/stamp-version.mjs [same flags as stamp-version.ts]

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const ENTRY = resolve(HERE, 'stamp-version.ts');

const args = process.argv.slice(2);

let esbuild;
try {
  ({ build: esbuild } = await import('esbuild'));
} catch (e) {
  console.error(
    `stamp-version.mjs: could not load esbuild (${e?.message ?? e}) — it is a devDependency of this ` +
      'repo (see the header: the floor-safe TS path). Run `npm install` at the repo root.',
  );
  process.exit(2);
}

const outDir = mkdtempSync(join(tmpdir(), 'stamp-version-'));
let code;
try {
  await esbuild({
    entryPoints: [ENTRY],
    outfile: join(outDir, 'bundle.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'warning',
  });
  const mod = await import(pathToFileURL(join(outDir, 'bundle.mjs')).href);
  if (typeof mod.main !== 'function') {
    console.error('stamp-version.mjs: the bundle exports no `main(argv)` — refusing to report success.');
    code = 2;
  } else {
    // REPO_ROOT (this file's parent), not the bundle's own location: the bundle lives in a temp dir, so
    // a root derived from its `import.meta.url` would be `/tmp` (measured — the first bundled run
    // looked for `/tmp/VERSION`).
    code = await mod.main(args, { repoRoot: REPO_ROOT });
  }
} catch (e) {
  console.error(`stamp-version.mjs: ${e?.stack ?? e}`);
  code = 2;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
process.exit(typeof code === 'number' ? code : 2);
