---
id: gap-worker-mcp-blacklist-strict-config
title: worker/fix-worker/selector 按黑名单排除 chrome-devtools/playwright 等重量级 MCP server
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

`quay-task-worker`/`fleet-task-worker`/`fix-worker`/`selector` 这几个纯写代码的角色，用普通 `claude -p` 派发时会**无条件连接全部已配置的 MCP server**，与任务是否需要浏览器测试无关。实测（本会话直接验证）：

- 一个纯 `echo`/`sleep` 的任务，一启动就会把 `chrome-devtools-mcp` 和 `@playwright/mcp` 的完整进程树拉起来（各自还带 npm exec 包装进程 + telemetry watchdog 子进程）。
- 生产环境实测：48 个 `chrome-devtools-mcp` + 12 个 `playwright-mcp` + 12 个 watchdog 子进程，合计约 3.24GB RSS，是当时内存压力的最大单一集中来源（2026-09-14 排查记录）。
- `chrome-devtools`/`playwright` 声明在**用户级** `~/.claude.json` 的 `mcpServers`（不是项目级 `.mcp.json`），所以 Claude Code 既有的 `disabledMcpjsonServers` 设置项对它们**不生效**（已实测：加了这个设置，两个 server 照样被 spawn）。

## Proposal

在 `.quay/profiles.yml` 的角色定义里新增 `mcpBlacklist`（字符串数组，server 名字）字段，仅给 `task-worker`/`fix-worker`/`selector` 设置 `[chrome-devtools, playwright]`；`outer`/`manager`/`pool-judge` 不设（`outer` 按 ADR-010 milestone e2e 可能真的需要浏览器工具，不能被连坐——即使它和 task-worker 共享 `worker-default` profile，`mcpBlacklist` 也必须挂在**角色**层，不能挂在共享 profile 层）。

派发时（`plugin/scripts/driver-runtime.ts` 的 `launchArgv`，唯一构造点），若解析出的角色带非空 `mcpBlacklist`：

1. **枚举当前实际配置了哪些 MCP server**——⛔ 不能用 `claude mcp list`（已实测：它会做存活健康检查，等于自己先把 chrome-devtools-mcp/playwright-mcp 起一遍去连接测试，完全背离目的）。必须直接读三类配置源文件：
   - 用户级：`~/.claude.json` → `.mcpServers`（已是绝对命令，无需展开变量）
   - 项目级：项目自己的 `.mcp.json` / `plugin/.mcp.json`（quay 自己那个 server 的声明含字面量 `${CLAUDE_PLUGIN_ROOT}`，用已有的 `resolveKernelPluginRoot()` 展开，不用猜）
   - 插件级：`~/.claude/settings.json` → `.enabledPlugins` 列出哪些插件启用了，再到 `~/.claude/plugins/cache/<marketplace>/<name>/<version>/.mcp.json` 找该插件自己的声明，字面量 `${CLAUDE_PLUGIN_ROOT}` 展开成探测到的那个 `<version>` 目录——**这个版本号目录会变**（本次排查中实测 meta-cc 的安装位置在同一会话内换过一次：从 `plugins/cache/meta-cc-marketplace/meta-cc/3.8.3/...` 变成 `~/.local/share/meta-cc/bin/meta-cc-mcp`），⛔ 不能写死版本号，必须每次现查（glob 版本目录）。
   - ⚠️ 如实登记覆盖边界：claude.ai 的 Gmail/Drive/Calendar 连接器不在 `~/.claude.json` 的 `.mcpServers` 里（是 Claude Code 原生托管的另一类东西），本枚举天然看不到、也管不到——这对 worker 场景是良性副作用，但设计上不能含糊地说"和 `claude mcp list` 看到的全集一致"。
2. 从枚举结果里减掉黑名单里的名字，把剩下的写成 `{"mcpServers": {...}}` 临时 JSON 文件。
3. argv 追加 `--strict-mcp-config --mcp-config <该临时文件路径>`。

**已实测验证可行的关键事实**（支撑这个方案能走通，不是纸上谈兵，2026-09-14）：

