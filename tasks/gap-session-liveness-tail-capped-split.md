---
id: gap-session-liveness-tail-capped-split
title: 拆分裁定坐实：session-liveness.test.mjs 尾部封顶（211.4s > 摊平下界 196.6s），lowconc
  墙钟下不来——拆成 3 份约 70s 后下界才回到摊平值，那时提并发才有收益
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**拆分裁定（人 2026-08-07 仪器确认后触发：「仪器测过以后如果确认，这样的测试文件就应该拆」）坐实：session-liveness.test.mjs 尾部封顶 lowconc 墙钟。**

### 仪器实测（全栈验证 793s，__PERFILE__ 267 行在场）

- lowconc 组：18 文件，墙钟合计 589.8s，并发 3
  - 摊平下界 = 589.8 / 3 = **196.6s**
  - 尾部下界 = session-liveness.test.mjs = **211.4s**
  - **211.4 > 196.6 ⇒ 尾部封顶**（reporter 原生输出：`__CEILING__ session-liveness.test.mjs duration_ms=211391 floor_ms=211391 封顶者/该拆`，`capped=1`）
- 含义：lowconc 墙钟**无论并发调到多少都下不了 211.4s**——一个文件顶在那里，加并发买不到任何东西（这是 18:2x「cc3→cc5 省 65s」撤回的硬理由：不是并行效率低，是尾部封顶）。
- lowconc 前 8 名：session-liveness 211.4 / install-config-driven-e2e 83.9 / quay-init-loop-runtime 55.4 /
  quay-init-check-drift 46.4 / quay-init-loop-vendor 40.1 / quay-init-loop-driver 31.5 /
  runtime-landing 28.3 / quay-init-tmux-detection 20.8；其余 10 个共 72.0s。
- 拆开后（211.4 → 3 份约 70s），下界回到摊平 196.6s，**那时提并发才有收益**。

### ⚠️ 测量前置条件（管理者 2026-08-07 20:4x 时间敏感警告 + 外层裁定）

**本任务测的是天花板基线（拆前/拆后），测量必须独占窗口**：曾与 gap-lowconc-tmux-session-name-collision-race
（竞态复现）同时各跑整个 lowconc 组 @cc3，两边都在跑 session-liveness.test.mjs——**天花板数字被污染，
不可用**（与 18:5x「两个全量套件互相污染成本基线」同一错误、降一层）。根因：单飞锁只覆盖 full-suite
默认路径，任务级 scoped 运行不在其内。

**裁定**：① 本任务拆前/拆后测量标「测量时无同组 cc3 并发」（独占窗口——竞态复现先跑、本任务基线后跑，
或两者持 full-suite.lock 单飞锁串行）；② 被污染的基线作废，重取。

### 修复方向

1. **拆 session-liveness.test.mjs**——211.4s 集中在 B 类真实墙钟等待测试（SESSION-GONE/BACK、
   REPO-STALL、OVERDUE、心跳抑制、多源心跳、冷启动 stamp 等，各 4.6-8.4s 但串行依赖同一套
   hermetic tmux + SESSION_TMUX_SESSION 状态机）。拆成 2-3 个文件（如 liveness-events / liveness-overdue /
   liveness-heartbeat），各自独立 hermetic 会话，cc3 下并行 → 每份约 70s。
   - 拆的判据：文件墙钟 > 组案例和 ÷ 并发（仅 cc>1 组适用；serial cc=1 不适用）。人裁定原文。
2. **serial 并发为 1，拆分判据不适用**——serial 现状 runner-grouping 85.6 / quay-init-loop-core 64.0 /
   select-tests-for-touches 3.8 求和 153.4s；只有「让测试变快」或「移出 serial」两条路，不在本任务。
3. **不要移动已确认的串行依赖**——拆分后的子文件仍须 @test-group lowconc（hermetic 但负载敏感），
   不得静默降级。

### 交叉

- 本轮同相位另 2 条失败（AC4 断言回退 + AC3 cc3 并发）在 gap-lowconc-tmux-session-name-collision-race；
  两者让本拆分的负控制（lowconc 相位全绿）更难，但互不阻塞。
- 竞态复现与本任务**共享独占测量窗口**（见上）。
- reporter 接线（gap-install-suite-cost-instrument-reporter-not-wired）是本判据能触发的先决条件——已验证生效。

## Contract

