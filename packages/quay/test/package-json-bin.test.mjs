// package-json-bin.test.mjs — M120 Stage 2.1 (DIR-060).
//
// Pins the distribution-manifest fields the Node-floor fix depends on, and
// GUARDS the fields the plan/proposal explicitly forbid changing:
//   - `bin.quay` points at the transpiled ./dist/quay.js (Node-20-runnable),
//     NOT the native-.ts entrypoint (which needs Node >=23).
//   - `files` ships "dist" (plus the pre-existing bin/src/docs entries).
//   - `exports` is UNCHANGED — still ./src/*.ts. Repointing it to ./dist/*.js
//     was an architect-review-REJECTED design (breaks ERR_MODULE_NOT_FOUND for
//     ~29 test files that resolve quay/* subpaths before dist/ is built). This
//     is a hard regression guard.
//   - `engines.node` stays ">=20.0.0" — the declared floor this milestone
//     protects (CI runner version is bumped separately; engines is untouched).
//   - package.sh builds dist/ (via build-dist.sh) BEFORE `npm pack`.
//
// Test-first: RED against today's bin (./bin/quay.ts) / GREEN after the edit.
// This is a 100%-of-changed-fields manifest assertion (grep/parse mechanical
// check), stated honestly — NOT a fabricated line-coverage %.
//
// Run: node --test packages/quay/test/package-json-bin.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const packageSh = readFileSync(path.join(pkgDir, "scripts", "package.sh"), "utf8");

test("bin.quay points at the transpiled ./dist/quay.js (Node-20-runnable), not ./bin/quay.ts", () => {
  assert.equal(pkg.bin.quay, "./dist/quay.js");
});

test("files ships the dist bundle plus the pre-existing entries", () => {
  assert.ok(Array.isArray(pkg.files));
  assert.ok(pkg.files.includes("dist"), 'files must include "dist"');
  for (const entry of ["README.md", "CHANGELOG.md", "LICENSE.md", "bin", "src"]) {
    assert.ok(pkg.files.includes(entry), `files must still include "${entry}"`);
  }
});

test("REGRESSION GUARD: exports is unchanged — still ./src/*.ts, never repointed to ./dist/*.js", () => {
  assert.deepEqual(pkg.exports, {
    "./adr-store": "./src/adr-store.ts",
    "./document-store": "./src/document-store.ts",
    "./contract-validator": "./src/contract-validator.ts",
  });
  for (const target of Object.values(pkg.exports)) {
    assert.match(target, /^\.\/src\/.*\.ts$/, `exports target ${target} must stay a ./src/*.ts path`);
    assert.doesNotMatch(target, /dist/, "no exports target may point into dist/");
  }
});

test("engines.node stays >=20.0.0 (the declared distribution floor is untouched)", () => {
  assert.equal(pkg.engines.node, ">=20.0.0");
});

test("package.sh builds dist/ (build-dist.sh) BEFORE npm pack", () => {
  // The build INVOCATION line (not a comment mention).
  const buildInvoke = packageSh.match(/^\s*bash\s+"\$\{SCRIPT_DIR\}\/build-dist\.sh"\s*$/m);
  assert.ok(buildInvoke, "package.sh must invoke build-dist.sh as a command");
  // The `npm pack` COMMAND line (a bare `npm pack`, not the header-comment mention).
  const packCmd = packageSh.match(/^\s*npm pack\s*$/m);
  assert.ok(packCmd, "package.sh must run `npm pack` as a command");
  assert.ok(
    buildInvoke.index < packCmd.index,
    "the build-dist.sh invocation must run before the npm pack command"
  );
});
