# SPEC：统一 `*-driver` 架构 —— 机械化执行面与长会话规划面的分野

**作者**：manager｜**日期**：2026-08-23｜**状态**：proposal，**待人裁定排期**
**来源**：人 2026-08-23 提出四点改进方向（事件触发/可配置可扩展/manager 定时任务下沉/冷启动简化），
manager 检查代码后给出四点分析（讨论轮，未裁定），人要求"基于讨论创建并提交 SPEC 文档"。
**前置**：本 SPEC 描述的是**下一阶段（AC143–149，`manager-phase-goal.md` "📋 下一阶段"节）**的目标架构；
**排期在 AC142 系列（spawn 链修复→fake-completion→exit-4→3 条历史遗留→AC141-3）收口之后**——
理由见 §0 末尾，不是新增前置，是已有的下一阶段切换判据。

---

## 0. 一句话

**把"任务晋升/执行/定时检查"这类已经结晶（人的裁定+机制形态都已固定）的过程，全部收进一个共享骨架的
`*-driver` 家族（机械进程，无 LLM 会话开销，事件驱动）；把"和人对话、架构、规划"这类仍需要语义判断、
仍在演化的工作，留给 manager 这一层长会话（未来可能有职责不同的同类会话）。两者之间用已验证可行的
跨进程 SendMessage 通信，不新造消息通道。**

**为什么现在写、但不现在做**：本会话（2026-08-23）在推进 AC142 系列时，直接实测到"驱动的完成记录不可信"
（`gap-worker-driver-fake-completion-exit-0`）——如果在这个地基上做统一架构，新架构会**继承同一个缺陷，
且因为统一而扩散到全部 kind**（现在 2 个 driver 有这问题，统一后可能 5 个都有，且共用同一份错误逻辑）。
本 SPEC 的落地时机 = AC142 系列全部 done（本文件成文时已 4/5 done，见 tick-log 同日记录）。

---

## 1. 现状盘点（直读代码，非印象）

### 1.1 已经存在、已经在同构的部分

| 部件 | 状态 | 证据 |
|---|---|---|
| 统一入口 | ✅ 已有 | `quay driver <start\|stop\|drain\|status\|restart> --kind <promotion\|worker>` |
| kind 派发 registry | ✅ 已有，8 张表 | `promotion-driver-launch.sh`：`KIND_DRIVER`/`KIND_PREFIX`/`KIND_VERBS`/`KIND_CAP_FLAG`/`KIND_HAS_INTERVAL`/`KIND_PID_SELF`/`KIND_RUN_PREFIX`/`KIND_CARRIERS` |
| 载体命名 | ✅ 已同构 | `<kind>-round.jsonl` / `<kind>-outcome.jsonl`（promotion/worker 两族已对齐） |
| 承载稳定性 | ✅ 已有 | supervisor + 主检出规范化（worktree 启动会被重定位到主检出，AC1 `gap-resident-driver-stable-carrier-liveness`） |
| 单一 LLM 调用点 | ✅ 已有 | `launchArgv(role, prompt, root)`——四处分立的 `["claude","-p",…]` 已归到一处（AC140） |
| 入站控制面 | ✅ 已有（worker-driver 独有，promotion-driver 待补） | `serveControlPlane`：MCP over HTTP/SSE，`halt`/`setPreference`/`forceDispatch` 三操作，调用方身份走 `Mcp-Caller-Id` header 或 `caller` 参数，`knownCallers()` 校验（缺省 `outer,manager`） |
| 事件触发器 | ✅ 已有两个，**但消费者是会话不是 driver** | `slot-free-trigger.ts`（17KB）、`suite-state-trigger.ts`——两者头注释均明写"Monitor 推送给 OUTER" |
| 事件载体 | ✅ 已有三个在用 | `.quay/fan-in-merge-lock-events.jsonl`、`.quay/gate-events.jsonl`、`.quay/suite-state-events.jsonl` |
| 定时/例行触发评估 | ✅ 已有，纯函数 | `routine-scheduler.ts`（167 行）——`every(N)`/`interval:<N>m`/`on(<event>)` 三种触发形态，**已经是"判断是否该做"和"去做"分离的设计**，且随插件分发（`${CLAUDE_PLUGIN_ROOT}/scripts/`），不依赖仓库本地脚本 |
| Touches 互斥的判定逻辑 | ✅ 已有，单一实现 | `checkTouchesPair`（`ready-pool-check.ts`），`concurrent-batch-scheduler.ts` 复用同一函数做批量装配，**未重新实现** |

