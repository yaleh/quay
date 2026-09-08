// @test-group engine
// quay-init.test.mjs — gap-quay-init-closure-shrink-body (SPEC §6 / AC168 收缩本体).
//
// The new quay-init contract: a PROJECT INITIALIZER whose write surface is the SIX-item closed set —
//   .quay/config.yml / .quay/profiles.yml / tasks/ / .gitignore /
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

function runInit(ws, args = []) {
  const extra = args.includes("--loop") && !args.some((a) => a === "--worktree-root")
    ? ["--worktree-root", diskWorktreeRoot()] : [];
  return spawnSync("bash", [path.join(pluginDir, "scripts", "quay-init.sh"), ...extra, ...args], {
    cwd: ws,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir },
  });
}

const INIT_ARGS = (ws) => [
  "--loop", "--root", ws, "--project", "proj",
  "--test-command", "node --test", "--tmux-session", "proj-0:0.0",
];

// The six-item closed set (SPEC §6) — the exact relative paths quay-init may write.
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

// ── AC1: the write surface is the six-item closed set ────────────────────────────────────────────────
test("AC1 — a real quay-init --loop laydown writes ONLY the six-item closed set (no extension/script copies)", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, INIT_ARGS(ws));
    assert.equal(r.status, 0, `init must exit 0:\n${r.stdout}${r.stderr}`);

    const files = listFiles(ws);
    for (const f of files) {
      const ok = CLOSED_SET.includes(f) || f.startsWith("tasks/");
      assert.ok(ok, `a laid-down path must be in the closed set ∪ tasks/ descendants; got ${f} (all: ${files.join(", ")})`);
    }
    for (const c of CLOSED_SET) {
      assert.ok(files.includes(c), `the closed-set member must be laid down: ${c}`);
    }
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
    assert.match(cfg, /merge_target: integration/, "loop section must carry merge_target");
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
