# 规格：`quay-init` 退役 shell 脚本、改 CLI/MCP 原生实现；`/quay:init` 语义从"存在即跳过"改为"reconcile 到当前版本默认值"

**日期**：2026-09-18（人在 quay-fleet 项目讨论一个具体缺口时提出三条原则，扩展为本规格）
**来源**：quay-fleet 项目 dashboard 显示 `landing-baseline 未接入/无数据` → 追出配置缺 `fork_baseline`/`merge_target`
→ 追出根因是升级路径的合并函数从设计之初就没纳入这两个 key → 人给出三条原则，指向比"补两个 key"更大的范围。
**本文件**：讨论结论 + 已核实的现状事实（文件/行号）。**AC/DoD 与是否立案由外层判断，本文件不建。**

---

## 0. 触发案例（具体症状，已核实）

quay-fleet（`/data/home/yale/work/quay-fleet`）的 `.quay/config.yml` 曾经**同时缺失** `fork_baseline` 与
`merge_target` 两个 `loop:` key，导致 dashboard 分支模型行渲染成"未接入/无数据"。手工补齐后确认：

- `worker-driver.ts:4534` 的 fan-in 落地路径**全程硬编码** `mergeTarget ?? "develop"`，从不读配置——
  两个 key 缺失不影响机制正确性，纯粹是展示层的诚实性缺口（这条已解决，不在本规格范围内）。
- **真正的根因**：`plugin/scripts/quay-init.sh:645-704` 的 `ensure_loop_config()`（"config-preserving 增量升级"，
  任务 `gap-quay-init-config-preserving-incremental-upgrade`，2026-08-08 落地）**只更新 4 个 key**
  （`repo_root`/`test_command`/`tmux_session`/`worktree_root`），其余 `loop:` key（含 `fork_baseline`/
  `merge_target`/`concurrency_bands`/`routines`）**原样保留、绝不触碰**——注释 `:657` 明确点名这是设计选择。
- `fork_baseline: develop` 是三天后（2026-08-11，`fe053af7`）才加进 fresh-install 模板的默认值。
  `ensure_loop_config` 从未被同步更新去纳入它 ⇒ **任何 2026-08-11 之前 init 过、之后只靠这条升级路径
  维护的项目，这两个 key 永远补不上，不管重跑多少次 `/quay:init`**（quay-fleet 今天实测：重跑 `/quay:init`
  后 `.quay/config.yml` mtime 完全不变，证实了这一点）。
- 这不是一次性疏忽——`ensure_provider_carrier_env()`（`:706-728`）是另一个只认 3 个 key 的独立合并函数，
  branch model 建立又是第三套独立机制。**每加一个新默认值，都要记得手工同步到某个专门的合并函数**，
  这个模式本身会持续复发同类遗漏。

---

## 1. 人给出的三条原则（原话）

> 面向用户的 quay 操作入口应优先 Claude Code 对话中易于使用的形态：mcp, skill。
>
> 可以接受 quay plugin 升级后重跑 /quay:init，而不应期望用户手动运行 quay-init.sh。实际上，最好不要保留
> 该 .sh，而直接在 mcp 中实现。
> /quay:init 的原则应当是保障项目设置符合该版本 quay 运行的要求。已有的不兼容的设置应按照新版本的
> 缺省值设置。

> `/quay:init` 应当有足够好的鲁棒性，能够在配置文件不存在或错误的情况下执行。我可以接受它用 quay cli
> 或 mcp —— 当然，这也要求它们应当在配置文件不存在或错误的情况下执行（至少执行 init 动作）。

三条原则合起来指向三个独立维度：**载体**（shell → CLI/MCP）、**语义**（存在即跳过 → reconcile 到当前
默认值）、**鲁棒性**（配置缺失/损坏时至少 init 动作要能跑），三者共享同一套底层设计（"当前版本要求的
默认 schema 是什么、如何 diff"），不应拆成互不相干的三个任务分别设计。

---

## 2. 现状事实清单（已核实，逐条带文件/行号）

### 2.1 载体现状：`/quay:init` 完全不经过 MCP

