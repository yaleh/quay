#!/usr/bin/env node
// version-consistency-check.mjs — the Node-20-safe way IN to `scripts/version-consistency-check.ts`.
//
// ── WHY THIS FILE EXISTS (it is a RUNNER, not a second implementation) ───────────────────────────
// `version-consistency-check.ts` is source-form TypeScript, so plain `node` can only run it with
// `--experimental-strip-types`, which landed in Node 22.6. The checker is now wired into
// `plugin/scripts/sync-vendor.sh`'s build (gap-release-bundle-embeds-dev-version-after-stamp), and
// that script's caller is the ROOT `postinstall` (`bash plugin/scripts/sync-vendor.sh || true`) on
// the declared floor (`package.json` `engines: >=20`); the same script is reached by
// `packages/quay/scripts/package.sh`, which ci.yml's `dist-verify-node-floor` job runs on Node 20.
// Measured, not assumed: `npx node@20 --experimental-strip-types …` ⇒ `node: bad option`.
//
// The floor-safe way to reach TypeScript in this repo is already established and this file applies
// it verbatim: esbuild parses TS with its OWN parser (exactly why `packages/quay/scripts/build-dist.mjs`
// runs on Node 20), so we bundle the source-form entry and run the bundle on whatever Node invoked
// us. `scripts/stamp-version.mjs` is the sibling runner for `stamp-version.ts` and this file mirrors
// it — the same two callers already depend on esbuild, so this adds no new precondition.
//
// ⛔ It must NOT grow its own copy of the judgment — everything lives in `version-consistency-check.ts`
// (and the shared carrier table `version-carriers.ts` it imports), and this file only bundles it,
// calls its exported `main(argv, env)`, and forwards the exit code. A second implementation here
// would be a drift source that no check compares against the first.
//
// ⛔ It calls `main` rather than SPAWNING the bundle: the bundled copy's `argv[1]` is a temp path, so
// a bundle whose only entry is an `argv[1]`-sniffing main-guard loads, matches nothing, and exits 0 —
// "the checker ran" for a run that judged nothing (hard rule 3b). That is why
// `version-consistency-check.ts` exports `main` at all (same reason as `stamp-version.ts`).
//
// Usage: node scripts/version-consistency-check.mjs [same flags as version-consistency-check.ts]

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const ENTRY = resolve(HERE, 'version-consistency-check.ts');

const args = process.argv.slice(2);

let esbuild;
try {
  ({ build: esbuild } = await import('esbuild'));
} catch (e) {
  console.error(
    `version-consistency-check.mjs: could not load esbuild (${e?.message ?? e}) — it is a devDependency of ` +
      'this repo (see the header: the floor-safe TS path). Run `npm install` at the repo root.',
  );
  process.exit(2);
}

const outDir = mkdtempSync(join(tmpdir(), 'version-consistency-check-'));
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
    console.error('version-consistency-check.mjs: the bundle exports no `main(argv)` — refusing to report success.');
    code = 2;
  } else {
    // REPO_ROOT (this file's parent), not the bundle's own location: the bundle lives in a temp dir,
    // so a root derived from its `import.meta.url` would be `/tmp`. Only used as the DEFAULT --root;
    // every build-time caller passes an explicit tree.
    code = mod.main(args, { repoRoot: REPO_ROOT });
  }
} catch (e) {
  console.error(`version-consistency-check.mjs: ${e?.stack ?? e}`);
  code = 2;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
process.exit(typeof code === 'number' ? code : 2);