**⇒ 结论：承载层、身份层、入口层、事件载体层都已经统一或接近统一。缺的不是"从零设计一套新架构"，
是三件具体的事：①把两个 driver 的主循环（reap/派发/判停/round 心跳）抽成共享骨架；②把事件触发器
的消费者从会话 Monitor 流改接到 driver 自己的判停/派发环；③给 driver 一个出站通知能力。**

### 1.2 两个 driver 未同构的部分

| 部件 | promotion-driver.ts | worker-driver.ts | 差异 |
|---|---|---|---|
| 行数 | 766 | 1429 | worker-driver 多出的部分主要是 MCP 控制面 + 常驻选择环 + selector/fix-worker 两条 spawn 路径 |
| 主循环 | 自己实现 reap/派发/判停 | 自己实现 reap/派发/判停 | **两份独立实现**，本 SPEC §2.1 要抽的骨架 |
| 事件感知 | 无 | 无 | 两者都是"轮询式常驻"，不是"事件触发式常驻"——`while(true){round++; ...}` |
| Touches 互斥检查（派发前） | 有（继承自 `ready-pool-check.ts` 的 `dispatchable_disjoint`） | **无**（`gap-launch-script-worker-cap-broken` AC3 正在补，已定为 AC2 的前提） | 本 SPEC 落地时应已修复，不重复讨论 |

---

## 2. 目标架构

### 2.1 机械面：统一 `*-driver` 骨架

```
                    ┌─────────────────────────────────────┐
                    │         driver-kernel（新，共享）      │
                    │  reap() / stopCondition() / round     │
                    │  心跳写盘 / 事件订阅 / spawn 记账       │
                    └──────────────┬────────────────────────┘
                                   │ 由 kind-plugin 提供
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
      promotion-plugin      worker-plugin        <未来 kind>-plugin
      （晋升判定+修复）      （执行+测试+合并）     （例：观测/账本/收尾——AC143）
```

**driver-kernel 的职责**（从两个现有 driver 里抽取的公共部分）：
- 常驻主循环骨架：`round` 计数、`running[]` 在飞集、`reap()` 回收已完成、`stopCondition()` 判停（halt/资源门）。
- round 心跳落盘：无条件每轮写一条（AC138-3 已验证的设计：即使池空也写，防止 outcome 停更被误读为驱动死亡）。
- **Touches 互斥过滤**（`checkTouchesPair`，单一实现，`gap-launch-script-worker-cap-broken` AC3 补齐后上收进 kernel，两个 kind 都受益，不是各自实现）。
- **事件订阅接口**（§2.2）+ **出站通知接口**（§2.3）。
- MCP 控制面（`serveControlPlane` 已是 worker-driver 独有实现，本 SPEC 建议上收进 kernel，promotion-driver 免费获得同等能力）。
- **进程守护（supervisor）本身**——`plugin/scripts/promotion-driver-launch.sh` 现有的 respawn 循环
  （`run_supervisor()`:268）、pid 记账（`pid_alive()`:243 / `_carrier_stats()`:253）、
  8 张 kind registry 表（`KIND_DRIVER`/`KIND_PREFIX`/`KIND_VERBS`/`KIND_CAP_FLAG`/
  `KIND_HAS_INTERVAL`/`KIND_PID_SELF`/`KIND_RUN_PREFIX`/`KIND_CARRIERS`:102-140）
  **全部港进 TS kernel**，`packages/quay/src/cli/driver.ts` 由"`spawnSync` bash 的薄壳"变为
  真正的实现入口。
  **⛔ 这不是可选项、不是"迁移期并存"**（人 2026-08-23 逐字裁定："这显然不够集成，对测试也不友好"）。
  **Node 侧等价原语已确认可用**：`spawn(cmd, {detached:true, stdio:["ignore",fd,fd]}).unref()`
  ≡ `setsid`+`nohup`；`process.kill(pid, 0)` ≡ `pid_alive()`；`child.on("exit")` + `setTimeout`
  ≡ `wait`+`sleep $RESTART_DELAY`。**⛔ 无需 systemd、无需保留 bash 兜底。**
  **可测试性是本条的目的，不是副产品**：港完后 respawn 判定、registry 查表、carrier 统计、
  liveness 判定都必须是可直接 `import` 的纯函数（对照 `worker-driver.ts` 的
  `computeLandingState`/`resolveConcurrency` 现有形态），⛔ 不接受"仍然只能 spawn 整个进程做黑盒断言"。

