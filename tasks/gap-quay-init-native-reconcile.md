---
id: gap-quay-init-native-reconcile
title: quay-init 退役 shell 脚本，改 CLI/MCP 原生实现；/quay:init 语义从"存在即跳过"改为"reconcile
  到当前版本默认值"
status: ready
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

- [x] AC1（三态化）：`packages/quay/src/init.ts` 的 `classifyConfig()` 把"配置已存在"改为三态
      （absent/valid/corrupt），`packages/quay/test/init.test.mjs` 新增覆盖"配置文件内容为非法
      YAML"场景的用例并全绿——机械检查：`node --test packages/quay/test/init.test.mjs` exit 0
      且用例名可 grep 到 "corrupt"/"malformed" 字样。**已核**：45/45 pass，exit 0；用例名含两词
      （`AC1 classifyConfig unit: absent / valid / corrupt (malformed YAML) are three distinct
      states` 等 4 条）。
- [x] AC2（reconcile 回归）：对已存在配置的处理从"跳过/整份覆盖"改为逐 key diff-补默认值；回归
      fixture 复现历史缺陷场景（预先构造的、缺版本级默认值的旧配置，跑 init 后断言被补上且原有
      其它自定义 key 不变）——机械检查：`node --test packages/quay/test/init.test.mjs
      --test-name-pattern reconcile` exit 0。**已核**：exit 0，5 条 reconcile 用例全绿（含
      "已是最新 ⇒ 不重写、mtime 不变"的否定臂与 `merge_target: integration` 迁移）。
      **⚠️ 与 AC 原文的一处偏差（已记录，理由可执行）**：原文要求"两个 key（`fork_baseline` +
      `merge_target`）被补上"，实现只补 `fork_baseline`。原因是本轮落地时撞上一条既有的**可执行
      不变量**：`plugin/test/quay-init.test.mjs:143` 断言 loop 写者**不得**写出 `merge_target`
      （它是被审计过的零消费者 key，已从写者面删除，
      gap-config-key-consumer-check-mechanical-enumeration）。若沿用原 AC，两个 fresh-install 写者
      将对"本版本输出什么"各说各话——正是本任务要根除的漂移形状。详见 DoD 证据小节。
- [x] AC3（载体迁移——**本轮裁定暂缓**，按 AC 原文改记为"任务体记录了暂缓理由"）：`SKILL.md`
      仍以 `bash quay-init.sh` 为主执行路径（`grep -c "bash.*quay-init.sh" plugin/skills/init/
      SKILL.md` = 3）。暂缓理由、已落地的半边与未落地的半边见 DoD 证据小节"载体迁移暂缓"，不留
      悬空引用。
