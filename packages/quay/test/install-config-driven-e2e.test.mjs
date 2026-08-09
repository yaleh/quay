// @test-group serial
// GROUP NOTE (gap-install-config-driven-e2e-load-flake): routed to `serial`, NOT `lowconc`.
// The serial criterion was nested-runner only (gap-serial-group-recompose-nested-runner-criterion);
// this file EXTENDS it to the install/quay-init family (the criterion is documented in
// scripts/test.sh — serial = the load-sensitive family that needs concurrency-1 isolation).
// install-config-driven-e2e does REAL quay-init --loop installs into temp workspaces (~122s
// standalone, 12 real installs) and flaked 2/3 full-suite rounds under the lowconc
// concurrency-3 phase (`✖ A1 字节一致` at 23s under resource contention while the solo run stayed
// 12/12 green — gap-install-config-driven-e2e-load-flake). serial = concurrency 1 = complete
// isolation: no competing hermetic test runs while this file lays down its workspaces.
// install-config-driven-e2e.test.mjs — gap-no-e2e-proves-install-is-configuration-driven.
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
//   A3 — an old-install workspace upgrades to all-new product files, and existing
//        .workflow-events/ / tick-log.md / gate events stay readable & semantically
//        unchanged. [RED now: the upgrade CONFLICT-skips the tick docs → they stay
//        the old version, so "all files equal the new product" fails]
//   A4 — a `## Finding` task WITHOUT `## Plan` passes the author→ready gate; a
//        `## Plan` task still goes through the strict contract. [RED now: the gate
//        still rejects Finding-without-Plan — "missing artifacts: plan"]
//
// AC6 (anti-pass-through, landed WITH the assertions, not deferred): the two
// workspaces' config files genuinely differ AND the laid-down count is > 0; the
// negative control deliberately makes BOTH installs fail and asserts the check
// stays red (never "both empty so identical").
// AC7: the two derived test commands are asserted to genuinely differ (verbatim
// evidence pasted in the task body from the run below).
// AC8: node:test + `// @test-group lowconc`; temp workspaces destroyed via after().

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { createStore } from "../../quay-native/src/store.ts";

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
]);

const substantive = (label) =>
  `${label} — this is real, substantive prose describing the ${label.toLowerCase()} in enough detail to exceed the minimum content threshold for this section, well past forty characters.`;

// ── workspace lifecycle (AC8: destroyed after the file runs, no shared-checkout residue) ─────────────
const _tmp = [];
function makeWorkspace(prefix = "install-e2e-") {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmp.push(ws);
  return ws;
}
after(() => {
  for (const ws of _tmp) fs.rmSync(ws, { recursive: true, force: true });
});