**kind-plugin 的职责**（每个 kind 保留、不上收的部分）：
- 候选池计算方式（promotion 读 `ready-pool-check`；worker 读同一个但语义不同——晋升候选 vs 执行候选）。
- 单任务的实际动作（promotion = 判定+可能 spawn fix worker；worker = spawn 完整实现链）。
- outcome 记录的字段形状（两族已经在 `computeOutcome`/`computeRoundRecord` 上部分同构，可以进一步统一 schema，但字段语义不同，不建议强行合并成一个类型）。

**新增 kind 的成本**（本 SPEC 的可扩展性目标）：**registry 表加一行 + 写一个 kind-plugin**，
不需要重新实现常驻循环/心跳/Touches 过滤/事件订阅/出站通知——这些都在 kernel 里。
这个成本已经在 AC139（`quay driver` 统一入口）落地时被验证过（`promotion-driver-launch.sh` 加 `--kind worker`
就是加一行 registry + 一个新 .ts 文件，未改 launch 脚本主体逻辑）。

### 2.2 事件触发：改接线，不新造

**现状**：`slot-free-trigger.ts` / `suite-state-trigger.ts` 已经能把"空槽出现"/"suite 状态变化"两类条件
转成事件（`SLOT-FREE` / `SUITE-RED` 等），推给 outer 的 Monitor 流。

**改动**：把消费者从"outer 的 Monitor 流"改成"driver 自己的判停/派发环"——即 driver 的常驻循环除了
每轮轮询，**也订阅这两个已有事件源**，事件到达时立即评估（不等下一轮 round），而不是等轮询周期。

**⛔ 不新造事件系统**：两个 trigger 脚本、三个事件载体、Monitor 挂载机制全部复用，只改"谁在监听"。
这是本 SPEC 四项改动里成本最低的一项。

**扩展点**（人提的"槽位变化、定时、任务状态变化"三类）：
- 槽位变化 = `SLOT-FREE`，已有。
- 任务状态变化 = 可复用 `gate-events.jsonl` / `fan-in-merge-lock-events.jsonl`，或视需要新增一类事件（**不建议在本 SPEC 阶段预先设计，等第一个真实需求出现再定义 schema**——硬规则④推论一：成本结构未知前不设数值/形态阈值）。
- 定时 = **`routine-scheduler.ts` 已经是这个**（`interval:<N>m` 触发形态），driver-kernel 直接调用它的判定函数即可，不需要重新发明一个定时器。

### 2.3 出站通知：driver → manager（真正缺失的一环）

**现状**：`grep SendMessage plugin/scripts/*driver*` 全部路径（含 `.sh`）零命中——**driver 不会主动通知任何人**，
只往 jsonl 写，等别人来读。**driver 是纯 Node 进程，不是 Claude Code 会话，没有 SendMessage 工具可调**——
这不是"没实现"，是"结构上不能直接调"，必须走进程间通信。

**验证过的机制**：`send-to-session.ts`，own-child 模式（manager 启动 driver 时把自己的 childToken 传给它）。
详见 §3，本节只引用结论：**manager 主动把凭据交给自己启动的子进程，不是伪造身份**，且已端到端实测过
（对一个真实 `-p` 会话注入消息、对方收到并执行）。

