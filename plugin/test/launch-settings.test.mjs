// @test-group governance
// launch-settings.test.mjs — gap-crystallize-launch-config-into-checked-in-settings-file, AC7
// （2026-08-25 更新至 AC154：profile 抽层后，launch.settings.json 只留 Claude Code 认识的键，
//  launcher/model/--bare/-n/unset/flags 全部迁到 .quay/profiles.yml）。
// Pins the checked-in launch settings (.claude/launch.settings.json) + the profile carrier
// (.quay/profiles.yml) + the launcher that consumes them (plugin/scripts/quay-launch.sh):
//   AC1 — settings file carries ONLY Claude Code keys ($schema/permissions/env); `_launchSpec`
//         is gone (AC154 缺口③：profile 不再寄生下划线扩展键).
//         profiles.yml carries profiles/roles separation + bare single-layer + unset:[...] explicit.
//   AC4 — positive control: every role's --dry-run matches profiles.yml verbatim; negative control:
//         a deliberately-broken profiles.yml produces a DIFFERENT command.
//   AC5 — --bare is available as a one-shot verification mode, not the default.
//   AC6 — BOTH routes REQUIRED: promptSuggestions=false (→ CLI flag) AND env var.
//   AC7 — this file is node:test + // @test-group governance.
//
// Run: scripts/test.sh plugin/test/launch-settings.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SETTINGS = path.join(REPO_ROOT, ".claude", "launch.settings.json");
const PROFILES = path.join(REPO_ROOT, ".quay", "profiles.yml");
const LAUNCHER = path.join(REPO_ROOT, "plugin", "scripts", "quay-launch.sh");

