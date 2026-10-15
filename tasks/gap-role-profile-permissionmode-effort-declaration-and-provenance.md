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

- [x] AC1: `ProfileSpec`/`RoleSpec` 新增 `permissionMode`/`effort` 两个可选字段，封闭枚举值**在实现时重新核对一次
  `claude --help` 的真实 choices**（粘贴核对结果——不信本任务 Proposal 里抄的那份，CLI 可能已变化），
  `resolveProfile`/`resolveRole` 正确继承展开（粘贴一个角色层覆盖 profile 层默认值的解析结果）。

  **实现时重核（2026-10-15，不信本任务静态抄录）**：`claude --help` ⇒
  `--effort <level>  Effort level for the current session (low, medium, high, xhigh, max)`；
  `--permission-mode <mode>  Permission mode to use for the session (choices: "acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan")`。
  与 Proposal 抄录**逐字一致**（无 CLI 漂移）。另有**独立第二次核对**：经 `claude-fjdac` 喂越界值，claude 自己
  回显允许集——`--effort boguslevel` ⇒ `Valid values: low, medium, high, xhigh, max`；
  `--permission-mode bogusmode` ⇒ `Allowed choices are acceptEdits, auto, bypassPermissions, manual, dontAsk, plan`。
  落进代码的常量（实测读数）：`PERMISSION_MODES = ["acceptEdits","auto","bypassPermissions","manual","dontAsk","plan"]`、
  `EFFORT_LEVELS = ["low","medium","high","xhigh","max"]`。

  **继承展开（合成配置，角色层覆盖 profile 层默认值）**：profile `w` 默认 `permissionMode: plan` / `effort: low`，
  role `r` 只声明 `permissionMode: manual` ⇒ 解析结果
  `{"permissionMode":"manual","effort":"low"}`（角色层赢、未声明的 effort 继续继承）；
  provenance ⇒ `permissionMode {value:"manual", source:"role", via:"r"}`、
  `effort {value:"low", source:"profile", via:"w"}`。
  真 dev-tree carrier 读数：`resolveRole("task-worker")` ⇒ `{"launcher":"claude-fjdac","model":"v4.1flash-anthropic","permissionMode":"bypassPermissions","effort":"high"}`，
  四个字段的 `source` 均为 `profile` / `via: "worker-default"`。
- [x] AC2: `validateProfiles` 对枚举外的值 fail-closed 拒绝（粘贴一条伪造的越界值被拒绝的错误消息），
  对声明「比当前已授权 `bypassPermissions` 更宽」的值的处理有明确记录（即便 6 个真实值里没有真正更宽的，
  也要写出"若 CLI 未来新增第 7 个值,封闭枚举会拒绝它"这条防御实际生效——用一个合成的越界字符串而非
  真实存在的值做负控制）。

  **伪造越界值被拒（真实错误消息）**：
  ```
  role "bogusRole": permissionMode must be one of "acceptEdits" | "auto" | "bypassPermissions" | "manual" | "dontAsk" | "plan", got "yolo" — closed enum (a value the CLI may add later is REJECTED by default, ⛔ not "looks fine, let it through")
  role "bogusRole": effort must be one of "low" | "medium" | "high" | "xhigh" | "max", got "turbo" — closed enum (a value the CLI may add later is REJECTED by default, ⛔ not "looks fine, let it through")
  ```
  profile 层同样被拒（`profile "w": permissionMode …`），两层共用一份 `closedSetError`（⛔ 不写四份）。

  **「不扩大授权」的明确记录**：当前整树唯一被授权的 defaultMode 是 `bypassPermissions`，它已是
  `claude --help` 六个取值里**最宽**的一个（跳过全部确认）⇒ 今天不存在结构上「更宽」的值，故**不需要宽度序**；
  这条校验真正的防御是**封**。负控制用**合成的越界串**（`"yolo"` / `"turbo"` / `"unrestricted"` /
  `"BYPASSPERMISSIONS"` / `"high "`），即「CLI 未来新增的第 7 个（可能更宽的）取值」的同形物 ⇒ 一律被拒。
  这一条**能取假**：若校验退化成「看起来像模式名就放过」，负控制立刻红。正向控制同时钉住
  「6 个真实 + 5 个 effort 取值**全部**通过」（否则「封闭」会变成误拒）。

  **实测补强（使这条闸承重，而非装饰）**：`--effort` 拼错时 CLI **不 fail-closed** ——
  `claude-fjdac -p hi --effort boguslevel` ⇒ `Warning: Unknown --effort value 'boguslevel' — ignoring it and
  using the default effort.` 且 **exit 0**；对照 `--permission-mode bogusmode` ⇒ `error: … is invalid` + **exit 1**。
  即 effort 的静默降级只由框架侧封闭枚举拦住（两个标志失败形态不同，故两者都必须有框架校验）。