**设计**：driver-kernel 在以下时机调用 `send-to-session.ts --pid <manager-pid> --token <manager-childToken>`
（具体消息形态、频率由落地方按 AC146 的"显式承接者"要求设计，本 SPEC 只定时机，不定文本格式）：
1. **round 内某个任务的 `final_state` 是异常态**（`failed`/`timed-out`/`killed`/`spawn-failed`，或 §2.4
   `gap-worker-driver-no-record-on-abnormal-death` 修复后新增的"异常但有记录"态）——立即通知，对应 AC146
   的"needs-human 产生后人不用翻 transcript 就能看到"。
2. **驱动自身判停**（`stopCondition()` 返回 stop=true 且 reason 不是常规的 `pool-empty`）——例如资源门 WAIT、
   halt 生效——这类此前只写进 round 心跳，现在同时通知，防止"驱动停了但没人知道"。
3. **⛔ 不建议**：每次正常完成都通知（会变成噪音，且正常完成本来就该被 promotion-driver/下一轮派发自然消费，
   不需要人看）。

### 2.4 与本会话已发现缺陷的关系（不是本 SPEC 的范围，但落地顺序相关）

`gap-worker-driver-fake-completion-exit-0`（已 done）和 `gap-worker-driver-no-record-on-abnormal-death`
（进行中）这两条修的是"driver 记录是否可信"——**这是 driver-kernel 的地基**。§2.1 的 kernel 抽取工作
**必须在这两条彻底收口之后做**，否则会把"记录不可信"这个缺陷原样复制进 kernel，所有未来的 kind 都会继承它。

---

## 3. 已验证的跨进程通信机制（人要求核实的部分；已查 git 历史并独立复核）

**结论：机制存在、已落地、已端到端实测过——`plugin/scripts/send-to-session.ts`（139 行，纯 Node 脚本，
不依赖 Claude Code SDK，`node --experimental-strip-types` 直接跑）。这不是 `worker-driver.ts` 的
MCP 控制面（那是另一个东西，见下方"排除项"）。**

### 3.1 机制本体

- **落地提交**：`62853261`（2026-08-15 15:50 UTC，"落地 send-to-session.ts（跨会话消息脚本，人裁定继续用+提交 git）"）——**已独立复核，提交真实存在，文件真实存在（7684 字节）**。
- **协议**（脚本头部注释，2026-08-15 实测确认 Claude Code 2.1.233）：
  ```
  第一行：{"type":"auth","token":"<peerToken 或 childToken>"}
  第二行：{"type":"user","message":{"role":"user","content":"<文本>"}}
  ```
  连的是目标会话注册的 Unix domain socket（`~/.claude/sessions/<pid>.json` 里的 `messagingSocketPath`
  字段，与本会话自己发消息用的 `uds:/run/user/<uid>/cc-socks/<pid>.sock` 是同一族）。**fire-and-forget**：
  socket 写完返回 0 字节，无 ack——退出码只代表"连上+写成功"，不代表"对方真收到"。
- **两种身份模式**：
  - `--pid <pid>`（用目标的 `peerToken`）⇒ 对端把发送方当"另一个会话" ⇒ **进 hold-for-approval 队列**。
  - `--pid <pid> --token <childToken>`（用目标自己的 `CLAUDE_CODE_MESSAGING_TOKEN`）⇒ 对端把发送方当
    **own-child** ⇒ **直接投递，不 hold**。

### 3.2 端到端验证证据（不是纸面设计，真跑过）

- `orchestration/manager-tick-log.md:11306-11314`（02:41Z）：起一个 headless `claude -p` worker
  （`--settings '{"crossSessionInbound":"accept"}'`），另一个 shell 跑
  `send-to-session.ts --pid <worker-pid> "ls + 发回"` ⇒ **worker 真的收到、跑了 `Bash ls`、并用它自己的
  SendMessage 工具回复**（回复本身带 `from-mode="bypass"` 包裹可验证）。