function readSettings(file = SETTINGS) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// profiles.yml 是 YAML；launcher 本身经 python3+yaml 消费，本测试用同一手法把它转 JSON 后断言结构。
function readProfiles(file = PROFILES) {
  const r = spawnSync("python3", ["-c", "import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))", file], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `profiles.yml must parse as YAML:\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

function launch(role, args = [], env = {}) {
  return spawnSync("bash", [LAUNCHER, role, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function launchWithProfiles(role, profilesText, args = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-launch-prof-"));
  const p = path.join(tmp, "profiles.yml");
  fs.writeFileSync(p, profilesText, "utf8");
  try {
    return launch(role, args, { QUAY_LAUNCH_PROFILES: p });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── AC1 — settings file is schema-clean; profile carrier holds launch config ──────────────────────

test("AC1 — settings file exists, valid JSON, and uses ONLY Claude Code keys (no _launchSpec)", () => {
  assert.ok(fs.existsSync(SETTINGS), `.claude/launch.settings.json must exist`);
  const s = readSettings();
  assert.equal(typeof s, "object");
  assert.ok(s.$schema, "settings file should declare $schema for validation");
  for (const k of Object.keys(s)) {
    assert.ok(["$schema", "permissions", "env"].includes(k), `unexpected settings key "${k}" — keep the launch file schema-clean (AC154 缺口③)`);
  }
  assert.ok(!("_launchSpec" in s), "_launchSpec must be REMOVED from launch.settings.json (AC154: profile 不再寄生下划线扩展键)");
  // permissions.defaultMode = bypassPermissions (ADR-016 remotely-drivable precondition)
  assert.equal(s.permissions?.defaultMode, "bypassPermissions");
});

test("AC1 — env carries the 917000 context/compaction + ADR-016 + ghost (prompt-suggestions) params", () => {
  const env = readSettings().env;
  assert.equal(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, "917000");
  assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "917000");
  assert.equal(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, "80");
  assert.equal(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN, "1");
  assert.equal(env.CLAUDE_CODE_DISABLE_MOUSE, "1");
  // ghost task param (gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false)
  assert.equal(env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION, "false");
});

test("AC1 — profiles.yml carries profiles/roles + flag-only params (AC154 profile 抽层)", () => {
  assert.ok(fs.existsSync(PROFILES), `.quay/profiles.yml must exist (profile carrier)`);
  const p = readProfiles();
  assert.equal(p.excludeDynamicSystemPromptSections, true, "excludeDynamicSystemPromptSections must be true");
  assert.equal(p.promptSuggestions, false, "promptSuggestions must be false (REQUIRED, not optional)");
  assert.ok(p.profiles, "profiles section must exist");
  assert.ok(p.roles, "roles section must exist");
  for (const role of ["manager", "outer", "task-worker", "selector", "fix-worker", "pool-judge"]) {
    const r = p.roles?.[role];
    assert.ok(r, `role "${role}" must be defined in roles`);
    assert.ok(r.name, `role "${role}" must carry a session display name (-n)`);
    assert.ok(r.profile, `role "${role}" must reference a profile`);
    const prof = p.profiles?.[r.profile];
    assert.ok(prof, `role "${role}" profile "${r.profile}" must be defined`);
    assert.ok(prof.launcher, `profile "${r.profile}" must carry a launcher`);
  }
  // distinct, stable names for session-liveness "whose session is this"
  const names = Object.values(p.roles).map((r) => r.name);
  assert.equal(new Set(names).size, 6, "role names must be distinct");
});

test("AC1 — bare lives ONLY in profiles (AC154 取假①: no top-level or role-level bare)", () => {
  const p = readProfiles();
  assert.ok(!("bare" in p), "top-level bare must NOT exist (single layer)");
  for (const [role, r] of Object.entries(p.roles)) {
    assert.ok(!("bare" in r), `role "${role}" must NOT carry bare (AC142 two-level ambiguity must not return)`);
  }
  // worker-default profile pins bare=false (worker/loop roles must not use --bare — AC142 root cause).
  assert.equal(p.profiles["worker-default"].bare, false, "worker-default profile must carry bare:false");
});

test("AC1 — worker+loop roles share one profile; 换模型改一处 (AC154 取假②)", () => {
  const p = readProfiles();
  const sharedRoles = ["outer", "task-worker", "selector", "fix-worker"];
  const profName = p.roles["task-worker"].profile;
  for (const role of sharedRoles) {
    assert.equal(p.roles[role].profile, profName, `${role} must reference the SAME profile as task-worker`);
  }
  assert.equal(p.profiles[profName].launcher, "claude-fjdac", "shared profile launcher is the wrapper");
  assert.ok(p.profiles[profName].model, "shared profile model is configured (not null)");
});

test("AC1 — manager env-cancellation is explicit unset:[...], NOT empty-string (AC154 取假③)", () => {
  const p = readProfiles();
  const mgrProf = p.roles.manager.profile;
  const mgr = p.profiles[mgrProf];
  assert.equal(mgr.launcher, "claude", "manager launcher is bare claude");
  assert.equal(mgr.model, null, "manager model is null (Anthropic default)");
  assert.ok(Array.isArray(mgr.unset), "manager profile must carry an unset list");
  assert.deepEqual(
    [...mgr.unset].sort(),
    ["CLAUDE_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_CODE_MAX_CONTEXT_TOKENS", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"].sort(),
    "manager must unset the deepseek-specific 917k context/compaction vars"
  );
  // no role carries an empty-string env to mean "unset" (the old convention is retired)
  assert.equal("env" in p.roles.manager, false, "manager role must NOT use empty-string env (use profile.unset)");
});

test("AC1 — no secrets checked in (deepseek key / anthropic token / sk- pattern)", () => {
  // launch.settings.json 是 --settings 输入，绝不应出现凭据 env 名（DEEPSEEK_API_KEY / ANTHROPIC_AUTH_TOKEN /
  // ANTHROPIC_BASE_URL）——真实凭据由 wrapper env 注入，不进 settings 文件。
  const settingsRaw = fs.readFileSync(SETTINGS, "utf8");
  for (const needle of ["DEEPSEEK_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) {
    assert.ok(!settingsRaw.includes(needle), `${SETTINGS} must not contain secret material: ${needle}`);
  }
  assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(settingsRaw), "settings file must not contain an sk- API key");
  // profiles.yml 的 auth: token / auth: key 字段合法提及 ANTHROPIC_AUTH_TOKEN（env 名，非 secret 值），
  // 故只扫真实 secret 值形态（sk- key）+ deepseek key 名（若出现必带值），不扫 ANTHROPIC_* env 名。
  const profilesRaw = fs.readFileSync(PROFILES, "utf8");
  assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(profilesRaw), "profiles.yml must not contain an sk- API key");
  assert.ok(!profilesRaw.includes("DEEPSEEK_API_KEY"), "profiles.yml must not contain the deepseek key");
});

// ── AC5 — --bare is opt-in, not the default ──────────────────────────────────────────────────────

test("AC5 — --bare appears only when explicitly requested; normal launch omits it", () => {
  const normal = launch("selector", ["--dry-run"]);
  assert.equal(normal.status, 0);
  assert.ok(!normal.stdout.includes("--bare"), "normal launch must NOT include --bare");
  const bare = launch("selector", ["--dry-run", "--bare"]);
  assert.equal(bare.status, 0);
  assert.ok(bare.stdout.includes("--bare"), "--bare flag must be appendable for one-shot sessions");
});

// ── AC4 — positive control: launcher output matches profiles.yml verbatim ────────────────────────

function extractSettingsArg(cmd) {
  // --settings 值是路径或 JSON 字符串；JSON 里含空格（env 键值），故捕获到 --exclude 前。
  const m = cmd.match(/--settings (.+?) --exclude-dynamic-system-prompt-sections/);
  assert.ok(m, `command must carry --settings:\n${cmd}`);
  const raw = m[1].trim();
  return raw.startsWith("{") ? JSON.parse(raw) : { __file: raw };
}

test("AC4 — positive control: every role's launch command carries the profile params", () => {
  const p = readProfiles();
  for (const role of Object.keys(p.roles)) {
    const r = launch(role, ["--dry-run"]);
    assert.equal(r.status, 0, `launcher for ${role} must exit 0:\n${r.stderr}`);
    const cmd = r.stdout.trim();
    const def = p.roles[role];
    const prof = p.profiles[def.profile];
    assert.ok(cmd.includes("--settings"), `${role}: command must reference --settings`);
    assert.ok(cmd.includes(`-n ${def.name}`), `${role}: command must carry -n ${def.name}`);
    assert.ok(cmd.includes("--exclude-dynamic-system-prompt-sections"), `${role}: command must carry --exclude-dynamic-system-prompt-sections`);
    assert.ok(cmd.includes("--prompt-suggestions false"), `${role}: command must carry --prompt-suggestions false (REQUIRED)`);
    assert.ok(cmd.startsWith(prof.launcher), `${role}: command must use launcher ${prof.launcher}`);
    if (prof.model) {
      assert.ok(cmd.includes(`--model ${prof.model}`), `${role}: command must carry --model ${prof.model}`);
    } else {
      assert.ok(!cmd.includes("--model"), `${role}: null model must NOT add --model`);
    }
  }
});

test("AC4 — deepseek roles reference the checked-in settings file; manager's effective env excludes 917k (via unset)", () => {
  const outer = extractSettingsArg(launch("outer", ["--dry-run"]).stdout.trim());
  const selector = extractSettingsArg(launch("selector", ["--dry-run"]).stdout.trim());
  assert.equal(outer.__file, SETTINGS, "outer must pass the checked-in file verbatim");
  assert.equal(selector.__file, SETTINGS, "selector must pass the checked-in file verbatim");
  // manager: effective env is the top-level env MINUS the deepseek-specific 917k vars (profile.unset)
  const mgr = extractSettingsArg(launch("manager", ["--dry-run"]).stdout.trim());
  assert.ok(mgr.env, "manager settings must carry an env object");
  assert.equal(mgr.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN, "1", "manager keeps ADR-016 DISABLE_*");
  assert.equal(mgr.env.CLAUDE_CODE_DISABLE_MOUSE, "1", "manager keeps ADR-016 DISABLE_*");
  assert.equal(mgr.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION, "false", "manager keeps prompt-suggestions off");
  for (const k of ["CLAUDE_CODE_MAX_CONTEXT_TOKENS", "CLAUDE_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"]) {
    assert.ok(!(k in mgr.env), `manager effective env must NOT contain ${k} (profile.unset must remove it)`);
  }
});

// ── AC4 — negative control: a broken profiles.yml produces a DIFFERENT command ───────────────────

test("AC4 — negative control: flipping promptSuggestions to true removes the REQUIRED flag", () => {
  const good = launch("selector", ["--dry-run"]).stdout.trim();
  assert.ok(good.includes("--prompt-suggestions false"), "baseline must carry the flag");
  const raw = fs.readFileSync(PROFILES, "utf8");
  const broken = raw.replace("promptSuggestions: false", "promptSuggestions: true");
  assert.notEqual(broken, raw, "the substitution must actually change profiles.yml");
  const r = launchWithProfiles("selector", broken, ["--dry-run"]);
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes("--prompt-suggestions"), "promptSuggestions=true must drop the flag");
  assert.notEqual(r.stdout.trim(), good, "a changed promptSuggestions must change the launch command");
});

test("AC4 — negative control: changing the shared profile model changes every worker command (one place)", () => {
  const good = launch("task-worker", ["--dry-run"]).stdout.trim();
  const raw = fs.readFileSync(PROFILES, "utf8");
  const broken = raw.replace("model: deepseek-v4-pro", "model: deepseek-v4-changed");
  assert.notEqual(broken, raw, "the substitution must actually change profiles.yml");
  const r = launchWithProfiles("task-worker", broken, ["--dry-run"]);
  assert.equal(r.status, 0);
  assert.notEqual(r.stdout.trim(), good, "a changed model must change the launch command");
  assert.ok(r.stdout.includes("--model deepseek-v4-changed"), "the mutated model must be visible in the command");
});

// ── ghost-suggestion source elimination (gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false) ──

test("AC6 — BOTH routes REQUIRED: promptSuggestions=false (→ CLI flag) AND env var", () => {
  const p = readProfiles();
  // Route 1: profiles.yml.promptSuggestions must be literally false → launcher emits --prompt-suggestions false.
  assert.equal(p.promptSuggestions, false, "promptSuggestions must be literally false (REQUIRED, not optional)");
  // Route 2: top-level env must carry the official env-var disable.
  assert.equal(readSettings().env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION, "false", "env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION must be false (REQUIRED)");
  // Every role's materialized command must carry the CLI flag (belt + suspenders).
  for (const role of Object.keys(p.roles)) {
    const r = launch(role, ["--dry-run"]);
    assert.equal(r.status, 0, `launcher for ${role} must exit 0:\n${r.stderr}`);
    assert.ok(r.stdout.includes("--prompt-suggestions false"), `${role}: launch command MUST contain --prompt-suggestions false`);
  }
});

test("AC6 — negative control: removing promptSuggestions drops the CLI flag (catches drift)", () => {
  const raw = fs.readFileSync(PROFILES, "utf8");
  const broken = raw.replace(/promptSuggestions: false\n/, "");
  assert.notEqual(broken, raw, "the substitution must actually remove the promptSuggestions key");
  const r = launchWithProfiles("selector", broken, ["--dry-run"]);
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes("--prompt-suggestions false"),
    "removing promptSuggestions must drop the CLI flag (the REQUIRED invariant is what pins it)");
});

// ── Settings schema conformance ───────────────────────────────────────────────────────────────────

test("AC7 — the settings file loads cleanly under claude --settings (no validation error)", () => {
  const r = spawnSync("claude", ["--settings", SETTINGS, "--version"], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(r.status, 0, `claude --settings must exit 0:\n${r.stderr}`);
  assert.match(r.stdout, /Claude Code|claude/);
});
