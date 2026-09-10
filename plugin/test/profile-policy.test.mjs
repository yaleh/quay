// @test-group engine
// profile-policy.test.mjs — gap-profile-policy-when-which-profile, AC1-3.
// Pins the L2 policy module (plugin/scripts/profile-policy.ts) + its carrier (.quay/profiles.yml):
//   AC1 — 主备回退：primary model 不可用时按 fallbackModel 自动降级（负控制：可用时不降级、无
//         fallback 时不降级）。可拿历史 glm-5.3 形态作合成配置验证。
//   AC2 — 加载校验：bare:true + auth:token（只给 ANTHROPIC_AUTH_TOKEN）在加载时被 validateProfiles
//         拒（⛔ 不是 spawn 后 13/13 全败才知道）；bare:true + auth:key 通过；auth 未声明也拒（fail-closed）。
//   AC3 — 继承去重：三个 worker role 共享 worker-default，只声明 name 差异（不逐字重复 launcher/model）；
//         `""` = 取消继承（mergeEnv 删键）、`"0"` 保留、`unset` 显式取消继承、`extends` 单链继承。
//   AC0 — 真 profiles.yml 钉死：文件可读 + 校验通过 + 五个 role 全可解析。
//
// Run: scripts/test.sh plugin/test/profile-policy.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  mergeEnv,
  applyUnset,
  resolveProfile,
  resolveRole,
  validateProfiles,
  readProfilesConfig,
  loadProfiles,
} from "../scripts/profile-policy.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PROFILES_YML = path.join(REPO_ROOT, ".quay", "profiles.yml");

/** 一份合成配置：primary model=glm-5.3 + fallbackModel=deepseek-v4-pro（SPEC §14① 历史形态）。 */
function fallbackConfig() {
  return {
    version: 1,
    profiles: {
      outer: { launcher: "claude-fjdac", model: "glm-5.3", fallbackModel: "deepseek-v4-pro", bare: false, auth: "token" },
    },
    roles: { outer: { profile: "outer", name: "quay-outer" } },
  };
}

// ── AC1 — 主备回退（能取假）────────────────────────────────────────────────────────────────────

test("AC1 — primary model unavailable ⇒ auto-fallback to fallbackModel (no manual intervention)", () => {
  const cfg = fallbackConfig();
  const r = resolveRole(cfg, "outer", { modelAvailable: (m) => m !== "glm-5.3" });
  assert.equal(r.model, "deepseek-v4-pro");
  // 其余字段不因回退而变（只降级 model）。
  assert.equal(r.launcher, "claude-fjdac");
  assert.equal(r.bare, false);
});

test("AC1 — negative control: primary available ⇒ NO fallback (model stays primary)", () => {
  const cfg = fallbackConfig();
  const r = resolveRole(cfg, "outer", { modelAvailable: () => true });
  assert.equal(r.model, "glm-5.3");
});

test("AC1 — negative control: no fallbackModel ⇒ unavailable does NOT fabricate a fallback", () => {
  const cfg = {
    profiles: { outer: { launcher: "claude-fjdac", model: "glm-5.3", bare: false, auth: "token" } },
    roles: { outer: { profile: "outer", name: "quay-outer" } },
  };
  const r = resolveRole(cfg, "outer", { modelAvailable: () => false });
  assert.equal(r.model, "glm-5.3"); // 无 fallback，只能保留 primary（不凭空造值）
});

// ── AC2 — 加载校验（能取假）────────────────────────────────────────────────────────────────────

test("AC2 — bare:true + auth:token is REJECTED at load (not after 13/13 spawn failures)", () => {
  const cfg = {
    profiles: { bad: { launcher: "claude-fjdac", model: "deepseek-v4-pro", bare: true, auth: "token" } },
    roles: { "fix-worker": { profile: "bad", name: "quay-fix-worker" } },
  };
  const v = validateProfiles(cfg);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /bare=true requires auth="key"/.test(e)), `expected bare/auth error, got: ${v.errors.join(" | ")}`);
});

test("AC2 — bare:true + auth:key passes (bare reads ANTHROPIC_API_KEY)", () => {
  const cfg = {
    profiles: { good: { launcher: "claude", model: null, bare: true, auth: "key" } },
    roles: { manager: { profile: "good", name: "quay-manager" } },
  };
  assert.equal(validateProfiles(cfg).ok, true);
});

