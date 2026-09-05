# quay 产品轮廓（对外面）

**创建**：2026-08-05（管理者）
**为什么在 `docs/proposals/`**：该目录被 `strategic-doc-staleness-check.ts` 覆盖
（`docs/proposals/*.md`），放这里能被既有的陈旧检查自动盯住。
（`orchestration/*ROADMAP*.md` 那条臂实测匹配 **0 个文件**，是死 glob，不能依赖。）

**这份文档描述「quay 对外交付的是什么」**，不是「还缺什么」
（缺口清单见 `orchestration/SPEC-complete-delivery-surface-2026-08-05.md`）。

**维护判据**：第 8 节的每条断言都附了可执行的核对命令。**改了实现却没改这里，
跑那些命令就会对不上。** 不要把本文件当散文维护。

---

## 0. 一句话

**quay 是一个「provider 无关的任务板」+「让 AI agent 分层自治地推进它」的机制。**
前者是产品的地基（任务可以住在文件里、GitHub Issues 里、别的系统里），
后者是产品的主体（三层循环把任务板真正推进下去）。

---

## 1. 五个面（按谁消费划分）

| 面 | 组件 | 消费者 |
|---|---|---|
| **可移植性** | Provider ABI + 三个 provider + `migrate` | 采用者 |
| **Agent 面** | loop tick 文档、MCP 工具、闸门引擎、skills | 三层 agent |
| **人面** | CLI、web board、RUNBOOK | 操作者 |
| **基座** | 周期锚点、动作信道、观测信道、状态存储 | 上面所有 |
| **交付** | plugin bundle、`quay-init`、升级通道 | 新项目 |

---

## 2. 可移植性：Provider ABI

**产品的地基。** Core 只对「任务视图模型」编程，从不针对某个后端：

```
task = {id, title, status, role, labels, parent/children, body}
body 里承载 ## Proposal / ## Plan / ## Acceptance Criteria / ## Definition of Done
```

| Provider | 后端 |
|---|---|
| `quay-native` | 本地磁盘的 markdown + YAML frontmatter（`tasks/*.md` **就是**数据） |
| `quay-github` | GitHub Issues |
| `quay-backlog` | backlog 后端 |

`.quay/config.yml` 是 provider 映射表（哪个启用、`path`、`tasks_dir`、`mcp_entry`、`env`）。
`quay migrate --from <a> --to <b>` 做迁移。

⇒ **这一面决定 quay 是「产品」而不是「一套循环脚手架」。**

---

## 3. Agent 面

### 3.1 行为：loop tick 文档（**必须是文本**）

`plugin/loop/` 两份：`orchestrator-loop-tick.md`（outer）、`fast-mode-loop-tick.md`（inner）。
**管理者层的对应文档尚未随包走**（`orchestration/manager-loop-tick.md` 只在 quay 本地）。

**为什么必须是文本而非代码**（三条，均有 2026-08-05 实证）：
1. **通用性**——新项目领域语义不同，改一行文本 vs 改代码分支；
2. **未枚举情况**——状态有限可枚举，策略必须处理没预见到的。
   实例：外层用 `aborted-no-failure` 这个**新语义值**解开红窗死锁，写死的代码给不出；
3. **自演进**——机制要能改自己的规则，改文本的门槛比改代码低一个量级。

**但形式化有三条硬约束**（`SPEC-state-crystallization-2026-08-05.md`）：
规则必须**引用状态字段名而不复述状态**（复述即产生第二真值源）；
每条规则必须有**机械挂载点**（`.halt` 的教训：规则说「在 tick 步骤 0 检查」，
而连续流程没有步骤 0，规则就失效了）；**禁止手写逃生舱**
（`note` 字段那次说明：逃生舱出现的位置，就是缺失字段的位置）。

### 3.2 查询：MCP 工具

`packages/quay/src/mcp-server.ts`，`quay mcp` 启动。工具**回答问题**，不做裁定。
**局限**：MCP 是**会话内**工具，随会话死亡 ⇒ 它可以是状态的**查询面**，不能是状态的**家**。

### 3.3 裁定：闸门引擎（QENG）

`packages/quay/src/gate/{engine,registry,gate-event-store,gate-log,acceptance-runner,lifecycle,driver}.ts`，
无动词 CLI：`gate` / `gate-log` / `complete` / `adjudicate` / `promote` / `retreat` / `run`。

