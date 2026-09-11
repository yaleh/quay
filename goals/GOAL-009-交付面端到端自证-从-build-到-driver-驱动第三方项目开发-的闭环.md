---
id: GOAL-009
title: 交付面端到端自证 —— 从 build 到「driver 驱动第三方项目开发」的闭环
status: achieved
kind: goal
origin: 人 2026-09-11：orangevps meta-cc 副本升级路径验证需要一条挂在本 goal 下的新
  AC（AC-238）才能进入持续复验范围；GOAL-009 已第二次被 goal-driver 机械 flip 回
  achieved（印证其自身文档风险5「达成即停止复验」），趁窗口重新打开时挂新 AC。
activatedAt: 2026-09-09T11:49:40.080Z
statusLog:
  - at: 2026-09-09T09:03:58.541Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved"
  - at: 2026-09-09T11:49:40.081Z
    from: achieved
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-11T03:04:50.838Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
  - at: 2026-09-11T03:11:05.813Z
    from: achieved
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-11T03:11:33.655Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
  - at: 2026-09-11T03:11:50.521Z
    from: achieved
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-11T17:17:20.624Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
---
## 背景

quay 已能 build、能跨主机安装、能在第三方项目里 project-scope 初始化，但**装完之后驱动不起来**——
2026-09-08/09 在 B(orangevps, x86_64)/C(ad-arm1, aarch64) 与第三方项目 meta-cc 克隆上实测：

1. **六个 driver kind 无一进交付物**。用仓库自己的 `deriveEntries("./plugin")` 跑：
   `promotion/worker/outer/quality/meta/goal-driver.ts` 全 MISS，`send-to-session.ts` 亦 MISS。
   根因：`driver-runtime.ts:142/154/213` 的 `DRIVER_KINDS` 以**字符串字面量数据表**点名它们当独立进程
   spawn，既不被 esbuild 内联，也不匹配 `build-plugin-dist.mjs` 的任何一条 entry 推导来源
   （09-08 `2afc38d91` 已把 Core 直引机械化，但**未覆盖数据表字面量这一类引用形态**）。
2. **`quay driver start` 报成功、退出 0，而 driver 根本没活**。实测：
   `started: supervisor pid=2598590 kind=promotion` + `exit=0`，而
   `{"supervisor_alive":0,"driver_alive":0,"alive":0,"running":0,"carrier_records":0}`。
   真实死因只写在目标项目内部日志：
   `driver-runtime: driver not found at /tmp/xproj-metacc/plugin/scripts/promotion-driver.ts`
   ——`driver-runtime.ts:986` 把路径锚在 `opts.root`（目标项目根），而按 AC168 闭集，被初始化的项目
   本来就不该有 `plugin/`。`:449` 的 `notifyManager` 同一个错，且 fire-and-forget 无 ack ⇒ 失败不可见。
   `start-drivers.ts` 只把 status 当**启动前的跳过快路径**、启动后只信退出码 ⇒ `/quay:drivers` 同样报成功。
   **昨天的失败是响的（kernel not found），修完之后失败沉了一层，变成静默的。**
3. **quay-init 的禁复制面漏了 mcp**。`quay-init-closure-assertion.ts:40` 的 `FORBIDDEN_PREFIXES` 只有
   `.claude/skills|workflows|agents/` + `plugin/scripts/`，`.mcp.json` 命中数 = 0；且该断言只在
   **开发树 laydown** 上跑，从未在**安装物 + 第三方项目**这个真实形态上跑过。
4. **闭集无 `goals/`**（`CLOSED_SET_DIRS = ["tasks"]`）⇒ 新初始化的项目开箱没有 goal 载体。

**为什么必须是 goal 而不是几条 task**（SPEC-goal-mechanism §11）：task 层判据是一次性的——
`extra.acceptance` 只在 fan-in 当轮跑一次、此后不再重跑。2026-09-08 为上述①②立的三条 task
（`gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs` 等）当夜全部 done，**且都没有
`goal_ac`** ⇒ 它们的取假控制在 fan-in 那一轮验过一次即被丢弃。GOAL-003 的「风险 4」逐字预言过
「AC168 收缩若未修 plugin-root-resolution，下游 quay driver start 全线失效」——**风险被准确写下，
但没有一条 AC 盯着它**，于是它照样发生，而且今天发现它还有第二层。**写进风险栏而没有 criterion
的东西等于没写**，本 GOAL 的每条风险因此要么绑 AC、要么在下方「非目标」里显式列出去向。

## 范围与非目标

