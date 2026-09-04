// profile-policy.ts — L2 policy「何时用哪个 profile」（gap-profile-policy-when-which-profile）。
// 一个纯函数库：把【语义 kind（role）】解析成【L1 profile（launcher/model/env/bare/auth）】，
// 在解析时套上三条 policy（SPEC §14 三种已发生失败各自对应的形态）：
//   ① 主备回退  —— profile.model 不可用时按 fallbackModel 自动降级（⛔ 不人工干预；SPEC §14① glm-5.3）。
//   ② 加载校验  —— 加载时拒绝 bare 与 auth 不相容的组合（bare:true ⇒ 必须提供 ANTHROPIC_API_KEY；
//                  auth:token 只给 ANTHROPIC_AUTH_TOKEN ⇒ 拒，⛔ 不是 spawn 后 13/13 全败才知道；SPEC §14②）。
//   ③ 继承去重  —— 多 role 共享一份 profile，只声明差异；`extends` 单链继承 + `unset`/`""` 取消继承
//                  （⛔ 三个 worker role 仍逐字重复 launcher/model ⇒ 假；SPEC §14③）。
// ⛔ 不是「配置项自由组合」：schema 是封闭的（ProfileSpec/RoleSpec 逐字段列出），不会长成第二个
//   bare 那种两级歧义旋钮。
//
// ⚠️ 保留 `""` = 取消继承语义（quay-launch.sh:98 `with_entries(select(.value != ""))`，manager 靠它
//   取消 917k 三件套；`"0"` 是有效值要保留）——mergeEnv 里 `""` 删键、其余（含 "0"）保留。
//
// 归属 blocker（归人裁定，未决，本模块不默认取值）：packages/quay（产品）vs plugin/scripts（编排）。
// 本文件落在编排层（与 L1 quay-launch.sh 同层）；若「包裹会话的 quay」是产品主张，L1/L2/L3 再整体迁。
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

// ── schema（封闭，逐字段列出 ⛔ 自由组合）───────────────────────────────────────────────────────
/** auth：这个 profile 的 launcher 提供哪种凭据。`key` = ANTHROPIC_API_KEY（--bare 唯一认的）；
 *  `token` = ANTHROPIC_AUTH_TOKEN（claude-fjdac wrapper 只给这个，且会置空 ANTHROPIC_API_KEY）。
 *  这是 bare 一致性校验（AC2）的判别面：bare:true 要求 auth:key。 */
export type AuthKind = "key" | "token";

/** 一个可复用的 profile（L1 抽层的 recipe）。extends = 单链继承；fallbackModel = 主备回退（AC1）。 */
export interface ProfileSpec {
  launcher?: string;
  model?: string | null;
  bare?: boolean;
  auth?: AuthKind;
  env?: Record<string, string>;
  unset?: string[];
  extends?: string;
  fallbackModel?: string | null;
}

/** 一个语义 kind（role）。profile = 引用；其余字段 = 只声明差异（AC3：不逐字重复 launcher/model）。 */
export interface RoleSpec {
  profile: string;
  name?: string;
  model?: string | null;
  bare?: boolean;
  env?: Record<string, string>;
  unset?: string[];
}

/** .quay/profiles.yml 的顶层形状。 */
export interface ProfilesConfig {
  version?: number;
  profiles?: Record<string, ProfileSpec>;
  roles?: Record<string, RoleSpec>;
  // flag-only 启动参数（AC154 随 _launchSpec 迁入；对全部 role 生效，由 L3 launchArgv 翻译成 CLI 参数）。
  excludeDynamicSystemPromptSections?: boolean;
  promptSuggestions?: boolean;
}

/** 解析后的一份 profile（继承已展开、env 已合并）。 */
export interface ResolvedProfile {
  launcher: string;
  model: string | null;
  bare: boolean;
  auth: AuthKind | null;
  env: Record<string, string>;
  fallbackModel: string | null;
}

/** 解析后的一份 role（kind → profile + name）。 */
export interface ResolvedRole extends ResolvedProfile {
  name: string;
}

/** resolveRole 的可选信号：判定某个 model 是否可用（主备回退的触发面）。
 *  缺省恒 true（不触发回退）。L3（driver 绑定）会把真实 spawn 失败接到这里。 */
export interface ResolveOptions {
  modelAvailable?: (model: string) => boolean;
}

// ── env 合并：`""` = 取消继承（删键）；`"0"` 等其余值原样保留 ───────────────────────────────────
/** 把 override 合并到 base 之上。override 中值为 `""` 的键 = 从结果里删掉（取消继承，
 *  复刻 quay-launch.sh:98 `with_entries(select(.value != ""))`）；`"0"` 是有效值，保留。 */
export function mergeEnv(base: Record<string, string>, override: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === "") delete out[k];
    else out[k] = v;
  }
  return out;
}

/** 对一份已合并的 env 应用 `unset: [...]`（显式取消继承，L1 目标形态）。unset 优先于 env 覆盖。 */
export function applyUnset(env: Record<string, string>, unset: readonly string[]): Record<string, string> {
  const out: Record<string, string> = { ...env };
  for (const k of unset) delete out[k];
  return out;
}

// ── profile 解析（继承展开）─────────────────────────────────────────────────────────────────────
/** 展开一份 profile 到 ResolvedProfile。extends 单链继承（递归），循环引用抛错。
 *  缺省 launcher=""（fail-closed 由 validateProfiles 补），bare=false，auth=null。 */