**与 MCP 工具语义不同，不可合并**：
- 工具**回答**（可以被忽略）
- 闸门**裁定并向 `<root>/.quay/gate-events.jsonl` 追加不可变 GateEvent**（留痕，不可绕过）

生命周期：`todo → ready → done`，终态 `needs-human`。
「**The meter is runnable, not asserted.**」

### 3.4 初始化与启动：skills

`plugin/skills/` 共 11 个，其中与产品面直接相关的：
`init`（铺设）、`cold-start`（点着循环）、`author`（todo→ready）、`execute`（ready→done）、
`loop-driver`、`routines`、`quay-directive`、`quay-task-operator`、`quay-task-to-plan`。

**边界**：`cold-start` 的前提第 3 条是「inner 会话可达」——**它假设会话已存在**。
**创建会话是它之前的一步**，见 `orchestration/RUNBOOK-session-bringup-2026-08-05.md`。

### 3.5 主动发现：探针（routine track）

**这是产品里唯一「主动去找缺陷并建议任务」的机制**，其余判据都是被动的（有人跑才答）。

| 组成 | 内容 |
|---|---|
| 探针定义 | `plugin/probes/` 4 个：`architecture-analysis`（用 archguard 查依赖环/上帝包/重复抽象，ADR-007 的 `L_D`/`L_G` 仪器）、`history-mining`（挖会话史找模式）、`self-validation`（自检）、`browser-explorer` |
| 机件 | `routine-scheduler.ts`（判哪些该跑）、`read-probe-spec.ts`（校验探针规格）、`routine-file-gate.ts`（findings 过闸：新颖性/质量/限流） |
| skill | `plugin/skills/routines/`（106 行） |
| 配置 | `.quay/config.yml` 的 `loop.routines:`，`trigger: every(5)` / `every(10)` |
| 产出 | findings → 候选任务文件（FILE-ONLY 不变式） |

**⚠️ 现状：机制曾完整，但死了 15 天（2026-08-05 实测）；已重新接线（2026-08-08，AC3）**

- **死因**：两层循环文档对探针的引用 `orchestrator-loop-tick.md` 0 处、`fast-mode-loop-tick.md` 0 处；
  触发器 `every(N)` 按**迭代计数**触发，而「迭代」是 ADR-022（2026-08-03）退休掉的经典管线的
  概念——两层快速模式没有迭代号，也没有任何地方调用 `routine-scheduler`。最后一次真跑：
  2026-07-15（提交信息里的 `Iteration 49/52`）。
- **修复（2026-08-08，`gap-delivery-outline-vs-verify-surface-single-source` AC3）**：
  - **铺设**：`quay-init --loop` 现在把 `plugin/probes/`（4 个 probe spec）铺进目标的
    `plugin/probes/`（此前 grep 0——目标项目磁盘上不出现探针）；
  - **调用方（活文档）**：`fast-mode-loop-tick.md` 新增步骤 3.7「例常例行（routine track）」——
    读 `loop.routines:` → `routine-scheduler.ts`（tick 计数替代迭代号）→ `read-probe-spec.ts`
    派发 → `routine-file-gate.ts` 过闸 + FILE-ONLY；routine 脚本随 --loop 铺入目标（机制语料裸名解析）；
  - **死配置检测**：`config-wiring-check.ts` 的 routines 字段现在要求**活 tick 文档引用 routine track**，
    否则报 NOT_CONSUMED_BY_DRIVER（config-validate 只校验语法，不校验「这段配置会不会被谁读」）。

**为什么这条比它看起来重要**：2026-08-05 实测，机器自己开出的 7 根新维度**全部是
post-friction**（被硌了才发现）。而探针**本来就是设计来做 pre-friction 发现的**。
⇒ 手工跑生成器问句不可持续，**探针才是可持续的 pre-friction 发现机制**，
它死了 15 天而没有任何东西报警——这本身是「机制存在但无人调用」那一族的第五个实例
（前四：`loop-driver.jsonl` 无写入者、遥测括号从没被调用、`human-steered` 标签消费者
全在退休管线、`strategic-doc-staleness` 的 orchestration 臂是死 glob）。

