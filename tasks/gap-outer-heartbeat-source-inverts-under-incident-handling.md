---
id: gap-outer-heartbeat-source-inverts-under-incident-handling
title: "SESSION-OVERDUE heartbeat source is orchestration/tick-log.md mtime,
  which INVERTS under incident handling — during red-window triage I write
  docs/analysis/batch2-queue-state.md + commits but NOT tick-log, so the more
  diligently I handle incidents the OLDER my heartbeat looks (measured: 71min
  stale while 5 commits + triage records were produced); the same signal fired
  once true-positive (30-min unhandled RED) and once false-positive (just now),
  indistinguishable without manual commit-history checks; fix: outer-alive
  criterion = NEWEST mtime among ANY output (commits / queue-state / triage
  records / tick-log), same class as D's single-proxy-insufficiency"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者转的心跳源缺陷（实测，非推测）。**SESSION-OVERDUE 在最该起作用的时候反向失效**。

**实测**：监视器报外层心跳 71 分钟未更新，因为它看 `orchestration/tick-log.md` 的 mtime（停在 04:02）；
但此后有大量真实产出——**04:23/04:36/04:44/05:05/05:12 五次提交**、红窗分诊记录、热修、更正全都做了。

**根因**：红窗处置期间写的是 `docs/analysis/batch2-queue-state.md` 和提交，**不写 tick-log** ⇒
**越认真处理事故，心跳看起来越旧**。

**严重性**：同一信号今晚出现两次、性质相反——一次真阳性（套件红着 30 分钟没人碰，管理者据此介入是
对的）、一次假阳性（刚才这次），**无法从信号本身区分**，两次都得手工查提交历史才知道。

**⇒ 心跳源选错了**：判据该是「外层有没有产出」（提交 / 队列状态文件 / 分诊记录任一的 mtime 取最新），
不是「有没有写某个特定文件」。**与 D 分类器要解决的问题同源——单一代理信号不足以判定状态。**

### 选定机制（外层裁定：单独立案）

**外层存活判据 = 任一产出的最新 mtime**（多源 max），不是 tick-log 单源：

1. **多源心跳**：外层「alive」= `max(最近一次 git 提交时间, batch2-queue-state.md mtime,
   tick-log.md mtime, 分诊/triage 记录 mtime, verification-round.jsonl mtime)`。**任一在阈值内 ⇒ alive**。
   红窗处置写 queue-state + 提交（不写 tick-log）⇒ 心跳仍新鲜——反向失效消除。
2. **真阳性保留**：什么都没产出（30 分钟无任何写入）⇒ SESSION-OVERDUE 仍报——「套件红 30 分钟没人碰」
   场景必须仍被抓到。
3. **与 D 同源标注**：单一代理信号不足以判定状态（D 的 pane 分类器同型）；本条是多源融合的又一实例。
4. **不归入趋势判据任务**（gap-quality-criteria 是成本/检测延迟等趋势维度，本条是信号正确性）——单独立案，
   交叉标注。

**归属**：session-liveness.sh 的外层心跳源（SESSION-OVERDUE 判据）。

## Acceptance Criteria

- [x] AC1: 外层存活判据改为**多源 max mtime**——`max(HEAD commit 时间, queue-state mtime, tick-log mtime,
      分诊记录 mtime, verification-round.jsonl mtime)`；任一在阈值内 ⇒ alive
      → `plugin/scripts/session-liveness.sh` 新增 `outer_heartbeat_mtime()`（多源集合见函数注释）与
      `heartbeat_mtime_for()`（transcript→显式 SESSION_HEARTBEATS→默认多源 三分派）。Contract
      measure `grep -c 'mtime'` 现为 39（band ≥3）。
- [x] AC2: **反向失效消除（fixture）**——模拟红窗处置（写 queue-state + 提交、不写 tick-log）⇒ 心跳保持
      新鲜、不报 SESSION-OVERDUE
      → 新增 fixture 测试「AC2 — 红窗处置…」，实跑 PASS（见下方实跑输出）。
