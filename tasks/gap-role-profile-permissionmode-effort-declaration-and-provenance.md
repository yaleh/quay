---
id: gap-role-profile-permissionmode-effort-declaration-and-provenance
title: Role/profile 声明式 model/launcher/permissionMode/effort + Session
  provenance（alias vs 真实 model），Fleet 项目显式 dev policy
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
depends_on:
  - gap-ac154-claude-code-profile-extraction
  - gap-profile-policy-when-which-profile
  - gap-ac140-llm-command-configurable
---
## Proposal

**人 2026-10-15 批准**：Quay 各 Agent 角色（driver+selector+task / fix-worker+judge / meta-driver）在开发中显式声明
`model, launcher, permissionMode, effort`；默认 dev 路由为本机代理 `127.0.0.1:26510`，启动 `--model v4.1flash`（该代理把
它映射到底层真实模型，会话 transcript 记录的真实 model 是 `deepseek-flash` —— alias 与真实模型不是一回事）。

**查重结果（先读完才立案，避免重复已完成的基础设施）**：`plugin/scripts/profile-policy.ts` 的 `ProfileSpec`/`RoleSpec`
已是封闭 schema（`gap-ac154-claude-code-profile-extraction` done），已有 L2 policy（主备回退/加载校验/继承去重，
`gap-profile-policy-when-which-profile` done），已有可配 wrapper+model 按 role（`gap-ac140-llm-command-configurable`
done）。**但逐字段核对（`plugin/scripts/profile-policy.ts:32-56`）确认 `permissionMode` 和 `effort` 两个字段【都不存在】**——
当前 `.claude/launch.settings.json` 把 `permissions.defaultMode` 写成全局硬编码 `"bypassPermissions"`（`.claude/launch.settings.json:3`），
不按角色区分，也不经 profiles.yml 声明；`effort` 在 profiles.yml / RoleSpec / launchArgv 里完全未出现。

**CLI 能力已存在，只是没被框架消费**（`claude --help` 实测）：
```
--effort <level>              Effort level for the current session (low, medium, high, xhigh, max)
--permission-mode <mode>      Permission mode to use for the session
                               (choices: "acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan")
```
两个标志都已被安装的 Claude Code 二进制原生支持，`launchArgv`（`plugin/scripts/driver-runtime.ts:2176`）目前只拼
`--settings/--model/--bare/-n/-p`，从不追加这两个标志。

**Session/Action provenance 现状确认为空**：`.quay/worker-outcome.jsonl` 的全部字段（实测一条真实记录的键集）
里没有 model/launcher/permissionMode/effort/声明值/覆盖来源 任何一项，也没有「实际 transcript 里的真实 model
名」——只有 `session_id`，要外部关联才能查。Alias（启动标志 `v4.1flash`）与真实模型（transcript 里的
`deepseek-flash`）目前无任何载体同时记录两者并区分。

**跨项目现状确认（非假设）**：`/data/home/yale/work/quay-fleet` 是独立项目（自己的 `.quay/config.yml`、自己的
`tasks/fleet-*.md` 任务板）。其 `.quay/profiles.yml` 目前是**裸机通用 shipped 回退模板的逐字拷贝**
（`launcher: claude, model: null, auth: key`，无任何本机代理/model 覆盖）——它从未得到过 dev-proxy 路由声明，
这正是用户要求「在 Fleet 项目显式设定该 dev policy」的真实空白，不是已经做了只是没写文档。

**shipped 模板现状确认（证明「不写死全局」这条已经是现有纪律，只需延续，不是新发明）**：
`plugin/.quay/profiles.yml`（裸机 fallback carrier）本就是 `launcher: claude, model: null`，与 dev-tree 根
`.quay/profiles.yml`（`launcher: claude-fjdac, model: v4.1flash-anthropic`）结构一致、取值不同——本机代理地址
**不出现**在 shipped carrier 里，只出现在本 dev-tree 自己的 `.quay/profiles.yml` 注释与 `worker-default.env` 的
推导上下文中。新字段必须延续这个分层，不得把 `127.0.0.1:26510` 写进 `plugin/.quay/profiles.yml`。

## Plan

1. **Schema 扩展**（`plugin/scripts/profile-policy.ts`）：`ProfileSpec`/`RoleSpec` 加两个可选字段：
   - `permissionMode?: "acceptEdits" | "auto" | "bypassPermissions" | "manual" | "dontAsk" | "plan"`
     ——封闭枚举，逐字对齐 `claude --help` 真实 choices（实现时重新核对一次，不信本任务写的这份静态抄录——
     CLI 版本可能已经变化）。
   - `effort?: "low" | "medium" | "high" | "xhigh" | "max"` ——同理，封闭枚举，实现时重新核对。