- `plugin/skills/init/SKILL.md:16-17`：「The logic lives in ONE executable —
  `bash ${CLAUDE_PLUGIN_ROOT}/scripts/quay-init.sh`. This skill delegates to it rather than repeating
  the write logic inline.」Frontmatter `allowed-tools: Bash, Read`，无任何 MCP 工具声明。
- `plugin/scripts/quay-init.sh` 全文 **2959 行**。粗分类：参数解析/help；文件状态批量预计算；
  provider `mcp_entry` 的 YAML 文本手术；旧版 `.quay/runtime` 退役迁移；`--check-drift`/
  `--check-dependency-closure` 只读诊断模式；六件套闭集写入（config.yml/profiles.yml/tasks/.gitignore/
  launch.settings.json/settings.json）；loop 参数增量合并（`ensure_loop_config`）；branch model 建立
  （转发给 vendored Node CLI）；`ensure_vendor_runtime` vendor 自举；auto-commit 交互确认。
- `packages/quay/src/mcp-server.ts` / `mcp-handlers.ts` **零个 init/setup/upgrade 类工具注册**
  （对 `"init"` 关键词 grep 只命中一行无关注释）。最接近的是只读的 `config_validate`。
- `packages/quay/src/init.ts`（662 行）+ `cli/init.ts`（251 行）已有一份**独立的** TS 实现，但对
  "配置已存在"的处理**比 shell 版本弱**：`init.ts:513` `configExists = fs.existsSync(configPath)` 为真时，
  `cli/init.ts:97-121` 甚至显式拒绝 `--loop` 参数（"unrecognized option"，指向 shell 版 `/quay:init --all
  --loop` 才是 canonical 入口）——**两条实现目前是两套不对称的逻辑，不是同一套代码的两层皮**。

### 2.2 鲁棒性现状：CLI 对"不存在"已经天然可用，对"损坏"是假鲁棒；MCP 两者都不行

- `runInit()`（`init.ts`）**从不 import `loadConfig`**，配置不存在时（`configExists === false`）直接走
  `ensureBranchModel` → `generateConfigContent` → 写盘，全程不解析旧文件 ⇒ **CLI 对"配置不存在"已经是
  鲁棒的**。
- 但 `configExists`（`init.ts:513`）是**纯粹的 `fs.existsSync`，从不尝试 `YAML.parse`**——"文件存在但内容
  是垃圾字节"和"文件存在且合法"完全等价。不带 `--force` 时两者都走同一个 `outcome: "skipped"` 分支
  （`cli/init.ts:208-215` 打印"already exists, use --force"）；带 `--force` 时两者都被同一份
  `generateConfigContent` 盲目覆盖。**能兜底（不崩溃），但诊断信息是错的**——损坏配置被误报成"配置冲突"，
  用户看不出真实原因；且 `--force` 覆盖是"整份丢弃"而非"抢救可用字段 + 按当前默认值补齐损坏部分"。
- `config.ts:22-33` 的 `loadConfig()`：文件不存在 `throw new Error("no .quay/config.yml found ...")`
  （`:24-28`）；YAML 解析失败**无 try/catch**，`YAML.parse(raw)`（`:30`）原样冒泡库自己的
  `YAMLParseError`；对必需字段（`providers`/`loop`）**完全不做校验**，校验下推到各消费者
  （`activeProvider`/`readLoopConfig` 等）。
- `mcp-server.ts:startMcpServer()` 启动序列，**两处同步硬依赖，均无 try/catch，均排在任何工具注册之前**：
  ```
  :193  const cfg = loadConfig();                    // 文件缺失/YAML 语法错在此抛
  :194-197  enabledProviderIds(cfg) 为空 ⇒ throw      // 同样无 try/catch
  :218  new McpServer(...)                             // 排在上面两处之后
  :259  registerAllHandlers(...)                       // 全部工具注册在此之后
  ```
  ⇒ **配置缺失或语法损坏时，MCP server 连 `McpServer` 实例都不会被构造，零工具可用**——包括本该用来
  诊断这个问题的 `config_validate` 工具本身。异常经 `cli/mcp.ts:handleMcp()`（无 try/catch）冒泡到
  `bin/quay.ts:run()` 的顶层 catch（`:95-101`），打印 stack、`exitCode=1`——进程干净退出，但从 MCP 客户端
  角度等价于"server 起不来"。
