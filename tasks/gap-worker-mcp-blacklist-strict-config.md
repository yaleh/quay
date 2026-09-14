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

- [ ] AC1：`.quay/profiles.yml` 的 `task-worker`/`fix-worker`/`selector` 三个角色带 `mcpBlacklist: [chrome-devtools, playwright]`；`outer`/`manager`/`pool-judge` 不带。负控制：`resolveRole(config, "outer")` 的结果 `mcpBlacklist` 为空/undefined，且其生成的 argv 与改动前逐字一致（⛔ 不能被共享 profile 连坐）。
- [ ] AC2：新解析模块对一个 fixture 化的"用户级 + 项目级 + 插件级"三源组合，正确合并出排除黑名单后的 `mcpServers` 对象，且插件级条目的字面量 `${CLAUDE_PLUGIN_ROOT}` 被正确展开成 fixture 里探测到的版本目录（不是原样保留占位符）。负控制：fixture 里插件版本目录改名/不存在时，该插件条目从结果中消失而不是抛异常，其余条目不受影响。
- [ ] AC3：任一源文件不可读/格式非法时，返回 `null`（不是把该源当"没有这一类 server"处理导致部分结果冒充完整结果——沿用硬规则 3b：给"无法评估"一个独立取值，不与"合格"共用输出），调用方据此不追加任何 mcp 相关 flag。
- [ ] AC4：**生产实测**（真实工作区，⛔ 非 fixture）——派发一个真实 `quay-task-worker`，`ps --ppid <该 worker pid>` 确认子进程列表**不含** `chrome-devtools-mcp`/`playwright`/`npm exec chrome-devtools-mcp`/`npm exec @playwright/mcp` 中任何一个；同一进程内让它真实调用 `mcp__quay__task_list`（或等价 quay MCP 工具）成功拿到数据，证明黑名单没有连坐掉 quay 自己。
- [ ] AC5：同一次生产实测，验证 archguard/meta-cc 至少其一在该 worker 的会话里可用（真实工具调用成功，不是仅进程存在），证明"枚举+展开"链路对插件级 server 真的接上了，不是恰好因为解析失败而回退成"什么 mcp 相关 flag 都不加"这种和"没做"同形的假通过（硬规则 4 推论三）。
- [ ] AC6：`outer` 角色的 spawn 行为（含实际会用到浏览器 MCP 的场景，若有现成回归测试）在改动前后逐字/逐行为不变。
- [ ] AC7：新解析模块的单元测试全部走可注入的 fixture 根目录（环境变量或参数缝，仿照本仓库已有的 `WORKTREE_PROCESS_REAPER_PS_SOURCE` 手法），⛔ 任何测试不得读取真实 `~/.claude.json`/`~/.claude/settings.json`/`~/.claude/plugins/cache`。

## Definition of Done

真正落地：改动合并进 `develop`，且 AC4/AC5 的生产实测读数取自 `develop` 权威分支代码跑出来的真实 worker 进程（⛔ 非 fixture、非手工临时起的对照进程）。`packages/quay/plugin/scripts/dist/*.js` 与顶层 `plugin/scripts/dist/*.js` 两处 dist 均已用改动后的源码重建。scoped 门 + 全量 `scripts/test.sh` 绿。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/profile-policy.ts
- plugin/scripts/mcp-blacklist-resolve.ts
- plugin/test/mcp-blacklist-resolve.test.mjs
- plugin/test/driver-runtime.test.mjs
- plugin/test/profile-policy.test.mjs
- .quay/profiles.yml
- tasks/gap-worker-mcp-blacklist-strict-config.md