// ── quay-init invocation ──────────────────────────────────────────────────────────────────────────────
function runInit(ws, { pluginRoot = PLUGIN_ROOT, repoRoot = "/srv/target", project = "proj", tmux = "proj-0:0.0", testCommand, addArgs = [] } = {}) {
  const args = ["--loop", "--root", ws, "--project", project, "--tmux-session", tmux, "--repo-root", repoRoot];
  if (testCommand) args.push("--test-command", testCommand);
  args.push(...addArgs);
  return spawnSync("bash", [path.join(pluginRoot, "scripts", "quay-init.sh"), ...args], {
    cwd: ws,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
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

// Files quay-init --loop actually LAYS DOWN (product files + config-class files
// it writes). The project's own files (package.json / go.mod, created by the
// test before install) are NOT part of the laid-down set — they must never make
// the anti-pass-through "count > 0" pass on their own.
function loopLaidDownFiles(ws) {
  const product = laidDownProductFiles(ws);
  const config = [...CONFIG_CLASS].filter((rel) => fs.existsSync(path.join(ws, rel)));
  return [...product, ...config];
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

// AC6: the anti-pass-through control. Without it, A1 can pass when BOTH sides
// failed to install anything ("both empty so identical").
function antiPassThroughCheck(ws1, ws2) {
  const count1 = loopLaidDownFiles(ws1).length;
  const count2 = loopLaidDownFiles(ws2).length;
  if (count1 === 0 || count2 === 0) {
    return { ok: false, reason: `laid-down count must be > 0 on both sides (got ${count1} / ${count2}) — both-empty is the empty-pass bug` };
  }
  const cfg1 = path.join(ws1, ".quay", "config.yml");
  const cfg2 = path.join(ws2, ".quay", "config.yml");
  if (!fs.existsSync(cfg1) || !fs.existsSync(cfg2)) {
    return { ok: false, reason: "config file must exist on both sides" };
  }
  if (fs.readFileSync(cfg1).equals(fs.readFileSync(cfg2))) {
    return { ok: false, reason: "the two config files must genuinely differ — identical configs mean neither side actually configured" };
  }
  return { ok: true, reason: "laid-down count > 0 on both sides and config files genuinely differ" };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A1 — cross-workspace byte-identity
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("A1 — two workspaces with genuinely different derived test commands lay down byte-identical product files (only the config differs)", () => {
  const ws1 = makeWorkspace();
  const ws2 = makeWorkspace();
  // ws1: package.json with a scripts.test entry → derives "npm test" (archguard rung).
  fs.writeFileSync(path.join(ws1, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));
  // ws2: go.mod → derives "go test ./..." (meta-cc rung).
  fs.writeFileSync(path.join(ws2, "go.mod"), "module example.com/proj\n\ngo 1.22\n");

  const r1 = runInit(ws1);
  const r2 = runInit(ws2);
  assert.equal(r1.status, 0, `ws1 install failed:\n${r1.stderr}`);
  assert.equal(r2.status, 0, `ws2 install failed:\n${r2.stderr}`);

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
  const diffs = crossWorkspaceDiffs(ws1, ws2);
  assert.deepEqual(diffs, [],
    `A1: laid-down files must be byte-identical across the two workspaces (only the config file may differ); differing=${JSON.stringify(diffs)}`);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A5 — heterogeneous target builds (AC8/AC11 of gap-the-runtime-has-nowhere-safe-to-land)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// The runtime used to land in `<target>/vendor/quay/dist/quay.js` — `vendor/` is Go's reserved
// module-vendoring directory, and `dist/` is a reserved build-output name. The landing decision
// (task AC2): the runtime is a GENERATED ARTIFACT, so it lands in `.quay/runtime/` (quay's own
// namespace) OUTSIDE git (gitignored by quay-init, AC10). AC8: the same artifact installs into a
// Node target and a Go target and BOTH still build after install (`npm test` / `go build ./...`).
// Byte-identity across targets (A1) does not save this — a Go target resolves `vendor/` by
// directory name, so the GO half is the one that can expose the collision (task AC11, the reinstall
// gate's A5 was missing `go build`).
test("A5 — a Node target still builds (npm test) after quay-init lands the runtime", () => {
  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "node --test test/smoke.test.mjs" } }, null, 2));
  fs.mkdirSync(path.join(ws, "test"), { recursive: true });
  fs.writeFileSync(path.join(ws, "test", "smoke.test.mjs"),
    'import { test } from "node:test";\nimport assert from "node:assert";\ntest("smoke", () => assert.equal(1, 1));\n');
  const r = runInit(ws);
  assert.equal(r.status, 0, `install must succeed:\n${r.stderr}`);
  // AC8 Node half: the target's own build must still pass after the runtime lands.
  const npmTest = spawnSync("npm", ["test"], { cwd: ws, encoding: "utf8" });
  assert.equal(npmTest.status, 0, `npm test must pass after install:\n${npmTest.stdout}\n${npmTest.stderr}`);
  assert.match(npmTest.stdout + npmTest.stderr, /smoke/, "the target's own test must actually have run");
});

test("A5 — a Go target still builds (go build ./...) after quay-init lands the runtime", (t) => {
  // ADR-019 decision #1 pattern: an in-file skip guard for an externally-tooled assertion. `go` is
  // present locally (proven green here) but not on the CI image — a missing tool must SKIP, not fail.
  const goProbe = spawnSync("go", ["version"], { encoding: "utf8" });
  if (goProbe.status !== 0) return t.skip(`go toolchain not available on this image (${goProbe.error?.message ?? goProbe.stderr})`);
  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "go.mod"), "module example.com/proj\n\ngo 1.22\n");
  // A real main package so `go build ./...` compiles something (no network: no external requires).
  fs.writeFileSync(path.join(ws, "main.go"), 'package main\n\nfunc main() {}\n');
  const r = runInit(ws);
  assert.equal(r.status, 0, `install must succeed:\n${r.stderr}`);
  // AC8/AC11 Go half: the target's Go build must still pass after the runtime lands. If the runtime
  // still sat in `vendor/`, Go's module resolution could treat that reserved directory specially and
  // break the build — the whole reason this half belongs in the reinstall gate.
  const goBuild = spawnSync("go", ["build", "./..."], { cwd: ws, encoding: "utf8" });
  assert.equal(goBuild.status, 0, `go build ./... must pass after install:\n${goBuild.stdout}\n${goBuild.stderr}`);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A5/AC9 — the runtime lands under no target-language-reserved directory (task AC9)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AC9 (task): the landing path must NOT sit under vendor / node_modules / target / build / dist — any
// of those is a reserved directory name in at least one target language/toolchain (Go vendor/,
// npm node_modules/, cargo/rust target/, make/cmake build/, bundler dist/). The check is by PATH
// LITERAL segment, extensible — the list below is the current exclusion set, not an exhaustive one.
test("AC9 — the laid-down runtime path contains no reserved directory segment (vendor/node_modules/target/build/dist)", () => {
  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "node --test" } }, null, 2));
  const r = runInit(ws);
  assert.equal(r.status, 0, `install must succeed:\n${r.stderr}`);
  const RESERVED = ["vendor", "node_modules", "target", "build", "dist"];
  // f9414dd3 moved the landing layout to .quay/runtime/bin/ (keeps the native bundle's
  // ../provider.yml resolution — provider.yml sits one level up from bin/). The A5/AC11 and
  // quay-init-loop config-path assertions use this same layout; this AC9 path list tracks it.
  const runtimes = [
    ".quay/runtime/bin/quay.js",
    ".quay/runtime/bin/quay-native.js",
    ".quay/runtime/provider.yml",
  ];
  for (const rel of runtimes) {
    assert.ok(fs.existsSync(path.join(ws, rel)), `runtime must exist at ${rel}`);
    const segments = rel.split("/");
    for (const seg of segments) {
      assert.ok(!RESERVED.includes(seg),
        `AC9: runtime path ${rel} must not contain reserved directory segment "${seg}" (reserved set: ${RESERVED.join(", ")})`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A2 — byte-identical to product artifacts + idempotent re-install
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("A2 — laid-down files are byte-identical to the product artifacts, and a second install changes ZERO product files", () => {
  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));

  const r1 = runInit(ws);
  assert.equal(r1.status, 0, `install failed:\n${r1.stderr}`);

  // Artifact identity: every laid-down product file equals the plugin source.
  const diffs = artifactDiffs(ws);
  assert.deepEqual(diffs, [],
    `A2: every laid-down file must be byte-identical to the product artifact; differing=${JSON.stringify(diffs)}`);

  // Idempotency: a second install changes ZERO product files.
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
// A3 — upgrade: all files become the new product, existing loop state stays readable
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("A3 — an old-install workspace upgrades to all-new product files, and existing loop state stays readable & semantically unchanged", () => {
  // Simulate an OLD plugin: a copy whose tick docs carry a legacy version marker.
  const oldPlugin = makeWorkspace("install-e2e-oldplugin-");
  fs.cpSync(PLUGIN_ROOT, oldPlugin, { recursive: true });
  const legacy = "\n<!-- legacy-1.0.0: old methodology, replaced by the config-driven install -->\n";
  fs.appendFileSync(path.join(oldPlugin, "loop", "orchestrator-loop-tick.md"), legacy);
  fs.appendFileSync(path.join(oldPlugin, "loop", "fast-mode-loop-tick.md"), legacy);

  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));

  // Existing loop state that must survive the upgrade: workflow events, tick log, gate events.
  const eventLine = JSON.stringify({ ts: 1, kind: "fixture", note: "pre-upgrade" });
  const workflowDir = path.join(ws, ".workflow-events");
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(path.join(workflowDir, "fm-e2e-fixture.jsonl"), `${eventLine}\n`);
  fs.writeFileSync(path.join(ws, "tick-log.md"), "# Tick log\n\n- 2026-08-04: e2e fixture tick\n");
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "gate-events.jsonl"), `${eventLine}\n`);

  // OLD install (old plugin version lays the legacy tick docs).
  const rOld = runInit(ws, { pluginRoot: oldPlugin });
  assert.equal(rOld.status, 0, `old install failed:\n${rOld.stderr}`);
  assert.ok(
    fs.readFileSync(path.join(ws, "orchestration", "orchestrator-loop-tick.md"), "utf8").includes("legacy-1.0.0"),
    "precondition: the old install must have laid the legacy tick docs"
  );

  // UPGRADE with the real (new) plugin.
  const rNew = runInit(ws);
  assert.equal(rNew.status, 0, `upgrade failed:\n${rNew.stderr}`);

  // Part 1: every laid-down file now equals the NEW product artifact.
  const diffs = artifactDiffs(ws);
  assert.deepEqual(diffs, [],
    `A3: after upgrade every laid-down file must equal the new product; still differing=${JSON.stringify(diffs)}`);

  // Part 2: existing loop state readable AND semantically unchanged (byte-identical).
  assert.equal(
    fs.readFileSync(path.join(workflowDir, "fm-e2e-fixture.jsonl"), "utf8"),
    `${eventLine}\n`,
    "A3: .workflow-events must survive the upgrade readable and unchanged"
  );
  assert.equal(
    fs.readFileSync(path.join(ws, "tick-log.md"), "utf8"),
    "# Tick log\n\n- 2026-08-04: e2e fixture tick\n",
    "A3: tick-log.md must survive the upgrade readable and unchanged"
  );
  assert.equal(
    fs.readFileSync(path.join(ws, ".quay", "gate-events.jsonl"), "utf8"),
    `${eventLine}\n`,
    "A3: gate events must survive the upgrade readable and unchanged"
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AC6 / AC1 — config-divergence fixture (gap-quay-init-config-preserving-incremental-upgrade):
// an ORGANICALLY EVOLVED consumer. The pre-fix A3 only used a self-made clean old-install
// ("config == template" — a synthetic sample); the real downstream (archguard) has custom
// loop values ≠ the template, and the pre-fix upgrade either stopped at config-conflict or
// --force-clobbered them. This fixture creates the organic shape (custom board/gates/stop/policy/
// concurrency_bands/fork_baseline/merge_target + the four fast-mode values) and asserts the
// config-preserving upgrade keeps the ENTIRE loop section unchanged while laying down the mechanism.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function writeEvolvedConsumerConfig(ws) {
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    "    path: /srv/proj/.quay/runtime",
    "    tasks_dir: /srv/proj/tasks",
    '    mcp_entry: ["node", "/srv/proj/.quay/runtime/bin/quay-native.js", "mcp"]',
    "loop:",
    "  board: native",
    "  gates: [acceptance]",
    "  stop: until(.halt)",
    "  policy: value-typed-ledger",
    "  concurrency_bands:",
    "    go: 5",
    "    wait: 2",
    "  fork_baseline: develop",
    "  merge_target: integration",
    "  repo_root: /srv/proj",
    "  test_command: custom-test-cmd",
    "  tmux_session: proj-session",
    "  worktree_root: /srv/proj-worktrees",
    "",
  ].join("\n"));
}

