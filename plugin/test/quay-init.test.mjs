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
// so the output must carry an EXPLICIT install step (`claude plugin marketplace add yaleh/quay` +
// `claude plugin install quay@quay --scope project` — the FULL recipe, not the bare
// `claude plugin marketplace add` substring, which also matched the rejected two-arg form), never a
// "config-just-works" implication (AC4 / SPEC §6 T3).
//
// Run:
//   scripts/test.sh plugin/test/quay-init.test.mjs
//   node --test plugin/test/quay-init.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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

// The closed set (SPEC §6) — the exact relative paths quay-init may write. `.quay/plugin` is the
// project-internal stable symlink (gap-config-provider-path-frozen-to-versioned-cache-dir): it is a
// symlink, not a file, and is ignored by `.quay/*` in .gitignore.
const CLOSED_SET = [
  ".quay/config.yml",
  ".quay/profiles.yml",
  ".quay/plugin",
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

// ── AC7 (gap-quay-init-env-only-tasks-dir-goals-adr-meta-land-inside-npm-package): the provider env
// must carry ALL FOUR QUAY_NATIVE_*_DIR keys, each pointing INSIDE the project root. Before this fix
// only QUAY_NATIVE_TASKS_DIR was written — the three carrier dirs (goals/adr/meta) then silently fell
// back to cwd (the vendored npm package dir) when the provider was spawned with no .quay/config.yml
// ancestor, so goals/adr/meta landed inside the installed package instead of the project.
test("provider env carries all four QUAY_NATIVE_*_DIR keys, each pointing inside the project root", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, INIT_ARGS(ws));
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const cfg = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
    const expected = {
      QUAY_NATIVE_TASKS_DIR: "tasks",
      QUAY_NATIVE_GOAL_DIR: "goals",
      QUAY_NATIVE_ADR_DIR: "adr",
      QUAY_NATIVE_META_DIR: "meta",
    };
    for (const [key, rel] of Object.entries(expected)) {
      const m = cfg.match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+)"?\\s*$`, "m"));
      assert.ok(m, `provider env must carry ${key} (config:\n${cfg})`);
      assert.equal(m[1].trim(), path.join(ws, rel), `${key} must point inside the project root (got ${m[1].trim()})`);
    }
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
    //
    // ── AC5 (gap-quay-init-install-steps-invalid-and-spec-4b-dev-slot): the predicate is ANCHORED
    // on the FULL single-<source> github recipe, not on the loose `claude plugin marketplace add`
    // substring. The loose form also passed the BROKEN two-arg recipe
    // (`marketplace add quay "${CLAUDE_PLUGIN_ROOT}"`) — rejected outright by the CLI
    // ("✘ Invalid marketplace source format. Try: owner/repo, https://..., or ./path") and a
    // DIRECTORY source into the bargain. That is the 硬规则 3b shape: a broken recipe read the
    // same as a qualified one for as long as the assertion lived. Both halves of 硬规则 2 are
    // discharged in this test: the positive match below, and the dry-run of the SAME predicate
    // against a known-BAD sample (the old recipe) at the bottom — a predicate that cannot go red
    // is caught here instead of in production.
    assert.match(out, /claude plugin marketplace add yaleh\/quay/,
      "must print the FULL github recipe `claude plugin marketplace add yaleh/quay` (one <source> arg)");
    assert.match(out, /claude plugin install quay@quay --scope project/,
      "must print the project-scoped install step (or the npm-global register-plugin.mjs path)");
    assert.doesNotMatch(out, /marketplace add quay "/,
      "must NOT print the rejected two-arg form (`marketplace add <name> <source>`)");
    // Known-BAD sample dry-run (硬规则 2, the zero-count half): the old recipe must still satisfy the
    // LOOSE predicate (else the strong one is not what changed) and must FAIL the strong one.
    const OLD_RECIPE = '  claude plugin marketplace add quay "/cache/quay/quay/0.11.0"';
    assert.match(OLD_RECIPE, /claude plugin marketplace add/,
      "the LOOSE predicate must still match the old form — otherwise the strong predicate proves nothing");
    assert.doesNotMatch(OLD_RECIPE, /claude plugin marketplace add yaleh\/quay/,
      "the STRONG predicate must go RED on the old two-arg recipe — else this assertion cannot take false");
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

