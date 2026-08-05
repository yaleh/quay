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

---

## 5. 基座（最薄的一面）

| 职责 | 现状 |
|---|---|
| **周期锚点** | **代码已落地，但尚未实际安装**（本文第 8 节的核对命令 2026-08-05 首次自检即抓到：`plugin/scripts/os-anchor-install.sh` + `os-anchor-watchdog.sh` 共 699 行已合并，而 `systemctl --user list-timers` 里 **0 个 quay timer**，AC1「timer 存在且 active」仍未勾）。此前全部是会话作用域的 `CronCreate`，**会话一死锚点永久消失且不留痕迹**——三次崩溃 + 两个项目停摆 29 小时的机制根 |
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

| 项 | 内容 |
|---|---|
| plugin bundle | `scripts` 97 · `gate-scripts` 14 · `skills` 11 · `probes` 4 · `loop` 2 · `workflows` 2 · `agents` 1 · `vendor` 2（自包含运行时） |
| 铺设 | `quay-init`（幂等），铺设集由文档引用**派生**而非硬编码 |
| 升级通道 | `quay-init` 内有 upgrade 逻辑，但目标项目实测仍会冻结在安装那一刻——**交付面自己在长大，目标没有跟上的路径**（已立案未闭） |

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

# 交付构成
for d in scripts gate-scripts skills probes loop workflows agents vendor; do
  echo "$d $(ls plugin/$d | wc -l)"; done

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

## 9. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-05 | 创建。触发：人问「有文档描述这一轮廓吗？如果没有，创建并持续维护」。实测确认 README/DESIGN/quay-proposal 三份各覆盖一片，`supervisor` 与 `upgrade` 几乎全缺，无单一文档覆盖完整轮廓。 |