- `--strict-mcp-config --mcp-config <只含 quay/archguard/meta-cc 的 json>` → spawn 出的子进程列表里确实只有这三个，chrome-devtools/playwright 一个都不起。
- 同一份配置下真的调 `mcp__quay__task_list`，拿回真实数据（`total: 2049`）——功能没丢，不是配置对了但连不上。
- 直接把 archguard 的原始 `.mcp.json`（带字面量 `${CLAUDE_PLUGIN_ROOT}` 占位符）喂给 `--mcp-config` **会失败**（`CONNECTION_CLOSED: "Connection closed"`）——证实了必须由我们自己展开变量，不能指望 `--mcp-config` 帮忙展开插件专属变量。

## Plan

1. 新建纯函数模块（如 `plugin/scripts/mcp-blacklist-resolve.ts`）：输入一个"配置根目录集合"（可注入，测试用 fixture 覆盖，⛔ 不读真实 `~/.claude*`）+ 黑名单数组，输出解析好的 `{"mcpServers": {...}}` 对象（已排除黑名单、已展开全部字面量 `${CLAUDE_PLUGIN_ROOT}`）。任何一步读不到/解析不出，对应那个 server 直接跳过（不中断整体）；整体枚举失败 ⇒ 返回 `null`（调用方据此不加任何 flag，回退原样派发，⛔ 不阻塞 worker 派发——这是资源优化，不是正确性闸）。
2. `driver-runtime.ts` 依赖的 `profile-policy.ts`（`loadProfiles`/`resolveRole`）解析 schema 增加 `mcpBlacklist?: string[]` 字段（角色层，非 profile 层）。
3. `launchArgv` 在现有 argv 构造之后，若 `resolved.mcpBlacklist` 非空，调用上述解析模块；成功则把生成的 json 写入临时文件（如 `.quay/mcp-config-cache/<role>-<hash>.json`，可复用/覆盖）并追加 `--strict-mcp-config --mcp-config <path>`；解析失败（`null`）则不追加，argv 与现状一致。
4. `.quay/profiles.yml` 给 `task-worker`/`fix-worker`/`selector` 三个角色加 `mcpBlacklist: [chrome-devtools, playwright]`；`outer`/`manager`/`pool-judge` 不加。
5. 六个 driver 的 dist（`packages/quay/plugin/scripts/dist/*.js` 与顶层 `plugin/scripts/dist/*.js` 均要重建——参考 2026-09-14 排查记录中发现的坑："两处 dist 都要重建，且生产实际读的是 `packages/quay/plugin` 那份 staged 快照，只重建顶层 dist 不会生效"，避免重蹈覆辙）。

## Acceptance Criteria

