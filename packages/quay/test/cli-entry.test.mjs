// @test-group product
// cli-entry.test.mjs — tests for packages/quay/test/helpers/cli-entry.mjs
// (gap-tests-spawn-cli-from-ts-source). The helper resolves a quay CLI entry
// ONCE per process, preferring the prebuilt `dist/<name>.js` bundle over the
// `.ts` source entry — but ONLY when the bundle is present AND fresh (mtime >=
// the newest `src/**/*.ts` + `bin/*.ts`). A stale bundle silently passing tests
// over old code is the failure mode the freshness check exists to make
// impossible.
//
// This file lives at packages/quay/test/cli-entry.test.mjs (NOT under
// test/helpers/) so scripts/test.sh's `packages/*/test/*.test.mjs` glob picks
// it up; it imports the pure resolution machinery from ./helpers/cli-entry.mjs.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveCliEntry,
  newestSourceMtime,
  fallbackWarning,
  QUAY_CLI,
  QUAY_NATIVE_CLI,
} from "./helpers/cli-entry.mjs";

// Every fake tree is removed once at the end of this file (the doc-store/adr-store carrier-array
// + after() pattern) — a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** Build a fake package tree: {src/, bin/, dist/} with the given .ts/.js files. */
function makeFakePkg(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-entry-test-"));
  _tmpDirs.push(root);
  for (const [rel, body] of Object.entries(t.files ?? {})) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  // Set explicit mtimes (mtimeMs) for files that need them.
  for (const [rel, mtimeMs] of Object.entries(t.mtimes ?? {})) {
    const full = path.join(root, rel);
    fs.utimesSync(full, new Date(mtimeMs), new Date(mtimeMs));
  }
  return root;
}

test("resolveCliEntry returns the dist bundle when present and fresh", () => {
  const root = makeFakePkg({
    files: {
      "src/index.ts": "export const x = 1;\n",
      "bin/quay.ts": "console.log('source');\n",
      "dist/quay.js": "console.log('bundle');\n",
    },
    mtimes: {
      "src/index.ts": 1000,
      "bin/quay.ts": 2000,
      "dist/quay.js": 3000, // newer than both sources
    },
  });
  const res = resolveCliEntry(root, { binName: "quay.ts", distName: "quay.js" });
  assert.equal(res.status, "bundle");
  assert.equal(res.entry, path.join(root, "dist/quay.js"));
  assert.equal(fallbackWarning(res), null);
});

test("resolveCliEntry falls back to the .ts source when dist is MISSING", () => {
  const root = makeFakePkg({
    files: { "src/index.ts": "export const x = 1;\n", "bin/quay.ts": "console.log('source');\n" },
  });
  const res = resolveCliEntry(root, { binName: "quay.ts", distName: "quay.js" });
  assert.equal(res.status, "missing-fallback");
  assert.equal(res.entry, path.join(root, "bin/quay.ts"));
  const warn = fallbackWarning(res);
  assert.ok(warn && warn.includes("MISSING"), `warning mentions MISSING: ${warn}`);
});

test("resolveCliEntry falls back to the .ts source when dist is STALE (source newer)", () => {
  const root = makeFakePkg({
    files: {
      "src/index.ts": "export const x = 1;\n",
      "bin/quay.ts": "console.log('source');\n",
      "dist/quay.js": "console.log('bundle');\n",
    },
    mtimes: {
      "src/index.ts": 9000, // source edited AFTER the bundle was built
      "dist/quay.js": 3000,
    },
  });
  const res = resolveCliEntry(root, { binName: "quay.ts", distName: "quay.js" });
  assert.equal(res.status, "stale-fallback");
  assert.equal(res.entry, path.join(root, "bin/quay.ts"));
  const warn = fallbackWarning(res);
  assert.ok(warn && warn.includes("STALE"), `warning mentions STALE: ${warn}`);
});

test("resolveCliEntry treats an equal mtime as fresh (>=, not >)", () => {
  const root = makeFakePkg({
    files: {
      "src/index.ts": "export const x = 1;\n",
      "dist/quay.js": "console.log('bundle');\n",
    },
    mtimes: { "src/index.ts": 5000, "dist/quay.js": 5000 },
  });
  const res = resolveCliEntry(root, { binName: "quay.ts", distName: "quay.js" });
  assert.equal(res.status, "bundle");
});

test("newestSourceMtime scans src/ recursively and includes bin/", () => {
  const root = makeFakePkg({
    files: {
      "src/a.ts": "a",
      "src/deep/nested/b.ts": "b",
      "src/deep/nested/ignored.mjs": "not-ts",
      "bin/quay.ts": "c",
      "dist/quay.js": "d",
    },
    mtimes: {
      "src/a.ts": 1000,
      "src/deep/nested/b.ts": 7000, // deepest newest
      "bin/quay.ts": 4000,
      "dist/quay.js": 9000,
    },
  });
  // newest .ts mtime is bin/quay.ts (4000)? No — deep/nested/b.ts = 7000 is newest.
  assert.equal(newestSourceMtime(root), 7000);
});

test("QUAY_CLI and QUAY_NATIVE_CLI are resolved absolute paths", () => {
  assert.equal(typeof QUAY_CLI, "string");
  assert.ok(path.isAbsolute(QUAY_CLI), "QUAY_CLI is absolute");
  assert.equal(typeof QUAY_NATIVE_CLI, "string");
  assert.ok(path.isAbsolute(QUAY_NATIVE_CLI), "QUAY_NATIVE_CLI is absolute");
  // The real constants must point at the real package trees in this repo.
  assert.ok(QUAY_CLI.includes("packages" + path.sep + "quay"), `QUAY_CLI inside packages/quay: ${QUAY_CLI}`);
  assert.ok(QUAY_NATIVE_CLI.includes("quay-native"), `QUAY_NATIVE_CLI inside packages/quay-native: ${QUAY_NATIVE_CLI}`);
});

test("newestSourceMtime returns 0 for a tree with no .ts files", () => {
  const root = makeFakePkg({ files: { "dist/quay.js": "bundle-only" } });
  assert.equal(newestSourceMtime(root), 0);
});