**范围（AC-201..AC-207）**：产物完整性（201）；凡被 spawn 的机件必进交付物（202）；driver 在无
`plugin/` 的第三方项目里真活（203）；quay-init 只写启用不写实现（204）；会话投递通道在项目生命周期内
持续可用（205）；目标项目具备 goals+tasks 双载体（206，含 `goals/` 进闭集的六处同步改动）；
端到端由 driver 驱动出真实开发提交（207）。

**非目标（人 2026-09-09 明令暂不列入，各自去向已记，⛔ 不是遗忘）**：

- **freshness 窗口 K 的形态**——「判据锚在多新的 commit 上才算数」。**其代价已知且必须写明**：
  没有 K，本 GOAL 一旦七条全绿即被 I2 机械 flip 为 achieved、离开 active 集，其名下 AC 随之离开
  `check --achieved-failing` 的作用域（`goal-store.ts:497` 逐字：Scope = achieved ACs under
  **ACTIVE** goals）⇒ **达成的那一刻就是停止复验的那一刻**。本 GOAL 显式承认这个洞，不假装没有。
- **AC-208 登记表机械化**（`long-term-guarantee-goal-backed-check.ts:45` 的
  `REGISTERED_GUARANTEES` 是手维护三项表，其 PASS 3/3 是按构造的绿）。
- **AC-209 空作用域不得与「全部通过」同形**（当前 active goal = 0 ⇒ I5 作用域为空 ⇒ 每轮输出
  `{"achievedButFailing": [], "evaluated": true}`，与「58 条全部复验通过」完全同形；同一函数对
  递归那一支专门做了 `evaluated:false` 并引了硬规则 3b，唯独空作用域这一支漏了）。
- **AC-180 re-home**（「active AC 必须有可运行判据」，人 2026-09-09 已同意其内容；但它挂在
  已 achieved 的 GOAL-001 下 ⇒ `goal-driver.ts:619` 只取 active goal ⇒ 当前不在评估域）。
- 插件功能本身的增删；GOAL-003 未竟事项的迁移；`quay-init-closure-ratchet` 手工重锚的消除。

## 退出条件

**散文版**：一次由本仓库现 build 的产物，在**非本机主机**上、**非本仓库项目**里安装，经会话投递点火
（初始化 quay + 启动 drivers）后，由该项目**自己的 `*-drivers`** 驱动，在该项目自身的 git 历史里
留下可核的开发提交，且对应 task 在其 store 里翻到 done；期间会话可**间断介入**做问题分析与
创建 goal/task（正如本项目当前形态）。切换需人明令。机器判据在 AC-201..AC-207，**不在本节**。

**三条方向性读数**（与 AC 并列，非替代）：① 交付物中「被 spawn 却未随包」的机件数 = 0（当前 7）；
② 目标项目 `.quay/*-round.jsonl` 存在窗口内记录（当前 0）；③ 第三方项目 git 历史中存在由任务
worktree 产出的提交（当前 0）。

## 风险

1. **顺序是硬的**：AC-202（机件进包）→ AC-203（driver 真活）→ AC-207（端到端）。颠倒即在缺件的
   前提下调试驱动逻辑。AC-206 的六处同步改动若漏一处即漂移（硬规则 5b）。
2. **AC-203 最容易被写成恒绿**：任何形如「`quay driver start` exit 0」的判据今天就是绿的而系统是死的
   ——判据必须读载体（`alive` / `carrier_records` / `last_record_ts`），⛔ 不读退出码。
   `start-drivers.ts:54` 的 `parseDriverStatus` 已把「读不出」与「不活」分成两个取值，复用它。
3. **AC-204 的「禁列为空」单独成立时可被「什么都不做」满足** ⇒ 必须与「启用声明存在」成对判定。
4. **自证风险**：AC-202..207 的 criterion 必须显式断言 `host ≠ 本机` ∧ `project_root ∉ quay repo`；
   否则在本仓库上一跑就绿，那是结构上不可能报红的绿（gap-ac118 实证）。
5. **达成即停止复验**（见「非目标」第一条）——本 GOAL 已知且暂不处理，由 K 的后续裁定承接。
6. **`claude --bg` 是验证夹具、不是产品能力**（人 2026-09-09）：产品文档与 skill 文案不得因本 GOAL
   而声称 quay 会启动会话，否则夹具会悄悄变成产品承诺。

## 与其他 goal 的关系

承接 GOAL-003（插件面收敛）的**下游验证面**：GOAL-003 把安装收缩成「只写配置」，本 GOAL 回答
「收缩之后，它还驱动得起来吗」——GOAL-003 的风险 4 正是本 GOAL 的 AC-202/203。与 GOAL-007
（done 判据变假无人再评估）同源：本 GOAL 是把一组长期保证显式上移到 goal 层的又一实例。