// ── AC3: a mid-write failure reports the per-item state (mechanically parseable) ───────────────────
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

// ── AC1/AC2/AC3: the failure report states WHAT THIS RUN WROTE, not what merely EXISTS ───────────────
// gap-quay-init-failure-report-existence-proxy-overreports-on-upgrade. The report used to classify each
// item by `[ -e <path> ]` — EXISTENCE — which coincides with "this run wrote it" ONLY on a fresh target.
// On a non-empty target (the upgrade path: a project that already ran quay-native) the two quantities
// separate: a pre-write failure credited this run with files it never touched, describing a run that
// changed nothing as a partial takeover. The three tests below are the AC1 (non-empty), AC2 (fresh
// negative control) and AC3 (three-state vocabulary) pair — AC4's "new coverage uses a non-empty
// target": the pre-existing mid-write test above uses an EMPTY target, the AC1/AC3 tests do not.
const CLOSED_SET_ALL = [
  ".quay/config.yml",
  ".quay/profiles.yml",
  "tasks",
  "goals",
  ".gitignore",
  ".claude/launch.settings.json",
  ".claude/settings.json",
];

// Every state the reporter can emit, longest-first (so `pre-existing` is not shadowed). An item that
// lands in NO bucket is a parse failure, never a silent absence — a vocabulary the parser cannot read
// must not look like a clean report.
const REPORT_STATES = ["written", "pre-existing", "unwritten", "unreadable"];
function parseClosedSetReport(combined) {
  const byState = Object.fromEntries(REPORT_STATES.map((s) => [s, []]));
  for (const line of combined.split("\n")) {
    const m = line.match(/^\s*(pre-existing|unwritten|unreadable|written):\s*(.+?)\s*$/);
    if (!m) continue;
    byState[m[1]].push(m[2].trim());
  }
  return byState;
}

test("AC1 — a pre-write failure on a NON-EMPTY target never marks an untouched file as written", () => {
  const ws = makeTmp("qinit-nonempty-");
  try {
    // Exactly what an upgrade target looks like: .quay/config.yml and tasks/ already there.
    fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
    fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
    const cfg = path.join(ws, ".quay", "config.yml");
    fs.writeFileSync(cfg, "# hand-written config\nproviders:\n  native:\n    enabled: true\n");
    fs.writeFileSync(path.join(ws, "tasks", "already-here.md"), "# a task the project already had\n");
    const before = fs.readFileSync(cfg);

    // NO --test-command ⇒ nothing is detectable in the target ⇒ fail-closed BEFORE any write.
    const r = runInit(ws, ["--root", ws, "--project", "proj-nonempty", "--plugin-root", pluginDir]);
    assert.notEqual(r.status, 0, `the run must fail closed:\n${r.stdout}${r.stderr}`);

    // Precondition (the RED condition this AC forbids): the bytes never changed…
    assert.equal(Buffer.compare(before, fs.readFileSync(cfg)), 0,
      "precondition: this run must not have touched .quay/config.yml's bytes");
    // …so the report may not claim it wrote them.
    const states = parseClosedSetReport(r.stdout + "\n" + r.stderr);
    assert.ok(!states.written.includes(".quay/config.yml"),
      `.quay/config.yml is byte-identical across the run but the report claims written:\n${r.stderr}`);
    assert.ok(!states.written.includes("tasks"),
      `tasks/ already existed and this run did not touch it, but the report claims written:\n${r.stderr}`);
    // The honest state it must carry instead: present before, untouched by this run.
    assert.ok(states["pre-existing"].includes(".quay/config.yml"),
      `.quay/config.yml must be reported pre-existing: (it was there, this run left it alone)\n${r.stderr}`);
    assert.ok(states["pre-existing"].includes("tasks"),
      `tasks/ must be reported pre-existing:\n${r.stderr}`);
  } finally { cleanup(ws); }
});