- [x] AC1：`.quay/profiles.yml` 的 `task-worker`/`fix-worker`/`selector` 三个角色带 `mcpBlacklist: [chrome-devtools, playwright]`；`outer`/`manager`/`pool-judge` 不带。负控制：`resolveRole(config, "outer")` 的结果 `mcpBlacklist` 为空/undefined，且其生成的 argv 与改动前逐字一致（⛔ 不能被共享 profile 连坐）。
- [x] AC2：新解析模块对一个 fixture 化的"用户级 + 项目级 + 插件级"三源组合，正确合并出排除黑名单后的 `mcpServers` 对象，且插件级条目的字面量 `${CLAUDE_PLUGIN_ROOT}` 被正确展开成 fixture 里探测到的版本目录（不是原样保留占位符）。负控制：fixture 里插件版本目录改名/不存在时，该插件条目从结果中消失而不是抛异常，其余条目不受影响。
- [x] AC3：任一源文件不可读/格式非法时，返回 `null`（不是把该源当"没有这一类 server"处理导致部分结果冒充完整结果——沿用硬规则 3b：给"无法评估"一个独立取值，不与"合格"共用输出），调用方据此不追加任何 mcp 相关 flag。
- [x] AC4：**生产实测**（真实工作区，⛔ 非 fixture）——派发一个真实 `quay-task-worker`，`ps --ppid <该 worker pid>` 确认子进程列表**不含** `chrome-devtools-mcp`/`playwright`/`npm exec chrome-devtools-mcp`/`npm exec @playwright/mcp` 中任何一个；同一进程内让它真实调用 `mcp__quay__task_list`（或等价 quay MCP 工具）成功拿到数据，证明黑名单没有连坐掉 quay 自己。
- [x] AC5：同一次生产实测，验证 archguard/meta-cc 至少其一在该 worker 的会话里可用（真实工具调用成功，不是仅进程存在），证明"枚举+展开"链路对插件级 server 真的接上了，不是恰好因为解析失败而回退成"什么 mcp 相关 flag 都不加"这种和"没做"同形的假通过（硬规则 4 推论三）。
- [x] AC6：`outer` 角色的 spawn 行为（含实际会用到浏览器 MCP 的场景，若有现成回归测试）在改动前后逐字/逐行为不变。
- [x] AC7：新解析模块的单元测试全部走可注入的 fixture 根目录（环境变量或参数缝，仿照本仓库已有的 `WORKTREE_PROCESS_REAPER_PS_SOURCE` 手法），⛔ 任何测试不得读取真实 `~/.claude.json`/`~/.claude/settings.json`/`~/.claude/plugins/cache`。

## Evidence（2026-09-14，本分支实测）

### 实现
- 新纯模块 `plugin/scripts/mcp-blacklist-resolve.ts`：三源枚举（用户级 `~/.claude.json` 的 `.mcpServers` / 项目级 `<dir>/.mcp.json` / 插件级 `enabledPlugins` → 插件根 `.mcp.json`），插件根四条候选（kernel plugin root 名字匹配 / `installed_plugins.json` 的 installPath / cache 版本目录 glob / `known_marketplaces.json` installLocation），减去黑名单、展开字面量 `${CLAUDE_PLUGIN_ROOT}`，输出 `{"mcpServers":{...}}`。
- `driver-runtime.ts` 的 `launchArgv`（AC140 唯一 argv 构造点）在 `resolved.mcpBlacklist` 非空时追加 `--strict-mcp-config --mcp-config <inline json>`；解析不出 ⇒ 一个 flag 都不加。新增可选测试缝 `LaunchArgvOpts.mcpRoots`（`undefined` = 生产路径 / `null` = 显式「解析不出」，两态可区分）。
- `profile-policy.ts`：`RoleSpec.mcpBlacklist?: string[]` + `ResolvedRole.mcpBlacklist: string[]`；`validateProfiles` **拒绝**把它挂在 profile 层（位置性错误，加载即拒，⛔ 不靠 review）与形状非法值。
- **两份 carrier 都落地**：`.quay/profiles.yml`（dev-tree）与 `plugin/.quay/profiles.yml`（quay-init 逐字铺进消费者 `.quay/` 的那一份）。⛔ 只改一份正是 `profiles-role-coverage-check.ts` 存在的那个缺陷形状（「修了一份、init 铺的是另一份」曾经真的 ship 过一次）。两份都**不用 YAML 锚点**（该文件被 quay-launch.sh 的 python3+yaml 与 TS 两条路径读，保持既有朴素形状）。
- `capability-catalog.sh` 补 6 行声明（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER）——新脚本进 `plugin/scripts/` 的入口闸义务；`capability-catalog.sh --summary` → `322 scripts | 322 declared | 0 unclassified`（exit 0）。
- `plugin/.quay/profiles.yml` 是 closure-ratchet 的 `LAYDOWN_SOURCES` 之一 ⇒ 已按机制 `--reanchor` 重锚（`3 files / 1022 bytes`，fingerprint `08ae0dcb…`），`--gate` PASS（shrink-only holds）；`--check-stale` 归零。

