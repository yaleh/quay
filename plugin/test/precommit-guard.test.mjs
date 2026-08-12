// @test-group engine
// precommit-guard.test.mjs — the mechanical gate of
// gap-precommit-guard-running-round-rejects-assertion-surface-commits.
//
// The defect (2026-08-12, three independent observations): the "no commits during a
// round" convention is not held — ① the convention has no artifact (round 60 broken
// 26s after agreeing, outer 47023142); ② even post-hoc it is hard to distinguish; ③ the
// participants are incomplete (inner is never in the agreement — round 63 it committed
// 4 task-body updates at 30-40s intervals inside the round window, nobody told it a
// round was running). ①② can be mitigated by "being more careful"; ③ is structurally
// impossible to solve by care. The guard must cover writers OUTSIDE the agreed list —
// hence a SHARED pre-commit hook (--install-hook wires <git-dir>/hooks/pre-commit),
// not a commit wrapper each writer must remember to call.
//
// Coverage map (task ACs):
//   AC1 — state=running AND staged files touch the assertion surface ⇒ reject (exit 1) + clear message
//   AC2 — fail-loud: state file missing / state field null ⇒ reject (never a plausible-looking value)
//   AC3 — covers ALL writers structurally: --install-hook wires the shared hook; the hook shim
//         invokes the guard; --uninstall-hook removes it (a shared hook covers outer/manager/inner
//         and anyone else — the participant list is not maintainable, the hook is)
//   AC4 — assertion surface aggregates from the A0b③ judged-object registry (NOT a hand-maintained
//         whitelist); missing/empty registry ⇒ fall back to the NARROWED surface tasks/** +
//         plugin/loop/** + scripts/test.sh @static-object aggregate (outer ruling B — the all-tracked
//         fallback was measured unusable at 4113/4316; the @static-object aggregate mechanically
//         covers the tick-core judgment objects, the 12a6b18b manager-accident class)
//   AC5 — negative controls: round 63 shape (inner commits a TASK file while running ⇒ blocked) and
//         round 60 shape (commit 26s after start ⇒ blocked, state=running regardless of elapsed);
//         terminal state (green/red) ⇒ allowed even when touching the assertion surface
//   AC6 — --allow-dirty-round (CLI and QUAY_ALLOW_DIRTY_ROUND=1 env) explicitly overrides
//
// Run: scripts/test.sh plugin/test/precommit-guard.test.mjs
// Scoped: scripts/test.sh --for-task gap-precommit-guard-running-round-rejects-assertion-surface-commits

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GUARD = path.join(REPO_ROOT, "plugin", "scripts", "precommit-guard.ts");

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

function run(cmd, args, cwd, env = {}) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}

function makeGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcg-"));
  run("git", ["init", "-q", "-b", "main"], root);
  run("git", ["config", "user.email", "test@test"], root);
  run("git", ["config", "user.name", "test"], root);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "hello\n", "utf8");
  fs.writeFileSync(path.join(root, "tasks", "existing.md"), "x\n", "utf8");
  const init = run("git", ["add", "."], root);
  assert.equal(init.status, 0, "git add init");
  const commit = run("git", ["commit", "-q", "-m", "init"], root);
  assert.equal(commit.status, 0, `git commit init: ${commit.stderr}`);
  return root;
}

function writeState(root, state) {
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify(state), "utf8");
}

function writeRegistry(root, patterns) {
  const reg = { version: 1, generatedBy: "fixture", patterns };
  fs.writeFileSync(path.join(root, "plugin", "scripts", "judged-object-registry.json"), JSON.stringify(reg), "utf8");
}

function stage(root, rel, content = "new\n") {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  const add = run("git", ["add", rel], root);
  assert.equal(add.status, 0, `git add ${rel}`);
}