export function resolveProfile(config: ProfilesConfig, profileName: string, _seen: Set<string> = new Set()): ResolvedProfile {
  if (_seen.has(profileName)) {
    throw new Error(`profile extends cycle: ${[..._seen, profileName].join(" -> ")}`);
  }
  const profiles = config.profiles ?? {};
  const spec = profiles[profileName];
  if (!spec) throw new Error(`profile not found: "${profileName}"`);
  _seen.add(profileName);

  // 先展开基 profile（若 extends），再合并本层。
  let base: ResolvedProfile = {
    launcher: "",
    model: null,
    bare: false,
    auth: null,
    env: {},
    fallbackModel: null,
  };
  if (spec.extends) base = resolveProfile(config, spec.extends, _seen);
  _seen.delete(profileName);

  const env = applyUnset(mergeEnv(base.env, spec.env ?? {}), spec.unset ?? []);
  return {
    launcher: spec.launcher ?? base.launcher,
    model: spec.model !== undefined ? spec.model : base.model,
    bare: spec.bare !== undefined ? spec.bare : base.bare,
    auth: spec.auth !== undefined ? spec.auth : base.auth,
    env,
    fallbackModel: spec.fallbackModel !== undefined ? spec.fallbackModel : base.fallbackModel,
  };
}

// ── role 解析（kind → profile + 差异 + 主备回退）────────────────────────────────────────────────
/** 把语义 kind 解析成 ResolvedRole。role 引用 profile，只叠加自己声明的差异（model/env/unset/bare）。
 *  主备回退：最终 model 不可用（opts.modelAvailable 判假）且有 fallbackModel ⇒ 降级到 fallbackModel。 */
export function resolveRole(config: ProfilesConfig, roleName: string, opts: ResolveOptions = {}): ResolvedRole {
  const roles = config.roles ?? {};
  const role = roles[roleName];
  if (!role) throw new Error(`role not found: "${roleName}"`);
  const p = resolveProfile(config, role.profile);

  const env = applyUnset(mergeEnv(p.env, role.env ?? {}), role.unset ?? []);
  let model = role.model !== undefined ? role.model : p.model;
  const bare = role.bare !== undefined ? role.bare : p.bare;
  const fallbackModel = p.fallbackModel;

  // AC1 主备回退：primary model 不可用 ⇒ fallbackModel。
  const available = opts.modelAvailable ?? (() => true);
  if (model !== null && fallbackModel !== null && !available(model)) {
    model = fallbackModel;
  }

  return {
    launcher: p.launcher,
    model,
    bare,
    auth: p.auth,
    env,
    fallbackModel,
    name: role.name ?? roleName,
  };
}

// ── 加载校验（AC2：bare 与 auth 不相容在加载时被拒，⛔ 非 spawn 后才知道）───────────────────────
/** 校验一份 profiles.yml。返回 { ok, errors }——ok:false 时 errors 逐条列出（⛔ 不是布尔化存在性）。 */
export function validateProfiles(config: ProfilesConfig): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const profiles = config.profiles ?? {};
  const roles = config.roles ?? {};

  for (const [name, p] of Object.entries(profiles)) {
    // auth 只能取封闭的 key|token（⛔ 自由组合）。
    if (p.auth !== undefined && p.auth !== "key" && p.auth !== "token") {
      errors.push(`profile "${name}": auth must be "key" or "token", got "${String(p.auth)}"`);
    }
    // AC2：bare:true 要求 ANTHROPIC_API_KEY（auth:key）。auth:token（只给 AUTH_TOKEN）⇒ 拒；
    // auth 未声明 ⇒ 同样拒（硬规则 3b：读不懂 ≠ 合格，fail-closed 要求显式声明）。
    if (p.bare === true && p.auth !== "key") {
      errors.push(
        `profile "${name}": bare=true requires auth="key" (ANTHROPIC_API_KEY), but auth=${p.auth === undefined ? "undeclared" : `"${p.auth}"`} — bare + auth-token launcher fails 13/13 (AC142)`
      );
    }
    if (p.extends !== undefined && !(p.extends in profiles)) {
      errors.push(`profile "${name}": extends references unknown profile "${p.extends}"`);
    }
    // extends 循环由 resolveProfile 抛错；这里用干跑捕获，把它转成一条 error 而非 throw。
    if (p.extends !== undefined && p.extends in profiles) {
      try {
        resolveProfile(config, name);
      } catch (e) {
        if (e instanceof Error && /cycle/.test(e.message)) errors.push(`profile "${name}": ${e.message}`);
      }
    }
  }

  for (const [name, r] of Object.entries(roles)) {
    if (!(r.profile in profiles)) {
      errors.push(`role "${name}": references unknown profile "${r.profile}"`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── 读取 ────────────────────────────────────────────────────────────────────────────────────────
/** 读并解析 .quay/profiles.yml。文件缺失 / YAML 非法 ⇒ 抛错（fail-closed）。 */
export function readProfilesConfig(root: string): ProfilesConfig {
  const file = path.join(root, ".quay", "profiles.yml");
  if (!fs.existsSync(file)) throw new Error(`profiles config not found: ${file}`);
  const raw = fs.readFileSync(file, "utf8");
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    throw new Error(`profiles config is not valid YAML: ${file} — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`profiles config must be a YAML mapping: ${file}`);
  }
  return doc as ProfilesConfig;
}

/** 读 + 校验一份 profiles.yml。校验不过 ⇒ 抛错（加载时拒绝，⛔ 不静默）。 */
export function loadProfiles(root: string): ProfilesConfig {
  const config = readProfilesConfig(root);
  const v = validateProfiles(config);
  if (!v.ok) throw new Error(`profiles config invalid:\n  - ${v.errors.join("\n  - ")}`);
  return config;
}
