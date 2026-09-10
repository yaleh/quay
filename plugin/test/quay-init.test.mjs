// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e (quay-init --loop install); install family flake rotation
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh --loop install subprocess tree. The install/quay-init family
// rotated flakes across groups under full-suite load, so the whole family is consolidated into the
// concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// quay-init.test.mjs — gap-quay-init-closure-shrink-body (SPEC §6 / AC168 收缩本体).
//
// The new quay-init contract: a PROJECT INITIALIZER whose write surface is the SEVEN-item closed set —
//   .quay/config.yml / .quay/profiles.yml / tasks/ / goals/ / .gitignore /
//   .claude/launch.settings.json / .claude/settings.json
// — and NOTHING else (no .claude/{skills,workflows,agents}, no plugin/scripts copies, no .quay/runtime).
// It is NOT an installer: the extension files + scripts are delivered by the quay Claude Code plugin,
// so the output must carry an EXPLICIT install step (`claude plugin marketplace add` +
// `claude plugin install`), never a "config-just-works" implication (AC4 / SPEC §6 T3).
//
// Run:
//   scripts/test.sh plugin/test/quay-init.test.mjs
//   node --test plugin/test/quay-init.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

const _tmp = [];
function makeTmp(prefix = "qinit-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmp.push(d);
  return d;
}
function cleanup(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
after(() => { for (const d of _tmp) cleanup(d); });

function diskWorktreeRoot() {
  const d = fs.mkdtempSync(path.join("/var/tmp", "qinit-wt-"));
  _tmp.push(d);
  return d;
}

function runInitEnv(ws, args = [], envExtra = {}) {
  const extra = args.includes("--loop") && !args.some((a) => a === "--worktree-root")
    ? ["--worktree-root", diskWorktreeRoot()] : [];
  return spawnSync("bash", [path.join(pluginDir, "scripts", "quay-init.sh"), ...extra, ...args], {
    cwd: ws,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir, ...envExtra },
  });
}
function runInit(ws, args = []) {
  return runInitEnv(ws, args);
}

// noTmuxPathPrefix — a temp dir whose `tmux` is a stub that reports NO sessions (exit 1), prepended to
// PATH so quay-init's detection resolves the stub instead of a real tmux. This is the AC4 "no-tmux
// host" simulation: `command -v tmux` succeeds but `tmux list-sessions` yields nothing ⇒ the detector
// returns "zero matches" — the exact path a real no-tmux host (CI/container/plain ssh) takes.
function noTmuxPathPrefix() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "qinit-notmux-"));
  _tmp.push(d);
  fs.writeFileSync(path.join(d, "tmux"), "#!/bin/sh\n# simulated no-tmux host: list-sessions yields nothing\nexit 1\n", { mode: 0o755 });
  return d;
}

const INIT_ARGS = (ws) => [
  "--loop", "--root", ws, "--project", "proj",
  "--test-command", "node --test", "--tmux-session", "proj-0:0.0",
];

// The seven-item closed set (SPEC §6) — the exact relative paths quay-init may write.
const CLOSED_SET = [
  ".quay/config.yml",
  ".quay/profiles.yml",
  ".gitignore",
  ".claude/launch.settings.json",
  ".claude/settings.json",
];

function listFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(root, p));
    }
  };
  walk(root);
  return out.sort();
}

