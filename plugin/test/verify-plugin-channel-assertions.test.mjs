// @test-group engine
// verify-plugin-channel-assertions.test.mjs — PASS and FAIL faces of every release-gate channel
// assertion, driven through the REAL script (tasks/gap-release-gate-verify-plugin-channel-misses-
// config-validate-version-pointer-scope-and-upgrade-assertions).
//
// The fixtures are a temp "installed plugin tree" (VERSION + .claude-plugin/plugin.json + a `bin/quay`
// stub the test controls) and a temp "scratch project" (`.quay/config.yml`, `.quay/plugin`, a
// `/proc`-shaped fixture for the cgroup reading, and a fixture HOME carrying the install record).
// The point is the JUDGEMENT, not the fixtures: the stub lets each case present exactly one broken
// reading and assert the script classifies it FAIL (or NOT-EVALUATED) rather than PASS.
//
// ⛔ No live driver / serve / Claude install is required: every reading the script consumes is
// fixture-addressable (the CLI stub, `QUAY_VERIFY_PROC_ROOT`, `QUAY_VERIFY_HOME`). The suite stays
// hermetic — it never depends on a feature that has not landed, and never touches the real `~/.claude`.
//
// Coverage map (the task's AC2 enumerated cases ①–⑤ + AC6's upgrade sequence):
//   ① config missing mcp_entry and the validator rejects it ⇒ FAIL
//   ② `quay --version` carries -dev while plugin.json does not ⇒ FAIL
//   ③ `.quay/plugin` points at another version directory ⇒ FAIL
//   ④ serve host cgroup is not a `quay-serve-*.scope` ⇒ FAIL
//   ⑤ an unreadable input (install dir without plugin.json) ⇒ NOT-EVALUATED, exit code ≠ all-PASS
//   and the all-PASS control (every assertion PASS ⇒ exit 0), plus the upgrade drill sequence
//   (link→old ⇒ init ⇒ link→new ⇒ validate) and its FAIL face.
//
// Run: node --experimental-strip-types --test plugin/test/verify-plugin-channel-assertions.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { judgeShippedSetClean } from "../scripts/verify-plugin-channel-assertions.ts";
import { parseRules, readShippedSet } from "../scripts/shipped-set-rules.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK = path.join(REPO_ROOT, "plugin", "scripts", "verify-plugin-channel-assertions.ts");

// One base temp dir for the whole file; every fixture lives under it and is removed in after().
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "vpca-"));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

let seq = 0;
function freshDir(tag) {
  const d = path.join(BASE, `${tag}-${seq++}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** A `bin/quay` stub the test controls; each case bakes in exactly the reading it wants. */
function writeCliStub(installedDir, opts = {}) {
  const version = opts.version ?? "0.17.0";
  const configExit = opts.configValidateExit ?? 0;
  const configMsg = opts.configValidateMessage ?? "1 warning(s) found.";
  const mcpOk = opts.mcpOk ?? true;
  const driverJson = opts.driverJson ?? JSON.stringify({ loaded_version: "current", path_quay_version: "current", pointer: { state: "current" } });
  const serverJson = opts.serverJson ?? JSON.stringify({ status: "running", loaded_version: "current", pid: 4242 });
  const script = `#!/usr/bin/env bash
set -u
case "\${1:-}" in
  --version) echo "${version}"; exit 0 ;;
  config) echo "${configMsg}"; exit ${configExit} ;;
  driver) echo '${driverJson}'; exit 0 ;;
  server) echo '${serverJson}'; exit 0 ;;
  mcp) printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}' '{"jsonrpc":"2.0","id":2,"result":{"structuredContent":{"ok":${mcpOk},"issues":[]}}}'; exit 0 ;;
