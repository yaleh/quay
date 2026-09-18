---
id: gap-quay-init-native-reconcile
title: quay-init 退役 shell 脚本，改 CLI/MCP 原生实现；/quay:init 语义从"存在即跳过"改为"reconcile
  到当前版本默认值"
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**触发案例**：quay-fleet 项目 dashboard 展示 landing-baseline 未接入/无数据 → 追出配置缺
`fork_baseline`/`merge_target` → 根因是 `plugin/scripts/quay-init.sh:645-704` 的
`ensure_loop_config()` 只更新 4 个固定 key（`repo_root`/`test_command`/`tmux_session`/
`worktree_root`），其余 `loop:` key 原样保留、绝不触碰；`fork_baseline: develop` 是三天后
（2026-08-11，`fe053af7`）才加进 fresh-install 模板的默认值，`ensure_loop_config` 从未被同步
纳入 ⇒ 任何在此之前 init 过、之后只靠这条升级路径维护的项目，这两个 key 永远补不上，无论重跑
多少次 `/quay:init`。quay-fleet 今天实测：重跑 `/quay:init` 后 `.quay/config.yml` mtime 完全
不变，证实了这一点。

**这不是一次性疏忽**：`ensure_provider_carrier_env()`（`:706-728`）是另一个只认 3 个 key 的独立
合并函数，branch model 建立又是第三套独立机制——每加一个新默认值，都要记得手工同步到某个专门
的合并函数，这个模式本身会持续复发同类遗漏。

**人在此基础上给出的三条原则（逐字，2026-09-18）**：
1. 面向用户的 quay 操作入口应优先 Claude Code 对话中易于使用的形态：mcp, skill。
2. 可以接受 quay plugin 升级后重跑 `/quay:init`，而不应期望用户手动运行 `quay-init.sh`。实际上，
   最好不要保留该 `.sh`，而直接在 mcp 中实现。`/quay:init` 的原则应当是保障项目设置符合该版本
   quay 运行的要求。已有的不兼容的设置应按照新版本的缺省值设置。
3. `/quay:init` 应当有足够好的鲁棒性，能够在配置文件不存在或错误的情况下执行。可以接受它用 quay
   cli 或 mcp —— 这也要求它们应当在配置文件不存在或错误的情况下执行（至少执行 init 动作）。

**已核实的现状事实**（正本背景文档：
`orchestration/SPEC-quay-init-reconcile-and-native-implementation-2026-09-18.md`，已在本地
develop，commit `516a5485c`；本任务不复制其内容，只引用）：
- `/quay:init` skill（`plugin/skills/init/SKILL.md:16-17`）完全靠 `bash` 调 `quay-init.sh`
  （2959 行），不经过 MCP；MCP 侧零个 init/setup/upgrade 类工具注册。
- `packages/quay/src/init.ts` + `cli/init.ts` 已有独立 TS 实现，但对"配置已存在"处理比 shell
  版本弱：`configExists`（`init.ts:513`）只是 `fs.existsSync`，不解析内容，"损坏"和"合法存在"
  完全等价；不带 `--force` 时都提示"already exists"（`cli/init.ts:208-215`），带 `--force` 时都
  被 `generateConfigContent` 盲目整份覆盖。
- MCP 侧 `startMcpServer()`（`mcp-server.ts:193-197`）有两处同步硬依赖（`loadConfig()` 无
  try/catch、`enabledProviderIds` 空检查），均排在任何工具注册（`McpServer` 构造于 `:218`，
  `registerAllHandlers` 于 `:259`）之前——配置缺失或语法损坏时整个 MCP server 连实例都不会被
  造出来，包括本该用来诊断问题的 `config_validate` 工具本身。`DIR-099-C` 曾裁定"故意不做启动期
  语义校验"，但那次讨论的前提是"语法合法、语义有问题"的配置，从未涉及"语法都解析不了"或"文件
  不存在"这两种更极端情况。
- 鸡生蛋问题已被现状代码绕开而非解决：`ensure_target_branch_model()`
  （`quay-init.sh:2782-2844`）判断分支模型时不经过 MCP 协议，而是直接 shell 出 vendored Node
  CLI 二进制（`node .../quay.js init --branch-model-only`）——证明"用 TS/Node 逻辑"和"必须先有
  MCP server"是两件事，可以解耦；但"纯 MCP"字面意义上，一个从零开始、没有 config.yml 的项目仍然
  无法只靠 MCP 完成 init。

**范围裁定（人 2026-09-18 明确同意）**：开一个 compound-eligible task 承接三个维度（载体/语义/
鲁棒性）；若落地时发现"CLI 化 + reconcile 语义"和"MCP 引导阶段重构"两块实现节奏、验收方式差异
确实很大，可在本任务下拆 children，或平行开 sibling task、互相 Touches 交叉标注；不升级为 GOAL
——已核实仓库 GOAL/AC 机制的先例（`GOAL-008` 五个平行 store kind、`GOAL-024` 十六个平行页面）都
是"多个本来就独立变化的平行对象各自需要一条机械判据"的形状，本任务是单一子系统（quay-init 配置
读写）的三个耦合侧面，按仓库其它架构类 SPEC（branching-model/plugin-lifecycle/
capability-planes/checker-mechanical-spine）的先例，都落地成了 gap-task 而非 goal。

## Plan