### Plan 偏差（实现选择，非遗漏）
Plan 第 3 步写的是「写临时文件 `.quay/mcp-config-cache/<role>-<hash>.json`」，实现改为 **inline JSON**（`--mcp-config` 同时接受文件与字符串）。理由：落盘要额外处理 `.gitignore` 豁免（未豁免的 `.quay` 运行时文件曾让 fan-in-ff-merge 拒绝 ff）、`/tmp` 生命周期、以及按 role+hash 缓存在插件版本变化后指向过期的 `${CLAUDE_PLUGIN_ROOT}` —— inline 一次消掉这三种失效面。已由 AC4/AC5 的生产实测证明可行。

### AC1
- `plugin/test/profile-policy.test.mjs` 新增 6 条（该文件 28/28 绿）：三个 role 黑名单逐字相等；`outer`/`manager`/`pool-judge`/`meta-driver` 解析为**空数组**（**前提断言**：`outer` 与 `task-worker` 确实共享同一 profile —— 否则这条负控制是空转）；shipped carrier 同构；合成配置证伪（同 profile 下 selector 不继承）；`validateProfiles` 拒绝 profile 层放置与五种非法形状。
- 生产读数（真实 `.quay/profiles.yml`）：`launchArgv("outer",…)` 的 mcp flag 数 = **0**（argv len 12）；`launchArgv("task-worker",…)` 带 `--strict-mcp-config`。

### AC2 / AC3 / AC7
- `plugin/test/mcp-blacklist-resolve.test.mjs` **19/19 绿**：三源合并；两种插件 `.mcp.json` 形状（quay 扁平 / archguard `mcpServers` 包裹）；插件条目**全部展开**成探测到的版本目录；`~/.claude.json` 的 `projects`（会话史）不当事 server 表；`enabledPlugins:{x:false}` 不算启用；非匹配的 kernel plugin root 不泄漏其 server；版本目录被 **glob**（改名仍找得到）与**不可定位时该插件消失、其余不受影响**（并附「放回即回来」对照 —— 没有这一半，「消失」可能是「从来没接上」）。
- AC3：源文件**存在但非法** JSON ⇒ 整体 `ok:false` + `mcpConfigArgvSuffix → []`（修好后立刻回 `ok:true` 作对照）；**缺失 ≠ 读不懂**（缺失 ⇒ `ok:true` 空表）—— 两态可区分。
- 「黑名单覆盖全部已配 server」时仍发 `--strict-mcp-config --mcp-config {"mcpServers":{}}` —— ⛔ 回退成「不加 flag」会把「排除」变成「全连」。
- AC7：全部走注入的 fixture 根；其中一条把 `fs.readFileSync` 包成观察器，断言真实 `~/.claude*` **零命中**（机械证明，不是纪律）；并断言夹具确实被读了（否则「零命中」也可能是恒真空转）。

### AC4（生产实测）
真实 `quay-task-worker` 派发：`launchArgv("task-worker", <prompt>)` 的真 argv（真 launcher `claude-fjdac` + 真 `--settings` + 真 `--strict-mcp-config --mcp-config`），cwd = 本 worktree；后代进程由 `/proc` 的 ppid 图逐趟重建（⛔ 不用被测对象自己的报告）。

| 读数 | 黑名单生效 | 对照（剥掉 mcp flag = 改动前形态） |
|---|---|---|
| worker pid | 873965 | 1105110 |
| 采样次数（1.5s 一趟） | 30 | 28 |
| 后代命中 `chrome-devtools-mcp\|playwright` | **0** | **7** |
| 退出码 | 0 | 0 |

对照那 7 条含 playwright-mcp、chrome-devtools-mcp、两个 `sh -c` 包装、npx 包装，以及 telemetry watchdog（`--parent-pid=<chrome-devtools-mcp pid>`）—— 即缺陷的完整形态。
同一次运行内该 worker 真实调用 `mcp__plugin_quay_quay__task_list {"pageSize":1}` 返回**真实任务数据**（`ARCH-M103-001`，含 body 文本），证明黑名单没连坐掉 quay 自己。

