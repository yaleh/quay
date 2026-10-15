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
// ⚠️ 保留 `""` = 取消继承语义（manager 靠它取消 917k 三件套；`"0"` 是有效值要保留）——mergeEnv 里
//   `""` 删键、其余（含 "0"）保留。
//   ⛔ 本行原先引的 `quay-launch.sh:98 with_entries(select(.value != ""))` 已失效（2026-09-26 实测：
//   该 jq 已不在树里；shell 层改用显式 `unset` 列表，quay-launch.sh:124「取消继承 = 从 base env 删
//   unset 键（显式列表，⛔ 非空串约定）」，`applyUnset` 即该显式形态的 TS 对应物）。`""` 规则在本层
//   继续保留是【刻意的向后兼容】，⛔ 不是因为 shell 层还有定义点 —— 别再把死锚点复制到第三处。
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

/** `claude --permission-mode` 的**封闭取值集**（逐字对齐 `claude --help` 的 `choices:`）。
 *  ⛔ 本表是**防御面**，不是抄录：`launchArgv` 只发声明过的值，`validateProfiles` 拒表外的一切字符串
 *  ⇒ CLI 未来新增第 7 个（可能比 `bypassPermissions` 更宽的）取值时，本枚举**默认拒绝**它，
 *  ⛔ 不是「看起来像就放过」（见 validateProfiles 的 permissionMode 校验）。
 *  核对记录（2026-10-15 实测 `claude --help`）：`(choices: "acceptEdits", "auto", "bypassPermissions",
 *  "manual", "dontAsk", "plan")` —— 与表逐字一致。 */
export const PERMISSION_MODES = ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** `claude --effort` 的**封闭取值集**（逐字对齐 `claude --help`）。
 *  核对记录（2026-10-15 实测 `claude --help`）：`--effort <level>  Effort level for the current session
 *  (low, medium, high, xhigh, max)` —— 与表逐字一致。
 *
 *  🔴 本表**承重**（不是装饰）。实测负控制（2026-10-15，经 `claude-fjdac` 真 spawn）：
 *    `claude-fjdac -p hi --effort boguslevel`
 *      ⇒ `Warning: Unknown --effort value 'boguslevel' — ignoring it and using the default effort.
 *         Valid values: low, medium, high, xhigh, max.` 且 **exit 0**。
 *  即：`--effort` 拼错时 CLI **不 fail-closed**，它降级到缺省值并正常退出——「声明了 max 却跑在
 *  缺省强度上」与「一切正常」在退出码与输出上**同形**（硬规则 3b/4b 的教科书形态）。
 *  ⇒ `validateProfiles` 的封闭集校验是这条路上**唯一**的 fail-closed 闸：它在加载时拒，⛔ 不指望
 *    CLI 报错。对照 `--permission-mode`（同一次实测：越界值 ⇒ `error: … is invalid` + **exit 1**），
 *    两个标志的失败形态**不同**，故两者都必须有框架侧校验，⛔ 不能「CLI 会报错」地省掉 effort。 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** 一个可复用的 profile（L1 抽层的 recipe）。extends = 单链继承；fallbackModel = 主备回退（AC1）。 */
export interface ProfileSpec {
  launcher?: string;
  model?: string | null;
  bare?: boolean;
  auth?: AuthKind;
  /** 会话的权限模式（`claude --permission-mode <v>`）。**可选**——缺省 ⇒ `launchArgv` 不追加该标志，
   *  现有 `launch.settings.json` 的 `permissions.defaultMode` 继续生效（逐字不变，见 DoD）。
   *  ⛔ 只能声明比现有已授权模式更**收紧**的值，见 validateProfiles。 */
  permissionMode?: PermissionMode;
  /** 会话的推理强度（`claude --effort <v>`）。**可选**，缺省 ⇒ 不追加该标志（逐字不变）。 */
  effort?: EffortLevel;
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
  /** gap-worker-mcp-blacklist-strict-config：本 role 派发时**不连接**的 MCP server 名。
   *  ⚠️ 必须挂在【角色】层而不是共享 profile 层：outer 与三个 worker role 共享 worker-default，
   *  而 outer 按 ADR-010 milestone e2e 可能真需要浏览器工具 ⇒ 挂 profile 会把它连坐。
   *  缺省/空 ⇒ 该 role 的 argv 与改动前逐字一致（不追加任何 mcp flag）。 */
  mcpBlacklist?: string[];
  /** 角色层覆盖（同 model/bare/env 的「只声明差异」语义）：`role.x !== undefined ? role.x : profile.x`。
   *  缺省 ⇒ 继承 profile 层；两层都不声明 ⇒ 不追加对应 CLI 标志（逐字不变）。 */
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
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
  /** 缺省 null = 未声明 ⇒ `launchArgv` 不追加 `--permission-mode`（硬规则 6：缺值 ≠ 某个取值）。 */
  permissionMode: PermissionMode | null;
  /** 缺省 null = 未声明 ⇒ `launchArgv` 不追加 `--effort`。 */
  effort: EffortLevel | null;
}