esac
exit 0
`;
  fs.mkdirSync(path.join(installedDir, "bin"), { recursive: true });
  const bin = path.join(installedDir, "bin", "quay");
  fs.writeFileSync(bin, script, { mode: 0o755 });
}

/** Build an "installed plugin tree" fixture. */
function makeInstall(tag, opts = {}) {
  const dir = freshDir(tag);
  if (opts.versionFile !== null) fs.writeFileSync(path.join(dir, "VERSION"), (opts.versionFile ?? opts.version ?? "0.17.0") + "\n");
  if (opts.pluginJson !== null) {
    fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude-plugin", "plugin.json"),
      opts.pluginJsonRaw ?? JSON.stringify({ name: "quay", version: opts.pluginJson ?? opts.version ?? "0.17.0" }),
    );
  }
  if (opts.withCli !== false) writeCliStub(dir, opts);
  if (opts.withInit) {
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "quay-init.sh"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  }
  return dir;
}

/** Build a "scratch project" fixture. */
function makeProject(tag, opts = {}) {
  const dir = freshDir(tag);
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const config =
    opts.configYml ??
    ["providers:", "  native:", "    enabled: true", '    tasks_dir: "./tasks"', ""].join("\n");
  fs.writeFileSync(path.join(dir, ".quay", "config.yml"), config);
  if (opts.pointerTarget !== undefined) {
    fs.symlinkSync(opts.pointerTarget, path.join(dir, ".quay", "plugin"));
  }
  if (opts.serverPid !== undefined) {
    fs.writeFileSync(path.join(dir, ".quay", "server.json"), JSON.stringify({ schemaVersion: 1, pid: opts.serverPid, startedAt: "2026-10-06T00:00:00Z", services: [] }));
  }
  if (opts.serveLogBytes !== undefined) {
    fs.writeFileSync(path.join(dir, ".quay", "serve.log"), "x".repeat(opts.serveLogBytes));
  }
  return dir;
}

/** A `/proc`-shaped fixture root carrying one `<pid>/cgroup`. */
function makeProcRoot(tag, pid, cgroupText) {
  const dir = freshDir(tag);
  fs.mkdirSync(path.join(dir, String(pid)), { recursive: true });
  fs.writeFileSync(path.join(dir, String(pid), "cgroup"), `0::${cgroupText}\n`);
  return dir;
}

/** A fixture HOME with an `installed_plugins.json` record. */
function makeHome(tag, entries) {
  const dir = freshDir(tag);
  fs.mkdirSync(path.join(dir, ".claude", "plugins"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "quay@quay": entries } }));
  return dir;
}

/** Run the real script; returns { status, stdout, stderr }. */
function runScript(args, env = {}) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECK, ...args],
    { encoding: "utf8", env: { ...process.env, ...env }, timeout: 120_000 },
  );
}

function lines(stdout) {
  return stdout.trim().split(/\r?\n/).filter(Boolean);
}

function assertionLine(stdout, id) {
  const hit = lines(stdout).find((l) => l.startsWith(`${id} `));
  assert.ok(hit, `expected an assertion line for ${id}; got:\n${stdout}`);
  return hit;
}

/** An all-PASS fixture: every reading qualifies. Returns { installed, project, home, procRoot }. */
function allPassFixture(tag) {
  const installed = makeInstall(tag, { version: "0.17.0", withInit: true });
  const project = makeProject(`${tag}-proj`, { pointerTarget: installed, serverPid: 4242, serveLogBytes: 12 });
  const procRoot = makeProcRoot(`${tag}-proc`, 4242, "/user.slice/user-1004.slice/user@1004.service/app.slice/quay-serve-test-123.scope");
  const home = makeHome(`${tag}-home`, [{ scope: "project", projectPath: project, installPath: installed, version: "0.17.0" }]);
  return { installed, project, home, procRoot };
}

// ── the all-PASS control (the baseline the NOT-EVALUATED exit must differ from) ──────────────────

test("all-PASS fixture: exit 0, every assertion PASS, summary printed", () => {
  const f = allPassFixture("pass");
  const r = runScript(
    ["--installed", f.installed, "--project", f.project, "--scope", "project"],
    { QUAY_VERIFY_PROC_ROOT: f.procRoot, QUAY_VERIFY_HOME: f.home },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /FAIL|NOT-EVALUATED/);
  assert.match(r.stdout, /^passed=\d+ failed=0 not-evaluated=0$/m);
  for (const id of [
    "config-validate-cli",
    "config-validate-mcp",
    "version-consistency",
    "project-pointer",
    "config-native-not-frozen",
    "driver-status-readings",
    "serve-own-scope",
    "serve-log-nonempty",
    "server-status-loaded-version",
    "scope-install-shape",
  ]) {
    assert.match(assertionLine(r.stdout, id), new RegExp(`^${id} PASS`), `expected ${id} PASS`);
  }
});

// ── ① config missing mcp_entry and the validator rejects it ⇒ FAIL ───────────────────────────────

test("① validator rejects the init-written config ⇒ config-validate-cli FAIL, exit 1", () => {
  const f = allPassFixture("cfg");
  // The real 0.16.0 symptom, verbatim.
  writeCliStub(f.installed, {
    configValidateExit: 1,
    configValidateMessage: 'error: providers.native — Enabled provider "native" is missing mcp_entry (must be a non-empty array)',
  });
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: f.procRoot,
    QUAY_VERIFY_HOME: f.home,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "config-validate-cli"), /^config-validate-cli FAIL.*missing mcp_entry/);
});

test("①b the MCP entry point rejects the same config ⇒ config-validate-mcp FAIL", () => {
  const f = allPassFixture("cfgmcp");
  writeCliStub(f.installed, { mcpOk: false });
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: f.procRoot,
    QUAY_VERIFY_HOME: f.home,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "config-validate-mcp"), /^config-validate-mcp FAIL/);
  // the CLI face of the same fixture is clean — the two entry points are judged independently
  assert.match(assertionLine(r.stdout, "config-validate-cli"), /^config-validate-cli PASS/);
});

// ── ② `quay --version` carries -dev while plugin.json does not ⇒ FAIL ────────────────────────────

test("② quay --version=-dev while plugin.json is clean ⇒ version-consistency FAIL", () => {
  const installed = makeInstall("devver", { version: "0.14.0", withCli: false, pluginJson: "0.14.0", versionFile: "0.14.0" });
  writeCliStub(installed, { version: "0.14.0-dev" });
  const project = makeProject("devver-proj", { pointerTarget: installed });
  const r = runScript(["--installed", installed, "--project", project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: makeProcRoot("devver-proc", 1, "/nowhere"),
    QUAY_VERIFY_HOME: makeHome("devver-home", []),
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "version-consistency"), /^version-consistency FAIL.*-dev/);
});

test("②b the dev tree's own carriers (-dev everywhere) are still FAIL, not PASS", () => {
  // The carriers AGREE on `0.17.0-dev`; agreement alone must not pass — the task's whole point is
  // that a RELEASE build must not carry -dev.
  const installed = makeInstall("devall", { pluginJson: "0.17.0-dev", versionFile: "0.17.0-dev", withCli: false });
  writeCliStub(installed, { version: "0.17.0-dev" });
  const project = makeProject("devall-proj", { pointerTarget: installed });
  const r = runScript(["--installed", installed, "--project", project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: makeProcRoot("devall-proc", 1, "/nowhere"),
    QUAY_VERIFY_HOME: makeHome("devall-home", []),
  });
  assert.match(assertionLine(r.stdout, "version-consistency"), /^version-consistency FAIL/);
});

// ── ③ `.quay/plugin` points at another version directory ⇒ FAIL ──────────────────────────────────

test("③ pointer at another version directory ⇒ project-pointer FAIL", () => {
  const installed = makeInstall("ptr-new", { version: "0.17.0" });
  const other = makeInstall("ptr-old", { version: "0.14.0" });
  const project = makeProject("ptr-proj", { pointerTarget: other });
  const r = runScript(["--installed", installed, "--project", project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: makeProcRoot("ptr-proc", 1, "/nowhere"),
    QUAY_VERIFY_HOME: makeHome("ptr-home", []),
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "project-pointer"), /^project-pointer FAIL/);
});

test("③b a missing pointer is NOT-EVALUATED (exit 3), never PASS", () => {
  const f = allPassFixture("ptr-missing");
  fs.rmSync(path.join(f.project, ".quay", "plugin"));
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: f.procRoot,
    QUAY_VERIFY_HOME: f.home,
  });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "project-pointer"), /^project-pointer NOT-EVALUATED/);
});

test("native provider freezing path/mcp_entry ⇒ config-native-not-frozen FAIL", () => {
  const f = allPassFixture("frozen");
  fs.writeFileSync(
    path.join(f.project, ".quay", "config.yml"),
    ["providers:", "  native:", "    enabled: true", "    path: ~/.claude/plugins/cache/quay/quay/0.14.0/vendor/quay-native", '    mcp_entry: ["node", "q.js", "mcp"]', ""].join("\n"),
  );
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: f.procRoot,
    QUAY_VERIFY_HOME: f.home,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "config-native-not-frozen"), /^config-native-not-frozen FAIL/);
});

// ── ④ serve host cgroup is not a quay-serve-*.scope ⇒ FAIL ───────────────────────────────────────

test("④ serve host in the caller's session cgroup ⇒ serve-own-scope FAIL", () => {
  const f = allPassFixture("cgroup");
  const procRoot = makeProcRoot(
    "cgroup-proc",
    4242,
    "/user.slice/user-1004.slice/user@1004.service/cloudcli.slice/cloudcli-resident.slice/claudecodeui-session-1006778-b9a01352.scope",
  );
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: procRoot,
    QUAY_VERIFY_HOME: f.home,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "serve-own-scope"), /^serve-own-scope FAIL/);
});

test("④b a dead host (no cgroup reading) ⇒ serve-own-scope NOT-EVALUATED", () => {
  const f = allPassFixture("cgdead");
  const procRoot = freshDir("cgdead-proc"); // pid dir absent ⇒ no cgroup
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: procRoot,
    QUAY_VERIFY_HOME: f.home,
  });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "serve-own-scope"), /^serve-own-scope NOT-EVALUATED/);
});

test("empty serve.log ⇒ serve-log-nonempty FAIL", () => {
  const f = allPassFixture("log");
  fs.writeFileSync(path.join(f.project, ".quay", "serve.log"), "");
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: f.procRoot,
    QUAY_VERIFY_HOME: f.home,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "serve-log-nonempty"), /^serve-log-nonempty FAIL/);
});

test("driver status missing a reading key ⇒ driver-status-readings FAIL", () => {
  const f = allPassFixture("drv");
  writeCliStub(f.installed, { driverJson: JSON.stringify({ loaded_version: "current", pointer: { state: "current" } }) });
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: f.procRoot,
    QUAY_VERIFY_HOME: f.home,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "driver-status-readings"), /^driver-status-readings FAIL/);
});

test("server loaded_version=behind ⇒ server-status-loaded-version FAIL", () => {
  const f = allPassFixture("ssv");
  writeCliStub(f.installed, { serverJson: JSON.stringify({ status: "running", loaded_version: "behind", pid: 4242 }) });
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: f.procRoot,
    QUAY_VERIFY_HOME: f.home,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "server-status-loaded-version"), /^server-status-loaded-version FAIL/);
});

test("scope install record absent ⇒ scope-install-shape FAIL", () => {
  const f = allPassFixture("scope");
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "user"], {
    QUAY_VERIFY_PROC_ROOT: f.procRoot,
    QUAY_VERIFY_HOME: f.home, // the record only carries a project-scope entry
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "scope-install-shape"), /^scope-install-shape FAIL/);
});

// ── ⑤ an unreadable input ⇒ NOT-EVALUATED, exit code ≠ all-PASS ──────────────────────────────────

test("⑤ install dir without plugin.json ⇒ version-consistency NOT-EVALUATED, exit 3 (≠ 0)", () => {
  const f = allPassFixture("noinput");
  fs.rmSync(path.join(f.installed, ".claude-plugin", "plugin.json"));
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "project"], {
    QUAY_VERIFY_PROC_ROOT: f.procRoot,
    QUAY_VERIFY_HOME: f.home,
  });
  assert.equal(r.status, 3, `expected exit 3 (NOT-EVALUATED), got ${r.status}\n${r.stdout}${r.stderr}`);
  assert.match(assertionLine(r.stdout, "version-consistency"), /^version-consistency NOT-EVALUATED/);
  assert.notEqual(r.status, 0, "NOT-EVALUATED must not share the all-PASS exit code");
});

test("usage: missing --installed/--project ⇒ exit 2; no args ⇒ exit 2", () => {
  const a = runScript(["--installed", "/nonexistent"]);
  assert.equal(a.status, 2, a.stdout + a.stderr);
  const b = runScript([]);
  assert.equal(b.status, 2, b.stdout + b.stderr);
  assert.match(b.stderr, /Usage:/);
});

// ── AC6: the local upgrade drill sequence and its FAIL face ──────────────────────────────────────

test("upgrade drill: link→old ⇒ init ⇒ link→new ⇒ validate PASS (exit 0)", () => {
  const oldTree = makeInstall("up-old", { version: "0.16.0", withInit: true });
  const newTree = makeInstall("up-new", { version: "0.17.0", withInit: true });
  const project = makeProject("up-proj", { pointerTarget: oldTree });
  // The init seam repoints the link, exactly as a real `/quay:init` would.
  const r = runScript(["--installed", newTree, "--project", project, "--scope", "project", "--upgrade-from", oldTree], {
    QUAY_VERIFY_HOME: makeHome("up-home", []),
    QUAY_VERIFY_INIT_CMD: `ln -sfn "${newTree}" "${path.join(project, ".quay", "plugin")}"`,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "upgrade-link-before"), /^upgrade-link-before PASS/);
  assert.match(assertionLine(r.stdout, "upgrade-link-after"), /^upgrade-link-after PASS/);
  assert.match(assertionLine(r.stdout, "upgrade-validate-after"), /^upgrade-validate-after PASS/);
});

test("upgrade drill FAIL face: init does NOT repoint the link ⇒ upgrade-link-after FAIL", () => {
  const oldTree = makeInstall("upf-old", { version: "0.16.0", withInit: true });
  const newTree = makeInstall("upf-new", { version: "0.17.0", withInit: true });
  const project = makeProject("upf-proj", { pointerTarget: oldTree });
  const r = runScript(["--installed", newTree, "--project", project, "--scope", "project", "--upgrade-from", oldTree], {
    QUAY_VERIFY_HOME: makeHome("upf-home", []),
    QUAY_VERIFY_INIT_CMD: "true", // the re-init is a no-op
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "upgrade-link-before"), /^upgrade-link-before PASS/);
  assert.match(assertionLine(r.stdout, "upgrade-link-after"), /^upgrade-link-after FAIL/);
});

test("upgrade drill FAIL face: project still points at the NEW tree ⇒ upgrade-link-before FAIL", () => {
  const oldTree = makeInstall("upg-old", { version: "0.16.0", withInit: true });
  const newTree = makeInstall("upg-new", { version: "0.17.0", withInit: true });
  const project = makeProject("upg-proj", { pointerTarget: newTree });
  const r = runScript(["--installed", newTree, "--project", project, "--scope", "project", "--upgrade-from", oldTree], {
    QUAY_VERIFY_HOME: makeHome("upg-home", []),
    QUAY_VERIFY_INIT_CMD: "true",
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(assertionLine(r.stdout, "upgrade-link-before"), /^upgrade-link-before FAIL/);
});

test("--json emits the assertion array + summary counts", () => {
  const f = allPassFixture("json");
  const r = runScript(["--installed", f.installed, "--project", f.project, "--scope", "project", "--json"], {
    QUAY_VERIFY_PROC_ROOT: f.procRoot,
    QUAY_VERIFY_HOME: f.home,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.failed, 0);
  assert.equal(parsed.notEvaluated, 0);
  assert.ok(Array.isArray(parsed.assertions) && parsed.assertions.length >= 10);
});

// ── the shipped-set assertion (tasks/gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-
//    shrink-only-size-ratchet) ────────────────────────────────────────────────────────────────────
//
// The judgement is driven through the SAME `readShippedSet` the release gate uses, on hermetic
// fixture trees: the point is which STATE the assertion reports, never a re-implemented predicate.
const SS_RULES = parseRules(
  ["# fixture rules", "test/", "*.test.mjs", "*-baseline.json", "fixtures/"].join("\n"),
);
const ssBaseline = (over = {}) => ({ files: 0, bytes: 0, shLines: 0, ...over });

function ssFixture(tag, files) {
  const dir = freshDir(tag);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

test("shipped-set-clean: a clean tree is PASS and the detail carries the real totals", () => {
  const dir = ssFixture("ss-clean", { "README.md": "hi\n", "scripts/tool.sh": "#!/usr/bin/env bash\necho hi\n" });
  const r = judgeShippedSetClean(readShippedSet(dir, SS_RULES), ssBaseline(), dir);
  assert.equal(r.state, "PASS");
  assert.match(r.detail, /2 files/);
  assert.match(r.detail, /no rule-excluded content among 4 rule\(s\)/);
});

test("shipped-set-clean: an excluded file present ⇒ FAIL, naming the path and the rule", () => {
  const dir = ssFixture("ss-dirty", { "README.md": "hi\n", "foo.test.mjs": "x\n", "deep/g.test.mjs": "x\n" });
  const r = judgeShippedSetClean(readShippedSet(dir, SS_RULES), ssBaseline(), dir);
  assert.equal(r.state, "FAIL");
  assert.match(r.detail, /foo\.test\.mjs \(rule \*\.test\.mjs\)/);
  assert.match(r.detail, /2 rule-excluded path\(s\) PRESENT/);
});

test("shipped-set-clean: a `test/` directory and a `*-baseline.json` are both caught", () => {
  const dir = ssFixture("ss-dir", { "test/a.mjs": "x\n", "sh-census-baseline.json": "{}\n" });
  const r = judgeShippedSetClean(readShippedSet(dir, SS_RULES), ssBaseline(), dir);
  assert.equal(r.state, "FAIL");
  assert.match(r.detail, /test\//);
  assert.match(r.detail, /sh-census-baseline\.json/);
});

test("shipped-set-clean: the size ceiling FAILs when the artifact outgrows the recorded clean build", () => {
  const dir = ssFixture("ss-size", { "a.md": "1\n", "b.md": "2\n", "c.md": "3\n" });
  const r = judgeShippedSetClean(readShippedSet(dir, SS_RULES), ssBaseline({ shipped: { files: 2, bytes: 1, shLines: 0 } }), dir);
  assert.equal(r.state, "FAIL");
  assert.match(r.detail, /larger than the recorded clean build/);
  assert.match(r.detail, /files 3 > ceiling 2/);
});

test("shipped-set-clean: an unreadable input is NOT-EVALUATED, never PASS", () => {
  // ① no rules in force ⇒ the reading itself refuses to be "clean" (硬规则 3b)
  const dir = ssFixture("ss-norules", { "a.md": "x\n" });
  assert.equal(judgeShippedSetClean(readShippedSet(dir, []), ssBaseline(), dir).state, "NOT-EVALUATED");
  // ② an unreadable `.sh` makes the reading partial
  const dangling = ssFixture("ss-dangling", { "a.md": "x\n" });
  fs.symlinkSync(path.join(dangling, "nope"), path.join(dangling, "broken.sh"));
  const partial = judgeShippedSetClean(readShippedSet(dangling, SS_RULES), ssBaseline(), dangling);
  assert.equal(partial.state, "NOT-EVALUATED");
  assert.match(partial.detail, /could not be read/);
  // ③ no readable baseline
  const clean = ssFixture("ss-nobase", { "a.md": "x\n" });
  assert.equal(judgeShippedSetClean(readShippedSet(clean, SS_RULES), null, clean).state, "NOT-EVALUATED");
});