test("AC2 — bare:true + auth UNDECLARED is rejected (fail-closed: 读不懂 ≠ 合格)", () => {
  const cfg = {
    profiles: { unclear: { launcher: "claude", model: null, bare: true } },
    roles: { manager: { profile: "unclear", name: "quay-manager" } },
  };
  const v = validateProfiles(cfg);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /bare=true requires auth="key"/.test(e)));
});

test("AC2 — unknown auth value is rejected (schema closed, ⛔ 自由组合)", () => {
  const cfg = {
    profiles: { weird: { launcher: "claude", model: null, bare: false, auth: "bogus" } },
    roles: {},
  };
  assert.equal(validateProfiles(cfg).ok, false);
});

test("AC2 — role referencing an unknown profile is rejected", () => {
  const cfg = { profiles: {}, roles: { ghost: { profile: "nope", name: "x" } } };
  assert.equal(validateProfiles(cfg).ok, false);
});

// ── AC3 — 继承去重 + `""` 取消继承（能取假）────────────────────────────────────────────────────

test("AC3 — mergeEnv: \"\" cancels inheritance (quay-launch.sh:98 semantics), \"0\" is preserved", () => {
  // "" 删键（取消继承）；"0" 是有效值要保留。
  const merged = mergeEnv({ A: "1", B: "2" }, { B: "", C: "3", D: "0" });
  assert.deepEqual(merged, { A: "1", C: "3", D: "0" });
});

test("AC3 — applyUnset removes inherited keys (explicit cancel-inheritance form)", () => {
  const env = applyUnset({ A: "1", B: "2" }, ["B"]);
  assert.deepEqual(env, { A: "1" });
});

test("AC3 — extends: child inherits launcher/auth, overrides model; unset strips inherited env", () => {
  const cfg = {
    profiles: {
      base: { launcher: "claude-fjdac", model: "deepseek-v4-pro", auth: "token", bare: false, env: { X: "1", Y: "2" } },
      child: { extends: "base", model: "glm-5.3", unset: ["Y"] },
    },
    roles: {},
  };
  const r = resolveProfile(cfg, "child");
  assert.equal(r.launcher, "claude-fjdac"); // 继承
  assert.equal(r.auth, "token");            // 继承
  assert.equal(r.model, "glm-5.3");         // 覆盖
  assert.deepEqual(r.env, { X: "1" });      // unset 去掉 Y
});

test("AC3 — extends cycle is caught (resolveProfile throws, validateProfiles reports it)", () => {
  const cfg = {
    profiles: { a: { extends: "b" }, b: { extends: "a" } },
    roles: {},
  };
  assert.throws(() => resolveProfile(cfg, "a"), /cycle/);
  const v = validateProfiles(cfg);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /cycle/.test(e)));
});

test("AC3 — the three worker roles share ONE profile, declaring only name/env diffs (no verbatim launcher/model duplication)", () => {
  const cfg = readProfilesConfig(REPO_ROOT);
  for (const role of ["task-worker", "selector", "fix-worker"]) {
    const spec = cfg.roles[role];
    assert.ok(spec, `role ${role} must exist`);
    // 不逐字重复：role 不自己声明 launcher/model/bare（都从 profile 继承）。
    assert.equal(spec.launcher, undefined, `${role} must not repeat launcher`);
    assert.equal(spec.model, undefined, `${role} must not repeat model`);
    assert.equal(spec.bare, undefined, `${role} must not repeat bare`);
    assert.equal(spec.profile, "worker-default", `${role} must reference the shared worker-default profile`);
    const r = resolveRole(cfg, role);
    assert.equal(r.launcher, "claude-fjdac");
    assert.equal(r.model, "deepseek-v4-pro-anthropic");
    assert.equal(r.bare, false);
  }
});

test("AC3 — outer/selector share the same worker-default recipe (换模型改一处)", () => {
  const cfg = readProfilesConfig(REPO_ROOT);
  const outer = resolveRole(cfg, "outer");
  const selector = resolveRole(cfg, "selector");
  assert.equal(outer.launcher, selector.launcher);
  assert.equal(outer.model, selector.model);
  assert.equal(outer.launcher, "claude-fjdac");
  assert.equal(selector.model, "deepseek-v4-pro-anthropic");
});

// ── AC0 — 真 profiles.yml 钉死（文件可读 + 校验通过 + 六 role 可解析）──────────────────────────