- `62853261` 提交信息自带自测记录：`--self` 自发自收，退出码 0，消息真的进了本会话。
- `orchestration/SPEC-worker-driven-inner-2026-08-16.md:196-197` 把它记为已勾选项："✅ 从 shell 给 `-p`
  会话发消息（`send-to-session.ts`）—— 实测：… → 收到并执行 ⇒ 外部驱动可注入指令"。
- **本 SPEC 成文过程中，人要求当场复测，manager 本会话亲自执行**（2026-08-23 13:5xZ）：
  `node send-to-session.ts --self "<验证消息>"` ⇒ 同一回合内本会话收到真实
  `<cross-session-message from="uds:…/4119399.sock" from-name="script-1173074" from-mode="bypass">`
  （消息帧原样送达）——**第三次独立端到端验证，且是本 SPEC 的作者亲自触发、亲自收到，非转述**。

### 3.3 身份模型（脚本自带的设计说明，本 SPEC 原样引用；人 2026-08-23 更正表述后重写）

**这是 quay 自有的、已验证生效的跨进程通信机制，用的是【预先声明的身份】——发送方如实自报"我是一个
脚本、以 bypass 模式在场"（`from-name="script-<pid>"`），不冒充任何具体的其他会话或他人身份。**
`from-mode` 字段由发送脚本自己写入消息帧，不是像原生 SendMessage 那样由 Claude Code 投递层验证后盖印——
**这是该通道的一个结构性特征，不是缺陷**：能连上目标会话 socket、能读到目标 token 这件事本身就是权限
边界（`.key` 文件 600 权限，仅本 OS 用户可读），**通道内的身份声明本来就是同一操作者对自己（或自己
明确启动的子进程）的自我标注，不存在冒充他人的问题**。脚本自己也标了使用范围：面向 owner 自己的会话 /
owner 明确启动的 own-child，**不作为原生 SendMessage 的替代品**——两者定位不同：原生 SendMessage 服务
已注册会话间的常规通信，本机制服务"非 Claude 会话的外部进程"这个原生 SendMessage 结构上覆盖不到的场景
（见 §3.4）。

**⇒ 对 §2.3（driver 出站通知）的设计含义**：driver 进程不是 Claude Code 会话，没有 SendMessage 工具可调，
必须用这条通道。**用 own-child 模式（`--pid <manager-pid> --token <childToken>`），不用 peerToken 模式**：
manager 在 `quay driver start` 时把自己当前的 `CLAUDE_CODE_MESSAGING_TOKEN`（childToken）传给 driver 进程
（例如环境变量，仅 driver 进程可读）——**这是 manager 把自己的通信凭据交给自己启动、自己负责的子进程，
让它能代表这次任务向自己报告，是同一操作者内部的预先声明身份**；**⛔ 不用 peerToken 模式**（会进
hold-for-approval 队列，失去自动通知的意义，且该路径的身份语义本来就是"另一个独立会话"，与 driver
的实际角色不符）。

### 3.4 排除项（避免和另一个机制混淆）

`worker-driver.ts` 的 `serveControlPlane`（MCP over HTTP/SSE，`halt`/`setPreference`/`forceDispatch`
三操作，`Mcp-Caller-Id` 身份）是**另一个、方向相反的东西**——outer/manager 用它**控制** driver，
不是 driver 用它**通知**谁。全仓库 `grep SendMessage plugin/scripts/*driver*` 零命中，**驱动的实际
执行路径用的是 `spawn(cmd, {stdio:"inherit"})` 直接拉起短命 `claude -p` 子进程**（不是向已运行会话注入消息）
——这也印证了 §2.1 里"driver 目前不会主动通知任何人"这个判断是真实缺口，不是找错了地方。

---

## 4. 现有独立脚本清单与整合讨论

### 4.1 候选并入 driver-kernel 的独立脚本

