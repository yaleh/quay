// @test-group product
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e; install family rotated flakes under full-suite load (rounds 160-162)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh --loop subprocess tree. The install/quay-init family rotated
// flakes across groups under full-suite load (round-160/161/162 — different files each round), so the
// whole family is consolidated into the concurrency-1 serial phase
// (gap-install-family-tests-rotate-flakes-under-full-suite).
// GROUP NOTE (gap-install-config-driven-e2e-load-flake + gap-install-family-tests-rotate-flakes-
// under-full-suite): routed to `serial`. The serial criterion was nested-runner only
// (gap-serial-group-recompose-nested-runner-criterion); this file EXTENDS it to the install/quay-init
// family (the criterion is documented in scripts/test.sh — serial = the load-sensitive family that
// needs concurrency-1 isolation). The install/quay-init family does REAL quay-init --loop installs
// into temp workspaces and flaked 2/3 full-suite rounds under the lowconc concurrency-3 phase
// (`✖ A1 字节一致` at 23s under resource contention while the solo run stayed green —
// gap-install-config-driven-e2e-load-flake). serial = concurrency 1 = complete isolation: the
// concurrency-1 serial phase is now the family's single isolation regime.
// install-config-driven-e2e.test.mjs — gap-no-e2e-proves-install-is-configuration-driven.
//
// SPLIT BY gap-split-three-phase-floor-files (2026-08-12): this file was the serial phase's floor
// (~107s, 19 real installs). It is split by test-focus into three sibling files (byte-identity core
// HERE; upgrade/config-preservation in install-config-driven-e2e-upgrade.test.mjs; runtime-landing +
// builds in install-config-driven-e2e-runtime.test.mjs). The test BODIES are byte-identical to the
// pre-split file; only their file placement changed. Each split file keeps the serial-group family
// annotations (@test-group serial + @load-sensitive real-install + @load-sensitive-entry) and its own
// after() cleanup, so the serial isolation semantics are preserved. This file keeps the A1 / A2 / A4
// core (cross-workspace byte-identity, artifact byte-identity + idempotent re-install, and the
// methodology finding/plan author→ready gate). The A5/AC9/AC6/A6/A5-AC11 runtime-landing tests moved
// to install-config-driven-e2e-runtime.test.mjs; the A3/AC6-AC1/AC2 upgrade tests moved to
// install-config-driven-e2e-upgrade.test.mjs.
//
// The reinstall gate: ONE e2e with FOUR assertions (A1–A4). This file is the ONLY
// mechanical gate for reinstalling two real projects (archguard, meta-cc). It lands
// RED FIRST (all four assertions red) — because a check that has never been red is
// indistinguishable from one that always returns an empty set, and this repo has
// paid that tuition twice (gap-checks-that-verify-an-empty-set-must-fail-closed,
// gap-checkers-have-never-been-shown-to-fail).
//
//   A1 — two workspaces with genuinely different derived test commands
//        (package.json → npm test vs go.mod → go test ./...) laid down by quay-init
//        must be byte-identical EXCEPT the config file(s). [RED now: tick docs are
//        text-substituted with the test command → they differ across workspaces]
//   A2 — laid-down files byte-identical to the product artifacts, and a SECOND
//        install changes ZERO product files. [RED now: tick docs differ from the
//        plugin templates — text substitution bakes target values in]
//   A4 — a `## Finding` task WITHOUT `## Plan` passes the author→ready gate; a
//        `## Plan` task still goes through the strict contract. [RED now: the gate
//        still rejects Finding-without-Plan — "missing artifacts: plan"]
//   (A3 — upgrade — moved to install-config-driven-e2e-upgrade.test.mjs.)
//
// AC6 (anti-pass-through, landed WITH the assertions, not deferred): the two
// workspaces' config files genuinely differ AND the laid-down count is > 0; the
// negative control deliberately makes BOTH installs fail and asserts the check
// stays red (never "both empty so identical"). [The AC6 TEST body lives in
// install-config-driven-e2e-runtime.test.mjs; the AC7/AC8 contract notes below still apply to the
// whole family.]
// AC7: the two derived test commands are asserted to genuinely differ (verbatim
// evidence pasted in the task body from the run below).
// AC8: node:test + `// @test-group serial` (moved from lowconc to the concurrency-1 serial phase
// with the install/quay-init family, gap-install-family-tests-rotate-flakes-under-full-suite);
// temp workspaces destroyed via after().

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createStore } from "../../quay-native/src/store.ts";
import { activeProvider } from "../src/config.ts";
import { resolvePluginRoot } from "../src/plugin-root.ts";
import { readPluginLinkVersion, pluginVersionState } from "../src/serve-render.ts";
import { laydownWorkspace } from "../../../plugin/test/helpers/quay-init-install-fixture.mjs";
import { spawnAsync, spawnTimings, assertParallelLaunches } from "../../../plugin/test/helpers/async-spawn.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PLUGIN_ROOT = path.resolve(REPO_ROOT, "plugin");