// ── AC1: the write surface is the seven-item closed set ──────────────────────────────────────────────
test("AC1 — a real quay-init --loop laydown writes ONLY the seven-item closed set (no extension/script copies)", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, INIT_ARGS(ws));
    assert.equal(r.status, 0, `init must exit 0:\n${r.stdout}${r.stderr}`);

    const files = listFiles(ws);
    for (const f of files) {
      const ok = CLOSED_SET.includes(f) || f.startsWith("tasks/") || f.startsWith("goals/");
      assert.ok(ok, `a laid-down path must be in the closed set ∪ tasks/ and goals/ descendants; got ${f} (all: ${files.join(", ")})`);
    }
    for (const c of CLOSED_SET) {
      assert.ok(files.includes(c), `the closed-set member must be laid down: ${c}`);
    }
    assert.ok(fs.existsSync(path.join(ws, "goals")), "goals/ must be created (dual carrier)");
    // The retired extension-file copy surface must be ABSENT (裁定 6: 不复制扩展或脚本).
    assert.ok(!fs.existsSync(path.join(ws, ".claude", "workflows")), "no .claude/workflows copy");
    assert.ok(!fs.existsSync(path.join(ws, ".claude", "agents")), "no .claude/agents copy");
    assert.ok(!fs.existsSync(path.join(ws, ".claude", "skills")), "no .claude/skills copy");
    assert.ok(!fs.existsSync(path.join(ws, "plugin")), "no plugin/scripts copy");
    assert.ok(!fs.existsSync(path.join(ws, "orchestration")), "no orchestration/ copy");
    assert.ok(!fs.existsSync(path.join(ws, "docs")), "no docs/analysis/ copy");
    // The retired runtime laydown is gone (no .quay/runtime).
    assert.ok(!fs.existsSync(path.join(ws, ".quay", "runtime")), "no .quay/runtime laydown");
  } finally { cleanup(ws); }
});

// ── config.yml: provider map + loop params ───────────────────────────────────────────────────────────
test("config.yml carries a provider map + the loop params the driver reads", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, INIT_ARGS(ws));
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const cfg = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
    assert.match(cfg, /providers:\s*\n\s+native:\s*\n\s+enabled: true/, "provider map must declare the native provider enabled");
    assert.match(cfg, /mcp_entry: \["node", .*quay-native\.js", "mcp"\]/, "provider mcp_entry must launch the native runtime");
    assert.match(cfg, /loop:\s*\n\s+repo_root:/, "loop section must carry repo_root");
    assert.match(cfg, /test_command: node --test/, "loop section must carry test_command");
    assert.match(cfg, /tmux_session: proj-0:0\.0/, "loop section must carry tmux_session");
    assert.match(cfg, /fork_baseline: develop/, "loop section must carry fork_baseline");
    // gap-config-key-consumer-check-mechanical-enumeration: the zero-consumer key is deleted from the
    // writer face — the negative control is that the dead key is NOT written (not merely unwired).
    assert.doesNotMatch(cfg, /merge_target/, "loop section must NOT carry the deleted zero-consumer key");
  } finally { cleanup(ws); }
});

// ── .claude/settings.json: enabledPlugins + permissions.allow ────────────────────────────────────────
test(".claude/settings.json enables the plugin (project-level) + pre-approves the plugin MCP namespace", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, INIT_ARGS(ws));
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const settings = JSON.parse(fs.readFileSync(path.join(ws, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.enabledPlugins?.["quay@quay"], true, "the plugin must be enabled at project level");
    assert.ok(Array.isArray(settings.permissions?.allow), "permissions.allow must be an array");
    assert.ok(settings.permissions.allow.includes("mcp__plugin_quay_quay__*"), "the plugin MCP namespace must be pre-approved");
  } finally { cleanup(ws); }
});

// ── AC4: explicit install steps (config does NOT auto-install) ──────────────────────────────────────
test("AC4 — the output carries the explicit install steps and never implies config-just-works", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, INIT_ARGS(ws));
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const out = r.stdout;
    // The explicit install step (SPEC §6 / T3): 启用 ≠ 安装, 未信任目录 settings 不被读 ⇒ 必须显式装.
    assert.match(out, /claude plugin marketplace add/, "must print the marketplace-add step");
    assert.match(out, /claude plugin install/, "must print the plugin-install step (or the npm-global register-plugin.mjs path)");
    // The negative control (硬规则 4 / SPEC §6): the forbidden "配置即生效" implication is absent.
    assert.doesNotMatch(out, /配置即生效/, "must not print the forbidden config-just-works phrasing");
    assert.doesNotMatch(out, /自动安装|自动装上/, "must not imply auto-install from config alone");
  } finally { cleanup(ws); }
});

