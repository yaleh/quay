// @test-group serial
// profiles-role-coverage-check.test.mjs —
// gap-quay-init-profiles-template-omits-every-role-the-drivers-request.
//
// The carrier `.quay/profiles.yml` is what `launchArgv(role, …)` resolves a driver's sub-session
// from, and a role it cannot resolve is a hard throw (profile-policy.ts resolveRole, fail-closed,
// no fallback) — so a carrier missing a requested role means that driver can NEVER dispatch. This
// file asserts on what a REAL `quay-init.sh` run produces into a real temp workspace, never on a
// template file: the defect this closes was a "fixed" carrier the init path never used.
//
// Every assertion carries a reachable red — case 2 deletes a role from the produced carrier and
// proves `launchArgv` then throws, so case 1's green cannot be constant.
//
// KNOWN-LOAD-SENSITIVE (same family as plugin/test/quay-init.test.mjs): each case spawns a real
// quay-init.sh subprocess tree, so the file is pinned to the concurrency-1 serial phase
// (gap-install-family-tests-rotate-flakes-under-full-suite).
//
// Run: scripts/test.sh plugin/test/profiles-role-coverage-check.test.mjs
//      node --test plugin/test/profiles-role-coverage-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchArgv } from "../scripts/driver-runtime.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const QUAY_INIT = path.join(PLUGIN_ROOT, "scripts", "quay-init.sh");
const SHIPPED_CARRIER = path.join(PLUGIN_ROOT, ".quay", "profiles.yml");

/** The profile roles the drivers ask for through launchArgv (grep -rn 'launchArgv("' plugin/scripts). */
const REQUESTED_ROLES = ["fix-worker", "task-worker", "pool-judge", "selector", "meta-driver"];