**维度 1（载体）**：退役 `quay-init.sh`，逻辑收进 `init.ts`/`cli/init.ts`；`/quay:init` skill
改调 vendored CLI（`node .../quay.js init ...`）而非 `bash quay-init.sh`。脚本里真正
shell-native 的部分（`detect_tmux_session` `:601-628`、TTY 交互确认 `:2680` 起、
`ensure_vendor_runtime` 自举 `:2028` 起）保留为极小 helper 或迁进 Node（`child_process`/
`process.stdin.isTTY`），不构成"必须留着整个 2959 行脚本"的理由——具体去留在实现阶段裁定并
记录理由。

**维度 2（语义）**：在一处（大概率是 `generateConfigContent` 所在处）定义"当前版本 `loop:`/
`providers:` 完整默认 schema"作为唯一正本。`configExists` 从二态（存在/不存在）改三态（不存在/
存在且可解析/存在但损坏）。reconcile 逻辑对已有配置做 diff：已有且未被标记废弃的 key 保留用户
值；schema 有但配置缺的 key 按当前默认值补上（直接吃掉 `fork_baseline`/`merge_target` 这类历史
遗留，用它作回归 fixture）；被标记为不兼容/废弃的 key 走显式迁移表。

**维度 3（鲁棒性）**：`startMcpServer()` 拆两阶段——无条件先注册引导类工具（至少 `init`，大概率
也该挪 `config_validate`），`loadConfig()` 链路失败时不再让整个进程退出，而是带降级状态继续跑；
MCP 侧 `init` 工具签名显式接收 root 参数，不依赖 `cfg.workspaceRoot`，内部复用 `init.ts` 里已经
与 `loadConfig` 解耦的 `runInit()` 逻辑（现成，不用重写）。

**范围边界（明确排除）**：quay-fleet 的具体展示症状已手工解决，不是本任务验收项；
`config_validate` 现有的语义校验能力（`DIR-099-C` 范围）不重新设计，只讨论它能不能在配置损坏/
缺失时也被注册上。

## Acceptance Criteria

- [ ] AC1（三态化）：`packages/quay/src/init.ts` 的 `configExists` 判断改为三态（absent/valid/
      corrupt），`packages/quay/test/init.test.mjs` 新增覆盖"配置文件内容为非法 YAML"场景的用例
      并全绿——机械检查：`node --test packages/quay/test/init.test.mjs` exit 0 且用例名可
      grep 到 "corrupt"/"malformed" 字样。
- [ ] AC2（reconcile 回归）：`/quay:init`（经 CLI）对已存在配置的处理从"跳过/整份覆盖"改为逐
      key diff-补默认值；新增回归 fixture 复现 fork_baseline/merge_target 历史缺陷场景（一个
      预先构造的、缺失这两个 key 的旧配置，跑 init 后断言两个 key 被补上且原有其它自定义 key
      不变）——机械检查：`node --test packages/quay/test/init.test.mjs
      --test-name-pattern reconcile`（或等价 pattern）exit 0。
- [ ] AC3（载体迁移）：`plugin/skills/init/SKILL.md` 不再以 `bash .../quay-init.sh` 作为主执行
      路径——机械检查：`grep -c "bash.*quay-init.sh" plugin/skills/init/SKILL.md` 为 0；若本轮
      裁定暂缓这一步，DoD 需record 裁定理由，AC3 相应改记为"任务体记录了暂缓理由"。
- [ ] AC4（MCP 鲁棒性最小可行路径）：构造一个没有/损坏 `.quay/config.yml` 的临时工作区，起
      `quay mcp` 子进程，断言进程不因 `loadConfig()` 直接抛错退出（结构性验证：能列出至少一个
      工具，或能通过某个工具调用产出一份合法 `.quay/config.yml`）——机械检查：
      `packages/quay/test/mcp-server.test.mjs` 新增覆盖该场景的用例，`node --test
      packages/quay/test/mcp-server.test.mjs` exit 0。
- [ ] AC5（shell 脚本收缩记录）：`quay-init.sh` 中 shell-native 部分（tmux 探测/TTY 交互/
      vendor 自举）的去留有明确记录并落实——机械检查：任务落地后 `wc -l
      plugin/scripts/quay-init.sh` 相较 2959 行有实质缩减，或该文件已被删除；具体阈值/整体退役
      与否在实现阶段裁定并写入 DoD 证据小节。

## Definition of Done

- [ ] AC1-AC5 全部落地为真实代码改动 + 通过的测试（不是文档/设计稿），`configExists` 三态、
      reconcile diff 逻辑、MCP 引导阶段的降级路径分别有可复现的最小场景跑通（DIR-026 Reading
      A：一个对象真的被这套机制操作过一次，不是 fixture 自证）。
- [ ] 若本任务过程中按 Proposal 里的范围裁定拆出 children 或 sibling task，本任务体在 DoD 证据
      小节记录拆分决定与去向，不留悬空引用。
- [ ] `scripts/test.sh --for-task gap-quay-init-native-reconcile` scoped 门绿。

## Touches

- tasks/gap-quay-init-native-reconcile.md（自身文件——self-touch）
- plugin/scripts/quay-init.sh
- packages/quay/src/init.ts
- packages/quay/src/cli/init.ts
- packages/quay/src/config.ts
- packages/quay/src/mcp-server.ts
- packages/quay/src/mcp-handlers.ts
- plugin/skills/init/SKILL.md
- packages/quay/test/init.test.mjs
- packages/quay/test/mcp-server.test.mjs
- orchestration/SPEC-quay-init-reconcile-and-native-implementation-2026-09-18.md（背景引用，不改内容）