test("AC6/AC1 — an organically evolved consumer keeps the ENTIRE loop section after a config-preserving --loop upgrade (no --force), and the mechanism files are laid down", () => {
  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));
  writeEvolvedConsumerConfig(ws);
  const cfgPath = path.join(ws, ".quay", "config.yml");
  const loopBefore = YAML.parse(fs.readFileSync(cfgPath, "utf8")).loop;

  // Config-preserving upgrade WITHOUT --force (AC1). The test command is deliberately NOT passed:
  // the prefer-existing path must keep the consumer's recorded loop.test_command (a real
  // downstream run of `quay init --loop` has no fresh detection clobbering it).
  const r = runInit(ws, { repoRoot: "/srv/proj", tmux: "proj-session" });
  assert.equal(r.status, 0, `config-preserving upgrade must succeed:\n${r.stderr}`);

  // AC1 first half: mechanism files ARE laid down.
  assert.ok(fs.existsSync(path.join(ws, "plugin", "scripts", "session-liveness.sh")),
    "AC1: mechanism files must be laid down on the existing consumer");
  const laid = laidDownProductFiles(ws);
  assert.ok(laid.length >= 20, `AC1: laid-down product count must be >= 20; got ${laid.length}`);

  // AC1 second half: config PRESERVED — the ENTIRE loop section (custom keys + the four
  // fast-mode values) is unchanged. The pre-fix `data["loop"] = {...}` replacement dropped
  // board/gates/stop/policy/concurrency_bands/fork_baseline/merge_target here.
  const loopAfter = YAML.parse(fs.readFileSync(cfgPath, "utf8")).loop;
  assert.deepEqual(loopAfter, loopBefore,
    `AC1: the config-preserving upgrade must keep every loop key (loop values unchanged); got ${JSON.stringify(loopAfter)}`);

  // The prefer-existing message is emitted (transparency that the consumer's value won over detection).
  assert.match(r.stdout, /using existing config loop\.test_command: custom-test-cmd/,
    "the upgrade must report it kept the consumer's existing loop.test_command");
});