**接线已落地**：触发器已从「迭代计数」改为两层模式实际拥有的量（tick 计数），见 `fast-mode-loop-tick.md` 步骤 3.7。

---

## 4. 人面

| 组件 | 命令 | 现状 |
|---|---|---|
| CLI | `quay init/task/action/gate/complete/promote/retreat/run/migrate/serve/mcp` | 完整 |
| Web board | `quay serve --host <ip> --port <p>` | 存在，但**看不到循环在干什么**（已立案 `gap-web-cannot-show-what-the-loop-is-doing-now`） |
| 会话拉起手册 | `orchestration/RUNBOOK-session-bringup-2026-08-05.md` | 2026-08-05 新增（第四次全灭后） |

**CLI 的形状是 `quay <名词> <子命令>`**，与 `git`/`docker` 同构。
⇒ 循环侧那 97 个 `plugin/scripts` 的收拢，应当是**扩展这个已有形状**
（`quay session` / `suite` / `meter` / `tree`），**不是另起一套**。

### 4b. 人的角色已经变了（2026-08-06，人给出方向 + 实测支撑）

**实测**：`.quay/gate-events.jsonl` 365 条闸门事件，`actor` 分布 **365 × `quay-cli`、0 × web**
——web 的 action 按钮**从未产生过一条状态变更**，且它自带一个已确认的 open-redirect 修复
（`serve-handlers.ts:1068`）：**一个从未被使用的功能贡献了一个真实漏洞**。

**根因不是「人懒得点」，是人在这套机制里的位置变了**：人给方向、提问、裁定优先级；
**改任务的只有 agent**。按钮是为一个已经不存在的角色建的 ⇒ 标准的退化器官。

⇒ 人面的两份新提案（**方向已定、AC/立案归外层**）：

| 文档 | 主张 |
|---|---|
| [`quay-web-human-is-not-an-operator.md`](./quay-web-human-is-not-an-operator.md) | **减法**：删 action 按钮；负控制＝删后 `actor` 分布不应变化 |
| [`quay-saas-remote-access-to-an-onprem-loop.md`](./quay-saas-remote-access-to-an-onprem-loop.md) | SaaS ＝**第三种传输**而非第二个产品；启动条件是**外部信号**，不是内部判断 |

**次序**：先删（零风险、消一个安全面）→ SaaS 保留选项、暂不动工。

---

## 5. 基座（最薄的一面）

| 职责 | 现状 |
|---|---|
| **周期锚点** | **OS 级 timer 已 active**（2026-08-05 11:35 实测：`quay-os-anchor-watchdog.timer` is-active=active、is-enabled=enabled，11:34:15 真实触发过一次）。**但「自动拉起」尚未被真实 kill 验证**——timer active 只证明它在跑，不证明它跑对了。此前全部是会话作用域的 `CronCreate`，**会话一死锚点永久消失且不留痕迹**——三次崩溃 + 两个项目停摆 29 小时的机制根 |
| **观测信道** | `session-liveness.sh` + Monitor 工具。**只信目标会话自己的 transcript**——pane 哈希 3 次假阳性、heartbeat 冻结 42 分钟仍报假警 |
| **动作信道** | **无统一实现**。投递 = 手写 `send-keys` 序列（6 种失败模式）；抢占 = `.halt` 文件（挡不住连续流程） |
| **状态存储** | **无权威家**。2026-08-05 实测「有几个任务在飞」有 **6 个源、4 个答案** |

**两处最薄，且是同一件事的两个投影**：
**观测有名字、动作没有**；**访问面有（MCP）、存储没有**。
两者都指向同一个缺失的东西——一个不随会话死亡的基座进程
（推演见 `orchestration/SPEC-integration-architecture-2026-08-05.md`）。

**该结晶为代码的六个状态实体**：
`Task` / `Run` / `Session` / `SuiteRun` / `Signal` / `Resource`——**每个恰好一个写入者**。

---

## 6. 交付