- [x] AC4（MCP 鲁棒性最小可行路径）：构造没有/**损坏** `.quay/config.yml` 的临时工作区，起
      `quay mcp` 子进程，断言进程不因 `loadConfig()` 直接抛错退出——机械检查：
      `packages/quay/test/mcp-server.test.mjs` 新增覆盖该场景的用例，`node --test
      packages/quay/test/mcp-server.test.mjs` exit 0。**已核**：219 PASS / 0 FAIL，exit 0；
      两种形态（absent 与 unparseable）各 3 条断言。
- [x] AC5（shell 脚本收缩记录）：裁定并落实——**2959 → 2400 行（-559，-18.9%）**；本轮不整体
      退役（理由见 DoD"载体迁移暂缓"），只删除**已无任何调用者**的死代码，故缩减是零行为变化的，
      由三条 diff 证明（`derive_loop_scripts` 输出集 / 一次真实 laydown 的全部产物 / 铺设 log）。
      保留 `derive_loop_scripts` / `verify_referenced_landed` / `_read_declarations` 及其 helper
      ——脚本头注释已声明它们是**库函数**（被 `laydown-set-check.sh` 等 source 后调用），不是本脚本
      写路径的一部分，整体退役属 AC158/AC159 波次。

## Definition of Done

- [x] AC1-AC5 全部落地为真实代码改动 + 通过的测试（不是文档/设计稿），`classifyConfig` 三态、
      reconcile diff 逻辑、MCP 引导阶段的降级路径分别有可复现的最小场景跑通（DIR-026 Reading A：
      一个对象真的被这套机制操作过一次，不是 fixture 自证）——见下方证据小节。
- [x] 拆分/去向记录：本任务**未**拆 children 或 sibling task（范围裁定：三个侧面共享同一套底层设计，
      AC1/AC2/AC4 已在本任务内落地）；剩余面（CLI 补三个写者 + 显式化 vendor 自举前置 ⇒ SKILL.md
      改调 CLI）记录于下方证据小节，不指向任何不存在的对象。
- [x] `scripts/test.sh --for-task gap-quay-init-native-reconcile --allow-thin` scoped 门绿：
      **exit 0，153 tests / 153 pass / 0 fail**（2026-09-18，本 worktree，merge develop 之后）。

### DoD 证据（2026-09-18 落地）

**AC1 三态化**：`classifyConfig()`（`packages/quay/src/init.ts`）返回 `absent | valid | corrupt`，
`fs.existsSync` 已从该判定路径移除。区分是**可执行的**、不是措辞：旧实现下"配置损坏"与"配置尚在"
走同一分支、打印同一句 "already exists"；新实现下损坏分支打印解析器原文且**不含** "already
exists"，该断言即用例的 RED 臂（用例：`AC1 corrupt: a malformed .quay/config.yml is NOT reported
as an existing config`）。`--reconcile` 在损坏态下重建并把不可解析的原始字节保留在
`.quay/config.yml.corrupt-<ts>`（用例断言备份与原文逐字节相同）。

**AC2 reconcile**：正本 = `LOOP_VERSION_DEFAULTS` + `LOOP_VALUE_MIGRATIONS` +
`reconcileConfigContent()`；经 `quay init --reconcile`（`cli/init.ts`）与 MCP `init` 工具（**默认
`reconcile: true`**）两个面暴露，二者调用同一个 `runInit`。实现走 YAML Document API（**保留注释**），
只在真要改键时才写盘——"已是最新"时报 `unchanged` 且 **mtime 不变**（无谓改写被否定，用例断言）。
回归 fixture 即 AC2 的 5 条用例：缺版本默认值、带 `my_project_key` 与两条注释的旧配置 ⇒ 补齐、
用户 key 与注释逐字不变；`merge_target: integration` ⇒ 经迁移表改写为 `develop`。

**AC4 MCP 鲁棒性**：`startMcpServer()` 拆两阶段（`registerBootstrapHandlers` 在任何 `loadConfig()`
之前）；配置不可读时进程**继续跑**并打印 `quay mcp: DEGRADED — … reason: …`，`init` +
`config_validate` 仍在（后者走同一个 `registerConfigHandlers`，喂的是 fallback 位置而非已加载 cfg）。
测试用**真实** `quay mcp` 子进程 + 真实 MCP 客户端，对 absent / unparseable 两种形态各断言：
(a) 连得上、(b) `listTools()` 见 `init`（缺它则整条修复路径不存在）、(c) 调 `init({root})` 后盘上
出现可解析且带 `loop.fork_baseline` 的配置。这两种形态在启动序列的**不同位置**失败（无文件 ⇒
`findConfig()` 走到根返回 null；有文件不可解析 ⇒ 走查成功而解析器抛），只活一种不算活。

**AC5 载体收缩**：`wc -l plugin/scripts/quay-init.sh` = **2400**（原 2959，-559，-18.9%）。删除的是
**当时即已无任何调用者**的定义：copy 机器（`copy_one`/`copy_dir`/`write_state_file`/`_precompute_states`/
`state_laid_hash`/`_dst_sha256`/`_record_laid_took`）+ 被 `write_config` 新装分支取代的重复 writer
`write_provider_config` + 同批无人调用的 `backup_config`/`rollback_config_on_exit` +
被 `ensure_runtime_artifacts_gitignore` 取代的 `ensure_runtime_gitignore` + `--check-drift` 的打印器
`drift_report`。判据**不是目测**，是三条 diff（各在执行删除前/后各取一次读数）：
① `derive_loop_scripts` 的输出集逐字不变（123 行，`diff` 为空）；
② 一次**真实** laydown（`--auto-commit-skip`）的全部产物逐字不变——`.quay/config.yml`、
`.claude/settings.json`、`.claude/launch.settings.json`、`.gitignore` 逐字节相同；`.quay/profiles.yml`
仅差项目名派生的 session 名，按项目名归一化后逐字节相同；③ 两次运行的 log 逐行相同。
配套机件同轮全绿：`laydown-set-check.sh`（scripts_derived 123, syntax_ok yes）、
`config-key-consumer-check.ts`（6 key，0 无消费者）、`packaging-hygiene-check.ts`、
`quay-init-closure-ratchet.ts --gate`（shrink-only，footprint 3 files / 1022 bytes 未增长，已重锚）。
同批删除的还有 `_CMP_STATE`/`_DST_HASH` 批量化——其生产者就是被删的 copy 机器，**即那个"批量查表"
分支从来只会走 fallback**，`_is_identical` 因此退化为直接 `cmp -s`（同答案，少一层）。

**载体迁移暂缓（原 AC3）——裁定与理由（可测，不是措辞）**：`SKILL.md` 的主执行路径**仍是**
`bash quay-init.sh`。理由有两条实测依据：①skill 的契约是七项闭集（config.yml / profiles.yml /
tasks/ / goals/ / .gitignore / launch.settings.json / .claude/settings.json + 安装步骤文案），而
CLI `quay init` 目前只写其中 4 项（缺 `goals/`、`.gitignore`、`.claude/settings.json` 与安装步骤）
⇒ **现在切换是功能回退**；②脚本里 `ensure_vendor_runtime` 负责 vendor dist 的陈旧自举构建，skill
一旦直调 `vendor/quay/dist/quay.js`，这个前置就没了 ⇒ 开发树上会静默跑旧代码。
**已落地的半边**：SKILL.md 记录了 reconcile 的两个可达面与其状态；AC1/AC2 的语义经 **MCP `init`
工具**（默认 reconcile）被真实消费——这正是人原则 #1 指定的优先形态，不是无人调用的能力。
**未落地的半边（去向）**：CLI 补 `goals/`、`.gitignore`、`.claude/settings.json` 三个写者，并把
`ensure_vendor_runtime` 的前置显式化之后，SKILL.md 改调 CLI，脚本方能整体退役。

**一处已知不一致（记录，不在本任务修）**：版本级默认值的正本是 `init.ts` 的
`LOOP_VERSION_DEFAULTS`；`quay-init.sh:write_config` 的新装 heredoc 无法 import TS，只能**镜像**
`fork_baseline` 一行（已在两处注释里互相指向）。新增版本级默认值时仍需改两处——这正是本任务要根除
的形状（"每加一个默认值都要记得同步"），完全消除它需要 heredoc 从 schema 派生，属上面那半程。

**AC 机械检查的一处弱点（如实记录）**：`node --test <file> --test-name-pattern reconcile` 在本机
node（v24.19）**不过滤**——实测报 `tests 45 / pass 45`，即该 pattern 未生效（pattern 不命中时 exit
仍为 0）。故 AC2 的这条判据单独**不能**证明 reconcile 用例存在；本任务的证据是 5 条用例名确含
"reconcile" 且逐条断言了各自的可取假点（见上文）。

## Touches

- tasks/gap-quay-init-native-reconcile.md（自身文件——self-touch）
- plugin/scripts/quay-init.sh
- packages/quay/src/init.ts
- packages/quay/src/cli/init.ts
- packages/quay/src/config.ts
- packages/quay/src/mcp-server.ts
- packages/quay/src/mcp-handlers.ts
- packages/quay-native/bin/quay-native.ts（本轮新增：runInit 新 outcome 词汇 corrupt / reconciled / unchanged 必须在该 handler 上也有分支，否则损坏态会被打印成假成功）
- plugin/skills/init/SKILL.md
- packages/quay/test/init.test.mjs
- packages/quay/test/mcp-server.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json（本轮新增：删除 laydown 源文件死代码后指纹过期，守卫要求按 --reanchor 重锚；gate 实测 shrink-only，footprint 未增长）
- orchestration/SPEC-quay-init-reconcile-and-native-implementation-2026-09-18.md（背景引用，不改内容）