// Config-class files: per-project state/config that legitimately differs across
// workspaces (absolute paths in config.yml, the laidAt timestamp in the state
// record, the per-project session in session-liveness.env). The PRODUCT files
// (mechanism scripts + tick docs) are what must be byte-identical.
const CONFIG_CLASS = new Set([
  ".quay/config.yml",
  ".quay/quay-init-state.json",
  "orchestration/session-liveness.env",
  // .gitignore — quay-init writes (or appends) the `.quay/runtime/` entry itself
  // (gap-the-runtime-has-nowhere-safe-to-land AC10); it is install-generated config, not a
  // product artifact. Deterministic content across workspaces, so A1's byte-identity holds.
  ".gitignore",
  // .quay/profiles.yml — gap-quay-init-profiles-template-omits-every-role-the-drivers-request:
  // role `name:` fields are now derived from the target workspace's own basename (fixes
  // cross-session SendMessage misrouting on the old hardcoded `quay-<role>` names), so this file
  // is legitimately per-workspace content, not a byte-identical product artifact.
  ".quay/profiles.yml",
  // .quay/plugin — gap-config-provider-path-frozen-to-versioned-cache-dir: `/quay:init` now lays a
  // per-project SYMLINK `<ws>/.quay/plugin -> <this project's scope installPath>`, and the config's
  // provider `path`/`mcp_entry` point at it (no version segment ⇒ upgrade-proof). It is
  // install-generated per-project config, not a product artifact — and it is a SYMLINK TO A
  // DIRECTORY, which `listFiles` reports as a plain entry (Dirent.isDirectory() is false for a
  // symlink), so `crossWorkspaceDiffs`' readFileSync would otherwise die EISDIR on it.
  ".quay/plugin",
]);

const substantive = (label) =>
  `${label} — this is real, substantive prose describing the ${label.toLowerCase()} in enough detail to exceed the minimum content threshold for this section, well past forty characters.`;

// ── workspace lifecycle (AC8: destroyed after the file runs, no shared-checkout residue) ─────────────
// gap-serial-phase-install-test-residue-dependency: EVERY install in this file now gets a UNIQUE
// disk-backed worktree root + a per-workspace tmux session name (independent env namespace — task
// fix direction B). The pre-fix runInit did NOT pass --worktree-root, so all ~19 installs recorded
// the SAME sibling-of-repo default `/srv/target-worktrees` — a FIXED, cross-test shared namespace
// that also does not exist on disk, so it can never be cleaned. Two install tests in the same
// serial phase (concurrency 1, but order-adjacent) must not present a shared namespace the other
// could trip on; this file is the FIRST runner in the round-161 ordering dependency, so its
// isolation is the load-bearing half.
const _tmp = [];
const _wtRoots = [];
after(() => {
  for (const ws of _tmp) fs.rmSync(ws, { recursive: true, force: true });
  for (const wt of _wtRoots) fs.rmSync(wt, { recursive: true, force: true });
});

