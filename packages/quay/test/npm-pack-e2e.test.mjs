// @test-group product
// npm-pack-e2e.test.mjs — M120 Stage 2.2 (DIR-060).
//
// End-to-end: run the REAL package.sh (build-dist.sh -> npm pack), install the
// produced tarball into a scratch prefix, and run the installed `quay` binary.
// Proves the distributed artifact — the thing a real `npm install -g` gets —
// actually executes from its `dist/quay.js` bin, including a real provider
// round-trip (`task list`).
//
// HONEST SCOPE: this run is on THIS host (Node 25). It CANNOT prove Node-20
// compatibility — that requires an actual Node-20 runtime (Phase 4's
// floor-verification job, exercised for real only by Phase 5's release run).
// What it DOES prove: the bin field resolves to the bundled dist, the tarball
// ships dist/quay.js, and the installed CLI runs end-to-end.
//
// package.sh is a SHELL script (no bash coverage tool in this repo — confirmed:
// no kcov/bashcov). Its logic path is exercised here via RED/GREEN exit-code +
// runnable-artifact assertions (the repo's documented shell strategy); Node's
// --experimental-test-coverage cannot reach a spawned shell script or a forked
// binary, and excludes the test file being run — so no fabricated line-coverage
// % is asserted for this stage.
//
// Run: node --test packages/quay/test/npm-pack-e2e.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const packageSh = path.join(pkgDir, "scripts", "package.sh");
const nativeBin = path.join(pkgDir, "..", "quay-native", "bin", "quay-native.ts");
const nativeProviderDir = path.dirname(nativeBin);
const pkgVersion = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;

let scratch; // install prefix
let installedBin; // node_modules/quay/dist/quay.js
let tgz;

before(() => {
  // Real package.sh run: builds dist/, then npm pack -> quay-<version>.tgz.
  execFileSync("bash", [packageSh], { encoding: "utf8", cwd: pkgDir, stdio: "pipe" });
  tgz = path.join(pkgDir, `quay-${pkgVersion}.tgz`);
  assert.ok(fs.existsSync(tgz), `package.sh must produce ${tgz}`);

  // Install the tarball into a scratch prefix (isolated from the repo).
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "quay-m120-e2e-install-"));
  execFileSync(
    "npm",
    ["install", "--prefix", scratch, tgz, "--no-save", "--no-audit", "--no-fund"],
    { encoding: "utf8", stdio: "pipe" }
  );
  installedBin = path.join(scratch, "node_modules", "quay", "dist", "quay.js");
});

after(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  if (tgz && fs.existsSync(tgz)) fs.rmSync(tgz, { force: true });
});

test("the installed tarball's bin resolves to dist/quay.js and it exists", () => {
  assert.ok(fs.existsSync(installedBin), `installed bin must exist at ${installedBin}`);
  const installedPkg = JSON.parse(
    fs.readFileSync(path.join(scratch, "node_modules", "quay", "package.json"), "utf8")
  );
  assert.equal(installedPkg.bin.quay, "./dist/quay.js", "installed package's bin must point at dist/quay.js");
});

test("installed `quay --help` runs and prints usage (Node 25 host — NOT a Node-20 proof)", () => {
  const help = execFileSync("node", [installedBin, "--help"], { encoding: "utf8" });
  assert.match(help, /Usage/);
});

test("installed `quay --version` prints the package version", () => {
  const version = execFileSync("node", [installedBin, "--version"], { encoding: "utf8" }).trim();
  assert.equal(version, pkgVersion);
});

test("installed `quay task list` does a real provider round-trip against a native workspace", () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-m120-e2e-tasks-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-m120-e2e-ws-"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );
  // Seed one task via the native provider, then list it through the INSTALLED bin.
  execFileSync("node", [nativeBin, "task", "create", "E2E1", "--title", "e2e fixture", "--status", "todo"], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  const list = execFileSync("node", [installedBin, "task", "list"], { encoding: "utf8", cwd: workspaceRoot });
  assert.match(list, /E2E1/, "installed bin's `task list` must show the seeded task");
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});