test("AC2 — negative control: on a fresh EMPTY target the same failure still reports all seven unwritten", () => {
  const ws = makeTmp("qinit-empty-");
  try {
    const r = runInit(ws, ["--root", ws, "--project", "proj-empty", "--plugin-root", pluginDir]);
    assert.notEqual(r.status, 0, `the run must fail closed:\n${r.stdout}${r.stderr}`);
    const states = parseClosedSetReport(r.stdout + "\n" + r.stderr);
    assert.deepEqual(states.written, [], "nothing was written, so nothing may be reported written:");
    assert.deepEqual(states["pre-existing"], [], "the target was empty, so nothing may be pre-existing:");
    assert.deepEqual(states.unreadable, [], "nothing was unreadable in this fixture:");
    for (const p of CLOSED_SET_ALL) {
      assert.ok(states.unwritten.includes(p),
        `${p} must be reported unwritten: on a fresh target (the predecessor task's AC3 behaviour)\n${r.stderr}`);
    }
  } finally { cleanup(ws); }
});

test("AC3 — one run's output carries ≥3 distinguishable states (written / pre-existing / unwritten)", () => {
  const ws = makeTmp("qinit-threestate-");
  try {
    // tasks/ pre-exists and `mkdir -p` leaves it alone ⇒ pre-existing.
    fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
    // A `.claude` FILE aborts the launch.settings.json lay-down mid-write ⇒ the items after it stay
    // absent ⇒ unwritten. config.yml/profiles.yml/goals/.gitignore are created before the abort.
    fs.writeFileSync(path.join(ws, ".claude"), "not a dir\n");
    const r = runInit(ws, ["--loop", "--root", ws, "--project", "proj-three",
      "--test-command", "node --test", "--tmux-session", "proj-three-0:0.0"]);
    assert.notEqual(r.status, 0, `a mid-write failure must exit non-zero:\n${r.stdout}${r.stderr}`);
    const states = parseClosedSetReport(r.stdout + "\n" + r.stderr);
    const observed = REPORT_STATES.filter((s) => states[s].length > 0);
    assert.ok(observed.length >= 3,
      `the report vocabulary must separate ≥3 states in ONE run, observed ${JSON.stringify(observed)}:\n${r.stderr}`);
    assert.ok(states.written.includes(".quay/config.yml"), "config.yml is created by this run ⇒ written:");
    assert.ok(states["pre-existing"].includes("tasks"), "tasks/ was already there, untouched ⇒ pre-existing:");
    assert.ok(states.unwritten.includes(".claude/settings.json"), "never reached ⇒ unwritten:");
  } finally { cleanup(ws); }
});
// ════════════════════════════════════════════════════════════════════════════════════════════════
// UPGRADE PATH — the RETIRED project-local runtime (gap-upgrade-leaves-legacy-project-runtime-stale-
// and-unmigrated). Every fixture below is a NON-EMPTY legacy target: it already carries a
// `.quay/config.yml` AND a populated `.quay/runtime/**` (the state a real pre-2026-09 install left
// behind). The pre-existing fixtures in this file are empty dirs, which is exactly why the defect
// this section covers was structurally unreachable from the suite before.
//
// RULING under test (AC1, option c): the plugin is the single delivery surface for the runtime, so
// the upgrade migrates the provider binding to THIS delivery's vendored bundle (an ABSOLUTE path
// under $PLUGIN_ROOT) and retires the now-unreferenced stale project-local copy — which no product
// path updated any more, so it silently looked like the runtime while nothing maintained it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// The bundles the plugin DELIVERS — what the migration must point the binding at.
const DELIVERED_NATIVE = path.join(pluginDir, "vendor", "quay-native", "dist", "quay-native.js");
const DELIVERED_CORE = path.join(pluginDir, "vendor", "quay", "dist", "quay.js");