> **单一事实源（2026-08-08 `gap-delivery-outline-vs-verify-surface-single-source` 人裁定；2026-08-29
> `gap-delivery-inventory-check-time-computation` 收官）**：plugin bundle 的目录计数**现算、不再有提交快照**——
> 单一事实源是 `plugin/scripts/verify-delivery-surface.ts --inventory`（机械计算磁盘真值，一条命令可查）。
> 2026-08-08 的裁定曾保留一个「机读快照 = 派生副本」并要求逐项校验（改一份不提醒另一份 = 漂移被 `inventory_drift` 报出），
> 但那份副本本身成了所有 script 任务的公共串行点（2026-08-29 批量重派 4 个 merge 冲突里 3 个撞在 outline 的 `scripts=N`）。
> 现移除派生副本：计数只在 check 时现算，无快照可漂移、无共享冲突热点。

| 项 | 内容 |
|---|---|
| plugin bundle | 目录计数由 `node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --inventory` **check 时现算**（单一事实源，一条命令可查）——无提交快照、无需再生成（`--write-inventory` 已退役） |
| 铺设 | `quay-init`（幂等），铺设集由文档引用**派生**而非硬编码 |
| release 新鲜度 | `bash plugin/scripts/release-freshness-check.sh`（gap-release-freshness-no-recut-mechanism）——重切触发：develop 领先最新 release tag 超阈值报 WARN（机械量 `git rev-list --count <tag>..develop`）；漂移闸：release tag 树 vs develop 机制集逐目录计数对比（复用 delivery-inventory 思路对 release 面）。DIR-061 覆盖「构建」不覆盖「保持 release 当前」，此检查补该缺口 |
| 升级通道 | `quay-init` 内有 upgrade 逻辑，但目标项目实测仍会冻结在安装那一刻——**交付面自己在长大，目标没有跟上的路径**（已立案未闭） |

### 6b. 前置条件（2026-08-08，`gap-delivery-outline-vs-verify-surface-single-source` AC4）

| 前置 | 值 | 说明 |
|---|---|---|
| **Node 下限** | `>= 20`（`package.json` `engines`；ad-arm1 实测系统 18.19.1） | 低于 20 无法跑 `--experimental-strip-types` 的 TS 脚本/检查 |
| **config.yml 完整形状** | 完整 `providers:` / `gates:` / `loop:`（DIR-050）；`quay-init --loop` 只生成 `loop:` 四字段（repo_root/test_command/tmux_session/worktree_root），ad-arm1 手工补 `gates:` 60 行才过 validate | 完整形状是交付前提——缺 `gates:` 段 validate 会失败；quay-init 的 loop 生成不构成完整 config |
| **tmux 拓扑** | **cold-start 前置（非全局）**——三窗口拓扑只在 cold-start 真正需要 | 铺设期不强制 tmux 会话存在；`quay-init --loop` 的 tmux 强制检测应移到 cold-start（见任务追加发现④，实现问题） |

---

## 7. 三层运行结构（产品如何被使用）

```
manager   跨项目，network 级，非 per-project——不随项目冷启动
  ↓ 驱动
outer     每项目一个，协调、验证、裁定
  ↓ 驱动
inner     每项目一个，执行、派发 subagent、合并
```

**边界**：outer 驱动 inner 做实现，manager 不直接改代码。
**层数增长是被刻意克制的**——基座进程不算第四层，因为它没有判断力、
不参与决策、不消费任务语义。**若基座开始需要做判断，说明设计错了。**

---

## 8. 可核对的断言（维护判据）

改了实现却没改本文，下面的命令会对不上：

```bash
# CLI 名词面
node --experimental-strip-types packages/quay/bin/quay.ts --help | grep -c '^  quay '

# 交付构成（单一事实源 = verify-delivery-surface --inventory；本命令即其机械核对，漂移报出）
node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --inventory

# provider 数
ls -d packages/quay-* | wc -l

# 闸门引擎构成
ls packages/quay/src/gate/

# 基座：OS 级锚点是否还在
systemctl --user list-timers --all | grep -i quay

# 状态源散落程度（本文第 5 节的核心论据）
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json | \
  python3 -c 'import json,sys;print("telemetry inflight:",len([t for t in json.load(sys.stdin)["tasks"] if not t.get("outcome")]))'
git worktree list | grep -c quay-worktrees
grep -l '^status: in-progress' tasks/*.md | wc -l
# ⇒ 三个数字若不一致，第 5 节「状态无权威家」仍然成立
```

---

## 8b. 实验遗留中值得回收的工具（2026-08-05 普查）

