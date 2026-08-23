// @test-group governance
// launch-settings.test.mjs — gap-crystallize-launch-config-into-checked-in-settings-file, AC7.
// Pins the checked-in launch settings (.claude/launch.settings.json) + the launcher that consumes it
// (plugin/scripts/quay-launch.sh):
//   AC1 — the settings file carries the current-mode must-have params: `--exclude-dynamic-system-
//         prompt-sections` (as _launchSpec.excludeDynamicSystemPromptSections), `-n/--name` per role
//         (_launchSpec.roles.*.name), and `--prompt-suggestions false` (as
//         env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION="false" AND _launchSpec.promptSuggestions=false →
//         launcher emits the CLI flag — BOTH routes REQUIRED,
//         gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false).
//   AC4 — positive control: the launcher's --dry-run output for every role matches the settings file
//         verbatim; negative control: a deliberately-broken copy of the settings file produces a
//         DIFFERENT command (the restart-plan-AC1 mistake is mechanically checkable).
//   AC5 — --bare is available as a one-shot verification mode, not the default.
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
const LAUNCHER = path.join(REPO_ROOT, "plugin", "scripts", "quay-launch.sh");

function readSettings(file = SETTINGS) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function launch(role, args = [], env = {}) {
  return spawnSync("bash", [LAUNCHER, role, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

// ── AC1 — settings file carries the must-have params ─────────────────────────────────────────────

test("AC1 — settings file exists and is valid JSON", () => {
  assert.ok(fs.existsSync(SETTINGS), `.claude/launch.settings.json must exist`);
  const s = readSettings();
  assert.equal(typeof s, "object");
  assert.ok(s.$schema, "settings file should declare $schema for validation");
});

test("AC1 — settings file uses only schema-valid keys plus the _launchSpec extension", () => {
  const s = readSettings();
  const knownKeys = new Set([
    "$schema",
    "permissions",
    "env",
    "_launchSpec",
  ]);
  for (const k of Object.keys(s)) {
    assert.ok(knownKeys.has(k), `unexpected settings key "${k}" — keep the launch file schema-clean`);
  }
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

test("AC1 — _launchSpec carries --exclude-dynamic-system-prompt-sections + --prompt-suggestions false + per-role names", () => {
  const spec = readSettings()._launchSpec;
  assert.equal(spec.excludeDynamicSystemPromptSections, true);
  // ghost-suggestion at-source elimination (gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false AC3):
  // REQUIRED, not optional — every role's launch must disable prompt suggestions (flag form).
  assert.equal(spec.promptSuggestions, false, "_launchSpec.promptSuggestions must be false (REQUIRED, not optional)");
  for (const role of ["manager", "outer", "inner", "task-worker", "selector", "fix-worker"]) {
    const r = spec.roles?.[role];
    assert.ok(r, `role "${role}" must be defined in _launchSpec.roles`);
    assert.ok(r.name, `role "${role}" must carry a session display name (-n)`);
    assert.ok(r.launcher, `role "${role}" must carry a launcher`);
    assert.ok(r.env !== undefined, `role "${role}" must carry an env object ({} or unset-overrides)`);
  }
  // distinct, stable names for session-liveness "whose session is this"
  const names = Object.values(spec.roles).map((r) => r.name);
  assert.equal(new Set(names).size, 6, "role names must be distinct");
});

test("AC1 — 917k vars are deepseek-role-only; manager unsets them (empty-string override)", () => {
  const spec = readSettings()._launchSpec;
  for (const role of ["outer", "inner"]) {
    assert.equal(Object.keys(spec.roles[role].env).length, 0, `${role}: deepseek role inherits the full top-level env`);
  }
  // manager must actively unset the deepseek-specific context/compaction vars
  for (const k of ["CLAUDE_CODE_MAX_CONTEXT_TOKENS", "CLAUDE_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"]) {
    assert.equal(spec.roles.manager.env[k], "", `manager must unset ${k} (empty string) — 917k on Anthropic would compact too late (session-launch-recipes §5)`);
  }
});

test("AC1 — no secrets checked in (deepseek key / anthropic token / sk- pattern)", () => {
  const raw = fs.readFileSync(SETTINGS, "utf8");
  for (const needle of ["DEEPSEEK_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) {
    assert.ok(!raw.includes(needle), `settings file must not contain secret material: ${needle}`);
  }
  // sk- tightened (gap-ac140 6-role change): a real API key is "sk-" followed by a run of key-material
  // chars; the crude substring "sk-" false-positives on the role name "task-worker" (ta-"sk-"-worker).
  assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(raw), "settings file must not contain an sk- API key");
});

// ── AC5 — --bare is opt-in, not the default ──────────────────────────────────────────────────────

test("AC5 — --bare appears only when explicitly requested; normal launch omits it", () => {
  const normal = launch("inner", ["--dry-run"]);
  assert.equal(normal.status, 0);
  assert.ok(!normal.stdout.includes("--bare"), "normal launch must NOT include --bare");
  const bare = launch("inner", ["--dry-run", "--bare"]);
  assert.equal(bare.status, 0);
  assert.ok(bare.stdout.includes("--bare"), "--bare flag must be appendable for one-shot sessions");
});

// ── AC4 — positive control: launcher output matches settings file verbatim ───────────────────────

function extractSettingsArg(cmd) {
  // --settings 值是路径或 JSON 字符串；JSON 里含空格（deferredToPpMigration 文本），故捕获到 --exclude 前。
  const m = cmd.match(/--settings (.+?) --exclude-dynamic-system-prompt-sections/);
  assert.ok(m, `command must carry --settings:\n${cmd}`);
  const raw = m[1].trim();
  return raw.startsWith("{") ? JSON.parse(raw) : { __file: raw };
}

test("AC4 — positive control: every role's launch command carries the settings params", () => {
  const s = readSettings();
  const spec = s._launchSpec;
  for (const role of Object.keys(spec.roles)) {
    const r = launch(role, ["--dry-run"]);
    assert.equal(r.status, 0, `launcher for ${role} must exit 0:\n${r.stderr}`);
    const cmd = r.stdout.trim();
    const def = spec.roles[role];
    assert.ok(cmd.includes("--settings"), `${role}: command must reference --settings`);
    assert.ok(cmd.includes(`-n ${def.name}`), `${role}: command must carry -n ${def.name}`);
    assert.ok(cmd.includes("--exclude-dynamic-system-prompt-sections"), `${role}: command must carry --exclude-dynamic-system-prompt-sections`);
    assert.ok(cmd.includes("--prompt-suggestions false"), `${role}: command must carry --prompt-suggestions false (ghost-suggestion source elimination, REQUIRED)`);
    assert.ok(cmd.includes("--prompt-suggestions false"), `${role}: command MUST carry --prompt-suggestions false (AC3 REQUIRED, not optional)`);
    assert.ok(cmd.startsWith(def.launcher), `${role}: command must use launcher ${def.launcher}`);
    if (def.model) {
      assert.ok(cmd.includes(`--model ${def.model}`), `${role}: command must carry --model ${def.model}`);
    } else {
      assert.ok(!cmd.includes("--model"), `${role}: null model must NOT add --model`);
    }
  }
});

test("AC4 — deepseek roles reference the checked-in settings file; manager's effective env excludes 917k", () => {
  const outer = extractSettingsArg(launch("outer", ["--dry-run"]).stdout.trim());
  const inner = extractSettingsArg(launch("inner", ["--dry-run"]).stdout.trim());
  assert.equal(outer.__file, SETTINGS, "outer must pass the checked-in file verbatim");
  assert.equal(inner.__file, SETTINGS, "inner must pass the checked-in file verbatim");
  // manager: effective env is the top-level env MINUS the deepseek-specific 917k vars
  const mgr = extractSettingsArg(launch("manager", ["--dry-run"]).stdout.trim());
  assert.ok(mgr.env, "manager settings must carry an env object");
  assert.equal(mgr.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN, "1", "manager keeps ADR-016 DISABLE_*");
  assert.equal(mgr.env.CLAUDE_CODE_DISABLE_MOUSE, "1", "manager keeps ADR-016 DISABLE_*");
  assert.equal(mgr.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION, "false", "manager keeps prompt-suggestions off");
  for (const k of ["CLAUDE_CODE_MAX_CONTEXT_TOKENS", "CLAUDE_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"]) {
    assert.ok(!(k in mgr.env), `manager effective env must NOT contain ${k}`);
  }
});

// ── AC4 — negative control: a broken settings file produces a DIFFERENT command ──────────────────

test("AC4 — negative control: flipping promptSuggestions to true removes the REQUIRED flag", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-launch-ps-"));
  try {
    const s = readSettings();
    const good = launch("inner", ["--dry-run"]).stdout.trim();
    assert.ok(good.includes("--prompt-suggestions false"), "baseline must carry the flag");
    // Flip the REQUIRED param off — the flag must disappear (restart-plan-AC1 class of error catchable).
    s._launchSpec.promptSuggestions = true;
    const brokenPath = path.join(tmp, "launch.settings.ps-on.json");
    fs.writeFileSync(brokenPath, JSON.stringify(s, null, 2), "utf8");
    const broken = launch("inner", ["--dry-run"], { QUAY_LAUNCH_SETTINGS: brokenPath });
    assert.equal(broken.status, 0);
    assert.ok(!broken.stdout.includes("--prompt-suggestions"), "promptSuggestions=true must drop the flag");
    assert.notEqual(broken.stdout.trim(), good, "a changed promptSuggestions must change the launch command");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC4 — negative control: deliberate edit changes the launch command (restart-plan-AC1 catchable)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-launch-neg-"));
  try {
    const s = readSettings();
    const good = launch("inner", ["--dry-run"]).stdout.trim();
    // Mutate the model for inner (the restart-plan-AC1 class of error: wrong model on launch).
    s._launchSpec.roles.inner.model = "deepseek-v4-pro";
    const brokenPath = path.join(tmp, "launch.settings.broken.json");
    fs.writeFileSync(brokenPath, JSON.stringify(s, null, 2), "utf8");
    const broken = launch("inner", ["--dry-run"], { QUAY_LAUNCH_SETTINGS: brokenPath });
    assert.equal(broken.status, 0);
    assert.notEqual(broken.stdout.trim(), good, "a changed model must change the launch command");
    assert.ok(broken.stdout.includes("--model deepseek-v4-pro"), "the mutated model must be visible in the command");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ghost-suggestion source elimination (gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false) ──

test("AC6 — BOTH routes REQUIRED: _launchSpec.promptSuggestions=false (→ CLI flag) AND env var", () => {
  const s = readSettings();
  // Route 1: _launchSpec.promptSuggestions must be literally false → launcher emits --prompt-suggestions false.
  assert.equal(s._launchSpec.promptSuggestions, false, "_launchSpec.promptSuggestions must be literally false (REQUIRED, not optional)");
  // Route 2: top-level env must carry the official env-var disable.
  assert.equal(s.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION, "false", "env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION must be false (REQUIRED)");
  // Every role's materialized command must carry the CLI flag (belt + suspenders).
  for (const role of Object.keys(s._launchSpec.roles)) {
    const r = launch(role, ["--dry-run"]);
    assert.equal(r.status, 0, `launcher for ${role} must exit 0:\n${r.stderr}`);
    assert.ok(r.stdout.includes("--prompt-suggestions false"), `${role}: launch command MUST contain --prompt-suggestions false`);
  }
});

test("AC6 — negative control: removing _launchSpec.promptSuggestions drops the CLI flag (catches drift)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-launch-ghost-"));
  try {
    const s = readSettings();
    delete s._launchSpec.promptSuggestions;
    const brokenPath = path.join(tmp, "launch.settings.no-ghost.json");
    fs.writeFileSync(brokenPath, JSON.stringify(s, null, 2), "utf8");
    const broken = launch("inner", ["--dry-run"], { QUAY_LAUNCH_SETTINGS: brokenPath });
    assert.equal(broken.status, 0);
    assert.ok(!broken.stdout.includes("--prompt-suggestions false"),
      "removing _launchSpec.promptSuggestions must drop the CLI flag (the REQUIRED invariant is what pins it)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Settings schema conformance (root additionalProperties tolerated; _launchSpec is the only extension) ──

test("AC7 — the settings file loads cleanly under claude --settings (no validation error)", () => {
  const r = spawnSync("claude", ["--settings", SETTINGS, "--version"], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(r.status, 0, `claude --settings must exit 0:\n${r.stderr}`);
  assert.match(r.stdout, /Claude Code|claude/);
});