function runGuard(root, args = [], env = {}) {
  return run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--json", ...args], root, env);
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

const RUNNING_STATE = {
  state: "running",
  runner: "inner",
  startedAt: "2026-08-12T21:00:00.000Z",
  laneCount: 4,
  scope: "worktree",
  runId: "fixture-run-63",
  pid: 12345,
  finishedAt: null,
  durationMs: null,
};

// ── AC1: running + assertion-surface touched ⇒ reject ────────────────────────────────────────────────

test("AC1 — running round + staged task file (assertion surface) ⇒ reject exit 1 with clear message", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE);
    writeRegistry(root, ["tasks/**", "packages/**"]);
    stage(root, "tasks/new.md");
    const res = runGuard(root);
    assert.equal(res.status, 1, `expected reject, got ${res.status}: ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "reject");
    assert.equal(out.reason, "running-round-assertion-surface");
    assert.ok(out.message.includes("fixture-run-63"), "message names the run");
    assert.ok(out.message.includes("startedAt"), "message names startedAt");
    assert.deepEqual(out.touchedAssertion, ["tasks/new.md"]);
    assert.ok(out.message.includes("预检清单"), "message carries the preflight checklist");
  } finally {
    cleanup(root);
  }
});

test("AC1b — running round + staged NON-assertion-surface file ⇒ allow (registry narrows)", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE);
    writeRegistry(root, ["tasks/**", "packages/**"]);
    stage(root, "README.md", "changed\n");
    const res = runGuard(root);
    assert.equal(res.status, 0, `expected allow, got ${res.status}: ${res.stdout}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "allow");
    assert.equal(out.reason, "no-assertion-surface-touched");
  } finally {
    cleanup(root);
  }
});

// ── AC1-early-red: state=red + finishedAt=null (runner still collecting) ⇒ reject ─────────────────────

test("AC1-early-red — state=red finishedAt=null (early-red, runner still collecting) ⇒ reject assertion-surface commit", () => {
  const root = makeGitRepo();
  try {
    writeState(root, { ...RUNNING_STATE, state: "red", reason: "failed" });
    writeRegistry(root, ["tasks/**", "packages/**"]);
    stage(root, "tasks/early-red.md");
    const res = runGuard(root);
    assert.equal(res.status, 1, `expected reject (early-red), got ${res.status}: ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "reject");
    assert.equal(out.reason, "running-round-assertion-surface");
    assert.equal(out.isRunning, true, "--json isRunning must be true for early-red");
    assert.equal(out.finishedAt, null, "--json finishedAt must be null for early-red");
    // 拒绝记录 append 到 .quay/precommit-guard-rejections.jsonl（runtime-state，观测记录）。
    const ledgerPath = path.join(root, ".quay", "precommit-guard-rejections.jsonl");
    assert.ok(fs.existsSync(ledgerPath), "rejection ledger must be written");
    const line = JSON.parse(fs.readFileSync(ledgerPath, "utf8").trim().split("\n").pop());
    assert.equal(line.verdict, "reject");
    assert.deepEqual(line.files, ["tasks/early-red.md"]);
    assert.equal(line.runId, "fixture-run-63");
    assert.ok(line.at, "ledger line carries ISO timestamp");
  } finally {
    cleanup(root);
  }
});

test("AC1-terminal — state=red finishedAt set (round finished) ⇒ allow", () => {
  const root = makeGitRepo();
  try {
    writeState(root, { ...RUNNING_STATE, state: "red", reason: "failed", finishedAt: 1786572515000, durationMs: 500000 });
    writeRegistry(root, ["tasks/**", "packages/**"]);
    stage(root, "tasks/terminal.md");
    const res = runGuard(root);
    assert.equal(res.status, 0, `expected allow (terminal), got ${res.status}: ${res.stdout}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "allow");
    assert.equal(out.isRunning, false, "--json isRunning must be false for terminal round");
    assert.ok(out.finishedAt != null, "--json finishedAt must be present for terminal round");
  } finally {
    cleanup(root);
  }
});

// ── AC2: fail-loud on missing/null state file ─────────────────────────────────────────────────────────

test("AC2 — state file MISSING ⇒ reject (fail-loud, never a plausible-looking value)", () => {
  const root = makeGitRepo();
  try {
    writeRegistry(root, ["tasks/**"]);
    stage(root, "README.md", "changed\n");
    const res = runGuard(root);
    assert.equal(res.status, 1, `expected reject on missing state, got ${res.status}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "reject");
    assert.equal(out.reason, "state-file-missing");
    assert.ok(out.message.includes("fail-loud"), "message says fail-loud");
  } finally {
    cleanup(root);
  }
});

test("AC2b — state field NULL ⇒ reject (fail-loud)", () => {
  const root = makeGitRepo();
  try {
    writeState(root, { ...RUNNING_STATE, state: null });
    writeRegistry(root, ["tasks/**"]);
    stage(root, "tasks/new.md");
    const res = runGuard(root);
    assert.equal(res.status, 1, `expected reject on null state, got ${res.status}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "reject");
    assert.equal(out.reason, "state-null");
  } finally {
    cleanup(root);
  }
});

// ── AC3: shared hook covers ALL writers ───────────────────────────────────────────────────────────────

