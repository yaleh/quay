// Unit tests for drivable-workspace-check.ts — DIR-062 child A (M125).
// Run: node --test experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs
//      node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/drivable-workspace-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseRegistry,
  loadRegistry,
  isCovered,
  checkPaths,
  selftest,
  DEFAULT_REGISTRY_PATH,
  DrivableCheckEnvError,
} from "../scripts/drivable-workspace-check.ts";

const THIS_FILE = fileURLToPath(import.meta.url);
const SCRIPT = fileURLToPath(new URL("../scripts/drivable-workspace-check.ts", import.meta.url));

// ── parseRegistry ────────────────────────────────────────────────────────────────────────────────
test("parseRegistry: authorized_root + workspaces[] block list", () => {
  const yaml = `authorized_root: /home/yale/work\nscope: validation\nworkspaces:\n  - path: /home/yale/work/quay\n  - path: /opt/outside\n    session: foo\n`;
  const r = parseRegistry(yaml);
  assert.equal(r.authorizedRoot, "/home/yale/work");
  assert.deepEqual(r.workspacePaths, ["/home/yale/work/quay", "/opt/outside"]);
});

test("parseRegistry: no authorized_root, no workspaces -> empty registry", () => {
  const r = parseRegistry("scope: validation\n");
  assert.equal(r.authorizedRoot, null);
  assert.deepEqual(r.workspacePaths, []);
});

test("parseRegistry: unparseable YAML -> empty registry, not a throw", () => {
  const r = parseRegistry("authorized_root: [unterminated\n  - broken");
  assert.equal(r.authorizedRoot, null);
  assert.deepEqual(r.workspacePaths, []);
});

test("parseRegistry: top-level non-object YAML (e.g. a bare scalar) -> empty registry", () => {
  const r = parseRegistry("just a string\n");
  assert.equal(r.authorizedRoot, null);
  assert.deepEqual(r.workspacePaths, []);
});

test("parseRegistry: workspaces entries missing a path field are skipped", () => {
  const r = parseRegistry("workspaces:\n  - session: no-path-here\n  - path: /a/b\n");
  assert.deepEqual(r.workspacePaths, ["/a/b"]);
});

// ── loadRegistry ─────────────────────────────────────────────────────────────────────────────────
test("loadRegistry: missing file throws DrivableCheckEnvError, exit code 2", () => {
  const missing = path.join(os.tmpdir(), "nope-" + Date.now() + ".yml");
  assert.throws(() => loadRegistry(missing), (e) => e instanceof DrivableCheckEnvError && e.exitCode === 2);
});

test("loadRegistry: real checked-in registry parses with the real authorized_root", () => {
  const r = loadRegistry(DEFAULT_REGISTRY_PATH);
  assert.equal(r.authorizedRoot, "/home/yale/work");
  assert.ok(r.workspacePaths.length > 0);
});

// ── isCovered ────────────────────────────────────────────────────────────────────────────────────
const REGISTRY = { authorizedRoot: "/home/yale/work", workspacePaths: ["/opt/explicit"] };

test("isCovered: under authorized_root -> true", () => {
  assert.equal(isCovered("/home/yale/work/archguard", REGISTRY), true);
});
test("isCovered: exact authorized_root match -> true", () => {
  assert.equal(isCovered("/home/yale/work", REGISTRY), true);
});
test("isCovered: explicit workspaces[] entry -> true", () => {
  assert.equal(isCovered("/opt/explicit", REGISTRY), true);
});
test("isCovered: descendant of explicit entry -> true", () => {
  assert.equal(isCovered("/opt/explicit/sub", REGISTRY), true);
});
test("isCovered: outside both -> false (fail closed)", () => {
  assert.equal(isCovered("/tmp/x", REGISTRY), false);
});
test("isCovered: string-prefix look-alike (not a real path ancestor) -> false", () => {
  assert.equal(isCovered("/home/yale/work2/evil", REGISTRY), false);
});
test("isCovered: empty/null target -> false", () => {
  assert.equal(isCovered("", REGISTRY), false);
  assert.equal(isCovered(null, REGISTRY), false);
  assert.equal(isCovered(undefined, REGISTRY), false);
});
test("isCovered: empty registry (no authorized_root, no workspaces) covers nothing", () => {
  assert.equal(isCovered("/home/yale/work/quay", { authorizedRoot: null, workspacePaths: [] }), false);
});

// ── checkPaths ───────────────────────────────────────────────────────────────────────────────────
test("checkPaths: all covered -> ok:true", () => {
  const r = checkPaths(["/home/yale/work/quay", "/opt/explicit"], REGISTRY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.uncovered, []);
});
test("checkPaths: one uncovered -> ok:false, uncovered lists it", () => {
  const r = checkPaths(["/home/yale/work/quay", "/tmp/x"], REGISTRY);
  assert.equal(r.ok, false);
  assert.deepEqual(r.uncovered, ["/tmp/x"]);
  assert.deepEqual(r.covered, ["/home/yale/work/quay"]);
});
test("checkPaths: empty input -> ok:false (fail-closed, never a vacuous pass)", () => {
  const r = checkPaths([], REGISTRY);
  assert.equal(r.ok, false);
});

// ── selftest() — the module's own embedded RED+GREEN fixture suite ─────────────────────────────────
test("selftest(): all embedded RED+GREEN fixture cases pass", () => {
  assert.equal(selftest(), true);
});

// ── CLI (isDirect block) — real subprocess invocation ───────────────────────────────────────────
function spawnCli(args) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

test("CLI: --selftest -> exit 0", () => {
  const r = spawnCli(["--selftest"]);
  assert.equal(r.status, 0, r.stderr);
});

test("CLI: /tmp/x against the real registry -> exit 1, FAIL printed", () => {
  const r = spawnCli(["/tmp/x"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL: 1\/1 workspace path\(s\) NOT covered/);
});

test("CLI: /home/yale/work/archguard against the real registry -> exit 0, PASS printed", () => {
  const r = spawnCli(["/home/yale/work/archguard"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /PASS: all 1 workspace path\(s\) covered/);
});

test("CLI: multiple paths, mixed coverage -> exit 1", () => {
  const r = spawnCli(["/home/yale/work/archguard", "/tmp/x"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL: 1\/2/);
});

test("CLI: no args -> usage error exit 2", () => {
  const r = spawnCli([]);
  assert.equal(r.status, 2);
});

test("CLI: --registry pointing at a fixture file overrides the default", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "drivable-registry-"));
  const registryFile = path.join(tmpDir, "custom.yml");
  fs.writeFileSync(registryFile, "authorized_root: /opt/custom-root\n");
  try {
    const ok = spawnCli(["/opt/custom-root/sub", "--registry", registryFile]);
    assert.equal(ok.status, 0, ok.stderr);
    const fail = spawnCli(["/home/yale/work/quay", "--registry", registryFile]);
    assert.equal(fail.status, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("CLI: --registry pointing at a missing file -> exit 2", () => {
  const missing = path.join(os.tmpdir(), "nope-cli-" + Date.now() + ".yml");
  const r = spawnCli(["/home/yale/work/quay", "--registry", missing]);
  assert.equal(r.status, 2);
});
