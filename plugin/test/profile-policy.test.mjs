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
// 后追加（gap-role-profile-permissionmode-effort-declaration-and-provenance，前缀 NEW-）：
//   NEW-AC1 — permissionMode/effort 两字段的继承展开（role > profile > extends > default）+
//             provenance 的「哪一层决定了最终值」（含主备回退时改报 fallback ⛔ 不谎称声明层）。
//   NEW-AC2 — 封闭枚举 fail-closed：表外串（含合成的「第 7 个更宽值」）一律拒；真实取值全过。
//   NEW-AC3 — launchArgv 追加 `--permission-mode <v>` / `--effort <v>`；**未声明 ⇒ argv 逐字不变**。
//   NEW-AC4 — 派发 provenance：声明值 / 覆盖来源 / 真实 argv / transcript 真实 model；
//             alias 与 real **两个字段**，默认不合并。
//   NEW-AC5 — shipped 模板不声明这两个字段、不路由任何本机 dev 取值（按**解析值**判，⛔ 非 grep 全文）。
//
// Run: scripts/test.sh plugin/test/profile-policy.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

// L3 消费点（launchArgv 是这两个字段唯一的落地处；provenance 是本任务新增的取证面）。
import { launchArgv, dispatchProvenance, readTranscriptRealModel } from "../scripts/driver-runtime.ts";

import {
  mergeEnv,
  applyUnset,
  resolveProfile,
  resolveRole,
  readRoleProvenance,
  validateProfiles,
  readProfilesConfig,
  loadProfiles,
  PERMISSION_MODES,
  EFFORT_LEVELS,
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
    assert.equal(r.bare, false);
  }
  // ⛔ 不钉具体模型名。模型名是【运行环境取值】（随网关导出集合漂移），钉住它不携带新信息
  //   —— 上面已断言 role 不自己声明 model（:160）—— 却会在换模型时让判据烂掉。
  //   留下能取假的那条：三个 role 必须解析出【同一个】model，谁私自覆盖就红。
  const models = ["task-worker", "selector", "fix-worker"].map((x) => resolveRole(cfg, x).model);
  assert.equal(new Set(models).size, 1, "the three worker roles must resolve the SAME model (换模型改一处)");
});