test("AC0 — .quay/profiles.yml exists, parses, and validates clean", () => {
  assert.ok(fs.existsSync(PROFILES_YML), ".quay/profiles.yml must exist");
  const cfg = loadProfiles(REPO_ROOT); // throws on invalid ⇒ 校验通过
  assert.equal(cfg.version, 1);
});

test("AC0 — all five roles resolve with a non-empty launcher", () => {
  const cfg = readProfilesConfig(REPO_ROOT);
  for (const role of ["manager", "outer", "task-worker", "selector", "fix-worker"]) {
    const r = resolveRole(cfg, role);
    assert.ok(r.launcher, `role ${role} must resolve a non-empty launcher`);
    assert.ok(r.name, `role ${role} must carry a name`);
  }
});

test("AC0 — manager profile cancels the 917k trio via unset (no silent 917k inheritance)", () => {
  const cfg = readProfilesConfig(REPO_ROOT);
  const manager = resolveRole(cfg, "manager");
  assert.equal(manager.launcher, "claude");
  assert.equal(manager.model, null);
  // unset 显式取消继承：这三个键不得出现在 manager 的 env 里（旧的 "" 约定被显式化为 unset）。
  assert.equal("CLAUDE_CODE_MAX_CONTEXT_TOKENS" in manager.env, false);
  assert.equal("CLAUDE_CODE_AUTO_COMPACT_WINDOW" in manager.env, false);
  assert.equal("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" in manager.env, false);
});

test("AC0 — task-worker keeps its own env (CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS) via role diff", () => {
  const cfg = readProfilesConfig(REPO_ROOT);
  const tw = resolveRole(cfg, "task-worker");
  assert.equal(tw.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, "0");
});

// ── SHIPPED — plugin/.quay/profiles.yml 出厂模板的 worker roles 键集与 dev-tree 一致 ──────────────
// gap-shipped-profiles-missing-worker-roles：quay-init verbatim 铺 shipped 模板进第三方项目
// .quay/profiles.yml；worker-driver 派发 `launchArgv("task-worker", …)` 经 resolveRole 对缺失 role
// 抛 `role not found: "task-worker"`（fail-closed）⇒ 第三方项目永不派发。钉死 shipped 模板的
// worker roles 可解析（负控制：role 缺失时 resolveRole 抛错）。

test("SHIPPED — plugin/.quay/profiles.yml resolves task-worker with launcher=claude (bare-machine default)", () => {
  const shipped = readProfilesConfig(path.join(REPO_ROOT, "plugin"));
  const tw = resolveRole(shipped, "task-worker");
  assert.equal(tw.launcher, "claude", "shipped worker-default keeps launcher=claude (bare-machine default)");
  assert.equal(tw.model, null, "shipped worker-default keeps model=null (bare-machine default)");
  assert.equal(tw.name, "quay-task-worker");
  // 角色自身不重复 launcher/model（与 dev-tree 同构，从 profile 继承）。
  assert.equal(shipped.roles["task-worker"].launcher, undefined);
  assert.equal(shipped.roles["task-worker"].model, undefined);
});

test("SHIPPED — the five worker roles (task-worker/selector/fix-worker/pool-judge/meta-driver) are all present", () => {
  const shipped = readProfilesConfig(path.join(REPO_ROOT, "plugin"));
  for (const role of ["task-worker", "selector", "fix-worker", "pool-judge", "meta-driver"]) {
    const r = resolveRole(shipped, role);
    assert.ok(r.launcher, `shipped role ${role} must resolve a non-empty launcher`);
    assert.equal(r.launcher, "claude", `shipped role ${role} must resolve launcher=claude`);
    assert.ok(r.name, `shipped role ${role} must carry a name`);
  }
});

test("SHIPPED — role key set matches dev-tree (isomorphic, only launcher/model values differ)", () => {
  const dev = readProfilesConfig(REPO_ROOT);
  const shipped = readProfilesConfig(path.join(REPO_ROOT, "plugin"));
  assert.deepEqual(
    Object.keys(shipped.roles).sort(),
    Object.keys(dev.roles).sort(),
    "shipped roles key set must equal dev-tree roles key set"
  );
});

test("SHIPPED — task-worker/fix-worker keep CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 (同 dev-tree role diff)", () => {
  const shipped = readProfilesConfig(path.join(REPO_ROOT, "plugin"));
  for (const role of ["task-worker", "fix-worker"]) {
    const r = resolveRole(shipped, role);
    assert.equal(r.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, "0");
  }
});