| 脚本 | 现状 | 整合方向 |
|---|---|---|
| `slot-free-trigger.ts` | 独立常驻，Monitor 消费 | 保留脚本本体（判定逻辑不变），**改消费者**（§2.2） |
| `suite-state-trigger.ts` | 独立常驻，Monitor 消费 | 同上 |
| `routine-scheduler.ts` | 纯函数，已解耦判定与执行 | **直接复用**，kernel 调用其判定函数，不重写 |
| `concurrent-batch-scheduler.ts` | 独立 CLI，批量装配用 | 装配策略保留独立（不是每个 kind 都要批量装配），但其依赖的 `checkTouchesPair` 上收进 kernel 后，本脚本改为调用 kernel 暴露的同一实现，**消除潜在的第二份实现漂移**（本会话已实证"第三份副本漂移"两次） |
| `ready-pool-check.ts` | 独立 CLI，两个 driver 都 spawn 它 | **不建议内联**——它是任务库语义判断（AC/DoD/Touches/依赖），复杂度和变更频率都高于"driver 该不该派发"这个机械问题，保持独立 CLI + driver spawn 调用是当前合适的边界（`packages/quay` 领域逻辑 vs `plugin/scripts` 编排逻辑的既有分层，`SPEC-integration-architecture-2026-08-05.md` 已有此判据：机件层"留在外面"） |
| `promotion-driver-launch.sh`（492 行 bash） | 统一入口已达成，但**实现语言与仓库其余部分割裂**：`cli/driver.ts` 只是 `spawnSync` 薄壳，真正的 supervisor 逻辑在 bash 里，测试只能黑盒（256 行测试 / 13 用例 / 仅 5 处 spawn 断言，对比 `worker-driver.ts` 的纯函数单测） | **整体港进 TS kernel 后删除本脚本**（§2.1 末条）。⛔ 非"迁移期并存"——人 2026-08-23 裁定不够集成/不利测试。港完后 `cli/driver.ts` 成为真正实现入口，本 `.sh` 文件从仓库移除（其 8 张 registry 表变成 TS 数据结构，`run_supervisor` 变成可单测的 kernel 函数） |

### 4.2 manager 定时任务（cron/loop）下沉的讨论

**人的第二点要求**：把 manager 的定时任务也改成由 `*-driver` 执行，仅在执行完后用 SendMessage 把必要信息发给 manager。

**现状盘点**：`manager-tick-core.md` 现有 A 段 21 步 + B 段 3 条，其中：
- **机械可下沉**（无需语义判断，直接可迁移成一个 `manager-driver` kind 的常驻循环）：读数收集（A0 `quay-session.ts manager-tick-readings`）、监视器复核（A0 手跑⑤）、哨兵三条件检查、PC/suite/release 新鲜度巡检——**这些正是本会话每轮实际在做的"直接量核实"部分**，无一例外都是纯函数式的"读 → 比较 → 报"。
- **不可下沉**（需要语义判断，必须留在 manager 会话）：判准逐条的"陈旧当现状"式判读（②b/②d/②e 那类"这个结论的依据是测量还是别人的意图"的分诊）、对 outer/inner 报告的因果核验（本会话今日已发生 5 次"拦下他方错误因果"的实例）、AC 落笔/裁定记录、跨层协调消息的措辞。

**⇒ 建议架构**：`manager-driver`（新 kind）常驻跑 A0 读数 + 哨兵检查 + audit 的**机械部分**（"判准框架"本身，即 workflow 里已经存在的 `manager-tick-readings`/`manager-tick-core.js` 逻辑），**读数+初步 audit 结果写进载体**；manager 会话不再每次都触发 `Workflow()` 重新起一整套 subagent 去读，改为：driver 完成一轮后 SendMessage 通知 manager"这轮读数在，有 N 条 audit violation"，manager **按需**读取载体、做语义判读、写 tick-log、决定要不要投递。

**⚠️ 这个改动的收益需要谨慎评估**：本会话当前每轮 `Workflow()` 调用本身就是"机械读数 subagent + audit subagent"的组合（见 `manager-tick-core.js` 的两个 agent），**某种意义上已经是"外包给一次性 subagent"而非"manager 主线程亲自读"**。真正的差异是：现在每次都要 manager 主线程发起 `Workflow()` 调用（占用一次 manager 回合）+ 等待其返回（占用一次 notification 处理）；改成 driver 常驻后，driver 自己按固定节奏跑，manager 只在**有事**（audit 报违规、driver 判停、异常态）时被 SendMessage 唤醒。**⇒ 收益是把"manager 必须每 20 分钟醒一次去发起读数"变成"manager 只在真有事时被叫醒"**——这才是"定时任务下沉"的真实价值，不是省掉读数逻辑本身（读数逻辑已经很薄）。