test("AC3 — outer/selector share the same worker-default recipe (换模型改一处)", () => {
  const cfg = readProfilesConfig(REPO_ROOT);
  const outer = resolveRole(cfg, "outer");
  const selector = resolveRole(cfg, "selector");
  assert.equal(outer.launcher, selector.launcher);
  assert.equal(outer.model, selector.model);
  assert.equal(outer.launcher, "claude-fjdac");

  // 取假负控制（照 worker-driver-resident-s04.test.mjs AC140-1b 的手法）：改合成 config 的
  // worker-default.model 一处 ⇒ 四个 role 全部跟随；任一 role 私自覆盖 model ⇒ 本断言即红。
  // ⛔ 不锚具体模型名 —— 那正是本用例此前烂掉的原因（判据钉的是运行环境取值，会随网关漂移）。
  const synth = {
    version: 1,
    profiles: { "worker-default": { launcher: "claude-fjdac", model: "SYNTH-MODEL-X", bare: false, auth: "token" } },
    roles: {
      outer: { profile: "worker-default", name: "o" },
      "task-worker": { profile: "worker-default", name: "t" },
      selector: { profile: "worker-default", name: "s" },
      "fix-worker": { profile: "worker-default", name: "f" },
    },
  };
  for (const role of ["outer", "task-worker", "selector", "fix-worker"]) {
    assert.equal(resolveRole(synth, role).model, "SYNTH-MODEL-X",
      `${role} must follow the shared worker-default model (换模型改一处)`);
  }
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

// ── ROLE-LEVEL mcpBlacklist（gap-worker-mcp-blacklist-strict-config AC1）──────────────────────────
// 纯写代码的三个 role 派发时不连浏览器 MCP；⛔ 字段必须挂【角色】层——outer 与它们共享
// worker-default profile，挂 profile 会把 outer 连坐（而 outer 按 ADR-010 可能真需要浏览器工具）。

const BLACKLISTED_ROLES = ["task-worker", "selector", "fix-worker"];
const MUST_NOT_BE_BLACKLISTED = ["outer", "manager", "pool-judge", "meta-driver"];

test("AC1 — the three code-writing roles carry the role-level mcpBlacklist", () => {
  const cfg = readProfilesConfig(REPO_ROOT);
  for (const role of BLACKLISTED_ROLES) {
    const r = resolveRole(cfg, role);
    assert.deepEqual(
      [...r.mcpBlacklist].sort(),
      ["chrome-devtools", "playwright"],
      `role ${role} must blacklist both browser MCP servers`,
    );
  }
});

test("AC1 negative control — outer/manager/pool-judge are NOT infected by the shared profile", () => {
  const cfg = readProfilesConfig(REPO_ROOT);
  // 前提：这些 role 确实与 task-worker 共享 worker-default（否则这条负控制是空转）。
  assert.equal(cfg.roles["outer"].profile, cfg.roles["task-worker"].profile, "precondition: shared profile");
  for (const role of MUST_NOT_BE_BLACKLISTED) {
    const r = resolveRole(cfg, role);
    assert.deepEqual(r.mcpBlacklist, [], `role ${role} must resolve an EMPTY blacklist`);
  }
  // profile 层本身不带该字段（角色层是唯一合法位置）。
  assert.equal(cfg.profiles["worker-default"].mcpBlacklist, undefined);
});

test("AC1 — SHIPPED carrier carries the same role-level blacklist (⛔ not dev-tree only)", () => {
  // quay-init lays plugin/.quay/profiles.yml verbatim into a consumer's .quay/profiles.yml
  // (profiles-role-coverage-check.ts exists precisely because "fixed one copy, the init path laid
  // down the other" shipped once). A dev-tree-only edit leaves the feature inert for every install.
  const shipped = readProfilesConfig(path.join(REPO_ROOT, "plugin"));
  for (const role of BLACKLISTED_ROLES) {
    assert.deepEqual([...resolveRole(shipped, role).mcpBlacklist].sort(), ["chrome-devtools", "playwright"]);
  }
  for (const role of MUST_NOT_BE_BLACKLISTED) {
    assert.deepEqual(resolveRole(shipped, role).mcpBlacklist, []);
  }
});

test("AC1 — negative control: the blacklist is FALSIFIABLE (a role without it resolves empty)", () => {
  const cfg = {
    version: 1,
    profiles: { w: { launcher: "claude", model: null, bare: false, auth: "key" } },
    roles: {
      "task-worker": { profile: "w", name: "tw", mcpBlacklist: ["chrome-devtools"] },
      selector: { profile: "w", name: "sel" },
    },
  };
  assert.deepEqual(resolveRole(cfg, "task-worker").mcpBlacklist, ["chrome-devtools"]);
  assert.deepEqual(resolveRole(cfg, "selector").mcpBlacklist, [], "same profile, no inheritance of the field");
});

test("AC1 — validateProfiles rejects mcpBlacklist on a PROFILE (positional error, not a review catch)", () => {
  const cfg = {
    version: 1,
    profiles: { w: { launcher: "claude", model: null, bare: false, auth: "key", mcpBlacklist: ["playwright"] } },
    roles: { "task-worker": { profile: "w", name: "tw" } },
  };
  const r = validateProfiles(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /ROLE-level/.test(e)), JSON.stringify(r.errors));
});

test("AC1 — validateProfiles rejects a malformed role-level blacklist (读不懂 ⇒ 拒，⛔ 不当空数组放过)", () => {
  const base = (mcpBlacklist) => ({
    version: 1,
    profiles: { w: { launcher: "claude", model: null, bare: false, auth: "key" } },
    roles: { "task-worker": { profile: "w", name: "tw", mcpBlacklist } },
  });
  for (const bad of ["playwright", [1, 2], [""], ["  "], {}]) {
    const r = validateProfiles(base(bad));
    assert.equal(r.ok, false, `mcpBlacklist=${JSON.stringify(bad)} must be rejected`);
  }
  assert.equal(validateProfiles(base(["playwright"])).ok, true, "a valid array still passes");
});

// ── permissionMode / effort（gap-role-profile-permissionmode-effort-declaration-and-provenance）──────
// 这两段钉的是【新字段】的行为，同时把上面那些既有 AC（bare/auth/mcpBlacklist）的用例留在原处不动
// —— AC7 要求的正是「加了两个字段之后旧校验逐字仍生效」，⛔ 不是「只测新字段、放过回归」。

test("NEW-AC1 — resolveProfile/resolveRole carry the two new fields through inheritance", () => {
  const cfg = {
    version: 1,
    profiles: {
      base: { launcher: "claude", model: null, bare: false, auth: "key", permissionMode: "plan", effort: "low" },
      child: { extends: "base", effort: "max" },
    },
    roles: {
      // 角色层覆盖 profile 层（AC1 要的「一个角色层覆盖 profile 层默认值的解析结果」）。
      a: { profile: "child", name: "qa", permissionMode: "manual" },
      // 不声明的 role ⇒ 逐字继承（含 extends 链）。
      b: { profile: "child", name: "qb" },
    },
  };
  const child = resolveProfile(cfg, "child");
  assert.equal(child.permissionMode, "plan", "extends 继承基 profile 的 permissionMode");
  assert.equal(child.effort, "max", "child 自己覆盖 effort");

  const a = resolveRole(cfg, "a");
  assert.equal(a.permissionMode, "manual", "角色层覆盖 profile 层");
  assert.equal(a.effort, "max", "未声明的字段继续从 profile 继承");

  const b = resolveRole(cfg, "b");
  assert.equal(b.permissionMode, "plan");
  assert.equal(b.effort, "max");
});

test("NEW-AC1 — undeclared ⇒ null (⛔ not a fabricated default value — 硬规则 6)", () => {
  const cfg = {
    version: 1,
    profiles: { w: { launcher: "claude", model: null, bare: false, auth: "key" } },
    roles: { r: { profile: "w", name: "qr" } },
  };
  assert.equal(resolveRole(cfg, "r").permissionMode, null);
  assert.equal(resolveRole(cfg, "r").effort, null);
});

test("NEW-AC1 — provenance names WHICH layer decided each value (role vs profile vs extends vs default)", () => {
  const cfg = {
    version: 1,
    profiles: {
      base: { launcher: "claude", model: "m-base", bare: false, auth: "key", effort: "low" },
      child: { extends: "base", permissionMode: "plan" },
    },
    roles: { r: { profile: "child", name: "qr", model: "m-role" } },
  };
  const p = readRoleProvenance(cfg, "r");
  assert.equal(p.role, "r");
  assert.equal(p.profile, "child");
  // role 层直接声明 ⇒ "role"。
  assert.deepEqual(p.fields.model, { value: "m-role", source: "role", via: "r" });
  // role 引用的 profile 自己声明 ⇒ "profile"，via 点名它。
  assert.deepEqual(p.fields.permissionMode, { value: "plan", source: "profile", via: "child" });
  // 经 extends 从 base 继承 ⇒ "extends"，via 点名**实际声明**它的 base（⛔ 不是 child）。
  assert.deepEqual(p.fields.effort, { value: "low", source: "extends", via: "base" });
  assert.deepEqual(p.fields.launcher, { value: "claude", source: "extends", via: "base" });
});

test("NEW-AC1 — provenance reports the FALLBACK layer when 主备回退 actually fired (⛔ 不谎称是声明层)", () => {
  const cfg = {
    version: 1,
    profiles: { w: { launcher: "claude", model: "glm-5.3", fallbackModel: "deepseek-v4-pro", bare: false, auth: "key" } },
    roles: { r: { profile: "w", name: "qr" } },
  };
  const fired = readRoleProvenance(cfg, "r", { modelAvailable: () => false });
  assert.equal(fired.fields.model.value, "deepseek-v4-pro");
  assert.equal(fired.fields.model.source, "fallback", "回退时值不是任何一层声明的最终值");
  const notFired = readRoleProvenance(cfg, "r", { modelAvailable: () => true });
  assert.equal(notFired.fields.model.source, "profile");
});

test("NEW-AC2 — validateProfiles rejects out-of-enum permissionMode/effort on BOTH layers (fail-closed)", () => {
  const mk = (spec) => ({
    version: 1,
    profiles: { w: { launcher: "claude", model: null, bare: false, auth: "key" } },
    roles: { r: { profile: "w", name: "qr", ...spec } },
  });
  // 合成越界串（⛔ 不是真实存在的取值）——「封闭」这条防御若只是「枚举恰好覆盖当前 CLI」，这里就漏。
  for (const bad of ["yolo", "turbo", "BYPASSPERMISSIONS", "bypass", "", "high "]) {
    const r = validateProfiles(mk({ permissionMode: bad }));
    assert.equal(r.ok, false, `role permissionMode=${JSON.stringify(bad)} must be rejected`);
    assert.ok(r.errors.some((e) => /permissionMode must be one of/.test(e)), JSON.stringify(r.errors));
  }
  for (const bad of ["maxx", "HIGH", "x-high"]) {
    const r = validateProfiles(mk({ effort: bad }));
    assert.equal(r.ok, false, `role effort=${JSON.stringify(bad)} must be rejected`);
  }
  // profile 层同样被拒（⛔ 不是只在 role 层校验）。
  const profileBad = {
    version: 1,
    profiles: { w: { launcher: "claude", model: null, bare: false, auth: "key", permissionMode: "yolo" } },
    roles: { r: { profile: "w", name: "qr" } },
  };
  assert.equal(validateProfiles(profileBad).ok, false);
  assert.ok(validateProfiles(profileBad).errors.some((e) => /^profile "w": permissionMode/.test(e)));
});

test("NEW-AC2 — the closed enum is the 不扩大授权 defence, and it FALSIFIES (every real value still passes)", () => {
  // 「若 CLI 未来新增第 7 个值」的负控制：拿一个【表外】的合成串 ⇒ 默认拒绝。
  // 这一条能取假：若校验改成「看起来像模式名就放过」，下面第一条就会红。
  const cfg = {
    version: 1,
    profiles: { w: { launcher: "claude", model: null, bare: false, auth: "key" } },
    roles: { r: { profile: "w", name: "qr", permissionMode: "unrestricted" } },
  };
  assert.equal(validateProfiles(cfg).ok, false, "a hypothetical wider 7th value is rejected by default");
  // 正向控制：今天 CLI 报告的**全部**取值都必须过（否则「封闭」会变成「误拒」）。
  for (const m of PERMISSION_MODES) {
    const ok = validateProfiles({
      version: 1,
      profiles: { w: { launcher: "claude", model: null, bare: false, auth: "key", permissionMode: m } },
      roles: { r: { profile: "w", name: "qr" } },
    });
    assert.equal(ok.ok, true, `real CLI value ${m} must be accepted: ${JSON.stringify(ok.errors)}`);
  }
  for (const e of EFFORT_LEVELS) {
    const ok = validateProfiles({
      version: 1,
      profiles: { w: { launcher: "claude", model: null, bare: false, auth: "key", effort: e } },
      roles: { r: { profile: "w", name: "qr" } },
    });
    assert.equal(ok.ok, true, `real CLI value ${e} must be accepted: ${JSON.stringify(ok.errors)}`);
  }
});

test("NEW-AC5 — the shipped carrier declares neither new field and routes no dev-only value", () => {
  const shippedYml = fs.readFileSync(path.join(REPO_ROOT, "plugin", ".quay", "profiles.yml"), "utf8");
  const shippedSettings = fs.readFileSync(path.join(REPO_ROOT, "plugin", ".claude", "launch.settings.json"), "utf8");
  // ① 本机 dev 路由的**字面量**在任何位置都不得出现（含注释——注释里的地址照样会被照抄）。
  for (const [name, text] of [["plugin/.quay/profiles.yml", shippedYml], ["plugin/.claude/launch.settings.json", shippedSettings]]) {
    for (const needle of ["127.0.0.1", "26510", "v4.1flash"]) {
      assert.ok(!text.includes(needle), `${name} must not carry the dev-only literal ${needle}`);
    }
  }
  // ② 「不写死本机取值」判的是【声明值】，⛔ 不是【出现了哪些字符串】——硬规则 2：按位置判定。
  //    shipped carrier 的注释里有一句「dev-tree 用 claude-fjdac …」的**指路**说明（那是文档，不是配置），
  //    所以本判据读解析后的 profile/role 取值，而非 grep 全文。
  const cfg = parseYaml(shippedYml);
  assert.equal(validateProfiles(cfg).ok, true, "出厂 carrier 逐字可解析且合法（新字段可选 ⇒ 缺省不破坏它）");
  for (const [pname, p] of Object.entries(cfg.profiles ?? {})) {
    assert.equal(p.launcher, "claude", `shipped profile ${pname}: launcher must be the generic claude`);
    assert.equal(p.model, null, `shipped profile ${pname}: model must be null (consumer supplies its own)`);
    assert.equal(p.permissionMode, undefined, `shipped profile ${pname}: must not declare permissionMode`);
    assert.equal(p.effort, undefined, `shipped profile ${pname}: must not declare effort`);
  }
  for (const [rname, r] of Object.entries(cfg.roles ?? {})) {
    assert.equal(r.permissionMode, undefined, `shipped role ${rname}: must not declare permissionMode`);
    assert.equal(r.effort, undefined, `shipped role ${rname}: must not declare effort`);
  }
  // ③ 逐角色解析确认：shipped carrier 下每个 role 都不追加这两个标志（第三方不声明 ⇒ argv 逐字不变）。
  for (const role of ["task-worker", "selector", "fix-worker", "outer", "manager", "pool-judge", "meta-driver"]) {
    const r = resolveRole(cfg, role);
    assert.equal(r.permissionMode, null, `${role}: shipped carrier must not declare permissionMode`);
    assert.equal(r.effort, null, `${role}: shipped carrier must not declare effort`);
  }
});

// ── launchArgv（L3 消费点）与派发 provenance ─────────────────────────────────────────────────────
// launchArgv 是这两个字段唯一的落地处：声明在 profiles.yml，实际生效在 argv。⛔ 只测 schema 不测 argv
// 就等于什么都没测——「解析对了但标志没拼进去」正是这条链最容易断的一环。

/** 合成一个 workspace root：`.quay/profiles.yml` + `.claude/launch.settings.json`。
 *  ⛔ 不碰真实配置根——本组的判据是 launchArgv 的行为，不是本机环境。 */
function makeRoot(profilesYaml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quay-profilemode-"));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "profiles.yml"), profilesYaml);
  fs.writeFileSync(
    path.join(root, ".claude", "launch.settings.json"),
    JSON.stringify({ $schema: "x", permissions: { defaultMode: "bypassPermissions" }, env: { KEEP: "1" } }),
  );
  return root;
}

const BOTH_DECLARED = [
  "version: 1",
  "profiles:",
  "  w:",
  "    launcher: claude",
  "    model: synth-model",
  "    bare: false",
  "    auth: key",
  "    permissionMode: plan",
  "    effort: xhigh",
  "roles:",
  "  task-worker:",
  "    profile: w",
  "    name: quay-synth",
  "",
].join("\n");

const NEITHER_DECLARED = [
  "version: 1",
  "profiles:",
  "  w:",
  "    launcher: claude",
  "    model: synth-model",
  "    bare: false",
  "    auth: key",
  "roles:",
  "  task-worker:",
  "    profile: w",
  "    name: quay-synth",
  "",
].join("\n");

test("NEW-AC3 — launchArgv appends --permission-mode <v> / --effort <v> for a role that declares them", () => {
  const root = makeRoot(BOTH_DECLARED);
  try {
    const argv = launchArgv("task-worker", "P", root);
    assert.equal(argv[argv.indexOf("--permission-mode") + 1], "plan");
    assert.equal(argv[argv.indexOf("--effort") + 1], "xhigh");
    // prompt 恒是最后一个元素（worker-driver 的续做 prompt 依赖这条不变量）。
    assert.equal(argv[argv.length - 1], "P");
    assert.ok(argv.indexOf("--permission-mode") < argv.indexOf("-n"), "flags precede the -n/-p tail");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("NEW-AC3 — DoD negative control: a role declaring NEITHER field gets a byte-identical argv (no flag)", () => {
  const root = makeRoot(NEITHER_DECLARED);
  try {
    const argv = launchArgv("task-worker", "P", root);
    assert.ok(!argv.includes("--permission-mode"), "⛔ must not append the flag when undeclared");
    assert.ok(!argv.includes("--effort"), "⛔ must not append the flag when undeclared");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("NEW-AC3 — role-level declaration overrides the profile-level one all the way into argv", () => {
  const root = makeRoot(BOTH_DECLARED + "  sel:\n    profile: w\n    name: quay-sel\n    effort: low\n");
  try {
    const argv = launchArgv("sel", "P", root);
    assert.equal(argv[argv.indexOf("--permission-mode") + 1], "plan", "inherited from the profile");
    assert.equal(argv[argv.indexOf("--effort") + 1], "low", "role layer wins");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("NEW-AC4 — the recorded provenance separates alias from real model, and names the deciding layer", () => {
  const root = makeRoot(BOTH_DECLARED);
  try {
    const argv = [...launchArgv("task-worker", "P", root), "--session-id", "00000000-0000-4000-8000-000000000000"];
    const p = dispatchProvenance("task-worker", root, argv, { sessionId: "00000000-0000-4000-8000-000000000000" });
    // 声明值 + 覆盖来源（哪一层决定了最终值）。
    assert.deepEqual(p.declared, {
      launcher: "claude",
      model: "synth-model",
      permissionMode: "plan",
      effort: "xhigh",
    });
    assert.deepEqual(p.override_source, {
      launcher: "profile", model: "profile", permissionMode: "profile", effort: "profile",
    });
    assert.equal(p.override_via.permissionMode, "w");
    // 真实 argv（⛔ 不是推导值）——从它身上读标志值。
    assert.deepEqual(p.argv, argv);
    assert.equal(p.argv_source, "launchArgv");
    // alias 与真实模型是**两个字段**（本 fixture 无 transcript ⇒ real 为 null 且带原因，
    // ⛔ 不是被填成与 alias 相同 —— 硬规则 3b：读不到不得与「读到且相同」同形）。
    assert.equal(p.model_alias, "synth-model");
    assert.equal(p.model_real, null);
    // 「读不到」必须带**可分辨的原因**，⛔ 不是空串、也⛔ 不是被填成 alias（硬规则 3b/6）。
    assert.ok(/transcript not found for session/.test(p.model_real_unavailable), p.model_real_unavailable);
    assert.equal(p.model_real_from, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("NEW-AC4 — a CLI-argv override is recorded as such (⛔ not mislabeled as a launchArgv product)", () => {
  const root = makeRoot(BOTH_DECLARED);
  try {
    const argv = ["node", "-e", "1"];
    const p = dispatchProvenance("task-worker", root, argv, { argvSource: "cli-exact", sessionId: null });
    assert.equal(p.argv_source, "cli-exact");
    assert.deepEqual(p.argv, argv);
    // 覆盖层不带 --model ⇒ alias 为 null（⛔ 不回落到 declared.model 假装它被传了）。
    assert.equal(p.model_alias, null);
    // 声明值仍然如实记录（配置说什么 vs 实际跑了什么，两半都要能读出来）。
    assert.equal(p.declared.model, "synth-model");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("NEW-AC4 — readTranscriptRealModel reads the SERVED model, not the requested alias (⛔ 自证)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-transcript-"));
  const sid = "11111111-2222-4333-8444-555555555555";
  try {
    const cwd = path.join(dir, "proj");
    const slugDir = path.join(dir, ".claude", "projects", "-" + cwd.replace(/\//g, "-"));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(
      path.join(slugDir, `${sid}.jsonl`),
      [
        // 我们**请求**的 alias —— 在 api-request 记录里。
        JSON.stringify({ type: "api-request", params: { model: "v4.1flash-anthropic" } }),
        // 服务端**实际**返回的模型 —— 在 assistant 记录里。这才是「真实模型」。
        JSON.stringify({ type: "assistant", message: { model: "deepseek-flash" } }),
        "",
      ].join("\n"),
    );
    // ⛔ 不碰 ~/.claude —— 直接钉投影函数在真实文件上的行为需要它落在真实 slug 下，
    //    故这里只断言「找不到时不伪装」这一半，另一半（真实读数）由 AC8 的真实 spawn 证据承担。
    const missing = readTranscriptRealModel(sid, path.join(dir, "elsewhere"));
    assert.equal(missing.model, null);
    assert.ok(/transcript not found/.test(missing.unavailable), missing.unavailable);
    assert.equal(missing.from, null);
    assert.equal(readTranscriptRealModel(null, cwd).model, null, "no session id ⇒ null (⛔ not a guess)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