// A disk-backed (non-tmpfs) worktree root, unique per call, tracked for after() cleanup. Mirrors
// quay-init-loop-helpers.diskWorktreeRoot (the loop family already isolates per-install this way);
// duplicated here because a plugin/test helper importing a packages/quay/test file would invert the
// dependency direction. /var/tmp is the disk-backed tmp on Linux; /tmp may be tmpfs on dev boxes —
// validate_worktree_root in quay-init.sh rejects tmpfs (exit 2 → the "init must exit 0" failure
// class this task is fixing), so a tmpfs root is never a safe fallback.
function diskWorktreeRoot() {
  let dir = null;
  for (const base of ["/var/tmp", os.tmpdir()]) {
    try {
      const t = spawnSync("stat", ["-f", "-c", "%T", base], { encoding: "utf8" });
      if (t.status === 0 && t.stdout.trim() !== "tmpfs") { dir = fs.mkdtempSync(path.join(base, "install-e2e-wt-")); break; }
    } catch { /* try next base */ }
  }
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), "install-e2e-wt-"));
  _wtRoots.push(dir);
  return dir;
}

function makeWorkspace(prefix = "install-e2e-") {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmp.push(ws);
  return ws;
}

// ── quay-init invocation ──────────────────────────────────────────────────────────────────────────────
// gap-serial-phase-install-test-residue-dependency: each install gets a UNIQUE --worktree-root (a
// per-call diskWorktreeRoot) and a per-workspace tmux session (derived from the workspace's own
// basename — a workspace's re-installs keep the same session, two workspaces never share one).
// Previously the worktree root was the shared sibling-of-repo default `/srv/target-worktrees` and
// the tmux session default was the fixed `proj-0:0.0` shared by every install in this file AND by
// the quay-init-loop family (STANDARD_INIT_ARGS) — shared env namespaces across serial-phase-
// adjacent install tests. Both values are CONFIG_CLASS (excluded from A1's byte-identity), so the
// independence does not disturb the config-driven byte-identity assertions.
// `worktreeRoot` option: undefined → a fresh unique disk root per call; a string → that root;
// null → pass NO --worktree-root (the config-preserving upgrade path: quay-init keeps the
// consumer's recorded loop.worktree_root — the AC6/AC1 + AC2 "entire loop section unchanged" path).
function runInitArgs(ws, { pluginRoot = PLUGIN_ROOT, repoRoot = "/srv/target", project = "proj", tmux, testCommand, worktreeRoot, addArgs = [] } = {}) {
  const session = tmux ?? `p-${path.basename(ws).slice(-12)}-0:0.0`;
  const args = ["--loop", "--root", ws, "--project", project, "--tmux-session", session, "--repo-root", repoRoot];
  if (worktreeRoot !== null) args.push("--worktree-root", worktreeRoot ?? diskWorktreeRoot());
  if (testCommand) args.push("--test-command", testCommand);
  args.push(...addArgs);
  return { pluginRoot, args };
}