function sha256(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

// makeDeliveryHome — a hermetic fixture `$HOME` whose plugin registry pins THIS delivery at a fixture
// install dir. The migration target is now the project-internal link `<ws>/.quay/plugin` (resolved
// from the registry — gap-config-provider-path-frozen-to-versioned-cache-dir), so the upgrade tests
// must supply the registry the link is resolved from; with the real `$HOME` the link would point at
// whatever quay happens to be installed on the host. The fixture install carries a BYTE-IDENTICAL copy
// of the plugin's delivered bundle, so the "traceable to this delivery" assertion keeps its power.
function makeDeliveryHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "qinit-home-"));
  _tmp.push(home);
  const install = path.join(home, "install", "cache", "quay", "quay", "9.9.9");
  fs.mkdirSync(path.join(install, "vendor", "quay-native", "dist"), { recursive: true });
  fs.copyFileSync(DELIVERED_NATIVE, path.join(install, "vendor", "quay-native", "dist", "quay-native.js"));
  fs.writeFileSync(path.join(install, "VERSION"), "9.9.9\n");
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "quay@quay": [{ scope: "user", installPath: install, version: "9.9.9" }] } }),
  );
  return home;
}

/** The runtime the project link exposes (the migration's canonical binding target). */
function linkRuntime(ws) {
  return path.join(ws, ".quay", "plugin", "vendor", "quay-native", "dist", "quay-native.js");
}

// treeHashes — { relPath: sha256 } for every file under `root` ({} when root is absent). Used as the
// AC3 "逐字节不变" instrument: a content-addressed snapshot of the whole subtree, not a file count.
function treeHashes(root) {
  const out = {};
  if (!fs.existsSync(root)) return out;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(root, p)] = sha256(p);
    }
  };
  walk(root);
  return out;
}

// makeLegacyWs — a NON-EMPTY legacy target: populated `.quay/runtime/bin/*`, an EXISTING config
// whose provider block is the caller's, and a `.gitignore` carrying the retired runtime entry.
// `stale: true` perturbs the project-local bundles so they differ from what the plugin delivers
// (the real-world case: a bundle vendored on an older date); `stale: false` copies them verbatim
// (a byte-current copy — the AC3 input).
function makeLegacyWs(ws, { config, stale }) {
  const bin = path.join(ws, ".quay", "runtime", "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(ws, "goals"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".gitignore"), "# quay runtime (install-generated, not source)\n.quay/runtime/\n");
  for (const [name, src] of [["quay-native.js", DELIVERED_NATIVE], ["quay.js", DELIVERED_CORE]]) {
    assert.ok(fs.existsSync(src), `fixture precondition: the plugin must DELIVER ${src} (scripts/test.sh mirrors it via sync-vendor.sh --sync-dist)`);
    fs.copyFileSync(src, path.join(bin, name));
    if (stale) {
      // A real stale bundle is not byte-identical to the delivery. Append a marker inside the
      // bundle's own text so the difference is a genuine content difference (not an mtime).
      fs.appendFileSync(path.join(bin, name), "\n// vendored 2026-08-20 (older than the current delivery)\n");
    }
  }
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), config);
}

// migrateLines — the migration/retirement report lines from a run (the AC1 "可从产物上观察到"
// surface). Returns them so a test asserts on the DEMONSTRATED behavior, not just the end state.
function migrateLines(r) {
  return (r.stdout + "\n" + r.stderr).split("\n").filter((l) => /migrated:|retired-orphan-runtime:|kept-/.test(l));
}

// resolvedMcpEntry — the `mcp_entry` list as written by the upgrade (the config is re-dumped in
// block style by ensure_loop_config, so the two canonical shapes are `- node\n- <path>\n- mcp`).
function resolvedMcpEntry(cfgText) {
  const m = cfgText.match(/mcp_entry:\n((?:[ \t]*- .*\n)+)/);
  assert.ok(m, `the upgraded config must carry an mcp_entry list:\n${cfgText}`);
  return m[1].trimEnd().split("\n").map((l) => l.trim().replace(/^- /, ""));
}

