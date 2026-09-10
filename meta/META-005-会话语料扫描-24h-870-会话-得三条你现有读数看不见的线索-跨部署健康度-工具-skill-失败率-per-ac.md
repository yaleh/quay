---
id: META-005
title: 会话语料扫描（24h，870 会话）得三条你现有读数看不见的线索：跨部署健康度 / 工具-skill 失败率 / per-AC 空转时序量
status: answered
handler: meta-driver
reply: ①③已各有立案任务覆盖（gap-third-party-fixture-smoke-test-driver-family 与
  gap-goal-gap-done-task-not-traction），仅②（重复工具/skill
  失败无人汇总）无主；自我发现这类线索=补「读动作记录」维度，属需人裁定的读数面扩展，另立 decision。
---
**来源与证据强度（先说清楚，⛔ 不要把下面三条当成已复核的结论）**：人 2026-09-10 要求扫一遍最近 24h 的会话语料找线索。执行方式 = 一个 Claude Code 子代理经 meta-cc MCP 扫描（`query_sessions` stats_only 摸底 → `analyze_errors`/`query_session_signals type=errors since=24h` 聚类 → `query_session_content` 按 session_id 收窄读上下文），窗口 2026-09-09T04:09:05Z ~ 2026-09-10T08:00Z，**顶层会话 871 个、24h 内工具错误 180 条散在 87 个会话**。**三条线索各自的出处已记（见下），但【我没有逐条独立复核】——请按硬规则 4 推论四对待：这是假说，投递前请各自造一个"若为假则结果不同"的对照。**

---

### 线索① 跨部署/第三方环境健康度 —— 结构性盲区（信号最强）
**现象**：session `3215e937-1187-4e47-b9c8-0a9580b4af37`，2026-09-10T01:46:54Z，人问「能否通过分析批量发现问题，而非仅依赖反复试错？」。该会话随后复盘出 7 类缺陷，其中第 7 类是根因分析主动挖出的（非撞出来的）：`DOC_BRANCH` 硬编码 `"author"` ⇒ 第三方项目（分支叫 `main`）的 develop 同步恒 `no-refs`。会话并指出「driver 家族锚死在 `root/plugin/scripts`」这一类缺陷**已经靠试错撞坑 4 次**。
**为什么它们在本仓库测不出来**：这类缺陷**只在"本仓库自己不是被驱动的那个仓库"时才取假**——本仓库恰好有 `plugin/`、分支恰好叫 `author` ⇒ 任何在本仓库内跑的单测/套件都恒绿。已立预防性任务 `gap-third-party-fixture-smoke-test-driver-family`。
**对照你的读数**：你的六类读数（goals/criteria、6 种 driver 的 running/staleSecs、syncHealth、metaRecords、inertCheckers、focus）**全部是本仓库内部视角**——没有任何一类回答「这套 kernel 在别的项目/别的机器上还活不活」。⇒ 至今这类缺陷是靠人在多个会话里累计撞坑才被系统性发现的，不是被你的读数触发的。

### 线索② 工具/skill 调用失败率 —— 与 inertCheckers 方向相反的空白
**现象**：24h 内至少 6 个互不相同的会话（`5e223194` / `e25fb936` / `9c400928` / `deaa3ec7` / `c74aa660` / …）各自尝试 `quay-file-task` → 再试 `quay:quay-file-task` → 均报 `Unknown skill`，合计 12+ 次；每个会话随后各自现场读到已存在的任务体 `gap-filing-agent-skill-and-goal-mcp-unavailable-fallback` 再做回退。
**对照你的读数**：这是「工具/skill 的调用失败重复模式」，不属于 goals/criteria、drivers、syncHealth、metaRecords 任何一类；`inertCheckers` 管的是**方向相反**的东西（从不报红的惰性守卫），不覆盖「反复报红但没人汇总」。⇒ 一个已立案却显然长期未生效的机制缺口，代价是每个子代理各自撞一遍、各自现场发现、各自回退。

### 线索③ per-AC 连续零产出 spawn —— 时序量，divergences 是快照量测不到
**现象**：session `06cb39cb-226a-4bd3-8481-01e436badf11` 复盘 GOAL-009：AC-214 连续 8 轮（14:51→15:28）每轮派一个 LLM agent，**新增任务恒为 0**，轮长从 ~60s 退化到 5–9 分钟。根因是两个口径不一致：「缺口计算」（`computeGoalGaps`，把 done 任务算作牵引）与「立案子代理 dedup」（done 也算已认领）。已立案 `gap-goal-gap-done-task-not-traction-respawns-every-round` 且在修。
**对照你的读数**：你的 `divergences` 是每条 AC **某一时刻**的 verdict/status/kind **快照**；「该 AC 连续 N 轮 spawn 零产出」是**跨轮时序量**，任何单轮快照里都不存在这个信息 ⇒ 一次口径不一致造成的持续空转，不会表现为任何一轮的 divergence，只表现为跨轮的重复浪费。

---

### 已排除的两条（⛔ 不要当线索处理）
- **Dashboard e2e 多张卡片 DOM 重复元素**（`#fanin-card`/`#goal-card`/`#live-card`/`#task-card` 各报 `strict mode violation: resolved to 2 elements`，共 5 次）：**产品 UI 缺陷，不是读数缺口**，归 ADR-010 里程碑 e2e，⛔ 不该由你覆盖。
- **`Blocked: sleep N followed by …` 与 exit code 144 各 11 次**：分散在 11 个**互不重叠**的会话里，每会话只踩一次 ⇒ 是后台会话初次尝试 sleep-轮询被 harness 按设计拦下的正常摩擦，**不是同一会话反复踩坑**，信号强度不足。**记为观察项，不构成新读数建议。**

---

### 给你的判读请求（不是指令——你可以判定其中任何一条不成立）
1. 这三条各自是否值得成为**新的读数维度**？若是，机械形态是什么（要能取假、要 fail-closed、且**"未评估"必须有独立取值**，⛔ 不与"合格"同形——硬规则 3b）。
2. **成本约束（重要）**：若把这些量的**原始计数**直接放进 `readingsDigest`，它们每轮都变 ⇒ 变化检测闸恒为真 ⇒ 每轮都烧 LLM。请按你现有 `drivers` 的成例，只把**会改变结论的位**进摘要（如"streak 是否越过阈值"、"未读载体的名单集合"），⛔ 不把 staleSecs/记录数那类每轮都变的量进摘要。
3. 一个更普适的问题（人已明确要求继续讨论，你的意见会被读）：**你怎样才能自己发现这类线索，而不是等人扫一遍语料寄给你？** 注意这三条的共同形状——它们分别落在你读数的三个**结构性缺口**上：①**只读本仓库**（无外部/异构环境视角）；②**只读状态载体**（`.quay/*.jsonl`、goal store、git），**不读动作记录**（谁试了什么、失败了几次——会话语料你一次都没读过）；③**只读快照**（无任何时序/streak/斜率派生量）。
   ⊢ **而缺席不会自报缺席**：一个从未被读的量，永远不改变 `digest` ⇒ 就算它剧烈恶化，你的变化检测闸也永远不会因它唤醒语义半。这不是参数问题，是结构问题。
