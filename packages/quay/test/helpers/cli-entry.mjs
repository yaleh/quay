// cli-entry.mjs — packages/quay/test/helpers/
//
// Resolves the quay CLI entrypoint ONCE per process, preferring the prebuilt
// `dist/<name>.js` bundle over the `.ts` source entry. The prebuilt bundle
// skips the full TypeScript module-graph load (~2.1 s per invocation), which
// is the single wall-clock lever for packages/quay/test/cli.test.mjs
// (gap-tests-spawn-cli-from-ts-source: 67 spawns of `bin/quay.ts` at 3.5 s each
// vs `dist/quay.js` at 1.4 s).
//
// Freshness is CHECKED, not assumed: the bundle is used only when its mtime is
// >= the newest mtime of any `src/**/*.ts` + `bin/*.ts` under the package
// root. A stale bundle silently passing tests over old code is the one failure
// mode that matters — this makes it impossible rather than unlikely. When the
// bundle is stale OR missing, the helper falls back to the `.ts` source entry
// and prints a one-line stderr warning (once per process; the module is
// imported once and the constants below are resolved at import time).
//
// Exports (this module is the LOAD-BEARING carrier also reused by
// gap-tests-use-cli-where-module-import-suffices):
//   QUAY_CLI          — resolved Core CLI entry (packages/quay)
//   QUAY_NATIVE_CLI   — resolved Native provider CLI entry (packages/quay-native)
//   resolveCliEntry() — the pure resolution logic (testable, deterministic)
//   newestSourceMtime() — pure recursive source scan (testable)
//   fallbackWarning() — one-line warning string for a fallback resolution
//
// Design note: the tests live at packages/quay/test/cli-entry.test.mjs (NOT
// under test/helpers/) so scripts/test.sh's `packages/*/test/*.test.mjs` glob
// picks them up. The resolution machinery is exported pure precisely so those
// tests can exercise every branch against temp trees with controlled mtimes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Package roots: helpers/ -> packages/quay; helpers/../../.. -> packages.
export const QUAY_PKG_DIR = path.resolve(__dirname, "../..");
export const QUAY_NATIVE_PKG_DIR = path.resolve(__dirname, "../../../quay-native");

/**
 * Newest mtime (ms since epoch) of every `*.ts` file under `pkgDir/src` and
 * `pkgDir/bin`, recursively. Returns 0 when there are no `.ts` sources at all
 * (a bundle-only tree is then trivially "fresh"). Missing dirs are skipped.
 */
export function newestSourceMtime(pkgDir) {
  let newest = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // dir absent — nothing to scan
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".ts")) {
        const m = fs.statSync(full).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  for (const sub of ["src", "bin"]) walk(path.join(pkgDir, sub));
  return newest;
}

/**
 * Resolve the CLI entry for one package, preferring the prebuilt dist bundle
 * when present and fresh.
 *
 * @param {string} pkgDir package root (must contain src/, bin/, and optionally dist/)
 * @param {{binName: string, distName: string}} opts `bin/quay.ts` + `dist/quay.js`
 * @returns {{entry: string, bundlePath: string, sourcePath: string,
 *            status: "bundle"|"stale-fallback"|"missing-fallback",
 *            distMtime: number, srcNewest: number}}
 */
export function resolveCliEntry(pkgDir, { binName, distName }) {
  const sourcePath = path.join(pkgDir, "bin", binName);
  const bundlePath = path.join(pkgDir, "dist", distName);
  const srcNewest = newestSourceMtime(pkgDir);
  let distMtime = 0;
  try {
    distMtime = fs.statSync(bundlePath).mtimeMs;
  } catch {
    distMtime = 0; // missing
  }
  if (distMtime > 0 && distMtime >= srcNewest) {
    return { entry: bundlePath, bundlePath, sourcePath, status: "bundle", distMtime, srcNewest };
  }
  const status = distMtime === 0 ? "missing-fallback" : "stale-fallback";
  return { entry: sourcePath, bundlePath, sourcePath, status, distMtime, srcNewest };
}

/**
 * One-line stderr warning for a fallback resolution, or null when the bundle
 * was used. Exported pure so tests can assert the exact wording.
 */
export function fallbackWarning(res) {
  if (res.status === "stale-fallback") {
    return `cli-entry: ${res.bundlePath} is STALE (src/bin newer); falling back to ${res.sourcePath} — run scripts/test.sh to rebuild`;
  }
  if (res.status === "missing-fallback") {
    return `cli-entry: ${res.bundlePath} is MISSING; falling back to ${res.sourcePath} — run scripts/test.sh to build`;
  }
  return null;
}

function warnOnce(res) {
  const msg = fallbackWarning(res);
  if (msg) console.error(msg);
}

// ── resolved once per process ──────────────────────────────────────────────
const _core = resolveCliEntry(QUAY_PKG_DIR, { binName: "quay.ts", distName: "quay.js" });
const _native = resolveCliEntry(QUAY_NATIVE_PKG_DIR, { binName: "quay-native.ts", distName: "quay-native.js" });

warnOnce(_core);
warnOnce(_native);

export const QUAY_CLI = _core.entry;
export const QUAY_NATIVE_CLI = _native.entry;