### AC5（生产实测）
第二次派发（pid 1416509，11 趟采样，后代命中仍为 **0**）内：
- `mcp__plugin_archguard_archguard__archguard_summary {"projectRoot":"/home/yale/work/quay"}` → **真实数据** `{"entityCount":446,"relationCount":908,"topDependedOn":[…]}` —— 插件级 server 经我们展开的 `${CLAUDE_PLUGIN_ROOT}` 真的连上了。
- `mcp__plugin_meta-cc_meta-cc__get_session_directory {"scope":"session"}` → 真实 JSON（含该 worker 自己的 session 目录、`file_count`:1、时间窗）。
两者都是**工具真的答了话**，不是「配置对了但连不上」。
- 附加可核读数（枚举覆盖面）：从真实配置解析出的表里含 `plugin_meta-cc_meta-cc` → `/home/yale/.local/share/meta-cc/bin/meta-cc-mcp` —— 即 meta-cc 在本会话中**已经搬家**后的位置（经 `known_marketplaces.json` 的 `installLocation` 找到），正是「⛔ 不能写死版本号」那条的现实样本；另外两个是 `plugin_archguard_archguard`（cache 版本目录）与 `plugin_quay_quay`。

### AC6
- `plugin/test/driver-runtime.test.mjs` 新增 4 条（该文件 31/31 绿）：对 `outer`/`manager`/`pool-judge`/`meta-driver`，`launchArgv(role,…)` 与 `launchArgv(role,…,{mcpRoots:<含 5 个 server 的 fixture>})` **deepEqual** ⇒ 这些 role 的 argv 结构上**不依赖 MCP 配置**（若哪天黑名单被误挂共享 profile 或去掉 `length > 0` 守卫，这条立刻红）；且都不含 `--strict-mcp-config`/`--mcp-config`，`-n <name> -p <prompt>` 尾巴完好。
- 上表「对照」列同时是 AC6 的差分读数：改动前的 argv 形态**会**拉起浏览器 MCP（7 条），改动后为 0。

### dist（DoD）
- `node --experimental-strip-types packages/quay/scripts/build-plugin-dist.mjs` → `plugin/scripts/dist`（85 个 bundle）。
- 暂存 `cp -R plugin/. packages/quay/plugin/`（去 `test/`）后 `build-plugin-dist.mjs packages/quay/plugin` → `packages/quay/plugin/scripts/dist`（91 个 bundle）。
- 两处的 `driver-runtime.js` **均**含 `strict-mcp-config`（新模块被 esbuild 内联进该 entry，⛔ 无独立 bundle 条目 —— 入口集是扫描派生而非手维护清单）。
- 两处 dist 都在 `.gitignore` 内：`git status --porcelain packages/quay/plugin` 零输出。

### 覆盖边界（如实登记，⛔ 不含糊）
- 枚举**看不到**：claude.ai 的 Gmail/Drive/Calendar 连接器不在 `~/.claude.json` 的 `.mcpServers` 里（Claude Code 原生托管的另一类东西）。本模块**不声称**与 `claude mcp list` 看到的全集一致。
- 实测环境里 worker 的 stderr 有一条既存的 `claude.ai connectors are disabled because ANTHROPIC_API_KEY …` —— 那是 auth 面，⛔ 非本改动引入。

## Definition of Done

真正落地：改动合并进 `develop`，且 AC4/AC5 的生产实测读数取自 `develop` 权威分支代码跑出来的真实 worker 进程（⛔ 非 fixture、非手工临时起的对照进程）。`packages/quay/plugin/scripts/dist/*.js` 与顶层 `plugin/scripts/dist/*.js` 两处 dist 均已用改动后的源码重建。scoped 门 + 全量 `scripts/test.sh` 绿。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/profile-policy.ts
- plugin/scripts/mcp-blacklist-resolve.ts
- plugin/scripts/capability-catalog.sh
- plugin/test/mcp-blacklist-resolve.test.mjs
- plugin/test/driver-runtime.test.mjs
- plugin/test/profile-policy.test.mjs
- .quay/profiles.yml
- plugin/.quay/profiles.yml
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-worker-mcp-blacklist-strict-config.md