test("AC1/AC2 — legacy bare-PATH project: upgrade migrates the binding to the delivered runtime and retires the stale .quay/runtime/", () => {
  const ws = makeTmp();
  try {
    makeLegacyWs(ws, {
      stale: true,
      config: 'providers:\n  native:\n    enabled: true\n    path: "."\n    tasks_dir: "./tasks"\n    mcp_entry: ["quay-native", "mcp"]\n',
    });
    const rt = path.join(ws, ".quay", "runtime");
    // PRECONDITION (AC4): the target must be NON-EMPTY. If a future edit "simplifies" this fixture
    // to an empty dir, the test would silently stop exercising the branch — so assert the shape.
    assert.ok(Object.keys(treeHashes(rt)).length > 0, "fixture precondition: the target must be NON-EMPTY (empty-dir fixtures cannot reach the upgrade branch)");

    const r = runInitEnv(ws, INIT_ARGS(ws), { HOME: makeDeliveryHome() });
    assert.equal(r.status, 0, `the upgrade must exit 0:\n${r.stdout}${r.stderr}`);

    // AC2 — the executed binding is no longer a PATH lookup: it names the project-internal stable
    // link, which resolves to a real file whose bytes ARE the delivered bundle.
    const cfg = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
    const entry = resolvedMcpEntry(cfg);
    assert.deepEqual(entry.slice(0, 2), ["node", linkRuntime(ws)],
      `the bare PATH form must be migrated to the stable project link runtime (got ${JSON.stringify(entry)})`);
    assert.ok(fs.existsSync(entry[1]), `the migrated mcp_entry must resolve to an existing executable: ${entry[1]}`);
    assert.equal(sha256(entry[1]), sha256(DELIVERED_NATIVE), "the migrated binding must be byte-identical to this delivery's bundle (traceable, not 'whatever $PATH holds')");

    // AC1 — the retired project-local copy is gone from its old location, reversibly (backed up).
    assert.ok(!fs.existsSync(rt), "the unreferenced stale project-local runtime must be retired");
    const backups = fs.existsSync(path.join(ws, ".quay", "quay-init-backups"))
      ? fs.readdirSync(path.join(ws, ".quay", "quay-init-backups")) : [];
    assert.ok(backups.length > 0, "the retirement must be reversible — a backup dir must exist (never a silent delete)");
    const backedUp = backups.some((ts) => fs.existsSync(path.join(ws, ".quay", "quay-init-backups", ts, "runtime", "bin", "quay-native.js")));
    assert.ok(backedUp, `the retired runtime must have been MOVED to a backup, not deleted (backups: ${backups.join(", ")})`);

    // The behavior is observable in the report, not only inferable from the end state.
    const lines = migrateLines(r).join("\n");
    assert.match(lines, /migrated: mcp_entry bare PATH reference/, `the report must name the bare-PATH migration:\n${lines}`);
    assert.match(lines, /retired-orphan-runtime:/, `the report must name the retirement:\n${lines}`);
  } finally { cleanup(ws); }
});

test("AC2 — an ABSOLUTE binding to a STALE project-local runtime is migrated too (the control that makes AC3 falsifiable)", () => {
  // A project whose binding is ALREADY absolute can still be pinned to a copy this delivery
  // superseded. This is the discriminating control for the AC3 test below: it proves the fixture
  // CLASS is touchable, so AC3's "nothing changed" cannot be an artifact of the branch never firing.
  const ws = makeTmp();
  try {
    makeLegacyWs(ws, {
      stale: true,
      config: `providers:\n  native:\n    enabled: true\n    path: "${ws}/.quay/runtime"\n    tasks_dir: "./tasks"\n    mcp_entry: ["node", "${ws}/.quay/runtime/bin/quay-native.js", "mcp"]\n`,
    });
    const rt = path.join(ws, ".quay", "runtime");
    assert.ok(fs.existsSync(path.join(rt, "bin", "quay-native.js")), "fixture precondition: NON-EMPTY legacy target");

    const r = runInitEnv(ws, INIT_ARGS(ws), { HOME: makeDeliveryHome() });
    assert.equal(r.status, 0, `the upgrade must exit 0:\n${r.stdout}${r.stderr}`);

    const cfg = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
    const entry = resolvedMcpEntry(cfg);
    assert.deepEqual(entry.slice(0, 2), ["node", linkRuntime(ws)],
      `a STALE project-local binding must be migrated to the stable project link (got ${JSON.stringify(entry)})`);
    assert.ok(!fs.existsSync(rt), "the superseded project-local runtime must be retired");
    assert.match(migrateLines(r).join("\n"), /stale retired project-local runtime/,
      "the report must name WHY it was migrated (stale vs this delivery)");
  } finally { cleanup(ws); }
});