/** 解析后的一份 role（kind → profile + name）。 */
export interface ResolvedRole extends ResolvedProfile {
  name: string;
  /** 该 role 的 MCP 黑名单（角色层，⛔ 不从 profile 继承——见 RoleSpec.mcpBlacklist）。
   *  未声明 ⇒ 空数组（「不排除任何 server」与「排除空集」在这里同义且都是显式的）。 */
  mcpBlacklist: string[];
}

/** resolveRole 的可选信号：判定某个 model 是否可用（主备回退的触发面）。
 *  缺省恒 true（不触发回退）。L3（driver 绑定）会把真实 spawn 失败接到这里。 */
export interface ResolveOptions {
  modelAvailable?: (model: string) => boolean;
}

// ── 值的【来源层】（AC4：记录「哪一层决定了最终值」，⛔ 不是只把最终值记一遍）────────────────────
// 为什么不复用 ResolvedProfile 的值：值告诉你「是什么」，来源告诉你「谁说了算」。一条 provenance 记录
// 若只带值，读者无法区分「这个 permissionMode 是角色层刻意收紧的」与「它是共享 profile 顺带继承的」——
// 而调整配置时这两者的改法完全不同（改 role 还是改 profile）。
// ⛔ 与硬规则 4b 同源：只记最终值的读数是一个**代理量**，它会随继承链重排而变化，却不反映意图落点。
/** 一个解析值的来源层。封闭枚举（⛔ 不自由组合）：
 *   - `role`      —— 角色层（RoleSpec）直接声明；
 *   - `profile`   —— role 直接引用的那份 profile 声明；
 *   - `extends`   —— 经 extends 单链从某个基 profile 继承（`via` 点名**实际声明**它的那份）；
 *   - `fallback`  —— 主备回退把 model 换成了 fallbackModel（值不是任何一层「声明」的最终值）；
 *   - `cli`       —— CLI 参数层覆盖（L3 的 override 缝；⛔ 本模块不产生，由调用方标注）；
 *   - `default`   —— 无任何层声明（内建缺省：launcher=""、model=null、permissionMode/effort=null）。 */
export type ValueSource = "role" | "profile" | "extends" | "fallback" | "cli" | "default";

/** 一个字段的 (值, 来源层, 点名) 三元组。 */
export interface FieldProvenance {
  /** 解析出的最终值（`null` = 没有值/未声明）。 */
  value: string | null;
  source: ValueSource;
  /** `profile`/`extends` 时点名【实际声明该值】的 profile 名；其余来源 ⇒ null。 */
  via: string | null;
}

/** provenance 覆盖的四个字段（env/bare/auth 不在此列：它们不是「启动标志」层面的可观测取值）。 */
export interface RoleProvenance {
  role: string;
  /** 该 role 引用的 profile 名。 */
  profile: string;
  fields: {
    launcher: FieldProvenance;
    model: FieldProvenance;
    /** ⛔ 与 `ResolvedRole.permissionMode` 同源（同一个解析核心），不是各算一遍。 */
    permissionMode: FieldProvenance;
    effort: FieldProvenance;
  };
}

// ── env 合并：`""` = 取消继承（删键）；`"0"` 等其余值原样保留 ───────────────────────────────────
// 实现单一来源 = kernel 叶 `packages/quay/src/kernel/env-merge.ts`。本文件只 import 并原样转出
// （公开面不变：`mergeEnv` 仍从本路径导出，签名不变）。落 kernel 的理由 = 两层唯一共同可达：
// ⛔ 产品层（`packages/quay/src/goal-store.ts` 的保真性判定器缺省 wiring）也读这一份，而
// `packages/**` → `plugin/**` 是 import-graph-check 的 `reverseEdges` 棘轮（基线 0）明令的逆向边，
// 故实现不能留在 plugin/scripts 里。原为两份逐字节相同的 body（本文件的 `mergeEnv` 与
// goal-store 的 `mergeProfileEnv`）—— routine `semantic-dedup-scan` finding
// `mergeenv-cross-layer-byte-identical-under-renamed-symbol` 的处置。
import { mergeEnv } from "../../packages/quay/src/kernel/env-merge.ts";
export { mergeEnv };