test("AC3 — --install-hook wires the SHARED pre-commit hook; --uninstall-hook removes it", () => {
  const root = makeGitRepo();
  try {
    const install = run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--install-hook"], root);
    assert.equal(install.status, 0, `install-hook: ${install.stderr}`);
    const hookPath = path.join(root, ".git", "hooks", "pre-commit");
    assert.ok(fs.existsSync(hookPath), "hook file written");
    const shim = fs.readFileSync(hookPath, "utf8");
    assert.ok(shim.includes("precommit-guard.ts"), "shim invokes the guard");
    assert.ok(!shim.includes("precommit-guard.ts.ts"), "shim must not double the extension (.ts.ts)");
    assert.ok(shim.includes("pre-commit guard"), "shim documents its purpose");
    const mode = fs.statSync(hookPath).mode & 0o111;
    assert.notEqual(mode, 0, "hook is executable");

    const uninstall = run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--uninstall-hook"], root);
    assert.equal(uninstall.status, 0, `uninstall-hook: ${uninstall.stderr}`);
    assert.ok(!fs.existsSync(hookPath), "hook removed");
  } finally {
    cleanup(root);
  }
});

test("AC3b — install-hook refuses to overwrite an unrelated pre-existing hook", () => {
  const root = makeGitRepo();
  try {
    const hookPath = path.join(root, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hookPath, "#!/usr/bin/env bash\necho unrelated\n", { mode: 0o755 });
    const install = run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--install-hook"], root);
    assert.equal(install.status, 2, "refuses to clobber an unrelated hook (usage/env error)");
    assert.ok(fs.readFileSync(hookPath, "utf8").includes("unrelated"), "original hook untouched");
  } finally {
    cleanup(root);
  }
});

// ── AC4: assertion surface from A0b③ registry; fallback narrowed (outer ruling B) ────────────────────