- [x] AC3: `launchArgv` 对声明了 `permissionMode`/`effort` 的角色正确追加 `--permission-mode <v>`/`--effort <v>`
  （粘贴真实 argv），对该 launcher 实测不转发该标志的情况有显式诊断路径而非静默假设生效（粘贴 claude-fjdac
  是否转发两个新标志的实测结果，无论结果是哪一种）。

  **真实 argv（配置路径 `launchArgv`，本 dev-tree carrier）**：
  ```
  claude-fjdac --settings <…> --exclude-dynamic-system-prompt-sections --prompt-suggestions false
    --model v4.1flash-anthropic --permission-mode bypassPermissions --effort high
    --strict-mcp-config --mcp-config <…> -n quay-task-worker -p "<prompt>" --session-id fa5423ed-…
  ```
  位置不变量：两个标志追加在 `-n <name> -p <prompt>` **之前** ⇒ prompt 恒是 argv 末元素（续做 prompt 依赖它）。
  **缺省负控制（DoD）**：未声明这两个字段的 role（实测 `manager`）⇒ argv **不含** `--permission-mode`/`--effort`，
  与改动前逐字一致。

  **claude-fjdac 是否转发的实测结果：转发**（两层证据）。
  ① 该 wrapper 末行为 `exec claude "$@"`（读 `/data/home/yale/.local/bin/claude-fjdac`），逐字透传；
  ② 负控制（经 wrapper 喂越界值，claude 自己回话 ⇒ 证明标志**真的到达**了 claude 二进制、不是被 wrapper 吞掉）：
  ```
  $ claude-fjdac -p hi --permission-mode bogusmode
  error: option '--permission-mode <mode>' argument 'bogusmode' is invalid. Allowed choices are acceptEdits, auto, bypassPermissions, manual, dontAsk, plan.     [exit 1]
  $ claude-fjdac -p hi --effort boguslevel
  Warning: Unknown --effort value 'boguslevel' — ignoring it and using the default effort. Valid values: low, medium, high, xhigh, max.                          [exit 0]
  ```

  **诊断路径（⛔ 非静默假设生效）**：`runEnvironmentSmoke` 经**同一个 `launchArgv`** 构造 argv ⇒ 一个不认这两个
  标志的 launcher 会把 "unknown option"/invalid 打在输出里，冒烟把原文粘进 `EnvironmentSmokeResult.output`
  （四态之一，⛔ 不与 `pass` 同形）。**并已记录该冒烟抓不到的一类**：「effort 拼错」是 warn + 降级 + exit 0 ⇒
  冒烟报 `pass`；这类静默降级的唯一 fail-closed 闸是 `validateProfiles` 的封闭枚举。两处合用才覆盖全部失败形态。