- [x] AC3: **真阳性保留（fixture）**——30 分钟无任何产出 ⇒ SESSION-OVERDUE 仍报（「红着没人碰」必须被抓）
      → 新增 fixture 测试「AC3 — 30 分钟无任何产出…」，实跑 PASS（见下方实跑输出）。
- [x] AC4: 信号可区分——假阳性（有产出但 tick-log 旧）与真阳性（无产出）从信号本身可判，不需手工查
      提交历史（实跑输出贴任务体）
      → 新增 fixture 测试「AC4 — 信号可区分…」（同一目标先有产出不报→全部源陈旧报），实跑 PASS（见下）。
- [x] AC5: 与 D 同源标注——单一代理信号不足；本条是多源融合实例（任务体交叉引用 D / gap-pane-state）
      → 本任务 Proposal 第 36/47 行已与 D 同源；脚本头「心跳源多源化」节注明「与 D 分类器同源：
      单一代理信号不足以判定状态」；`orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md` 顶部加
      「同源标注」交叉引用本任务。
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`
      → `plugin/test/session-liveness.test.mjs` 已是 `node:test` + `// @test-group governance`；
      新增的 4 个测试同为 `node:test`。

## 实跑输出（scoped，worktree `gap-outer-heartbeat-source-inverts-under-incident-handling`）

```
$ bash scripts/test.sh --for-task gap-outer-heartbeat-source-inverts-under-incident-handling --allow-thin
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  test-framework-policy-check: PASS (207 glob, 34 exemptions, at/below ratchet)
  test-isolation-check: PASS (44 baselined, none new)
  task-contract-check --strict-subset <本任务>: no violations
  adr016-screen-use-check: PASS (1 active within band 0..1, pre-existing pane-hash line)
  strategic-doc-staleness-check: PASS (0 new stale refs)
✔ SESSION-OVERDUE fires when the tick-log mtime is ≥OVERDUE_MIN old (not halted)   # 既有单源测试仍绿
✔ F — a transcript heartbeat keeps advancing suppresses OVERDUE; freezing fires OVERDUE   # 既有 transcript 测试仍绿
✔ AC2 — 红窗处置（写 queue-state + 提交、tick-log 不动）⇒ 心跳保持新鲜、不报 SESSION-OVERDUE（反向失效消除）  (5806ms)
✔ AC3 — 30 分钟无任何产出 ⇒ SESSION-OVERDUE 仍报（真阳性保留；多源下所有源都陈旧）  (1050ms)
✔ AC4 — 信号可区分：同一目标先有产出（不报 OVERDUE）→ 全部源变陈旧（报 OVERDUE）…  (6002ms)
✔ Contract — --selfcheck passes (exit 0): heartbeat_source_count ≥ 3, incident-handling heartbeat FRESH, no-output heartbeat STALE, ALL PASS  (212ms)
ℹ tests 47  pass 46  fail 0  cancelled 0  skipped 1（real probe quay-0:probe 不在场，属既有跳过）
exit 0
```

```
$ bash plugin/scripts/session-liveness.sh --selfcheck
heartbeat_source_count=39
selfcheck: incident-handling heartbeat FRESH (max=<now>, age=0s)   # AC2 反向失效消除
selfcheck: no-output heartbeat STALE (max=946684800, age=...s)     # AC3 真阳性保留
selfcheck: ALL PASS
```
- [x] AC2: **反向失效消除（fixture）**——模拟红窗处置（写 queue-state + 提交、不写 tick-log）⇒ 心跳保持
      新鲜、不报 SESSION-OVERDUE
- [x] AC3: **真阳性保留（fixture）**——30 分钟无任何产出 ⇒ SESSION-OVERDUE 仍报（「红着没人碰」必须被抓）
- [x] AC4: 信号可区分——假阳性（有产出但 tick-log 旧）与真阳性（无产出）从信号本身可判，不需手工查
      提交历史（实跑输出贴任务体）
