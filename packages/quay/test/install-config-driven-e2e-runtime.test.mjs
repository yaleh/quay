// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e; install family rotated flakes under full-suite load (rounds 160-162)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh --loop subprocess tree. The install/quay-init family rotated
// flakes across groups under full-suite load (round-160/161/162 — different files each round), so the
// whole family is consolidated into the concurrency-1 serial phase
// (gap-install-family-tests-rotate-flakes-under-full-suite).
// install-config-driven-e2e-runtime.test.mjs — the RUNTIME-LANDING/BUILD half of the
// install-config-driven e2e family (gap-no-e2e-proves-install-is-configuration-driven).
//
// SPLIT BY gap-split-three-phase-floor-files (2026-08-12): the pre-split
// install-config-driven-e2e.test.mjs was the serial phase's floor (~107s, 19 real installs). This
// file carries the runtime-landing + build half: A5 (Node + Go targets still build after the
// runtime lands), AC9 (runtime path contains no target-language-reserved directory segment), AC6
// (anti-pass-through control), A6 (landed worktree root is not on tmpfs), and A5/AC11 (Go vendor/
// negative control). Test BODIES are byte-identical to the pre-split file; only their file
// placement changed. Serial-group isolation is preserved: each real install gets a unique
// disk-backed worktree root + per-workspace tmux session, and the after() sweep destroys every
// workspace created here.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PLUGIN_ROOT = path.resolve(REPO_ROOT, "plugin");

// Config-class files (see the byte-identity sibling file for the full rationale).
const CONFIG_CLASS = new Set([
  ".quay/config.yml",
  ".quay/quay-init-state.json",
  "orchestration/session-liveness.env",
  ".gitignore",
]);

// ── workspace lifecycle (AC8: destroyed after the file runs, no shared-checkout residue) ─────────────
const _tmp = [];
const _wtRoots = [];
after(() => {
  for (const ws of _tmp) fs.rmSync(ws, { recursive: true, force: true });
  for (const wt of _wtRoots) fs.rmSync(wt, { recursive: true, force: true });
});

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
function runInit(ws, { pluginRoot = PLUGIN_ROOT, repoRoot = "/srv/target", project = "proj", tmux, testCommand, worktreeRoot, addArgs = [] } = {}) {
  const session = tmux ?? `p-${path.basename(ws).slice(-12)}-0:0.0`;
  const args = ["--loop", "--root", ws, "--project", project, "--tmux-session", session, "--repo-root", repoRoot];
  if (worktreeRoot !== null) args.push("--worktree-root", worktreeRoot ?? diskWorktreeRoot());
  if (testCommand) args.push("--test-command", testCommand);
  args.push(...addArgs);
  return spawnSync("bash", [path.join(pluginRoot, "scripts", "quay-init.sh"), ...args], {
    cwd: ws,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
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
    const src = path.join(PLUGIN_ROOT, "vendor", "quay", "dist", "quay.js");
    return fs.existsSync(src) ? src : null;
  }
  if (rel === ".quay/runtime/bin/quay-native.js") {
    const src = path.join(PLUGIN_ROOT, "vendor", "quay-native", "dist", "quay-native.js");
    return fs.existsSync(src) ? src : null;
  }
  if (rel === ".quay/runtime/provider.yml") {
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