- [x] AC4: Session/Action provenance 记录扩展落地——一条真实记录同时包含声明值、覆盖来源（哪一层决定了最终值）、
  真实 argv、该次会话 transcript 读出的真实 model 字段；**alias（启动标志里的 model 名）与真实模型
  （transcript 里的 model 名）分别可读、不被合并**（粘贴一条真实记录，两个字段值不同，比如
  `v4.1flash` 与 `deepseek-flash`）。

  **载体**：扩展 `.quay/worker-outcome.jsonl`（既有 worker 落地记录载体；`worker-driver.ts` 的 `runOneWorker`
  收尾时落 `provenance` 键，与 outcome 同一条记录 ⇒ 一次尝试的全部取证在同一行）。profile 解析失败 ⇒ 落
  `provenance_error`（⛔ 读不懂不得与「读到了」同形，也不得把收尾路径炸掉）。

  **一条真实记录（非 fixture：真 spawn `claude-fjdac` + 真 transcript 回读，2026-10-15）**：
  ```json
  {
    "role": "task-worker", "profile": "worker-default",
    "declared": {"launcher":"claude-fjdac","model":"v4.1flash-anthropic","permissionMode":"bypassPermissions","effort":"high"},
    "override_source": {"launcher":"profile","model":"profile","permissionMode":"profile","effort":"profile"},
    "override_via": {"launcher":"worker-default","model":"worker-default","permissionMode":"worker-default","effort":"worker-default"},
    "argv_source": "launchArgv",
    "argv": ["claude-fjdac","--settings","…","--model","v4.1flash-anthropic","--permission-mode","bypassPermissions","--effort","high","--strict-mcp-config","--mcp-config","…","-n","quay-task-worker","-p","Reply with exactly: ok","--session-id","fa5423ed-496e-481e-9065-1cbeeba12224"],
    "argv_prompt_elided_bytes": 0,
    "model_alias": "v4.1flash-anthropic",
    "model_real": "deepseek-flash",
    "model_real_from": {"transcript":"/data/home/yale/.claude/projects/-data-home-yale-work-quay-worktrees-gap-role-profile-permissionmode-effort-declaration-and-provenance/fa5423ed-496e-481e-9065-1cbeeba12224.jsonl","record_type":"assistant.message.model"},
    "model_real_unavailable": null
  }
  ```
  **两个 model 读数分列、值不同**：`model_alias = "v4.1flash-anthropic"`（argv 里的请求名）vs
  `model_real = "deepseek-flash"`（transcript `type:"assistant"` 记录的 `message.model` = 服务端实际返回的）
  ——⛔ 不合并。判定面刻意**不读** `type:"api-request"` 的 `params.model`（那正是 alias，拿它当「真实模型」是自证，
  硬规则 4）。读不到时 `model_real` 为 `null` 且 `model_real_unavailable` 给**可分辨原因**（⛔ 不是空串、
  ⛔ 不是被填成 alias 的值）。
  **CLI 参数层覆盖如实标注**：`--worker-cmd-exact` 覆盖时 `argv_source = "cli-exact"`，且 `model_alias = null`
  （⛔ 不回落到 `declared.model` 假装它被传了）。
  **argv 有界**：worker prompt 是一整份任务体（数十 KB），而该台账被多个消费者整文件读 ⇒ 只对**末元素**超 512B 时
  以 `<prompt:N bytes>` 占位**并记 N**（`argv_prompt_elided_bytes`），其余逐字保留（⛔ 非静默截断）。
- [x] AC5: shipped 模板（`plugin/.quay/profiles.yml`、`plugin/.claude/launch.settings.json`）里不出现
  `127.0.0.1:26510`/`v4.1flash` 等本机专属取值（grep 证据），新字段本身对任意项目都可配置而非被框架强制。

  **grep 证据（本任务改动后实测）**：
  ```
  --- plugin/.quay/profiles.yml ---        /127\.0\.0\.1/ -> 0   /26510/ -> 0   /v4\.1flash/ -> 0
  --- plugin/.claude/launch.settings.json ---  /127\.0\.0\.1/ -> 0   /26510/ -> 0   /v4\.1flash/ -> 0
  ```
  两份 shipped 模板**逐字未改**（`git status --porcelain` 对这两个文件无输出）；shipped carrier 里
  `permissionMode`/`effort` **零出现**（刻意不声明 ⇒ 消费者不声明就与改动前逐字一致）。
  **按位置判定（硬规则 2）**：`plugin/.quay/profiles.yml` 有一处 `claude-fjdac`，位于**既有的注释**里
  （「dev-tree 用 claude-fjdac + deepseek-v4-pro-anthropic，见根 .quay/profiles.yml」）——那是**指路文档**，
  ⛔ 不是声明值（本任务亦未改动该行）。测试因此判**解析后的 profile/role 取值**（`launcher == "claude"`、
  `model == null`、两字段 `undefined`），而非 grep 全文。
  **可配置而非强制**：两个字段在 `ProfileSpec`/`RoleSpec` 上均可选；dev-tree 根 `.quay/profiles.yml` 是第一个
  真实消费者（本任务显式声明，取值见 `override_via: worker-default`）。
  **注**：本任务**未**在 shipped 模板写任何文档注释——`packages/quay/src/init.ts` 的 `SHIPPED_PROFILES_TEMPLATE`
  与该文件由 `packages/quay/test/init.test.mjs` 强制逐字节相等，往一边加注释会同时要求改一个**不在本任务
  Touches 内**的产品文件；且把枚举表抄进第三处正是本仓明令避免的漂移源。字段正本留在 `profile-policy.ts`。