test("AC4 — EMPTY/missing registry ⇒ fallback to tasks/** + plugin/loop/** (empirical trouble classes)", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE);
    // no registry file at all → fallback-narrowed (tasks/** + plugin/loop/**; no scripts/test.sh here)
    stage(root, "tasks/fallback.md"); // round 60/63/67 class — in tasks/**
    const res = runGuard(root);
    assert.equal(res.status, 1, `expected reject via narrowed fallback, got ${res.status}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.registryMode, "fallback-narrowed");
    assert.deepEqual(out.touchedAssertion, ["tasks/fallback.md"]);
  } finally {
    cleanup(root);
  }
});

test("AC4b — empty patterns array in the registry ⇒ same narrowed fallback (fail-closed)", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE);
    writeRegistry(root, []);
    stage(root, "tasks/fallback.md");
    const res = runGuard(root);
    assert.equal(res.status, 1, `expected reject via empty-registry narrowed fallback, got ${res.status}`);
    assert.equal(JSON.parse(res.stdout).registryMode, "fallback-narrowed");
  } finally {
    cleanup(root);
  }
});

test("AC4c — narrowed fallback ALSO covers plugin/loop/** (cp-accident surface)", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE);
    stage(root, "plugin/loop/fast-mode-tick-core.md");
    const res = runGuard(root);
    assert.equal(res.status, 1, `plugin/loop/** must be blocked by fallback, got ${res.status}`);
    assert.equal(JSON.parse(res.stdout).registryMode, "fallback-narrowed");
    assert.deepEqual(JSON.parse(res.stdout).touchedAssertion, ["plugin/loop/fast-mode-tick-core.md"]);
  } finally {
    cleanup(root);
  }
});

test("AC4d — narrowed fallback does NOT cover arbitrary tracked files (README.md allowed)", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE);
    stage(root, "README.md", "changed\n"); // outside tasks/** + plugin/loop/** + static-object → allowed
    const res = runGuard(root);
    assert.equal(res.status, 0, `README.md must be allowed by narrowed fallback, got ${res.status}`);
    assert.equal(JSON.parse(res.stdout).registryMode, "fallback-narrowed");
  } finally {
    cleanup(root);
  }
});

test("AC4e — fallback aggregates scripts/test.sh @static-object annotations (tick-core class)", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE);
    // A scripts/test.sh declaring orchestration/manager-tick-core.md as a checker judgment object —
    // 12a6b18b (manager cp accident) class. The @static-object aggregation must pull it into the
    // fallback even with no registry present.
    const testShDir = path.join(root, "scripts");
    fs.mkdirSync(testShDir, { recursive: true });
    fs.writeFileSync(
      path.join(testShDir, "test.sh"),
      [
        "#!/usr/bin/env bash",
        "run_static_checks() {",
        '  run_checker "tick-core-static-check" node foo.ts --root "$root"',
        "  # @static-object orchestration/manager-tick-core.md orchestration/orchestrator-tick-core.md",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    stage(root, "orchestration/manager-tick-core.md");
    const res = runGuard(root);
    assert.equal(res.status, 1, `@static-object-derived file must be blocked, got ${res.status}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.registryMode, "fallback-narrowed");
    assert.deepEqual(out.touchedAssertion, ["orchestration/manager-tick-core.md"]);
  } finally {
    cleanup(root);
  }
});

// ── AC5: negative controls (round 60 / round 63 shapes; terminal states) ─────────────────────────────

test("AC5 — round 63 shape: inner commits a TASK file while running ⇒ blocked", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE); // runId fixture-run-63 — inner committing task bodies
    writeRegistry(root, ["tasks/**"]);
    stage(root, "tasks/gap-some-body-update.md");
    const res = runGuard(root);
    assert.equal(res.status, 1, "round 63 shape must be blocked");
    assert.equal(JSON.parse(res.stdout).reason, "running-round-assertion-surface");
  } finally {
    cleanup(root);
  }
});

test("AC5b — round 60 shape: commit 26s after round start ⇒ blocked (state=running is the signal)", () => {
  const root = makeGitRepo();
  try {
    const started = new Date(Date.now() - 26_000).toISOString();
    writeState(root, { ...RUNNING_STATE, startedAt: started });
    writeRegistry(root, ["tasks/**"]);
    stage(root, "tasks/new.md");
    const res = runGuard(root);
    assert.equal(res.status, 1, "round 60 shape (26s after start) must be blocked");
    assert.equal(JSON.parse(res.stdout).reason, "running-round-assertion-surface");
  } finally {
    cleanup(root);
  }
});

test("AC5c — TERMINAL state (green) ⇒ allowed even when touching the assertion surface", () => {
  const root = makeGitRepo();
  try {
    writeState(root, { ...RUNNING_STATE, state: "green", finishedAt: Date.now() / 1000 });
    writeRegistry(root, ["tasks/**"]);
    stage(root, "tasks/new.md");
    const res = runGuard(root);
    assert.equal(res.status, 0, `terminal state must allow, got ${res.status}`);
    assert.equal(JSON.parse(res.stdout).reason, "not-running");
  } finally {
    cleanup(root);
  }
});

// ── AC6: --allow-dirty-round explicit override ────────────────────────────────────────────────────────

test("AC6 — --allow-dirty-round CLI flag explicitly overrides the rejection", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE);
    writeRegistry(root, ["tasks/**"]);
    stage(root, "tasks/new.md");
    const res = runGuard(root, ["--allow-dirty-round"]);
    assert.equal(res.status, 0, `override must allow, got ${res.status}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "allow");
    assert.equal(out.reason, "allow-dirty-round-override");
    assert.equal(out.override, true);
  } finally {
    cleanup(root);
  }
});

test("AC6b — QUAY_ALLOW_DIRTY_ROUND=1 env var overrides (the pre-commit-hook path, which gets no args)", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE);
    writeRegistry(root, ["tasks/**"]);
    stage(root, "tasks/new.md");
    const res = runGuard(root, [], { QUAY_ALLOW_DIRTY_ROUND: "1" });
    assert.equal(res.status, 0, `env override must allow, got ${res.status}`);
    assert.equal(JSON.parse(res.stdout).reason, "allow-dirty-round-override");
  } finally {
    cleanup(root);
  }
});

test("AC6c — override also applies to the fail-loud missing-state case (explicit, recorded)", () => {
  const root = makeGitRepo();
  try {
    // no state file at all — fail-loud would reject; the EXPLICIT override records responsibility.
    writeRegistry(root, ["tasks/**"]);
    stage(root, "tasks/new.md");
    const res = runGuard(root, ["--allow-dirty-round"]);
    assert.equal(res.status, 0, `override must allow even with missing state, got ${res.status}`);
    assert.equal(JSON.parse(res.stdout).reason, "allow-dirty-round-override");
  } finally {
    cleanup(root);
  }
});

// ── Real-repo smoke: the guard runs against THIS repo without crashing ───────────────────────────────

test("real-repo smoke — guard runs against the real repo (no crash, readable verdict)", () => {
  // The real repo's .quay/full-suite-state.json is whatever the live loop wrote; we only assert
  // the guard executes without an internal error (exit not 2) and reports a JSON verdict.
  const res = runGuard(REPO_ROOT);
  assert.notEqual(res.status, 2, `guard must not crash on the real repo: ${res.stderr} ${res.stdout}`);
  const out = JSON.parse(res.stdout);
  assert.ok(["allow", "reject"].includes(out.verdict), "verdict is allow or reject");
});