const _tmp = [];
function makeTmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "qprc-"));
  _tmp.push(d);
  return d;
}
after(() => {
  for (const d of _tmp) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

/** A real git workspace named <base>, i.e. one a third-party project would actually be. */
function makeWorkspace(base) {
  const root = path.join(makeTmp(), base);
  fs.mkdirSync(root, { recursive: true });
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(git("init", "-q", ".").status, 0, "git init must succeed");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  assert.equal(git("commit", "-q", "--allow-empty", "-m", "init").status, 0, "seed commit must succeed");
  return root;
}

function runInit(root) {
  return spawnSync(
    "bash",
    [QUAY_INIT, "--root", root, "--plugin-root", PLUGIN_ROOT, "--test-command", "true"],
    { encoding: "utf8", timeout: 180_000 },
  );
}

/** Parse the role keys + session names of a carrier (python3+yaml, the same reader quay-launch.sh uses). */
function readCarrier(file) {
  const r = spawnSync(
    "python3",
    [
      "-c",
      "import sys,yaml,json;d=yaml.safe_load(open(sys.argv[1])) or {};" +
        "print(json.dumps({k:(v or {}).get('name') for k,v in (d.get('roles') or {}).items()}))",
      file,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, `carrier must parse as YAML: ${file}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** A workspace initialised by the real entry, with its carrier path. */
function initialised(name) {
  const root = makeWorkspace(name);
  const r = runInit(root);
  assert.equal(r.status, 0, `quay-init must succeed in ${root}\n${r.stdout}\n${r.stderr}`);
  const carrier = path.join(root, ".quay", "profiles.yml");
  assert.ok(fs.existsSync(carrier), `quay-init must lay down ${carrier}`);
  return { root, carrier, log: r.stdout };
}

/** Remove a role block from a carrier, preserving everything else (the reachable-red fixture). */
function dropRole(carrier, role) {
  const lines = fs.readFileSync(carrier, "utf8").split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (line === `  ${role}:`) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.startsWith("  ") && line.endsWith(":") && !line.startsWith("    ")) skipping = false;
      else continue;
    }
    out.push(line);
  }
  fs.writeFileSync(carrier, out.join("\n"));
}

test("AC1 — a real quay-init covers every requested role, and launchArgv resolves each one", () => {
  const { root, carrier } = initialised("ac1-project");
  const roles = readCarrier(carrier);
  for (const role of REQUESTED_ROLES) {
    assert.ok(roles[role] !== undefined, `produced carrier must define the requested role "${role}" (has: ${Object.keys(roles).join(", ")})`);
  }
  for (const role of REQUESTED_ROLES) {
    let argv;
    assert.doesNotThrow(() => {
      argv = launchArgv(role, "", root);
    }, `launchArgv("${role}", "", <workspace>) must resolve`);
    const i = argv.indexOf("-n");
    assert.ok(i >= 0, `argv must carry -n for role "${role}": ${JSON.stringify(argv)}`);
    assert.ok(argv[i + 1] && argv[i + 1].length > 0, `the -n value for "${role}" must be non-empty`);
  }
});

test("AC1 negative control — launchArgv THROWS once the carrier loses that role (the red is reachable)", () => {
  const { root, carrier } = initialised("ac1-negative");
  const before = readCarrier(carrier);
  assert.ok(before["fix-worker"], "fixture precondition: fix-worker must be present before the mutation");
  dropRole(carrier, "fix-worker");
  assert.equal(readCarrier(carrier)["fix-worker"], undefined, "fixture: the role must actually be gone");
  assert.throws(
    () => launchArgv("fix-worker", "", root),
    /role not found/,
    "a carrier without the role must make launchArgv throw — otherwise AC1's green proves nothing",
  );
});

test("AC3 — the produced carrier does not ship the retired role `inner`", () => {
  const { carrier } = initialised("ac3-retired");
  const roles = readCarrier(carrier);
  assert.equal(roles["inner"], undefined, `the retired role must not be laid down (SPEC-tmux-retirement-2026-09-03); got ${JSON.stringify(roles)}`);
});

test("AC4 — two differently-named projects get different, project-derived session names", () => {
  const a = initialised("proj-alpha");
  const b = initialised("proj-beta");
  const namesA = readCarrier(a.carrier);
  const namesB = readCarrier(b.carrier);
  for (const role of ["manager", "task-worker"]) {
    assert.ok(namesA[role].startsWith("proj-alpha-"), `proj-alpha's ${role} name must derive from the project: ${namesA[role]}`);
    assert.ok(namesB[role].startsWith("proj-beta-"), `proj-beta's ${role} name must derive from the project: ${namesB[role]}`);
    assert.notEqual(namesA[role], namesB[role], `two projects must not share the ${role} session name`);
  }
  // ⛔ The literal `quay-` prefix is what made every third-party project collide with quay's OWN
  // sessions (SendMessage addresses peers by name ⇒ misrouting).
  for (const names of [namesA, namesB]) {
    for (const n of Object.values(names)) {
      assert.ok(!n.startsWith("quay-"), `no project may inherit quay's hardcoded session prefix: ${n}`);
    }
  }
});

test("skip semantics — a carrier the user already had is never overwritten", () => {
  const root = makeWorkspace("user-owned");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const carrier = path.join(root, ".quay", "profiles.yml");
  const mine = "# MINE, hand-written\nversion: 1\nprofiles:\n  worker-default:\n    launcher: claude\n    model: null\n    bare: false\n    auth: key\nroles:\n  manager:\n    profile: worker-default\n    name: my-own-manager\n";
  fs.writeFileSync(carrier, mine);
  const r = runInit(root);
  assert.equal(r.status, 0, `quay-init must succeed\n${r.stdout}\n${r.stderr}`);
  assert.equal(fs.readFileSync(carrier, "utf8"), mine, "a PRE-EXISTING carrier belongs to the user and must survive init byte-for-byte");
});

test("the produced carrier is the shipped template, differing only by the role-name prefix", () => {
  const { carrier } = initialised("prefix-swap");
  const shipped = fs.readFileSync(SHIPPED_CARRIER, "utf8");
  const produced = fs.readFileSync(carrier, "utf8");
  const swap = (text, prefix) => text.replace(/^(\s*name:\s*)quay-/gm, `$1${prefix}-`);
  assert.equal(produced, swap(shipped, "prefix-swap"), "the shell entry must lay the shipped carrier down verbatim, with the project-derived names");
});