test("AC3 — a byte-current .quay/runtime/ + an already-absolute mcp_entry: the upgrade is a byte-identical no-op", () => {
  // NEGATIVE CONTROL (硬规则 4 / AC3「能取假」). Input: the project-local runtime is byte-identical
  // to what the plugin delivers, and the binding is already an absolute path. Nothing needs fixing,
  // so nothing may be rewritten or deleted. This assertion CAN turn red: (a) an implementation that
  // always re-points the binding at the plugin runtime, or (b) one that always clears
  // `.quay/runtime/` regardless of staleness, or (c) one that re-dumps the config unconditionally
  // (the yaml re-serialization alone would mutate the provider block's textual form). The sibling
  // AC2 test above shows the SAME fixture class IS touched when the copy is genuinely stale — so a
  // green here is a real "no gratuitous change", not a branch that never runs.
  const ws = makeTmp();
  const wt = diskWorktreeRoot();
  try {
    makeLegacyWs(ws, {
      stale: false,
      // The fixture must be CURRENT IN BOTH RESPECTS for "nothing needs fixing" to be true, so the
      // byte-identity assertion below keeps its power instead of measuring a fixture that is merely
      // out of date: (1) the runtime copy is byte-identical to the delivery and the binding is
      // already absolute (the AC3 premise), and (2) the four carrier-dir pins are present. Gap
      // gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak added the carrier pins to the
      // upgrade path (`ensure_provider_carrier_env`), so a config missing them is now a project that
      // DOES need something — asserting byte-identity over it would be asserting that the backfill
      // never happens. That backfill's own contract (idempotent, minimal, no gratuitous rewrite) is
      // pinned in plugin/test/quay-init-config-env-keys.test.mjs.
      config: `providers:\n  native:\n    enabled: true\n    path: "${ws}/.quay/runtime"\n    tasks_dir: "./tasks"\n    mcp_entry: ["node", "${ws}/.quay/runtime/bin/quay-native.js", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "./tasks"\n      QUAY_NATIVE_ADR_DIR: "./adr"\n      QUAY_NATIVE_GOAL_DIR: "./goals"\n      QUAY_NATIVE_META_DIR: "./meta"\nloop:\n  repo_root: "${ws}"\n  test_command: node --test\n  tmux_session: proj-0:0.0\n  worktree_root: ${wt}\n`,
    });
    const rt = path.join(ws, ".quay", "runtime");
    const cfgPath = path.join(ws, ".quay", "config.yml");
    const beforeRt = treeHashes(rt);
    assert.ok(Object.keys(beforeRt).length > 0, "fixture precondition: NON-EMPTY runtime dir");
    // The fixture must genuinely BE current, else this control degenerates into the AC2 case.
    assert.equal(beforeRt["bin/quay-native.js"], sha256(DELIVERED_NATIVE), "fixture precondition: the project-local bundle must be byte-identical to the delivery");
    const beforeCfg = fs.readFileSync(cfgPath);

    // The loop values are passed identically to what the fixture already carries, so the loop merge
    // is a value-level no-op too — the only remaining way the file could change is a gratuitous write.
    const r = runInit(ws, [...INIT_ARGS(ws), "--worktree-root", wt]);
    assert.equal(r.status, 0, `the upgrade must exit 0:\n${r.stdout}${r.stderr}`);

    assert.deepEqual(treeHashes(rt), beforeRt, "AC3: a byte-current .quay/runtime/ must survive the upgrade byte-for-byte");
    assert.deepEqual(fs.readFileSync(cfgPath), beforeCfg, "AC3: the config — mcp_entry included — must survive the upgrade byte-for-byte");
    assert.match(r.stdout, /kept-runtime-copy:/, "the report must state that the current copy was deliberately left alone");
  } finally { cleanup(ws); }
});
