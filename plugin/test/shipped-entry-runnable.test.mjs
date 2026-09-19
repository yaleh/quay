// @test-group product
// plugin/test/shipped-entry-runnable.test.mjs
//
// gap-shipped-entry-files-not-runnable (AC-233): packages/quay's `files` used to
// ship the whole `bin/` directory, so the npm tarball carried bin/quay.js (a
// source-tree probe shim) and bin/quay.ts (the raw TypeScript CLI) — files that
// LOOK like entries (exec bit / shebang / under bin/) but are structurally NOT
// runnable from an install location. Node refuses type stripping for files under
// node_modules/ (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, independent of
// Node version), and bin/quay.js is a dev-tree probe, not a declared bin.
//
// Invariant pinned here: every packed file that IS a user entry must be a
// declared `package.json` bin that runs from an install-location layout. A "user
// entry" is exactly one of:
//   (1) a declared `package.json` bin (anywhere in the package — dist/quay.js), or
//   (2) a file under the conventional bin/ directory (entry-by-location).
// The AC-233 fix removes bin/quay.js + bin/quay.ts (+ bin/node-version-check.cjs)
// from `files`, so the only shipped entry is the declared bin `./dist/quay.js`
// (a self-contained esbuild bundle — the version is embedded at build time).
//
// ⛔ exec-bit / shebang ALONE is NOT entry evidence. The tarball legitimately
// carries the whole plugin bundle (`files` includes "plugin" — the plugin IS the
// delivery surface), and every plugin/*.sh carries a shebang + exec bit: those are
// mechanisms invoked BY PATH by the driver/gate (the capability-catalog declarations),
// not user-facing commands. Treating "any shebang file" as an entry produced ~300
// false violations (plugin/scripts/*.sh, plugin/gate-scripts/*.sh,
// plugin/vendor/*/dist/*.js) — the over-wide definition this test now narrows to
// a third, non-violating state (shipped-mechanism). The enumeration stays complete
// (every packed file is classified); only "declared bin but not runnable" and
// "bin/ file that is not a declared bin" are violations.
//
// ⛔ NOT "the declared bin runs": the enumerated set is ALL packed files. A
// non-declared bin/ file that sneaks into `files` (the exact shape of the original
// defect) fails the assertion — that is the whole point. A declared bin that does
// not run from an install layout also fails it.
//
// Environment note: `npm pack --dry-run` packs `packages/quay/plugin/`, a
// GITIGNORED generated snapshot (staged by scripts/package.sh before `npm pack`,
// never tracked — .gitignore:26). It is present in the shared checkout (left over
// from a prior package.sh run) and absent in a fresh worktree, so the file SET
// differs (439 vs 95 files). The VERDICT is environment-independent: the shipped-
// mechanism state absorbs the plugin bundle in the checkout that has it, and the
// bin/ defect surface (tracked files) is present in both.
//
// Run: node --test plugin/test/shipped-entry-runnable.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PKG_DIR = path.join(REPO_ROOT, "packages", "quay");

const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));