// ── --dry-run: writes nothing ────────────────────────────────────────────────────────────────────────
test("--dry-run lists the closed set and writes nothing", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, [...INIT_ARGS(ws), "--dry-run"]);
    assert.equal(r.status, 0, `--dry-run must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /closed set:/, "must report the closed set");
    assert.equal(listFiles(ws).length, 0, "--dry-run must write no files");
  } finally { cleanup(ws); }
});

// ── AC1/AC4: a no-tmux host must NOT hard-fail the init (tmux session is optional) ─────────────────
// gap-quay-init-hard-requires-tmux-session-and-leaves-partial-write. tmux is shadowed by a stub that
// reports no sessions — the exact "no tmux host" path (CI/container/plain ssh). The init must exit 0,
// lay all seven closed-set items, and write loop.tmux_session: null (never a guess, never exit 2).
// Negative control ① (removing the simulation ⇒ still green): the assertion only checks exit 0 + six
// items + null — with a REAL tmux present the detector still finds zero MATCHING sessions for the
// unique project name `proj-notmux`, so the same optional path continues and the test stays green.
// Negative control ② (reverting tmux to hard-fail ⇒ red): if the detector again `exit 2`s on a miss,
// r.status becomes 2 and both asserts below (status 0 + /needs the target project's tmux/ absent) turn red.
test("no-tmux host: quay-init exits 0, lays the seven-item closed set, and writes tmux_session: null", () => {
  const ws = makeTmp();
  try {
    const prefix = noTmuxPathPrefix();
    const r = runInitEnv(ws,
      ["--loop", "--root", ws, "--project", "proj-notmux", "--test-command", "node --test"],
      { PATH: prefix + ":" + (process.env.PATH || "") });
    assert.equal(r.status, 0, `init must exit 0 on a no-tmux host:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr, /needs the target project's tmux session/,
      "must not hard-fail on a missing tmux session (the retired dual-tmux prerequisite)");
    for (const c of CLOSED_SET) {
      assert.ok(fs.existsSync(path.join(ws, c)), `closed-set member must be laid down: ${c}`);
    }
    assert.ok(fs.existsSync(path.join(ws, "tasks")), "tasks/ must be created");
    assert.ok(fs.existsSync(path.join(ws, "goals")), "goals/ must be created (dual carrier)");
    const cfg = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
    assert.match(cfg, /tmux_session:\s*null/, "loop.tmux_session must be null when no session is detected");
  } finally { cleanup(ws); }
});

// ── AC3: a mid-write failure reports the per-item written/unwritten state (mechanically parseable) ──
// A `.claude` FILE (not a dir) makes the launch.settings.json lay-down's `mkdir -p .claude` abort AFTER
// config.yml/profiles.yml/tasks/goals/.gitignore were written — the exact partial-write shape the task
// describes. The EXIT trap must list which of the seven items landed (written:) and which did not
// (unwritten:), so "initialized half-way" is distinguishable from "not initialized".
test("AC3 — a mid-write failure lists the seven-item written/unwritten state", () => {
  const ws = makeTmp();
  try {
    fs.mkdirSync(path.join(ws, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(ws, "scripts", "test.sh"), "#!/bin/bash\necho test\n");
    fs.writeFileSync(path.join(ws, ".claude"), "not a dir\n");
    const r = runInit(ws, ["--loop", "--root", ws, "--test-command", "node --test", "--tmux-session", "proj-0:0.0"]);
    assert.notEqual(r.status, 0, `a mid-write failure must exit non-zero:\n${r.stdout}${r.stderr}`);
    const combined = r.stdout + "\n" + r.stderr;
    // written before the abort.
    for (const p of [".quay/config.yml", ".quay/profiles.yml", "tasks", "goals", ".gitignore"]) {
      assert.match(combined, new RegExp(`written:\\s*${p.replace(/\./g, "\\.")}`),
        `the report must mark ${p} written`);
    }
    // never reached.
    for (const p of [".claude/launch.settings.json", ".claude/settings.json"]) {
      assert.match(combined, new RegExp(`unwritten:\\s*${p.replace(/\./g, "\\.")}`),
        `the report must mark ${p} unwritten`);
    }
  } finally { cleanup(ws); }
});