- [x] AC6: `quay-fleet` 项目在**它自己的任务板**（`/data/home/yale/work/quay-fleet/tasks/`，`fleet-*` 前缀)上
  有一条任务显式声明该项目自己选择 127.0.0.1:26510 + v4.1flash + permissionMode/effort 的 dev policy
  （本任务只负责核实该任务已创建并引用其 id，不在本任务里代为实现 quay-fleet 侧的落地——那是 quay-fleet
  自己的 worker/driver 的工作，遵循"peer-host 的落地不是本任务能单方面完成的动作"同类纪律）。

  **核实结果：该任务已存在**（本任务只核实并引用，⛔ 不代办 quay-fleet 侧落地）：
  - 路径：`/data/home/yale/work/quay-fleet/tasks/fleet-dev-policy-local-proxy-permissionmode-effort.md`（fleet 自己的板）
  - frontmatter：`id: fleet-dev-policy-local-proxy-permissionmode-effort`、`status: todo`、`labels: [gap]`、
    `depends_on: [gap-role-profile-permissionmode-effort-declaration-and-provenance]`（**引用本任务 id**）
  - 它显式声明了该项目自己选择的 dev policy：标题即「Fleet 项目显式 dev policy：本机代理 127.0.0.1:26510 +
    v4.1flash + permissionMode/effort（quay 框架新字段的首个第三方消费者）」；正文写明各角色默认开发路由走
    `http://127.0.0.1:26510/`、启动标志 `--model v4.1flash`，并明确「该字段**不会**被写死进任何 shipped 模板
    ——每个项目要用本机代理 dev 路由，必须在**自己的** `.quay/profiles.yml` 里显式声明」。
  - **反证它确是真空白**（非「已做只是没写文档」）：quay-fleet 自己的 `.quay/profiles.yml` 实测仍是裸机模板
    （`launcher: claude` / `model: null`，两处 profile 均如此），从未配置过本机代理路由。
- [x] AC7: 安全回归——`plugin/test/profile-policy.test.mjs` 现有 `bare`/`auth`/`mcpBlacklist` 校验用例全部仍通过
  （粘贴测试输出，证明没有覆盖率被移除）。

  **既有用例逐条仍在原处、全部通过**（⛔ 只加新字段、未删弱化任何旧断言）：该文件 28 条原用例（含
  `AC2 — bare:true + auth:token rejected` / `bare:true + auth:key passes` / `auth undeclared also rejected (fail-closed)` /
  `unknown auth value rejected` / `mcpBlacklist on a PROFILE rejected` / `malformed role-level blacklist rejected` /
  `bare/auth/mcpBlacklist` 三组 SHIPPED 用例）→ 加 13 条新用例后共 41 条，实测：
  ```
  ℹ tests 41   ℹ pass 41   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0
  ```
- [x] AC8: 真实启动验收——至少一次真实 spawn 携带新字段，粘贴其 argv 和 provenance 记录（非 fixture-only）。

  **真实 spawn（非 fixture）**：走配置路径 `launchArgv("task-worker", …)` 构造 argv ⇒ 真 `claude-fjdac`
  （携带 `--permission-mode bypassPermissions --effort high`）⇒ 真会话 transcript 回读 ⇒ 经**生产写入器**
  `appendOutcomeToFile` 落进真载体 `<worktree>/.quay/worker-outcome.jsonl`。实测结果：
  ```
  status: 0   signal: null   wall_clock_ms: 4426        stdout: ok
  session_id: fa5423ed-496e-481e-9065-1cbeeba12224
  model_alias: v4.1flash-anthropic   model_real: deepseek-flash
  ```
  argv 与 provenance 记录全文见 AC3 / AC4 两处的粘贴（同一次 spawn）。prompt 用的是 driver 自己在起循环前做环境
  冒烟的同一条最小 prompt（`ENVIRONMENT_SMOKE_PROMPT` = "Reply with exactly: ok"），已知不触发工具调用，
  故 `bypassPermissions` 模式下也安全。