// Normalize package.json `bin` values ("quay": "./dist/quay.js") to the
// package-relative paths npm pack reports ("dist/quay.js").
function declaredBinPaths() {
  const bin = pkgJson.bin || {};
  return Object.values(bin).map((p) => p.replace(/^\.\//, ""));
}

// `npm pack --dry-run --json` is the authoritative "what actually ships" source —
// the same mechanism AC-233's own AC4 uses. Emits a JSON array on stdout; each
// entry's `files[]` carries {path, size, mode}.
function packedFiles() {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: PKG_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out)[0].files.map((f) => ({ path: f.path, mode: f.mode }));
}

// Read the first 2 bytes — enough to detect a `#!` shebang.
function readShebangPrefix(rel) {
  const abs = path.join(PKG_DIR, rel);
  const fd = fs.openSync(abs, "r");
  try {
    const buf = Buffer.alloc(2);
    const n = fs.readSync(fd, buf, 0, 2, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

// Files npm runs via package.json `scripts` (lifecycle hooks — postinstall,
// build, ...) are invoked BY npm, not by a user, so they are not "entries" even
// when they carry a shebang (scripts/register-plugin.mjs does). Exempting them
// keeps the enumeration honest: a postinstall hook is a legitimate shipped file,
// not a broken entry, and must not be demanded to be a declared bin.
function lifecycleHookPaths() {
  const scripts = pkgJson.scripts || {};
  const paths = new Set();
  for (const cmd of Object.values(scripts)) {
    for (const m of String(cmd).matchAll(/\b([\w./-]+\.(?:mjs|cjs|js|ts))\b/g)) {
      paths.add(m[1]);
    }
  }
  return paths;
}

// "Runnable from an install-location layout": copy the declared bin into a
// node_modules/<pkg>/ directory and run it there. The node_modules path component
// is what makes a `.ts` entry structurally fail (Node refuses type stripping under
// node_modules), so running from this layout is what actually discriminates a
// runnable bundle from a `.ts` entry that can never run after install. dist/quay.js
// is a self-contained esbuild bundle (version embedded at build time), so copying
// the single file is a faithful install-location simulation.
function runsFromInstallLayout(rel) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-shipped-entry-"));
  const dest = path.join(tmp, "node_modules", "quay", rel);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(PKG_DIR, rel), dest);
    const res = spawnSync(process.execPath, [dest, "--version"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    return res.status === 0 && res.stdout.trim().length > 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The three distinguishable states of a packed file (Plan option (c) — keep the
// enumeration complete, narrow what counts as a VIOLATION). Only the first two
// "not runnable" states below are defects; "shipped mechanism" is the third,
// non-violating state that absorbs the plugin bundle's shebang-carrying .sh files.
const State = {
  DECLARED_BIN_RUNNABLE: "declared-bin-runnable",
  DECLARED_BIN_NOT_RUNNABLE: "declared-bin-not-runnable",
  BIN_ENTRY_NOT_DECLARED: "bin-entry-not-declared",
  SHIPPED_MECHANISM: "shipped-mechanism",
  NON_ENTRY: "non-entry",
};

function classify(packedFile, shebangPrefix, binPaths) {
  const { path: rel, mode } = packedFile;
  if (binPaths.includes(rel)) {
    // A declared bin (anywhere in the package) must run from an install layout.
    return runsFromInstallLayout(rel)
      ? State.DECLARED_BIN_RUNNABLE
      : State.DECLARED_BIN_NOT_RUNNABLE;
  }
  if (rel.split("/")[0] === "bin") {
    // Under the conventional bin/ directory but not a declared bin: the exact
    // shape of the AC-233 defect (bin/quay.js, bin/quay.ts). Entry-by-location
    // is enough — no exec bit / shebang required (bin/node-version-check.cjs).
    return State.BIN_ENTRY_NOT_DECLARED;
  }
  if ((mode & 0o111) !== 0 || shebangPrefix === "#!") {
    // Exec bit / shebang but NOT under bin/ and NOT a declared bin: a shipped
    // mechanism (plugin/scripts/*.sh, plugin/gate-scripts/*.sh, plugin/vendor
    // runtimes) invoked by path, not a user-facing command. NOT a violation.
    return State.SHIPPED_MECHANISM;
  }
  return State.NON_ENTRY;
}

test("every packed entry-like file is a declared bin runnable from an install layout", () => {
  const binPaths = declaredBinPaths();
  const hookPaths = lifecycleHookPaths();
  const packed = packedFiles();
  const byState = {
    [State.DECLARED_BIN_RUNNABLE]: [],
    [State.DECLARED_BIN_NOT_RUNNABLE]: [],
    [State.BIN_ENTRY_NOT_DECLARED]: [],
    [State.SHIPPED_MECHANISM]: [],
    [State.NON_ENTRY]: [],
  };
  let hookCount = 0;
  for (const f of packed) {
    if (hookPaths.has(f.path)) {
      hookCount += 1;
      continue; // lifecycle hook, not a user-facing entry
    }
    byState[classify(f, readShebangPrefix(f.path), binPaths)].push(f.path);
  }
  const violations = [
    ...byState[State.DECLARED_BIN_NOT_RUNNABLE].map(
      (p) => `${p}: declared bin but does not run from an install layout`,
    ),
    ...byState[State.BIN_ENTRY_NOT_DECLARED].map(
      (p) => `${p}: under bin/ but not a declared package.json bin`,
    ),
  ];
  const ex = (list) => (list.length ? list[0] : "none");
  // The three states are printed so the output itself distinguishes them (AC6):
  console.log(
    `# shipped-entry classification — ` +
      `declared-bin-runnable=${byState[State.DECLARED_BIN_RUNNABLE].length} [${ex(byState[State.DECLARED_BIN_RUNNABLE])}] | ` +
      `declared-bin-not-runnable=${byState[State.DECLARED_BIN_NOT_RUNNABLE].length} [${ex(byState[State.DECLARED_BIN_NOT_RUNNABLE])}] | ` +
      `bin-entry-not-declared=${byState[State.BIN_ENTRY_NOT_DECLARED].length} [${ex(byState[State.BIN_ENTRY_NOT_DECLARED])}] | ` +
      `shipped-mechanism=${byState[State.SHIPPED_MECHANISM].length} [${ex(byState[State.SHIPPED_MECHANISM])}] | ` +
      `non-entry=${byState[State.NON_ENTRY].length} [${ex(byState[State.NON_ENTRY])}] | ` +
      `lifecycle-hook=${hookCount}`,
  );
  assert.deepEqual(
    violations,
    [],
    `packed entry files must each be a declared bin runnable from an install layout. ` +
      `Declared bins: ${JSON.stringify(binPaths)}. Violations:\n${violations.join("\n")}`,
  );
});

test("negative control: the install-layout run check refuses a .ts entry and accepts a .js entry", () => {
  // A .ts entry under a node_modules/ layout must be refused by Node (type
  // stripping is unsupported under node_modules — on Node >= 22.6 this is
  // ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) — the exact structural failure
  // the task exists to prevent, reproduced hermetically so the "runnable from
  // install layout" leg is proven able to take false (硬规则 4). The assertion
  // pins the refusal (non-zero exit + a produced error), not the Node-internal
  // error string, so it stays true across Node floors (a pre-stripping Node
  // fails the .ts with a SyntaxError instead — still a refusal).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-shipped-entry-nc-"));
  const nmRoot = path.join(tmp, "node_modules", "quay");
  fs.mkdirSync(nmRoot, { recursive: true });
  try {
    const tsEntry = path.join(nmRoot, "evil.ts");
    fs.writeFileSync(tsEntry, "#!/usr/bin/env node\nconst x: number = 1;\nconsole.log('hi', x);\n");
    const tsRun = spawnSync(process.execPath, [tsEntry], { encoding: "utf8" });
    assert.notEqual(tsRun.status, 0, "a .ts entry under node_modules/ must NOT run");
    assert.ok(
      String(tsRun.stderr).length > 0,
      "the .ts refusal must produce an error (type stripping unsupported under node_modules)",
    );

    const jsEntry = path.join(nmRoot, "ok.js");
    fs.writeFileSync(jsEntry, "#!/usr/bin/env node\nconsole.log('ok');\n");
    const jsRun = spawnSync(process.execPath, [jsEntry], { encoding: "utf8" });
    assert.equal(jsRun.status, 0, "a .js entry under node_modules/ must run");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