2. **`resolveProfile`/`resolveRole` 继承展开**：两个新字段按现有字段的继承规则（`spec.x !== undefined ? spec.x : base.x`）
   纳入 `ResolvedProfile`/`ResolvedRole`。
3. **`validateProfiles` 两条新校验**（AC2/AC3 的落点）：
   - 封闭集校验：声明值不在上述枚举 ⇒ `errors.push(...)`（同现有 `auth` 校验手法，不静默吞）。
   - **permissionMode 不扩大现有授权**：当前整树唯一被授权的 defaultMode 是 `bypassPermissions`
     （`.claude/launch.settings.json` 的现状）。新字段允许角色声明**比它更收紧**的模式（如 `plan`/`manual`），
     但不允许声明一个会议定义为"比 bypassPermissions 更宽"的模式——由于当前 CLI 的 6 个值里没有一个结构上
     比 bypassPermissions 更宽（它已是最宽的"跳过确认"态），这条校验的真正作用是**防未来 CLI 新增第 7 个
     更宽值时的默认拒绝**：枚举表之外的任何字符串一律拒，不是"看起来像"就放过。
4. **`launchArgv` 追加两个标志**：`resolved.permissionMode` 非空 ⇒ 追加 `--permission-mode <value>`；
   `resolved.effort` 非空 ⇒ 追加 `--effort <value>`。**对不支持该标志的 launcher（如本机代理/wrapper 若实测不
   转发该参数）要安全处理**——实现时实测 `claude-fjdac` 是否转发这两个新标志给底层代理；若不转发，
   `launchArgv` 仍然追加标志（标志面向 `claude` 二进制本身，不面向代理），但要留一条诊断路径（如
   `runEnvironmentSmoke` 的四态冒烟之一)供后续角色发现"声明了但代理忽略"这类静默降级，而不是假设它一定生效。
5. **Session/Action provenance 记录**（新诉求，现有载体都不覆盖）：扩展既有的 worker 落地记录载体
   （`.quay/worker-outcome.jsonl`，`plugin/scripts/driver-runtime.ts`/`worker-driver.ts` 写入点）或新增一个专用
   provenance 记录，字段至少包含：
   - 声明值（本次 resolveRole 解析出的 model/launcher/permissionMode/effort）
   - 覆盖来源（profile 层 / role 层 / CLI 参数层——哪一层最终决定了这个值，不是单纯把最终值记下来）
   - 实际传给子进程的完整 argv（已有 `--model`/`--permission-mode`/`--effort` 等真实拼出的那一份，不是推导值）
   - 该次会话 transcript 里**读到的真实 model 字段**（经该 session jsonl 本身解析，不是 argv 里的名字）
   - 上面两个 model 读数**分别留痕**（alias vs 真实），不得合并成一个字段——这是用户点名要求的核心区分。
6. **跨项目可配置，不写死全局策略**：
   - 新字段只进 schema/校验/launchArgv（`plugin/scripts/*.ts`），**不在任何 shipped 模板
     （`plugin/.quay/profiles.yml`、`plugin/.claude/launch.settings.json`）里写入 `127.0.0.1:26510`/`v4.1flash`
     这类本机 dev 专属取值**——那些只能活在各项目自己的 `.quay/profiles.yml`。
   - 本 dev-tree 自己的根 `.quay/profiles.yml` 按需补充 `permissionMode`/`effort` 的显式声明（而非隐式继承
     `.claude/launch.settings.json` 的全局硬编码），作为第一个真实消费者验证新字段可用。
7. **Fleet 项目显式 dev policy（独立任务，Fleet 自己的任务板，本任务只引用不代办）**：
   `quay-fleet` 的 `.quay/profiles.yml` 当前是裸机模板逐字拷贝——需要 quay-fleet 自己立一个任务
   （在 `/data/home/yale/work/quay-fleet` 的任务板上，`fleet-*` 前缀），显式把本机代理
   `127.0.0.1:26510` + `v4.1flash` + 合适的 `permissionMode`/`effort` 写进它自己的 `.quay/profiles.yml`，
   作为该项目自己选择的 dev policy，而不是从 quay dev-tree 继承或被框架强推。
8. **安全回归**：新增/复用 `plugin/test/profile-policy.test.mjs` 的用例，证明现有 `bare`/`auth`/`mcpBlacklist`
   校验（AC1/AC2/AC3 of the already-done profile-policy 任务）在加了两个新字段后仍然逐字生效（不是只测新字段、
   放过回归）。