- [x] AC9: `scripts/test.sh --for-task <this task>` 绿；预算上限（`.quay/config.yml` 等）未被本任务改动。

  **scoped gate 绿**：`bash scripts/test.sh --for-task gap-role-profile-permissionmode-effort-declaration-and-provenance --allow-thin`
  ⇒ `exit 0`，`ℹ tests 198  ℹ pass 198  ℹ fail 0`，且 change-relevant 静态层全 PASS
  （含 `import-graph-check`: `valueSccs=0 ≤ 0, typeSccs=0 ≤ 0, reverseEdges=0 ≤ 0`、
  `profiles-role-coverage-check`、`enum-surface-parity-check`、`touches-one-entry-one-path-check` 等，全表无一条 FAIL）。
  **防漂移**：`anti-drift-touches-check --merge-target develop` ⇒
  `ANTI-DRIFT OK — 6 actual file(s), all within declared Touches (10 glob(s))`，exit 0。
  **预算未动**：本任务相对 `develop` 只改 6 个文件（`.quay/profiles.yml` + `plugin/scripts/{profile-policy,driver-runtime,worker-driver}.ts`
  + `plugin/test/{profile-policy,worker-driver-fan-in-s02}.test.mjs`），`.quay/config.yml` 及任何 budget/cap/concurrency
  声明**零改动**；`.quay/profiles.yml` 的改动**仅是新增两个字段 + 注释**（无既有键被改）。

  **第 6 个文件（`plugin/test/worker-driver-fan-in-s02.test.mjs`，Touches 扩宽的由来）**：
  该文件 AC1 把「循环体构造 worker argv」的那次调用**逐字钉死在一个拼法**上
  （`await workerArgvForTaskAsync(sel.task, rootDir, workerCmdOpts)`）。本任务把循环体的调用点换成**同一实现的**
  `workerArgvForTaskWithSourceAsync` 变体（多带回 AC4 需要的覆盖来源）⇒ 该断言变红。
  修法是**钉性质、不钉拼法**（循环体 await 的是异步 argv 构造；两个异步变体都必须存在），⛔ 不是放宽判据：
  同步 `workerArgvForTask` 的 `doesNotMatch` 负控制逐字保留。
  按位置判定（硬规则 2）：`grep -rn workerArgvForTask plugin/test/ packages/*/test/` 的命中里**只有这一个文件**
  钉了拼法（硬规则 5b 兄弟实例数 = 1，已逐条核对）；扩宽 Touches 后 scoped gate 重新选中该文件的 10 条用例
  **全绿**（`188 → 198` 的来源），且这正是「扩宽 Touches 会重选 checker、新红必属自己」那条纪律的对照面——
  本次新选中的只有这一条已知红，已修。

  **⛔ 全套件（fan-in 的 suite 步）另有一条与【本任务 delta 无关】的红，已定位并给出去处**：
  `plugin/test/full-suite-runner-cgroup.test.mjs` 的 AC3 断言「真实 round 的实测并发 < 128（请求 lane 数）」。
  **不是本任务的缺陷**（三条独立证据）：① 该测试文件与 `plugin/scripts/full-suite-runner.ts` 相对 `develop`
  **逐字节未改**（`git diff --stat develop...HEAD --` 对两者均空）；② 本任务自己的 round
  （`mfi-gap-role-profile-…-1792030898206-0eaf7e`，laneCount 32/48/64/127）实测重叠**一律 64**，正是该断言要求的值；
  ③ 把**另一行**排除后该窗口读数从 128 落回 64 ⇒ 断言会通过。那另一行是
  `runId=mfi-gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls-1792002203760-5f2304`
  （该任务 `status: needs-human`），`laneCount=32` 却实测重叠 128，即那次 OOM 恢复轮自己记录的读数。
  ⇒ 判词两条：**另一个任务的 round 记录落进了本 worktree 的 `.quay/verification-round.jsonl`**，且
  **AC3 的 last-5 窗口不按 `runId`/`scope` 过滤**。两条都在本任务 `## Touches` 之外，⛔ 本任务不改该测试或 runner
  （改它等于拿数据凑判据，且是别人的范围）。

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
- plugin/test/worker-driver-fan-in-s02.test.mjs

## Blocker

**2026-10-15T02:43:18.608Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (3) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：55f4a8f5-7040-4e04-9a93-00dcfb63496e