`experiments/quay-perpetual-stream/` 是经典管线（ADR-022 已退休）的家：
测试 15,940 行 + 脚本 26,325 行。**普查结论：大部分该清，但有一小批通用工具值得回收进产品。**

### 规模（实测）

| 项 | 数 |
|---|---|
| `experiments/*/test/*.test.mjs` 在**默认套件 glob 里** | **46**（每轮全套件都跑） |
| 其中被现行文档/脚本引用 | 14（30%） |
| **其中无人引用** | **32（70%）** |
| **其中连被测实现都已删除** | **15** |
| `scripts/` 实体文件 | 103（另有 15 个是指向 `plugin/` 的符号链接，同一份代码不算遗留） |
| 其中已回收进 `plugin/scripts/` | 40 |
| **真·仅存 experiments** | **63** |

### 值得回收的（通用价值，几乎不依赖退休管线）

| 脚本 | 行 | 它回答什么 | 对退休管线的引用 |
|---|---|---|---|
| `git-lens-l-d-code-doc-ratio.ts` | 125 | `L_D` 收敛代理：某 git 范围内代码:文档行增量比 | 2 处 |
| `git-lens-l-g-structural-drift.ts` | 233 | `L_G` 收敛代理：结构漂移 | 1 处 |
| `git-lens-l-s-behavior-variance.ts` | 167 | `L_S` 收敛代理：被触模块的行为方差（轻量变异探针） | 1 处 |
| `derive-touches-heuristic.ts` | 188 | 任务体缺 `## Touches` 时机械/启发式抽取——**直接喂给 `checkTouchesPair`** | 1 处 |

**前三条是 ADR-006/007 的 GIT 五透镜里 `L_D`/`L_G`/`L_S` 的量化实现**，与经典管线无关，
且正好补上 `architecture-analysis` 探针的同一类能力。
**第四条直接解决今晚实测过的痛点**：`## Touches` 声明不准是并发派发与分支模型的成本上界。

### 绑死退休管线、应随清理一起走的（示例）

`drain-scheduler` / `deliverable-governor` / `drain-dispose-corruption-check` /
`chart2-s1|s2|s3-*` / `chart-headroom` / `chart-saturation-check` /
`explore-exploit-cadence`（按「≥1/5 EXPLORE 里程碑」规则判 milestone 是否到期——
milestone 概念已随 ADR-022 退休）。

### 判据（避免下次再堆积）

**一个测试文件若其被测实现已不存在，应当随实现一起删除**——15 个这样的文件仍在每轮
全套件里跑，**无论绿红都不携带关于现行系统的信息**。

---

## 9. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-05 | 创建。触发：人问「有文档描述这一轮廓吗？如果没有，创建并持续维护」。实测确认 README/DESIGN/quay-proposal 三份各覆盖一片，`supervisor` 与 `upgrade` 几乎全缺，无单一文档覆盖完整轮廓。 |
| 2026-08-25 | driver 运行时两级分层落地（gap-ac151）：supervisor 由 bash `promotion-driver-launch.sh` 港进 TS `driver-runtime.ts`（Layer 0），promotion/worker 改继承 Layer 0+1a。DELIVERY-INVENTORY scripts 计数净零（+1 driver-runtime.ts / -1 promotion-driver-launch.sh），快照数值不变。 |
| 2026-08-28 | 退役前置检查落地（gap-b0-retirement-precondition-checker-call-surface）：新增 `outer-retirement-precondition-check.ts`（枚举 outer 执行核引用的 checker、判定留存调用面、孤儿必须显式退役），并把 `outer-anchor-check.ts` / `outer-cron-registry.ts` 标为随退役层显式退役（RETIRED-WITH-RETIRING-LAYER）。DELIVERY-INVENTORY scripts 计数 +1（+outer-retirement-precondition-check.ts）。 |
| 2026-09-05 | quality driver 第三例程（gap-quality-driver-architecture-review-routine）：新增 `architecture-review-cluster.ts`（机械聚类纯函数，聚合 P1/P2/P4 三检测器 `--json` 输出 → LLM judge → JS 合并 → `.quay/architecture-review-round.jsonl` 判词载体），把三个零周期调用的检测器接上会转的轮子。DELIVERY-INVENTORY scripts 计数 +1（+architecture-review-cluster.ts）。 |