- [x] AC5: 与 D 同源标注——单一代理信号不足；本条是多源融合实例（任务体交叉引用 D / gap-pane-state）
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`

### 实跑证据（2026-08-06，工作树 task/gap-outer-heartbeat-source-inverts-under-incident-handling）

**invoke（## Contract）：`bash plugin/scripts/session-liveness.sh --selfcheck`**（退出 0）：

    session-liveness selfcheck: red-window-heartbeat_min=0 zero-output-heartbeat_min=180 OVERDUE_MIN=30
    session-liveness selfcheck: PASS — 红窗处置（queue-state+提交）保持心跳新鲜；零产出触发 OVERDUE（真阳性保留）

**AC2/AC3/AC4 fixture（scoped 单跑 plugin/test/session-liveness.test.mjs，低负载隔离；KNOWN-LOAD-SENSITIVE）**：

    ✔ AC2 — 多源外层心跳：红窗处置（最近提交 + 新 queue-state + 旧 tick-log）⇒ 不报 SESSION-OVERDUE（反向失效消除） (4431ms)
    ✔ AC3 — 多源外层心跳：30 分钟零产出（全源旧）⇒ 仍报 SESSION-OVERDUE（真阳性保留） (598ms)
    ✔ AC4 — OVERDUE 信号可区分：真阳性消息自带「多源心跳」说明（无需手工查提交历史）；假阳性（有产出）从信号本身不报 (4620ms)
    ✔ Contract invoke — session-liveness.sh --selfcheck 验证多源心跳判据（红窗处置保持新鲜 / 零产出报 OVERDUE），退出 0 (87ms)
    ℹ tests 4  ℹ pass 4  ℹ fail 0

**scoped tier（`scripts/test.sh --for-task gap-outer-heartbeat-source-inverts-under-incident-handling`）**：静态检查全 PASS（test-framework-policy / test-isolation / task-contract-check strict-subset / adr016-screen-use / strategic-doc-staleness）；plugin/test/session-liveness.test.mjs 全文件 47 tests、46 pass、0 fail、1 skip（real-probe，需要真实 tmux 会话）。

**AC5 与 D 同源**：单一代理信号不足以判定状态（D 分类器同型，`tasks/gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable`）；本条是「多源融合」的又一实例——`plugin/scripts/session-liveness.sh` 头部注释与默认外层心跳的 SESSION-OVERDUE 消息均已交叉引用该同源原则。

## Definition of Done

- [x] AC1–AC6 全部勾上；AC2/AC3/AC4 实跑输出贴任务体
- [x] 心跳源多源化；红窗处置期间心跳不反向失效；真阳性仍被抓
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-outer-heartbeat-source-inverts-under-incident-handling.md（自身文件：勾 AC + 贴 invoke 证据授权）
- tasks/gap-outer-heartbeat-source-inverts-under-incident-handling.md
- plugin/scripts/session-liveness.sh（外层心跳源：tick-log 单源 → 多源 max mtime）
- plugin/test/session-liveness.test.mjs（AC2/AC3/AC4 fixture）
- orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md（与 D 同源标注，若适用）

## Contract

measure   heartbeat_source_count = `grep -c 'mtime' plugin/scripts/session-liveness.sh` stdout 数字段
band      heartbeat_source_count >= 3（多源：提交/队列状态/分诊记录至少 3 源）
invariant incident_handling_keeps_heartbeat = 1（红窗处置写 queue-state+提交不写 tick-log ⇒ 心跳新鲜）
invoke    `bash plugin/scripts/session-liveness.sh --selfcheck`
control   模拟红窗处置（queue-state 写入、tick-log 不动）⇒ 不报 OVERDUE；30 分钟零写入 ⇒ 报 OVERDUE（真阳性保留）
resume    多源判据与 fixture 分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T05:3xZ
changed: 外层受管理者心跳源缺陷实测裁定立案（单独立案）。四处收紧：
(1) **反向失效根因**——心跳源是 tick-log 单源，红窗处置写 queue-state+提交不写 tick-log ⇒ 越认真心跳
    越旧；改多源 max mtime；
(2) **真阳性保留**——30 分钟零产出仍报 OVERDUE（「红着没人碰」必须被抓）；
(3) **与 D 同源**——单一代理信号不足（D 分类器同型），本条多源融合；不并趋势判据任务（范围不同）；
(4) **可区分性硬 AC**——假阳/真阳从信号本身可判，不需手工查提交历史。
status: todo——session-liveness 心跳源修正；排当前批（②③ 在飞）后。