function runInit(ws, opts = {}) {
  const { pluginRoot, args } = runInitArgs(ws, opts);
  return spawnSync("bash", [path.join(pluginRoot, "scripts", "quay-init.sh"), ...args], {
    cwd: ws,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
}

// runInitAsync — the async-spawn variant (gap-suite-parallel-independent-installs). Two INDEPENDENT
// installs in one test are run via Promise.all: spawnSync blocks the event loop, so the sync runInit
// can never overlap; this returns a promise resolving to the same {status, stdout, stderr} shape.
function runInitAsync(ws, opts = {}) {
  const { pluginRoot, args } = runInitArgs(ws, opts);
  return spawnAsync("bash", [path.join(pluginRoot, "scripts", "quay-init.sh"), ...args], {
    cwd: ws,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
}

// The landed loop.worktree_root, extracted from the installed .quay/config.yml — the AC3 independence
// invariant's load-bearing field (two parallel installs sharing a worktree root would race on git
// worktree operations). Returns null when the line is absent.
function landedWorktreeRoot(ws) {
  const cfg = path.join(ws, ".quay", "config.yml");
  if (!fs.existsSync(cfg)) return null;
  const m = /worktree_root:\s*(\S+)/.exec(fs.readFileSync(cfg, "utf8"));
  return m ? m[1] : null;
}

function extractDetectedCommand(stdout) {
  const m = /detected test command: ([^\n]+)/.exec(stdout);
  return m ? m[1].trim() : null;
}

// ── filesystem helpers ─────────────────────────────────────────────────────────────────────────────────
function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}

// Map a laid-down workspace relpath to its plugin source (product artifact).
// Returns null for config-class/generated files and the project's own files.
function productSource(rel) {
  if (rel.startsWith("plugin/scripts/")) {
    return path.join(PLUGIN_ROOT, "scripts", path.basename(rel));
  }
  if (rel === "orchestration/orchestrator-loop-tick.md") {
    return path.join(PLUGIN_ROOT, "loop", "orchestrator-loop-tick.md");
  }
  if (rel === "docs/analysis/fast-mode-loop-tick.md") {
    return path.join(PLUGIN_ROOT, "loop", "fast-mode-loop-tick.md");
  }
  if (rel === ".quay/runtime/bin/quay.js") {
    // The built runtime is laid verbatim when the plugin source has it (a gitignored
    // build artifact, present after scripts/test.sh's build step, absent in a raw
    // checkout). Compare it only when it exists. The TARGET landing path is
    // .quay/runtime/bin/quay.js (gap-the-runtime-has-nowhere-safe-to-land AC9 — never
    // vendor/, a Go reserved dir), mapped to the plugin-source bundle at
    // plugin/vendor/quay/dist/quay.js.
    const src = path.join(PLUGIN_ROOT, "vendor", "quay", "dist", "quay.js");
    return fs.existsSync(src) ? src : null;
  }
  if (rel === ".quay/runtime/bin/quay-native.js") {
    const src = path.join(PLUGIN_ROOT, "vendor", "quay-native", "dist", "quay-native.js");
    return fs.existsSync(src) ? src : null;
  }
  if (rel === ".quay/runtime/provider.yml") {
    // provider.yml travels with the native bundle (resolved via `../provider.yml` from the
    // bundle's bin/ dir); byte-identity to the plugin source is part of G2 (AC6).
    const src = path.join(PLUGIN_ROOT, "vendor", "quay-native", "provider.yml");
    return fs.existsSync(src) ? src : null;
  }
  return null;
}

function isProductFile(rel) {
  return productSource(rel) !== null && !CONFIG_CLASS.has(rel);
}

function laidDownProductFiles(ws) {
  return listFiles(ws).filter((rel) => isProductFile(rel));
}

// A1: cross-workspace byte-identity of the laid-down files (config-class excluded).
// A file present on only ONE side is the project's own file (package.json/go.mod),
// not a laid-down product file — single-side PRODUCT files are caught separately
// by the equal-set assertion in the A1 test.
function crossWorkspaceDiffs(ws1, ws2) {
  const files1 = new Map(listFiles(ws1).map((r) => [r, r]));
  const files2 = new Map(listFiles(ws2).map((r) => [r, r]));
  const diffs = [];
  for (const rel of files1.keys()) {
    if (CONFIG_CLASS.has(rel)) continue;
    if (!files2.has(rel)) continue;
    if (!fs.readFileSync(path.join(ws1, rel)).equals(fs.readFileSync(path.join(ws2, rel)))) {
      diffs.push(rel);
    }
  }
  return diffs;
}

// A2/A3: laid-down product files that differ from the plugin source artifact.
function artifactDiffs(ws) {
  const diffs = [];
  for (const rel of laidDownProductFiles(ws)) {
    const src = productSource(rel);
    if (!fs.existsSync(src)) continue;
    if (!fs.readFileSync(path.join(ws, rel)).equals(fs.readFileSync(src))) {
      diffs.push(rel);
    }
  }
  return diffs;
}

function snapshotProductFiles(ws) {
  const snap = new Map();
  for (const rel of laidDownProductFiles(ws)) {
    snap.set(rel, fs.readFileSync(path.join(ws, rel)));
  }
  return snap;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AC6 — the native provider resolves from the plugin root when the config omits path/mcp_entry
// (gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it (D))
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("AC6① — activeProvider() fills the native provider from the plugin root when the config omits path/mcp_entry", () => {
  const pluginRoot = resolvePluginRoot();
  assert.ok(pluginRoot, "the test must be able to resolve a plugin root");
  const cfg = { config: { providers: { native: { enabled: true, tasks_dir: "/x/tasks" } } } };
  const p = activeProvider(cfg, undefined);
  assert.equal(p.id, "native");
  assert.equal(p.path, path.join(pluginRoot, "vendor", "quay-native"), "path must default to <plugin-root>/vendor/quay-native");
  assert.deepEqual(
    p.mcp_entry,
    ["node", path.join(pluginRoot, "vendor", "quay-native", "dist", "quay-native.js"), "mcp"],
    "mcp_entry must default to the plugin's vendored native bundle",
  );
  assert.ok(fs.existsSync(p.mcp_entry[1]), `the resolved runtime must exist on disk: ${p.mcp_entry[1]}`);
});

test("AC6② — an explicit provider entry is left EXACTLY as written (only `native` gets defaults)", () => {
  const custom = { enabled: true, path: "/custom/dir", mcp_entry: ["node", "/custom/dir/server.js", "mcp"] };
  const p = activeProvider({ config: { providers: { github: custom } } }, "github");
  assert.equal(p.path, "/custom/dir", "a non-native provider's explicit path must be untouched");
  assert.deepEqual(p.mcp_entry, custom.mcp_entry, "a non-native provider's explicit mcp_entry must be untouched");
  // A `native` entry that DOES carry an explicit binding is also left alone (the default only fills gaps).
  const explicitNative = { enabled: true, path: "/explicit/native", mcp_entry: ["node", "/explicit/native/x.js", "mcp"] };
  const n = activeProvider({ config: { providers: { native: explicitNative } } }, "native");
  assert.equal(n.path, "/explicit/native");
  assert.deepEqual(n.mcp_entry, explicitNative.mcp_entry);
});

test("AC6③ — a REAL workspace whose config omits path/mcp_entry launches the native provider and answers task_list", () => {
  const ws = makeWorkspace();
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "tasks", "AC6-1.md"),
    "---\nid: AC6-1\ntitle: ac6 probe\nstatus: todo\n---\n\n## Proposal\n" + substantive("Proposal") + "\n",
  );
  // ⛔ NO path / mcp_entry — exactly the shape quay-init now writes.
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    tasks_dir: "${ws}/tasks"\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${ws}/tasks"\n`,
  );
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(REPO_ROOT, "packages", "quay", "bin", "quay.ts"), "task", "list", "--root", ws, "--json"],
    { encoding: "utf8", timeout: 90000 },
  );
  assert.equal(r.status, 0, `task list must succeed via the plugin-root default:\nstdout:${r.stdout}\nstderr:${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
  assert.ok(Array.isArray(tasks), `task list must return a task array: ${r.stdout}`);
  assert.ok(tasks.some((t) => t.id === "AC6-1"), `the task must be visible — the provider really launched: ${r.stdout}`);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AC9 (serve half) — the dashboard's "laid" version is DERIVED FROM THE LINK, not a state file
// (gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it (E))
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("AC9 — readPluginLinkVersion() reads the link target's plugin.json; a missing link is null (not a match)", () => {
  const ws = makeWorkspace();
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });

  // No link ⇒ null, and the dashboard comparator must report the DISTINCT `unknown` state (硬规则 3b).
  assert.equal(readPluginLinkVersion(ws), null, "no link ⇒ null");
  assert.equal(pluginVersionState("0.15.0", null), "unknown", "a missing reading must NOT read as `match`");
  assert.notEqual(pluginVersionState("0.15.0", null), "match");

  // A link to a plugin root with version 0.14.0 ⇒ that version is the "laid" reading.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "ac9-plugin-root-"));
  _tmp.push(target);
  fs.mkdirSync(path.join(target, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(target, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "quay", version: "0.14.0" }));
  fs.symlinkSync(target, path.join(ws, ".quay", "plugin"));

  assert.equal(readPluginLinkVersion(ws), "0.14.0", "the version must come from the link target's plugin.json");
  assert.equal(pluginVersionState("0.15.0", "0.14.0"), "mismatch", "delivered != link ⇒ mismatch");
  assert.equal(pluginVersionState("0.14.0", "0.14.0"), "match");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A1 — cross-workspace byte-identity
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("A1 — two workspaces with genuinely different derived test commands lay down byte-identical product files (only the config differs)", async () => {
  const ws1 = makeWorkspace();
  const ws2 = makeWorkspace();
  // ws1: package.json with a scripts.test entry → derives "npm test" (archguard rung).
  fs.writeFileSync(path.join(ws1, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));
  // ws2: go.mod → derives "go test ./..." (meta-cc rung).
  fs.writeFileSync(path.join(ws2, "go.mod"), "module example.com/proj\n\ngo 1.22\n");

  // The install-family serial phase runs this file CONCURRENTLY with 26 other real-install test
  // files (gap-split-three-phase-floor-files moved the byte-identity core into a file that shares
  // the serial phase with the quay-init-loop fixture builders). The round-38 A1 failure
  // (`differing=["plugin/scripts/session-liveness.sh"]`, the ONLY non-byte-identical file) was a
  // MID-SUITE SOURCE CHANGE: the outer loop merged the observer-sessions-fix (25d60d38, which
  // rewrites plugin/scripts/session-liveness.sh) into the shared checkout 44s into round 38
  // (verified: round 38 start 15:19:41 on 4f1f050b, merge 15:20:25 → bbb19e46; rounds 39/40 on the
  // merged commit were GREEN). A1's two installs straddled the merge — one laid the OLD
  // session-liveness.sh, the other the NEW — so the cross-workspace byte-identity broke even
  // though the laydown mechanism itself is deterministic. Freeze a PRIVATE copy of the plugin
  // source and run BOTH installs from it, so the determinism contract is isolated from
  // shared-checkout noise (a concurrent fixture build or in-flight merge can no longer change the
  // source between the two installs). The byte-identity contract is NOT weakened: a laydown that
  // baked the derived test command into a product file would still differ across the two workspaces
  // even with a frozen source (the frozen copy is the same current plugin, copied once at start).
  //
  // ⛔ THE FREEZE MUST COVER THE CORE SOURCE THE PLUGIN READS, NOT JUST THE DIRECTORY IT LAUNCHES FROM.
  // Since gap-arch-quay-init-sh-python-heredocs-to-native (SPEC-architecture-consolidation-ts-and-shell
  // §5 Phase 5.1) quay-init.sh's steps are no longer python3 bodies inside the shell — it dispatches to
  // the sibling `scripts/quay-init-steps.ts`, whose logic lives in `packages/quay/src/init.ts` and is
  // reached through `core-src-import.ts` (static literal FIRST: `<pluginRoot>/packages/quay/src/
  // init.ts`). Freezing only `plugin/` left the copy with no Core to read at all: every step died with
  // ERR_MODULE_NOT_FOUND, so `has-npm-test` read as "no scripts.test", the ladder fell through every
  // rung, and quay-init exited 2 before laying anything down — measured 2026-09-20 as the full suite's
  // only red (`ws1 install failed: … none could be detected in /tmp/install-e2e-…`). Copy the Core
  // source UNDER THE SAME RELATIVE SHAPE so the freeze covers what an install actually reads.
  // The frozen Core's bare imports (`yaml`, today) resolve through a SYMLINK to the checkout's own
  // node_modules — the same shape `installed-layout-sibling-resolvability.test.mjs` uses, and for the
  // same reason: a test must not own a second install of the dependency tree. (Deps are not the
  // source the freeze protects, so a symlink does not weaken it — and unlike a copy of one package,
  // it keeps resolving if the Core ever grows a second bare import.)
  //
  // ⛔ WHY NOT `<frozenRoot>/plugin` + `<frozenRoot>/packages/quay/src` (the repo-tree shape): that
  // would make `$PLUGIN_ROOT/../packages/quay/src` EXIST — the very source dir quay-init's staleness
  // probe (`dist_stale`) keys off — and a copied source file newer than the copied bundle (cpSync does
  // not preserve mtimes) would send BOTH parallel installs into a sync-vendor.sh auto-rebuild *into the
  // frozen copy*. Nested inside the plugin root that path stays absent, so the probe still cannot fire.
  const frozenPlugin = makeWorkspace("install-e2e-frozenplugin-");
  fs.cpSync(PLUGIN_ROOT, frozenPlugin, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, "packages", "quay", "src"), path.join(frozenPlugin, "packages", "quay", "src"), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(frozenPlugin, "node_modules"), "dir");

  // The two installs are INDEPENDENT (distinct workspace / worktree root / tmux session; the frozen
  // plugin copy is a read-only input — `$PLUGIN_ROOT/../packages/quay/src` is absent, the source dir
  // quay-init's staleness probe keys off, so it never rebuilds into it).
  // Run them in parallel (gap-suite-parallel-independent-installs): spawnSync blocks the event loop,
  // so the sync form can never overlap; Promise.all over two async spawns is the one place intra-test
  // concurrency actually takes effect.
  const t0 = spawnTimings.length;
  const [r1, r2] = await Promise.all([runInitAsync(ws1, { pluginRoot: frozenPlugin }), runInitAsync(ws2, { pluginRoot: frozenPlugin })]);
  assert.equal(r1.status, 0, `ws1 install failed:\n${r1.stderr}`);
  assert.equal(r2.status, 0, `ws2 install failed:\n${r2.stderr}`);
  assertParallelLaunches(t0, "A1");

  // AC3 (independence invariant, round-161): the two parallel installs landed DISTINCT worktree
  // roots. Workspace and tmux session are distinct by construction (makeWorkspace + a session
  // derived from each workspace's own basename); the worktree root is the load-bearing field under
  // parallelism — a shared root would race on git worktree operations.
  const wt1 = landedWorktreeRoot(ws1);
  const wt2 = landedWorktreeRoot(ws2);
  assert.ok(wt1 && wt2, `AC3: both installs must land a worktree_root (got ${JSON.stringify(wt1)} / ${JSON.stringify(wt2)})`);
  assert.notEqual(wt1, wt2, "AC3: the two parallel installs must land distinct worktree roots");

  // AC7: the two derived test commands genuinely differ (verbatim evidence below).
  const cmd1 = extractDetectedCommand(r1.stdout);
  const cmd2 = extractDetectedCommand(r2.stdout);
  assert.ok(cmd1 && cmd2, `both workspaces must derive a test command (got ${JSON.stringify(cmd1)} / ${JSON.stringify(cmd2)})`);
  assert.notEqual(cmd1, cmd2, `AC7: the derived test commands must genuinely differ (got ${cmd1} / ${cmd2}) — otherwise A1 only proves the same substitution value produces the same result`);

  // Anti-pass-through (AC6): both sides must have laid down the SAME product file set.
  const laid1 = laidDownProductFiles(ws1);
  const laid2 = laidDownProductFiles(ws2);
  assert.deepEqual(laid2, laid1, `both workspaces must lay down the SAME product set; ws1=${JSON.stringify(laid1)} ws2=${JSON.stringify(laid2)}`);

  // The core A1 assertion: byte-identical laid-down files, only config differs.
  // On failure, emit an actionable diagnostic (which workspace's file drifted, the first
  // differing byte offset, and whether each side still matches the plugin source) so a
  // recurrence is immediately diagnosable rather than an opaque byte-identity failure.
  const diffs = crossWorkspaceDiffs(ws1, ws2);
  if (diffs.length > 0) {
    const dbg = [];
    for (const rel of diffs) {
      const b1 = fs.readFileSync(path.join(ws1, rel));
      const b2 = fs.readFileSync(path.join(ws2, rel));
      dbg.push(`${rel} ws1.sha256=${createHash("sha256").update(b1).digest("hex").slice(0, 16)} ws2.sha256=${createHash("sha256").update(b2).digest("hex").slice(0, 16)} len1=${b1.length} len2=${b2.length}`);
      const n = Math.min(b1.length, b2.length);
      for (let i = 0; i < n; i++) {
        if (b1[i] !== b2[i]) {
          dbg.push(`  first diff @ ${i}: ws1=[${b1.slice(Math.max(0, i - 30), i + 30).toString("utf8").replace(/\n/g, "\\n")}] ws2=[${b2.slice(Math.max(0, i - 30), i + 30).toString("utf8").replace(/\n/g, "\\n")}]`);
          break;
        }
      }
      // gap-quay-init-profiles-template-omits-every-role-the-drivers-request: a diffing rel with
      // no productSource() mapping (e.g. a file that should have been added to CONFIG_CLASS
      // instead) must report cleanly here, not crash fs.readFileSync(null) — a crashing debug
      // branch is worse than a plain assertion failure (硬规则 3b: reads-as-crash ≠ read-as-pass,
      // but a debug helper that throws still obscures the real diff being reported).
      const src = productSource(rel);
      if (src === null) {
        dbg.push(`  (no productSource() mapping for ${rel} — likely belongs in CONFIG_CLASS instead)`);
      } else {
        dbg.push(`  ws1 identical to plugin source: ${fs.readFileSync(src).equals(b1)}`);
        dbg.push(`  ws2 identical to plugin source: ${fs.readFileSync(src).equals(b2)}`);
      }
    }
    assert.deepEqual(diffs, [],
      `A1: laid-down files must be byte-identical across the two workspaces (only the config file may differ); differing=${JSON.stringify(diffs)}\n  ${dbg.join("\n  ")}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A2 — byte-identical to product artifacts + idempotent re-install
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("A2 — laid-down files are byte-identical to the product artifacts, and a second install changes ZERO product files", () => {
  const { ws, install: r1 } = laydownWorkspace();
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));

  assert.equal(r1.status, 0, `install failed:\n${r1.stderr}`);

  // Artifact identity: every laid-down product file equals the plugin source.
  const diffs = artifactDiffs(ws);
  assert.deepEqual(diffs, [],
    `A2: every laid-down file must be byte-identical to the product artifact; differing=${JSON.stringify(diffs)}`);

  // Idempotency: ONE real install on the fixture copy changes ZERO product files.
  const before = snapshotProductFiles(ws);
  const r2 = runInit(ws);
  assert.equal(r2.status, 0, `second install failed:\n${r2.stderr}`);
  const after = snapshotProductFiles(ws);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(),
    "A2: the product file set must be unchanged after a second install");
  for (const rel of before.keys()) {
    assert.ok(after.get(rel).equals(before.get(rel)),
      `A2: a second install must not modify product file ${rel}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A4 — the methodology gate: Finding-without-Plan passes; Plan stays strict
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("A4 — a ## Finding task WITHOUT ## Plan passes the author→ready gate; a ## Plan task still goes through the strict contract", () => {
  const dir = makeWorkspace();
  const store = createStore(dir);

  // Direction 1 (the meta-cc / quay Finding-template direction): `## Finding`
  // fills the proposal-slot, and the task has NO `## Plan` — it must pass
  // author→ready.
  const findingBody =
    `## Finding\n${substantive("Finding")}\n` +
    `## Acceptance Criteria\n- [x] a real, checkable acceptance criterion\n- [x] another one\n` +
    `## Definition of Done\n${substantive("Definition of Done")}\n`;
  store.write("A4-FINDING", { title: "finding-no-plan", status: "todo", body: findingBody });
  const rf = store.check("A4-FINDING");
  assert.equal(rf.ok, true,
    `A4: a ## Finding task WITHOUT ## Plan must pass author->ready; shape=${rf.shape} ok=${rf.ok} artifacts=${JSON.stringify(rf.artifacts)} reason=${JSON.stringify(rf.reason)}`);

  // Direction 2: `## Plan` still goes through the strict contract (a compliant
  // task passes; a task missing a required section FAILS — never waived by the
  // finding change).
  const planBody =
    `## Proposal\n${substantive("Proposal")}\n` +
    `## Plan\n${substantive("Plan")}\n` +
    `## AC\n- [x] a real, checkable acceptance criterion\n- [x] another one\n` +
    `## DoD\n${substantive("DoD")}\n`;
  store.write("A4-PLAN", { title: "plan-compliant", status: "todo", body: planBody });
  const rp = store.check("A4-PLAN");
  assert.equal(rp.ok, true,
    `A4: a compliant ## Plan task must still pass the strict contract; shape=${rp.shape} ok=${rp.ok} reason=${JSON.stringify(rp.reason)}`);

  const brokenPlan =
    `## Proposal\n${substantive("Proposal")}\n` +
    `## Plan\n${substantive("Plan")}\n` +
    `## DoD\n${substantive("DoD")}\n`; // no AC / Acceptance Criteria section
  store.write("A4-PLAN-MISSING-AC", { title: "plan-missing-ac", status: "todo", body: brokenPlan });
  const rm = store.check("A4-PLAN-MISSING-AC");
  assert.equal(rm.ok, false,
    `A4: a ## Plan task missing a required section must FAIL (strict contract not waived); shape=${rm.shape} ok=${rm.ok} reason=${JSON.stringify(rm.reason)}`);
});