- **已有的相关裁定**（`tasks/DIR-099-C.md`，done）：团队明确讨论过"要不要在 `startMcpServer()` 内做启动期
  配置校验"，裁定是**故意不做**——但那次讨论的前提是"语法合法、语义有问题"的配置（如未解析的 gate 引用），
  从未涉及"语法都解析不了"或"文件根本不存在"这两种更极端的情况。**这次讨论的范围比 DIR-099-C 更宽，
  不是重复，是把边界推到了 DIR-099-C 没覆盖的两个更极端的输入**。
- **仓库里没有"`quay init` 因损坏配置崩溃"的历史事故记录**——原因是结构性的：`runInit()` 从不解析已存在
  的配置内容，所以这条路径根本不会因 YAML 损坏而抛异常；它是"侥幸不炸"，不是"设计上处理了"。

### 2.3 鸡生蛋问题：已被现有代码绕开，但绕法不是"证明 MCP 能做到"

- `ensure_target_branch_model()`（`quay-init.sh:2782-2844`）判断分支模型时，**不经过 MCP 协议**，而是
  `node "$PLUGIN_ROOT/vendor/quay/dist/quay.js" init --branch-model-only --root "$WORKSPACE_ROOT"`
  （`:2844`）——直接 shell 出插件自带的、与目标项目 config.yml 无关的 vendored Node CLI 二进制，走的是
  `quay init --branch-model-only` 这个 **config-free** CLI 入口。
- 这证明"要用到 TS/Node 判断逻辑"和"必须先有 MCP server"是两件事，当前实现已经把两者解耦。但反过来说，
  **"纯 MCP" 字面意义上会重新引入循环**：一个从零开始、目标项目没有 `.quay/config.yml` 的场景，
  MCP server 按 §2.2 的启动序列无法构造出来，也就没有工具可调。现状的解法是"绕开 MCP，用裸 CLI 调用"，
  不是"证明了 MCP 能处理这个场景"。

---

## 3. 目标架构（三个维度，共享同一套底层设计）

### 3.1 载体：退役 shell 脚本，逻辑收进 CLI，`/quay:init` skill 改调 CLI

- `quay-init.sh` 里真正"必须是 shell"的部分很小：`detect_tmux_session`（`:601-628`，`tmux
  list-sessions` 探测）、`[ -t 0 ]` TTY 交互确认（`:2680` 起 auto-commit）、`ensure_vendor_runtime`
  （`:2028` 起，vendor dist 是否 stale 的 mtime 对比 + 自举构建）。**这三类是环境探测/进程交互，不是
  "配置读写逻辑"**，可以保留为极小的 shell helper 或迁进 Node 的 `child_process`/`process.stdin.isTTY`，
  不构成"必须留着整个 2959 行脚本"的理由。
- 其余部分（六件套写入、loop 参数合并、provider env 回填、drift 报告）**本质上都是"读一份 YAML、按规则
  改一份 YAML、写回去"**，和 `init.ts`/`cli/init.ts` 现在做的事是同一类操作，应该收敛到一处。
- `/quay:init` skill 的 `allowed-tools` 从 `Bash, Read` 改成直接 `Bash: node .../quay.js init ...`
  （调 vendored CLI，不再调 shell 脚本）——这一步不依赖 MCP 是否落地，可以先做。

### 3.2 语义：从"存在即跳过 / --force 整份覆盖"改为"reconcile 到当前版本默认值"

- 在一处（大概率是现有 `generateConfigContent` 所在的位置）定义"当前版本的 `loop:`/`providers:` 完整
  默认 schema"，作为唯一正本。