9. **真实启动验收**：至少一次真实 `claude`/`claude-fjdac` spawn 携带新声明的 `permissionMode`/`effort`，
   粘贴其真实 argv 与真实 provenance 记录（不是 fixture-only）。

## Acceptance Criteria

- [ ] AC1: `ProfileSpec`/`RoleSpec` 新增 `permissionMode`/`effort` 两个可选字段，封闭枚举值**在实现时重新核对一次
  `claude --help` 的真实 choices**（粘贴核对结果——不信本任务 Proposal 里抄的那份，CLI 可能已变化），
  `resolveProfile`/`resolveRole` 正确继承展开（粘贴一个角色层覆盖 profile 层默认值的解析结果）。
- [ ] AC2: `validateProfiles` 对枚举外的值 fail-closed 拒绝（粘贴一条伪造的越界值被拒绝的错误消息），
  对声明「比当前已授权 `bypassPermissions` 更宽」的值的处理有明确记录（即便 6 个真实值里没有真正更宽的，
  也要写出"若 CLI 未来新增第 7 个值,封闭枚举会拒绝它"这条防御实际生效——用一个合成的越界字符串而非
  真实存在的值做负控制）。
- [ ] AC3: `launchArgv` 对声明了 `permissionMode`/`effort` 的角色正确追加 `--permission-mode <v>`/`--effort <v>`
  （粘贴真实 argv），对该 launcher 实测不转发该标志的情况有显式诊断路径而非静默假设生效（粘贴 claude-fjdac
  是否转发两个新标志的实测结果，无论结果是哪一种）。
- [ ] AC4: Session/Action provenance 记录扩展落地——一条真实记录同时包含声明值、覆盖来源（哪一层决定了最终值）、
  真实 argv、该次会话 transcript 读出的真实 model 字段；**alias（启动标志里的 model 名）与真实模型
  （transcript 里的 model 名）分别可读、不被合并**（粘贴一条真实记录，两个字段值不同，比如
  `v4.1flash` 与 `deepseek-flash`）。
- [ ] AC5: shipped 模板（`plugin/.quay/profiles.yml`、`plugin/.claude/launch.settings.json`）里不出现
  `127.0.0.1:26510`/`v4.1flash` 等本机专属取值（grep 证据），新字段本身对任意项目都可配置而非被框架强制。
- [ ] AC6: `quay-fleet` 项目在**它自己的任务板**（`/data/home/yale/work/quay-fleet/tasks/`，`fleet-*` 前缀)上
  有一条任务显式声明该项目自己选择 127.0.0.1:26510 + v4.1flash + permissionMode/effort 的 dev policy
  （本任务只负责核实该任务已创建并引用其 id，不在本任务里代为实现 quay-fleet 侧的落地——那是 quay-fleet
  自己的 worker/driver 的工作，遵循"peer-host 的落地不是本任务能单方面完成的动作"同类纪律）。
- [ ] AC7: 安全回归——`plugin/test/profile-policy.test.mjs` 现有 `bare`/`auth`/`mcpBlacklist` 校验用例全部仍通过
  （粘贴测试输出，证明没有覆盖率被移除）。
- [ ] AC8: 真实启动验收——至少一次真实 spawn 携带新字段，粘贴其 argv 和 provenance 记录（非 fixture-only）。
- [ ] AC9: `scripts/test.sh --for-task <this task>` 绿；预算上限（`.quay/config.yml` 等）未被本任务改动。

## Definition of Done

- AC1-9 均带真实粘贴证据勾选。
- 未自动修改任何其它已有生产服务（如 `claude-fjdac` 本身、本机代理服务）的凭据；未在未经确认的情况下重启
  任何关键在飞会话（anchor/driver 若需要重启以生效新 schema，走本会话已建立的「人授权 + 现场核实 + 负控制
  确认」协议，不是自动重启）。
- `permissionMode`/`effort` 对任意第三方项目都是可选声明，缺省行为与改动前逐字一致（现有角色不声明这两个
  字段时，argv 不追加对应标志，`launch.settings.json` 的现有 `permissions.defaultMode` 继续生效）。

## Touches
- plugin/scripts/profile-policy.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/profile-policy.test.mjs
- plugin/scripts/worker-driver.ts
- .quay/worker-outcome.jsonl
- .quay/profiles.yml
- plugin/.quay/profiles.yml
- .claude/launch.settings.json
- plugin/.claude/launch.settings.json