/** 对一份已合并的 env 应用 `unset: [...]`（显式取消继承，L1 目标形态）。unset 优先于 env 覆盖。 */
export function applyUnset(env: Record<string, string>, unset: readonly string[]): Record<string, string> {
  const out: Record<string, string> = { ...env };
  for (const k of unset) delete out[k];
  return out;
}

// ── profile 解析（继承展开）─────────────────────────────────────────────────────────────────────
/** 一次 profile 解析的内部结果：值 + env + 四个字段的来源层。
 *  ⛔ `resolveProfile` 与 `readRoleProvenance` **共用本函数**——继承规则只有这一份实现，
 *  来源信息是它的副产物而不是第二次走一遍链（否则两份会在下一次改继承规则时漂移）。 */
interface TrackedProfile {
  resolved: ResolvedProfile;
  sources: Pick<RoleProvenance["fields"], "launcher" | "model" | "permissionMode" | "effort">;
}

/** 内建缺省（无任何层声明时）。⛔ 单点：resolveProfile 与 validateProfiles 都从这里取。 */
const PROFILE_DEFAULTS: ResolvedProfile = {
  launcher: "",
  model: null,
  bare: false,
  auth: null,
  env: {},
  fallbackModel: null,
  permissionMode: null,
  effort: null,
};

/** 把一个 spec 字段的「是否声明」翻成 (值, 来源)。`declared === undefined` ⇒ 继承 base 的来源。 */
function field<T extends string>(
  declared: T | null | undefined,
  base: FieldProvenance,
  declaredSource: ValueSource,
  via: string | null,
): FieldProvenance {
  if (declared !== undefined) return { value: declared ?? null, source: declaredSource, via };
  return base;
}

/** 展开一份 profile，同时跟踪四个字段的来源层。extends 单链继承（递归），循环引用抛错。 */
function resolveProfileTracked(config: ProfilesConfig, profileName: string, _seen: Set<string> = new Set()): TrackedProfile {
  if (_seen.has(profileName)) {
    throw new Error(`profile extends cycle: ${[..._seen, profileName].join(" -> ")}`);
  }
  const profiles = config.profiles ?? {};
  const spec = profiles[profileName];
  if (!spec) throw new Error(`profile not found: "${profileName}"`);
  _seen.add(profileName);

  // 先展开基 profile（若 extends），再合并本层。
  let base: TrackedProfile = {
    resolved: { ...PROFILE_DEFAULTS },
    sources: {
      launcher: { value: null, source: "default", via: null },
      model: { value: null, source: "default", via: null },
      permissionMode: { value: null, source: "default", via: null },
      effort: { value: null, source: "default", via: null },
    },
  };
  if (spec.extends) base = resolveProfileTracked(config, spec.extends, _seen);
  _seen.delete(profileName);

  const env = applyUnset(mergeEnv(base.resolved.env, spec.env ?? {}), spec.unset ?? []);
  // 本层声明 ⇒ source="profile"；否则继承基层的来源，但把「基层自己声明的」改写成 "extends"
  //（对**本 profile 的读者**而言它确实是继承来的），并保留 `via` = 真正声明它的那一份。
  const inherit = (b: FieldProvenance): FieldProvenance =>
    b.source === "profile" ? { value: b.value, source: "extends", via: b.via } : { ...b };
  return {
    resolved: {
      launcher: spec.launcher ?? base.resolved.launcher,
      model: spec.model !== undefined ? spec.model : base.resolved.model,
      bare: spec.bare !== undefined ? spec.bare : base.resolved.bare,
      auth: spec.auth !== undefined ? spec.auth : base.resolved.auth,
      env,
      fallbackModel: spec.fallbackModel !== undefined ? spec.fallbackModel : base.resolved.fallbackModel,
      permissionMode: spec.permissionMode !== undefined ? spec.permissionMode : base.resolved.permissionMode,
      effort: spec.effort !== undefined ? spec.effort : base.resolved.effort,
    },
    sources: {
      launcher: field(spec.launcher, inherit(base.sources.launcher), "profile", profileName),
      model: field(spec.model, inherit(base.sources.model), "profile", profileName),
      permissionMode: field(spec.permissionMode, inherit(base.sources.permissionMode), "profile", profileName),
      effort: field(spec.effort, inherit(base.sources.effort), "profile", profileName),
    },
  };
}