**⛔ 本 SPEC 不裁定是否现在做这个改动**——这本身也是 AC143 的范围（观测/账本/收尾面驱动化），排在 AC142 收口 + §2.1 kernel 抽取之后。

### 4.3 冷启动简化（人的第三点）——已在讨论轮定性为"副产品"，本节只补充落地检查点

`cold-start/SKILL.md` 472 行 8 大步中，与会话强相关、会话退役后自然消失的步骤（不逐条重复讨论轮已给的分析）：
建 tmux 拓扑、挂 Monitor（若 §2.2 落地则 driver 自己订阅事件，不需要 outer Monitor 转发）、建 20 分钟 cron
（若 §4.2 的 manager-driver 落地则 manager 自己的 cron 也可能简化为"仅在 driver 未按预期通知时的兜底"）、
驱动 inner 起 fast mode（inner 会话本身若按 AC148/149 退役，这步直接消失）。

**落地检查点**（供将来验证"冷启动确实简化了"用，不是现在就要满足）：
`cold-start/SKILL.md` 的步骤数应随 AC143→149 的推进单调下降，且每一步的删除都应能对应一条已 done 的
下一阶段 AC——**⛔ 不接受"觉得不需要了就删"，删除同样要走 AC148 式的"逐条给出归属"纪律**
（本仓库已为"抽查即删"付过代价：2026-08-10 删 164 行、3 条无家可归）。

---

## 5. 非目标

- ⛔ 不在本 SPEC 裁定具体的 kernel 代码实现细节（函数签名、文件拆分方式）——那是实现任务的 Plan，
  本 SPEC 只定架构边界和落地顺序。
- ⛔ 不裁定 manager 会话本身是否退役——AC143-149 的既有范围已明确排除"取消 manager 会话"
  （`manager-phase-goal.md` "📋 下一阶段"节非目标段已写明，manager 保留为语义驱动方，最上层仍有人兜底）。
- ⛔ 不在本 SPEC 里设计新事件的具体 schema——等 §2.2 提到的"第一个真实需求"出现再定义。
- ⛔ 不要求现有独立脚本一次性全部迁移进 kernel——§4.1 的整合是渐进式的，迁移期允许新旧并存
  （registry 表加一列声明"用/不用共享骨架"）。

---

## 6. 排期与验收方向（非最终 AC，供下一阶段立案时参考）

1. AC142 系列全部 done（本文件成文时 4/5 done，剩 §2.4 提到的 no-record 任务）。
2. driver-kernel 抽取（§2.1），至少两个现有 kind（promotion/worker）迁移到共享骨架，**行为不变**
   （既有测试全过 + 生产载体读数与迁移前同构）。
3. 事件订阅接线（§2.2）——**取假点**：制造一次 SLOT-FREE 场景，driver 在事件到达后的秒级响应，
   而非等到下一轮 round（对照当前轮询间隔）。
4. 出站通知（§2.3）落地——**取假点**：制造一次任务异常终止，manager 应通过 `send-to-session.ts`
   own-child 通道收到消息（在 manager 会话里表现为一条 `<cross-session-message>`，与本会话平时
   收到 outer/inner 的 SendMessage 消息在呈现上一致）而不需要主动去读任何载体。
5. manager 定时任务下沉（§4.2）——**取假点**：manager 连续 N 轮不主动发起 `Workflow()`，仍能在真实
   异常发生时于合理延迟内知晓（对照当前每 20 分钟一次的固定节奏）。
6. 冷启动步骤数下降（§4.3）——**取假点**：`cold-start/SKILL.md` 步骤数相比本文件成文时的 472 行/8 步
   有可验证的下降，且每条删除都能追溯到一条已 done 的 AC。