- `/quay:init` 的行为改成：读取已有配置（若能解析）→ 对 schema 里的每个 key 做 diff——
  - 已有且未被标记为废弃/不兼容的 key：**保留用户值**；
  - schema 里有但配置里缺的 key：**按当前版本默认值补上**（这条直接吃掉本规格 §0 的触发案例，
    且是通用解法——以后再加新默认值，只需要改 schema 一处，不需要记得同步到某个合并函数）；
  - 被标记为不兼容/已废弃的 key（例如历史上出现过的、指向已退役分支的 `merge_target: integration`）：
    走一张显式迁移表，不是简单保留也不是简单覆盖。
- 这条语义变化让 `--force` 的含义也应该重新定义：不再是"整份覆盖"，而是"允许迁移表覆盖用户显式设置的
  不兼容值"——具体行为留给立案阶段设计，本规格只定方向。

### 3.3 鲁棒性：CLI 与 MCP 都要能在配置缺失/损坏时至少完成 init 动作

- **`configExists` 三态化**：不存在 / 存在且可解析 / 存在但损坏。三态分别对应不同的用户提示与不同的
  reconcile 起点（损坏配置的处理是"尝试解析、抢救可解析的顶层字段，解析失败的字段按当前默认值重建"，
  而不是不存在与合法两态之外的第三种黑盒行为）。
- **`startMcpServer()` 拆两阶段**：
  1. 无条件注册"引导类"工具（至少 `init`，大概率也该把 `config_validate` 挪到这一阶段），不依赖
     `loadConfig()` 成功；
  2. 现有的 `loadConfig()` → `enabledProviderIds` → `registerAllHandlers` 链条失败时，**不再让整个
     进程退出**，而是带着"只有引导工具可用"的降级状态继续跑，把清晰的失败原因通过引导工具本身
     （或一个专门的状态资源）暴露给调用方。
- **MCP 侧的 `init` 工具签名不能依赖 `cfg.workspaceRoot`**（走到引导阶段时 `cfg` 可能压根不存在），需要
  显式接收一个 root/path 参数，内部直接复用 `init.ts` 里已经与 `loadConfig` 解耦的 `runInit()` 逻辑
  （这部分现成，不用重写）。

---

## 4. 开放问题（需要外层/立案阶段裁定，本规格不替它们下结论）

1. **MCP 半是否值得做，还是先只做 CLI 化？** CLI 化（§3.1）本身已经能解决"退役 shell 脚本"和大半个
   "载体"诉求；MCP 引导阶段的拆分（§3.3 第二条）是一次真实的启动流程重构，成本比 CLI 化高一截。
   两者可以分阶段落地，但设计（schema/diff 规则）必须共享，不能分头长出两套。
2. **"不兼容"的判定规则由谁定义、放哪个文件？** 目前唯一的先例是分支模型的 `ensureBranchModel`/
   `classifyBranch`（`branch-model.ts`，ADR-004 单一实现）——迁移表式的 reconcile 规则是否也要收进
   同一个文件，还是另开一个 `config-schema.ts`。
3. **shell-native 的三小块（tmux 探测/TTY 交互/vendor 自举）最终去哪**：保留极小 shell helper，还是
   全部迁进 Node（`child_process` 探测 tmux、`process.stdin.isTTY` 判断交互式、Node 自己判断 vendor
   dist 是否 stale）。这不影响本规格的主线，但决定 `quay-init.sh` 能不能被**完全**删除，还是收缩成
   一个几十行的极小引导脚本。
4. **落地顺序**：`configExists` 三态化和 reconcile 语义（§3.2/§3.3 CLI 部分）收益最直接、风险最低，
   适合先做；MCP 分阶段启动重构范围最大，适合放后面独立验收。

---

## 5. 范围边界（不在本规格内）

- Dashboard 展示层的具体渲染修复（`landing-baseline 未接入/无数据` 的字面症状）已经通过手工补齐
  quay-fleet 的 `.quay/config.yml` 解决，不需要作为本规格的验收项——本规格要解决的是"这类缺口为什么
  会发生、以后再犯同类遗漏时机制能不能自己兜住"，不是这一次的症状本身。
- `config_validate` 工具现有的语义校验能力（DIR-099-C 范围）不重新设计，只讨论"它能不能在配置损坏/
  缺失时也被注册上"（§3.3）。

---

**本文件不建 AC/DoD、不排优先级——那是外层的活。**