/** 展开一份 profile 到 ResolvedProfile。extends 单链继承（递归），循环引用抛错。
 *  缺省 launcher=""（fail-closed 由 validateProfiles 补），bare=false，auth=null。 */
export function resolveProfile(config: ProfilesConfig, profileName: string, _seen: Set<string> = new Set()): ResolvedProfile {
  return resolveProfileTracked(config, profileName, _seen).resolved;
}

// ── role 解析（kind → profile + 差异 + 主备回退）────────────────────────────────────────────────
/** 把语义 kind 解析成 ResolvedRole。role 引用 profile，只叠加自己声明的差异（model/env/unset/bare）。
 *  主备回退：最终 model 不可用（opts.modelAvailable 判假）且有 fallbackModel ⇒ 降级到 fallbackModel。 */
export function resolveRole(config: ProfilesConfig, roleName: string, opts: ResolveOptions = {}): ResolvedRole {
  return resolveRoleTracked(config, roleName, opts).resolved;
}

/** resolveRole + 来源层（同一次 walk 的两个投影，⛔ 不是两次解析）。 */
interface TrackedRole {
  resolved: ResolvedRole;
  provenance: RoleProvenance;
}

function resolveRoleTracked(config: ProfilesConfig, roleName: string, opts: ResolveOptions = {}): TrackedRole {
  const roles = config.roles ?? {};
  const role = roles[roleName];
  if (!role) throw new Error(`role not found: "${roleName}"`);
  const p = resolveProfileTracked(config, role.profile);

  const env = applyUnset(mergeEnv(p.resolved.env, role.env ?? {}), role.unset ?? []);
  let model = role.model !== undefined ? role.model : p.resolved.model;
  const bare = role.bare !== undefined ? role.bare : p.resolved.bare;
  const fallbackModel = p.resolved.fallbackModel;

  // 角色层声明 ⇒ source="role"；否则沿用 profile 层的来源（含 extends/default）。
  // ⚠️ `launcher` **不是** RoleSpec 字段（只有 profile 有）⇒ 它的来源永远来自 profile 层，
  //    ⛔ 不在这里伪造一个 role 层分支。
  const sources = {
    launcher: { ...p.sources.launcher },
    model: field(role.model, p.sources.model, "role", roleName),
    permissionMode: field(role.permissionMode, p.sources.permissionMode, "role", roleName),
    effort: field(role.effort, p.sources.effort, "role", roleName),
  };

  // AC1 主备回退：primary model 不可用 ⇒ fallbackModel。
  // ⛔ 回退发生时 model 的【来源层】也必须改写成 "fallback" —— 该值不是任何一层「声明」的最终值，
  //   继续报声明它的那一层就是在 provenance 里撒谎（硬规则 3b）。
  const available = opts.modelAvailable ?? (() => true);
  if (model !== null && fallbackModel !== null && !available(model)) {
    model = fallbackModel;
    sources.model = { value: fallbackModel, source: "fallback", via: sources.model.via };
  }

  const permissionMode = role.permissionMode !== undefined ? role.permissionMode : p.resolved.permissionMode;
  const effort = role.effort !== undefined ? role.effort : p.resolved.effort;
  const resolved: ResolvedRole = {
    launcher: p.resolved.launcher,
    model,
    bare,
    auth: p.resolved.auth,
    env,
    fallbackModel,
    permissionMode,
    effort,
    name: role.name ?? roleName,
    // 角色层字段：⛔ 不读 profile（shared worker-default 上的黑名单会连坐 outer）。
    mcpBlacklist: role.mcpBlacklist ?? [],
  };
  return {
    resolved,
    provenance: {
      role: roleName,
      profile: role.profile,
      fields: {
        launcher: sources.launcher,
        model: sources.model,
        permissionMode: sources.permissionMode,
        effort: sources.effort,
      },
    },
  };
}

/** 只读 provenance（AC4 的「覆盖来源」面）：role → 四个字段各自的 (值, 哪一层, 点名)。
 *  ⛔ 与 `resolveRole` 共用同一次 walk（`resolveRoleTracked`）⇒ 记录里的值与来源不可能互相矛盾。
 *  调用方拿它落进 worker 的落地记录；本模块**不**碰任何载体（纯函数，可单测）。 */
