// @test-group product
// package-json-bin.test.mjs — M120 Stage 2.1 (DIR-060).
//
// Pins the distribution-manifest fields the Node-floor fix depends on, and
// GUARDS the fields the plan/proposal explicitly forbid changing:
//   - `bin.quay` points at the transpiled ./dist/quay.js (Node-20-runnable),
//     NOT the native-.ts entrypoint (which needs Node >=23).
//   - `files` ships "dist" (plus the pre-existing bin/src/docs entries).
//   - `exports` for the IN-REPO-RESOLVED subpaths is unchanged — still ./src/*.ts.
//     Repointing THOSE to ./dist/*.js was an architect-review-REJECTED design
//     (breaks ERR_MODULE_NOT_FOUND for ~29 files that resolve quay/* subpaths
//     before dist/ is built). Hard regression guard.
//     The ONE reviewed exception, added 2026-10-09 by
//     gap-dashboard-kernel-export-for-cross-project-reuse: `quay/dashboard-kernel`
//     is dist/-backed, because its only consumer is an EXTERNAL install — where a
//     `.ts` target cannot work at all (Node refuses to type-strip under
//     node_modules: ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) — and nothing
//     in-repo resolves it (asserted mechanically below, which is what keeps the
//     exception from reopening the rejected failure mode).
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
import { readFileSync, readdirSync } from "node:fs";
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

// The subpaths resolved IN-REPO (`import … from "quay/adr-store"` and friends, in product and test
// files that run BEFORE dist/ is ever built). They MUST stay ./src/*.ts: repointing them into dist/
// is the architect-review-REJECTED design this guard exists for — ~29 files would fail with
// ERR_MODULE_NOT_FOUND until someone ran a build.
const IN_REPO_RESOLVED_SUBPATHS = ["./adr-store", "./document-store", "./contract-validator", "./init"];
// DIR-098 added ./init; gap-dashboard-kernel-export-for-cross-project-reuse added the two
// ./dashboard-kernel* entries. Enumerating the key set keeps a DROPPED subpath as loud as an added one.
const ALL_SUBPATHS = [...IN_REPO_RESOLVED_SUBPATHS, "./dashboard-kernel", "./dashboard-kernel/vectors"];

const repoRoot = path.resolve(pkgDir, "..", "..");

/** Every code file under the given roots (no node_modules, no dotdirs) — the surface a bare-specifier
 *  import could actually live in. */
function codeFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) codeFiles(p, out);
    else if (/\.(mjs|cjs|js|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Repo-relative paths of code files that actually RESOLVE `specifier` (a `from`/`require`/`import()`
 *  /`resolve()` call), not files that merely mention it in prose. Comments and READMEs quote the
 *  specifier in backticks and must not count. */
function filesResolvingBareSpecifier(specifier) {
  const call = new RegExp(`(\\bfrom|\\brequire\\(|\\bimport\\(|\\bresolve\\()\\s*"${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  const hits = [];
  for (const root of ["packages", "plugin", "scripts"]) {
    for (const file of codeFiles(path.join(repoRoot, root))) {
      if (call.test(readFileSync(file, "utf8"))) hits.push(path.relative(repoRoot, file));
    }
  }
  return hits.sort();
}

test("REGRESSION GUARD: the in-repo-resolved ./src/*.ts exports stay ./src/*.ts — never repointed into dist/", () => {
  assert.deepEqual(Object.keys(pkg.exports).sort(), [...ALL_SUBPATHS].sort(),
    "the export subpath set is pinned in BOTH directions — a silently dropped subpath breaks consumers just as loudly as an added one");
  for (const subpath of IN_REPO_RESOLVED_SUBPATHS) {
    const target = pkg.exports[subpath];
    assert.match(target, /^\.\/src\/.*\.ts$/, `exports target ${target} must stay a ./src/*.ts path`);
    assert.doesNotMatch(target, /dist/, "no exports target may point into dist/");
  }
});

test("the ONE dist/-backed export is the external-only kernel subpath — and NOTHING in-repo resolves it", () => {
  // WHY AN EXCEPTION IS NECESSARY (measured, not assumed): Node REFUSES to strip TypeScript types
  // for any file under node_modules — `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. The four
  // subpaths above only work in-repo because npm workspaces SYMLINK the package, so their realpath
  // lands outside node_modules; a genuine external `npm install` copies the package INTO
  // node_modules, where a `.ts` target fails outright. `quay/dashboard-kernel` exists to serve
  // exactly that external consumer (claudecodeui is the first), so its runtime target must be
  // built JS — with a `types` condition so TypeScript consumers still get the real signatures.
  //
  // WHY THIS IS NOT THE REJECTED DESIGN: the rejected repoint broke in-repo resolvers that run
  // before any build. This subpath has none — and that absence is ASSERTED below rather than
  // asserted by hand, so adding an in-repo resolver later (which would resurrect the failure mode)
  // fails this test instead of surfacing as ERR_MODULE_NOT_FOUND in someone else's suite.
  assert.deepEqual(pkg.exports["./dashboard-kernel"], { types: "./src/dashboard-kernel.ts", default: "./dist/dashboard-kernel.js" });
  assert.equal(pkg.exports["./dashboard-kernel/vectors"], "./src/dashboard-kernel-vectors.json");

  const resolvers = filesResolvingBareSpecifier("quay/dashboard-kernel")
    // dashboard-kernel.test.mjs is the PUBLISH-SURFACE test: its occurrence is the external
    // consumer's probe script (a string it writes into a temp dir), not an in-repo resolution.
    .filter((rel) => rel !== "packages/quay/test/dashboard-kernel.test.mjs");
  assert.deepEqual(resolvers, [],
    `a dist/-backed subpath must have no in-repo resolver (those run before dist/ exists) — found: ${resolvers.join(", ")}`);
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