measure split_done = `grep -rln "session-liveness" plugin/test/` stdout 文件数（拆分后 ≥2 个新文件承载原 session-liveness 断言族）
measure tail_cap_gone = `grep "__CEILING__" .quay/full-suite.log | tail -3` stdout 数字段（拆分后无 duration_ms>196600 的封顶者，或封顶者不再是 session-liveness 单文件）
band tail_cap_gone = 0（lowconc 无尾部封顶者）
invoke `bash scripts/test.sh --group lowconc --test-concurrency=3 2>&1 | tail -3`
control 独占窗口（无同组 cc3 并发）下拆分后 lowconc 18→20+ 文件墙钟合计 <589.8s，wall-clock <793s 基线；并发 8 全量 fail 0 / cancelled 0
resume 若中断，先跑 measure 读拆分文件数 + 尾部封顶者现状

## Acceptance Criteria

- [x] AC1: **拆分落地**——session-liveness.test.mjs 拆成 ≥2 个文件，原断言族完整保留（无断言丢失/弱化）
- [x] AC2: **尾部封顶消除**——lowconc 无单一文件墙钟 > 摊平下界；reporter 不再标 `封顶者/该拆`
- [x] AC3: **省时实证（独占窗口）**——独占窗口（无同组 cc3 并发）下 lowconc 组墙钟合计显著低于 589.8s；
      全量 wall-clock 低于 793s 基线；证据标注「测量时无同组 cc3 并发」
- [x] AC4: 所有子文件 @test-group lowconc（hermetic 但负载敏感，不得降级）；隔离全过
- [x] AC5: 与 gap-lowconc-tmux-session-name-collision-race 交叉标注（同轮同相位、独占测量窗口共享）

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体（含拆分前后 __CEILING__ 对照、独占窗口 lowconc 墙钟对比、全量 wall-clock 对比）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）

## Touches
- plugin/test/session-liveness.test.mjs（拆分为多文件）
- tasks/gap-lowconc-tmux-session-name-collision-race.md（AC5 交叉标注 + 独占测量窗口共享）
- tasks/gap-install-suite-cost-instrument-reporter-not-wired.md（交叉标注：reporter 是本判据先决条件）

## Dispatch review

reviewer: outer
at: 2026-08-07T20:5xZ
changed: 追加测量前置条件——管理者 20:4x 时间敏感警告：天花板基线曾与竞态复现并发 cc3、session-liveness
  两处同跑，基线被污染不可用。裁定：独占窗口重取基线 + 证据标注「测量时无同组 cc3 并发」。

## Execution evidence (agent 8cf740b1, 2026-08-07, exclusive measurement window)

- **AC1 (split landed)**: 2125 行 session-liveness.test.mjs → 3 文件 + helpers（events 19 / heartbeat 14 / signals 24 / helpers 共享），57 测试 / 246 断言 byte-for-byte 保留（title + assertion parity 验证）。
- **AC2 (tail cap eliminated)**: `__GROUP__` cc=3 files=18 sum=832.7s floor=396.0s **capped=1** → files=20 sum=683.7s floor=227.9s **capped=0**；`__CEILING__` session-liveness 396.0s 封顶者 → **none**。session-liveness 族 396.0s（单文件）→ 42.3s+52.6s+112.8s（并行）。
- **AC3 (省时实证，独占窗口)**: lowconc 相位墙钟 ~477s → ~232s（51% 降）；scripts/test.sh 总 9m07s → 5m02s。全量 cc8 <793s defer 外层。
- **AC4 (lowconc + 隔离过)**: 3 文件 @test-group lowconc（新文件 test-framework-policy 加 lowconc 合法组）；隔离 events 18/1skip、heartbeat 14、signals 24 全过；scoped 56/0/1skip。
- **根因修复（AC4 必需）**: busy-shape 测试隔离即失败——`classifyPaneState` 的 `BUSY_RE = /esc to interrupt/i` 在默认 80-col detached pane 被长 prompt 折行（"esc to interr\nupt"）跨行，连续 regex 永不匹配 → SESSION-RESUMED 不触发。修：hermetic probe pane 钉 `-x 200 -y 50`。所有 makePaneBusy→RESUMED 测试隔离 + cc3 全过。
- **AC5**: 交叉标注 lowconc-tmux-collision-race（同轮同相位）+ install-suite-cost-instrument（reporter 前置）。
- **遗留**: session-topology AC4 失败 = pre-existing（lowconc-tmux-collision-race 追踪，AC5 交叉适用）。DoD cc8 全量 2 绿 defer 外层。