export function readRoleProvenance(config: ProfilesConfig, roleName: string, opts: ResolveOptions = {}): RoleProvenance {
  return resolveRoleTracked(config, roleName, opts).provenance;
}

// ── 加载校验（AC2：bare 与 auth 不相容在加载时被拒，⛔ 非 spawn 后才知道）───────────────────────

/** 封闭枚举校验的**单一实现**（permissionMode/effort × profile 层/role 层共用，⛔ 不写四份）。
 *  返回 [] 表示合格；否则一条人读的 error（含**被拒的原值**，让作者知道该改什么）。
 *
 *  🔴 `permissionMode` 的**不扩大授权**语义（AC2）。当前整树唯一被授权的 defaultMode 是
 *  `bypassPermissions`（`.claude/launch.settings.json` 的 `permissions.defaultMode`），它是
 *  `claude --help` 六个取值里**最宽**的一个（「跳过全部确认」）⇒ 今天不存在一个结构上「更宽」的值，
 *  所以本函数**不需要一个宽度序**。它真正的防御是**封**：CLI 未来新增第 7 个取值（很可能就是某个
 *  比 `bypassPermissions` 更放得开的东西）时，本枚举**不认识它** ⇒ 默认拒绝，⛔ 不是等到有人把它
 *  写进 profiles.yml 才发现「框架替人放大了权限」。
 *  ⇒ 判据**能取假**：拿一个真实存在但越界的合成串（如 `"yolo"` / `"turbo"`）声明进去必须被拒——
 *    「封闭」与「枚举恰好覆盖当前 CLI 全部取值」是两件事，后者今天为真，前者才是不扩大授权的保证。 */
function closedSetError(
  layer: "profile" | "role",
  name: string,
  fieldName: string,
  value: unknown,
  allowed: readonly string[],
): string[] {
  if (typeof value === "string" && allowed.includes(value)) return [];
  return [
    `${layer} "${name}": ${fieldName} must be one of ${allowed.map((v) => `"${v}"`).join(" | ")}, got ${JSON.stringify(value)} — ` +
      `closed enum (a value the CLI may add later is REJECTED by default, ⛔ not "looks fine, let it through")`,
  ];
}
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
    // permissionMode / effort：**封闭枚举**，表外的一切字符串一律拒（⛔ 不是「看起来像就放过」）。
    if (p.permissionMode !== undefined) {
      errors.push(...closedSetError("profile", name, "permissionMode", p.permissionMode, PERMISSION_MODES));
    }
    if (p.effort !== undefined) {
      errors.push(...closedSetError("profile", name, "effort", p.effort, EFFORT_LEVELS));
    }
    // mcpBlacklist 是【角色层】字段：挂到共享 profile 上会把同 profile 的别的 role 连坐
    // （worker-default 被 outer 与三个 worker role 共享；outer 按 ADR-010 可能真需要浏览器工具）。
    // schema 封闭 ⇒ 位置性错误在加载时被拒，⛔ 不是靠 review。下一条 assert 让 TS 也拒绝这个写法。
    if ("mcpBlacklist" in (p as Record<string, unknown>)) {
      errors.push(
        `profile "${name}": mcpBlacklist is a ROLE-level field — putting it on a shared profile would blacklist MCP servers for every role sharing it (e.g. outer on worker-default)`
      );
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
    // 角色层 mcpBlacklist：必须是字符串数组（封闭 schema；读不懂 ⇒ 拒，⛔ 不当空数组放过）。
    if (r.mcpBlacklist !== undefined) {
      if (!Array.isArray(r.mcpBlacklist) || r.mcpBlacklist.some((s) => typeof s !== "string" || s.trim() === "")) {
        errors.push(`role "${name}": mcpBlacklist must be a non-empty-string array, got ${JSON.stringify(r.mcpBlacklist)}`);
      }
    }
    // 角色层 permissionMode / effort：同一个封闭枚举（⛔ 两个层级共用一份校验，不各写一遍）。
    if (r.permissionMode !== undefined) {
      errors.push(...closedSetError("role", name, "permissionMode", r.permissionMode, PERMISSION_MODES));
    }
    if (r.effort !== undefined) {
      errors.push(...closedSetError("role", name, "effort", r.effort, EFFORT_LEVELS));
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