test("AC2 — config backup before upgrade + rollback restores the config unchanged on a failed upgrade", () => {
  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));
  writeEvolvedConsumerConfig(ws);
  const cfgPath = path.join(ws, ".quay", "config.yml");
  // The pre-upgrade config captured BEFORE the baseline install — a backup taken by an upgrade
  // must capture exactly this (the config as it was on disk before that upgrade wrote it).
  const originalConfig = fs.readFileSync(cfgPath, "utf8");

  // Baseline install (mechanism present, config written by quay-init).
  const r0 = runInit(ws, { repoRoot: "/srv/proj", tmux: "proj-session", testCommand: "original-test-cmd" });
  assert.equal(r0.status, 0, `baseline install must succeed:\n${r0.stderr}`);
  const beforeUpgrade = fs.readFileSync(cfgPath, "utf8");

  // AC2 first half: a config backup must exist after an upgrade (backup before upgrade), and it
  // must capture the PRE-upgrade config (what was on disk before that run modified it).
  const backups = listFiles(path.join(ws, ".quay", "quay-init-backups")).filter((rel) => rel.endsWith("config.yml"));
  assert.ok(backups.length >= 1, `AC2: a config backup must be created before the upgrade; got ${JSON.stringify(backups)}`);
  const backupContent = fs.readFileSync(path.join(ws, ".quay", "quay-init-backups", backups[0]), "utf8");
  assert.equal(backupContent, originalConfig,
    "AC2: the first backup must capture the pre-upgrade config exactly (backup before upgrade)");

  // Force a FAILED upgrade AFTER the config write: a corrupted NON-loop installed script
  // (send-keys-verified.sh is NEVER_LAYDOWN — the lay-down does not replace it, so
  // verify-installed-executables fails closed). The upgrade passes a DIFFERENT test_command,
  // which ensure_loop_config writes into the config — proving the rollback must undo it.
  fs.mkdirSync(path.join(ws, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(ws, "plugin", "scripts", "send-keys-verified.sh"),
    "#!/usr/bin/env bash\n# corrupted non-loop residue — never replaced by the lay-down\n");
  const rUp = runInit(ws, { repoRoot: "/srv/proj", tmux: "proj-session", testCommand: "SHOULD-NOT-STICK-cmd" });
  assert.notEqual(rUp.status, 0,
    "precondition: a corrupted non-loop installed script must fail the upgrade (verify-installed-executables fail-closed)");
  assert.match(rUp.stdout + rUp.stderr, /rolled back .*config.*unchanged/,
    "AC2: the failed upgrade must report the config rollback");

  // AC2 second half: the failed upgrade restored the config byte-for-byte (rollback unchanged).
  const afterFailed = fs.readFileSync(cfgPath, "utf8");
  assert.equal(afterFailed, beforeUpgrade,
    "AC2: a failed upgrade must restore the config unchanged (rollback); the SHOULD-NOT-STICK-cmd write must be undone");
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AC6 — anti-pass-through control (landed WITH the assertions, not deferred)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("AC6 — anti-pass-through: configs genuinely differ + laid-down count > 0; the both-installs-fail negative control stays red", () => {
  // Positive: two REAL installs → configs differ, laid-down count > 0, check passes.
  const ws1 = makeWorkspace();
  const ws2 = makeWorkspace();
  fs.writeFileSync(path.join(ws1, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));
  fs.writeFileSync(path.join(ws2, "go.mod"), "module example.com/proj\n\ngo 1.22\n");
  assert.equal(runInit(ws1).status, 0, "ws1 install must succeed (precondition)");
  assert.equal(runInit(ws2).status, 0, "ws2 install must succeed (precondition)");

  const pos = antiPassThroughCheck(ws1, ws2);
  assert.ok(pos.ok, `AC6: real installs must satisfy the anti-pass-through control; ${pos.reason}`);

  // The laid-down set must include the FULL known mechanism (the "equals the
  // product set size" half of AC6): both tick docs, session-liveness.sh, and the
  // core checkers the loop actually runs. This closes the "both sides miss the
  // same file so they look identical" gap.
  const REQUIRED_PRODUCT_FILES = [
    "orchestration/orchestrator-loop-tick.md",
    "docs/analysis/fast-mode-loop-tick.md",
    "plugin/scripts/session-liveness.sh",
    "plugin/scripts/fast-mode-telemetry.ts",
    "plugin/scripts/resource-gate.sh",
    "plugin/scripts/task-contract-check.ts",
    "plugin/scripts/loop-driver-check.sh",
  ];
  // inner-state.sh is retired (gap-retire-inner-state-one-observer-targets-by-parameter AC3): it
  // must NOT be in the laid-down product set.
  for (const ws of [ws1, ws2]) {
    const laid = new Set(loopLaidDownFiles(ws));
    assert.ok(!laid.has("plugin/scripts/inner-state.sh"),
      "inner-state.sh must NOT be laid down into target projects (retired, AC3)");
  }
  for (const ws of [ws1, ws2]) {
    const laid = new Set(loopLaidDownFiles(ws));
    for (const f of REQUIRED_PRODUCT_FILES) {
      assert.ok(laid.has(f), `AC6: expected laid-down file missing: ${f} (ws=${ws})`);
    }
    assert.ok(laidDownProductFiles(ws).length >= 20,
      `AC6: laid-down product count must be >= 20 (the full mechanism set); got ${laidDownProductFiles(ws).length} (ws=${ws})`);
  }

  // Negative control: BOTH installs FAIL (empty workspace, no --test-command →
  // detection fails closed, nothing laid down). The check MUST stay red — it must
  // NOT pass just because "both sides are empty so identical".
  const f1 = makeWorkspace("install-e2e-fail-");
  const f2 = makeWorkspace("install-e2e-fail-");
  const rFail1 = runInit(f1);
  const rFail2 = runInit(f2);
  assert.notEqual(rFail1.status, 0, "precondition: empty workspace without --test-command must fail install");
  assert.notEqual(rFail2.status, 0, "precondition: empty workspace without --test-command must fail install");
  assert.equal(loopLaidDownFiles(f1).length, 0, "failed install must lay down nothing");
  assert.equal(loopLaidDownFiles(f2).length, 0, "failed install must lay down nothing");

  const neg = antiPassThroughCheck(f1, f2);
  assert.ok(!neg.ok, `AC6 negative control: both-installs-empty must be detected as red (not 'identical'); ${neg.reason}`);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A6 — the reinstall gate's A6 (GOAL-when-to-reinstall.md): after landing, the target project's
// worktree root is NOT on tmpfs. NAMING WARNING (gap-the-shipped-tick-doc-... AC8): this is the
// GATE's A6 — do NOT confuse it with the anti-pass-through test named "AC6" above. They differ by
// one letter; a green "AC6" says nothing about this "A6".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("A6 — a landed quay-init --loop writes a loop.worktree_root that is NOT on tmpfs (a tmpfs root is rejected)", () => {
  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));
  const r = runInit(ws);
  assert.equal(r.status, 0, `install must succeed (precondition):\n${r.stderr}`);

  // The landed config must carry loop.worktree_root, and that root's filesystem type must NOT be
  // tmpfs — /tmp is tmpfs, every MB is RAM, and the 2026-08-04 machine-wide OOM traced straight
  // to in-flight worktrees living in it (GOAL-when-to-reinstall.md A6).
  const cfg = path.join(ws, ".quay", "config.yml");
  assert.ok(fs.existsSync(cfg), "landed .quay/config.yml must exist");
  const cfgText = fs.readFileSync(cfg, "utf8");
  const m = /worktree_root:\s*(\S+)/.exec(cfgText);
  assert.ok(m, `landed config must carry loop.worktree_root:\n${cfgText}`);
  const wtRoot = m[1];
  // The root may not exist yet (quay-init validates the nearest existing ancestor) — probe it.
  let probe = wtRoot;
  while (probe !== "/" && !fs.existsSync(probe)) probe = path.dirname(probe);
  const t = spawnSync("stat", ["-f", "-c", "%T", probe], { encoding: "utf8" });
  assert.equal(t.status, 0, `stat of worktree root's fs must work: ${wtRoot}`);
  assert.notEqual(t.stdout.trim(), "tmpfs",
    `A6: the landed worktree root must NOT be on tmpfs (it is memory, not disk); got "${t.stdout.trim()}" for ${wtRoot}`);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A5 / AC11 — the GO half of the reinstall gate (GOAL-when-to-reinstall.md A5, gap-the-runtime-has-
// nowhere-safe-to-land AC11). A1 only requires byte-identity of the laid-down files; but vendor/ is a
// Go RESERVED dir — a non-Go vendor/ dir flips a Go module with dependencies into vendor mode and
// breaks `go build ./...` with "inconsistent vendoring". Only a Go target can expose this, so the Go
// half of the gate must assert `go build ./...` still passes after quay-init lands. This test is
// HERMETIC: the Go module uses a LOCAL replace dependency (no network, no external module downloads).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function writeGoTarget(ws) {
  fs.writeFileSync(path.join(ws, "go.mod"),
    "module example.com/proj\n\ngo 1.22\n\nrequire example.com/dep v0.0.0\n\nreplace example.com/dep => ./dep\n");
  fs.writeFileSync(path.join(ws, "main.go"),
    'package main\n\nimport (\n\t"fmt"\n\t"example.com/dep"\n)\n\nfunc main() { fmt.Println(dep.Greet()) }\n');
  fs.mkdirSync(path.join(ws, "dep"), { recursive: true });
  fs.writeFileSync(path.join(ws, "dep", "go.mod"), "module example.com/dep\n\ngo 1.22\n");
  fs.writeFileSync(path.join(ws, "dep", "dep.go"), 'package dep\n\nfunc Greet() string { return "hi" }\n');
}

function goBuild(ws) {
  return spawnSync("go", ["build", "./..."], { cwd: ws, encoding: "utf8" });
}

test("A5/AC11 — a Go target still builds after quay-init lands (.quay/runtime/, never vendor/); the OLD vendor/ landing demonstrably breaks the build", () => {
  // Skip cleanly when go is not installed (the reinstall gate's Go half needs a real toolchain).
  if (!spawnSync("go", ["version"], { encoding: "utf8" }).stdout) {
    return;
  }
  const ws = makeWorkspace("install-e2e-go-");
  writeGoTarget(ws);

  // Precondition: without quay-init the Go module builds.
  let b = goBuild(ws);
  assert.equal(b.status, 0, `baseline go build must pass:\n${b.stdout}${b.stderr}`);

  // NEGATIVE control (the pre-fix layout): a non-Go vendor/ dir (quay-init's OLD landing) flips Go
  // into vendor mode → the build must FAIL with "inconsistent vendoring". This proves the test is
  // NOT vacuous: a runtime laid under vendor/ would break exactly this target.
  fs.mkdirSync(path.join(ws, "vendor", "quay", "dist"), { recursive: true });
  fs.writeFileSync(path.join(ws, "vendor", "quay", "dist", "quay.js"), "// old layout\n", "utf8");
  b = goBuild(ws);
  assert.notEqual(b.status, 0, "the OLD vendor/ landing must break the Go build (inconsistent vendoring)");
  assert.match(b.stderr, /inconsistent vendoring/, "must fail with Go's vendor-mode error — the exact meta-cc DIR-103 defect");
  fs.rmSync(path.join(ws, "vendor"), { recursive: true, force: true });

  // quay-init --loop lands into the Go target (test command derived: go test ./...).
  const r = runInit(ws);
  assert.equal(r.status, 0, `quay-init must succeed on the Go target:\n${r.stderr}`);

  // The runtime must land OUTSIDE vendor/ — in .quay/runtime/ (never under a Go-reserved dir).
  assert.ok(fs.existsSync(path.join(ws, ".quay", "runtime", "bin", "quay-native.js")),
    "the native provider runtime must land in .quay/runtime/bin/");
  assert.ok(fs.existsSync(path.join(ws, ".quay", "runtime", "bin", "quay.js")),
    "the Core runtime must land in .quay/runtime/bin/");
  assert.ok(!fs.existsSync(path.join(ws, "vendor")),
    "quay-init must NOT create a vendor/ dir in the Go target (the Go-reserved dir stays clean)");

  // The Go target still builds after landing.
  b = goBuild(ws);
  assert.equal(b.status, 0, `go build must pass after quay-init lands (A5 Go half / AC11):\n${b.stdout}${b.stderr}`);
});
