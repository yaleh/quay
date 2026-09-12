---
id: GOAL-014
title: meta-driver 是否新增「动作记录失败聚合」读数维度（重复工具/skill 调用失败）
status: active
kind: goal
origin: >-
  【要裁定什么】META-005 三条线索中：①（跨部署健康）已由 GOAL-009 AC-203~207（在飞）+
  gap-third-party-fixture-smoke-test-driver-family 覆盖，③（per-AC 时序空转）已由
  gap-goal-gap-done-task-not-traction-respawns-every-round 覆盖且在修；仅②（重复工具/skill
  调用失败无人汇总）是无主的新读数维度。是否把它纳入 meta-driver 读数，以及按什么触发与成本约束纳入？

  【选项与代价】① 纳入：定期经 meta-cc 扫 24h 会话语料，按「同错误×跨会话重复次数」聚合，仅越过阈值才进
  digest（机械形态须能取假、fail-closed、未评估独立取值；成本=新增扫描载体+阈值触发设计，须防原始计数每轮变导致 digest 恒真烧
  LLM）；② 不纳入：维持快照状态载体读数，盲区靠人/子代理周期性扫语料后回溯（成本=结构性盲区持续、每次人工撞坑）；③
  窄覆盖：只对「已立案但长期未生效」的机制任务加失效告警，覆盖②的具体实例
  gap-filing-agent-skill-and-goal-mcp-unavailable-fallback，不建通用聚合（成本=改动小但覆盖窄）

  【实测依据】metaRecords = [META-005]（meta-driver 机械采集于 2026-09-10T09:29:42Z）

  【为什么不能机械决定】②的失败计数不在我任何现有读数里（恰是结构性盲区），无法用 evidenceKey 落地 autoDrive；又无活跃 goal 可挂
  proposal；扩读数面=给 meta-driver 加新感官，涉及每轮 LLM 成本与触发设计（META-005
  已自标成本约束），是机器不应单方面决定的 scope+成本选择

  【怎么关闭】认可某个选项 ⇒ 激活本条（draft→active）；否决 ⇒ 保持 draft 或标 superseded。

  【本条为何由人工写入 + 编号沿革】meta-driver 在 2026-09-10T09:29:42Z 一轮已自行产出本决策并尝试落地为
  GOAL-013，因 fileDecisions 建 GOAL 时不传 --body 而 exit 2 失败（缺陷已立案
  gap-meta-filedecisions-goal-write-omits-body）。其后 GOAL-013 于 10:06:18
  被另一会话用于「判据保真性」议题，故本条改用新编号（硬规则 8：编号不复用）。上面的 question/options/为什么不能机械决定 三段逐字复用
  meta-driver 的产出，人工只补了它没能传的 body 三段。
activatedAt: 2026-09-12T00:33:10.605Z
statusLog:
  - at: 2026-09-12T00:33:10.606Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
---
## 背景

**实证（2026-09-10 一次会话语料扫描，窗口 24h / 顶层会话 871 个 / 工具错误 180 条散在 87 个会话）**：至少 6 个互不相同的会话各自尝试 `quay-file-task` → 再试 `quay:quay-file-task` → 均报 `Unknown skill`，合计 12+ 次；每个会话随后**各自现场**读到已存在的任务体 `gap-filing-agent-skill-and-goal-mcp-unavailable-fallback` 再做回退。⇒ 一个已立案却显然长期未生效的机制缺口，代价是每个子代理各撞一遍、各自发现、各自绕行，而**没有任何机件把这 12 次汇总成一个信号**。

**为什么这在现有读数里不可见**：meta-driver 的六类读数（goals/criteria、6 种 driver 的 running/staleSecs、syncHealth、metaRecords、inertCheckers、focus）**全部读的是状态载体**（`.quay/*.jsonl`、goal store、git），**没有一类读动作记录**（谁试了什么、失败了几次）。`inertCheckers` 管的是**方向相反**的东西（从不报红的惰性守卫），不覆盖「反复报红但无人汇总」。

**为什么它不能靠 meta-driver 自驱解决（结构性理由）**：`autoDrive` 通道强制 `evidenceKey` 必须在**本轮读数**里解析得出 ⇒ 一个**尚不在读数里**的量，在构造上永远不可能成为 autoDrive 的证据。**盲区不可自驱**——这正是本条必须走人工裁定通道的原因，不是谨慎，是机制约束。

**更一般的形状**：`digest` 由读数算出，故任何**从未被读**的量永远不改变 digest ⇒ 无论它怎样恶化，变化检测闸都不会因它唤醒语义半。**缺席不自报缺席。**

## 范围与非目标

**范围**：是否把「动作记录（会话语料）中的工具/skill 调用失败重复模式」纳入 meta-driver 读数；若纳入，采什么触发形态与成本约束（见 origin 的三个选项）。

**非目标（⛔ 逐条排除，避免本条膨胀成「读数面总改造」）**：
- ⛔ **不含 ①（跨部署/第三方环境健康度）**——归 GOAL-012 与 `gap-third-party-fixture-smoke-test-driver-family`（done，落在套件闸上）。
- ⛔ **不含 ③（通用时序派生层）**——已另立 `gap-meta-readings-no-timeseries-derivation`。
- ⛔ **不含修复 `quay-file-task` 技能名解析本身**——那是实例问题，归 `gap-filing-agent-skill-and-goal-mcp-unavailable-fallback`；本条问的是「这 12 次失败为何没有任何机件看见」。
- ⛔ **不在本条内定阈值数值**——成本结构未实测前不设数值阈值（硬规则 4 推论一）；阈值属于选定方案后的实现细节。

**已知成本约束（选 ① 时必须遵守）**：只把「聚合结果是否越过阈值」这个**位**进 `readingsDigest`，⛔ 不把原始计数进——计数每轮都变 ⇒ 摘要恒不相等 ⇒ 闸恒为真 ⇒ 每轮都烧 LLM。另：24h 内 871 个会话，`query_sessions` 的 stats_only 实测 >120s ⇒ 读语料**必须增量**（since = 上轮时刻）且**必须用聚合形态**，⛔ 不能每轮拉全量、更不能拉全文。

## 退出条件

1. 人在 origin 列出的三个选项中作出选择并留痕——**激活本条（draft→active）即裁定本身**；否决则保持 draft 或标 `superseded`。
2. 若选 ① 或 ③：由该选择产生的实现工作**已立案**（含具体 Touches 与能取假的 AC），⛔ 不以「已回答」本身充当完成。
3. 若选 ②（不纳入）：该判断连同理由写进可被后续读到的正本，且 meta-driver 的读数面说明中记明「动作记录不在读数范围内」——⛔ 不留成一个未被记录的默认（否则下一次有人扫语料又会重新发现同一件事）。
4. ⚠️ **激活前须按 AC-217 给本 GOAL 至少配一条 AC 判据**（活跃 GOAL 无退出条件不可判定达成）——本条现为 draft 故尚不违反该判据。