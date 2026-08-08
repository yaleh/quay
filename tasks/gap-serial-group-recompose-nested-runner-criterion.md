---
id: gap-serial-group-recompose-nested-runner-criterion
title: "Serial group mixes two reasons — recompose per manager audit: only 3
  must stay serial (nested runner spawning own worker-pool sub-suites:
  runner-grouping 21 / select-tests-for-touches 23 / quay-init-loop-core 18);
  checker-cost needs LOW LOAD not cc1 (9 timing-sensitive, monotonicity
  assertion) → lowconc; session-topology self-isolated (9 hermetic tmux signals,
  made itself concurrency-safe but stays serial) → lowconc;
  install-config-driven-e2e's only serial mention is 'AC8: node:test +
  @test-group serial' (acceptance criterion not technical necessity) → lowconc;
  saves ~37s (15% of serial 246s, the ONLY group where moving one file saves its
  full time) with annotation-only changes; ALSO the quay-init-loop-core [serial]
  vs driver/runtime/vendor [lowconc] GROUP NOTES are verbatim-identical — real
  criterion is nested-runner, text says load-sensitive; elevate 'nested runner'
  as the explicit serial criterion"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

> **Cross-annotation (2026-08-07) — baselines VOIDED by concurrency pollution (AC3/AC5 of
> `gap-resource-gate-no-single-flight-lock-two-suite-overlap`):** this task's serial-group
> baselines (serial 246s, per-file 86.4s/61.7s/27.8s, the ~37s saving) were measured during the
> 2026-08-07 window when TWO cc8 full suites ran concurrently (this task's worktree +
> `task/wire-suite-cost-reporter`), 3x+ oversubscription on 4 cores (PSI cpu some avg10 = 86.22,
> gate limit 40) — serial was being re-measured UNDER another cc8's load, the exact failure mode
> the serial group exists to avoid. Those numbers are **silently-wrong baselines** and must NOT be
> written into ACs/evidence as the reference. **Action: after the single-flight lock
> (`gap-resource-gate-no-single-flight-lock-two-suite-overlap`) lands, re-measure the serial
> recompose (before/after) in a clean single window (one cc8 suite alone).** Until the lock lands,
> treat this task's serial elapsed-time numbers as untrustworthy.

## Proposal

**serial 组混了两种理由——按管理者审计重编：必留 serial 的只有 3 个（嵌套 runner），移走 2 个 +
checker-cost，直接省 ~37s（serial 246s 的 15%）、只改组注解。**

### 审计证据（管理者 18:5x，机械可复现；耗时 = 名字匹配下界，归属率 77%）

| 文件 | 嵌套runner | 自隔离 | 时序敏感 | 耗时 |
|---|---|---|---|---|
| runner-grouping | 21 | 0 | 0 | 86.4s |
| select-tests-for-touches | 23 | 1 | 0 | 3.3s |
| quay-init-loop-core | 18 | 0 | 0 | 61.7s |
| checker-cost | 2 | 0 | 9 | 0.8s |
| session-topology | 4 | 9 | 0 | 9.2s |
| install-config-driven-e2e | 2 | 1 | 0 | 27.8s |

（嵌套runner = 匹配 test.sh\|node --test\|--test-concurrency；自隔离 = mkdtemp\|tmpdir\|TMUX_TMPDIR\|-S；
时序敏感 = MONOTONIC\|loadavg\|jitter\|elapsed）

### 分组裁定

**必留 serial（前三个，同一理由：嵌套 runner）**——spawn `node --test` / `test.sh --for-task` 带自己
worker 池的子套件；cc8 下 8 个这种文件 = 8×N 进程。cc1 是正确答案不是保守：
- runner-grouping / select-tests-for-touches / quay-init-loop-core

**移出 serial**：
- **checker-cost → lowconc**（理由完全不同：只需【低负载】不需 cc1——9 处时序敏感、断言
  400→800→1200ms 单调性、并发 8 主体负载下 node 启动抖动破坏它）；
- **session-topology → lowconc**（9 处自隔离 + 自声明 hermetic tmux private socket、kill-session never
  kill-server——把自己做成并发安全却仍留 serial，隔离功课做了、分组没跟）；
- **install-config-driven-e2e → lowconc**（唯一串行提及是「AC8: node:test + @test-group serial」——
  是所属任务的验收标准非技术必要性；全文没说"不串行会怎样"）。

**成本回报**：serial 是 cc1（唯一「移走一个文件直接省下它全部耗时」的组——其它组摊平、serial 求和）。
install-config-driven-e2e 27.8s + session-topology 9.2s ≈ **37s（serial 246s 的 15%）**，且只改一行组注解、
不需改测试代码。checker-cost 移出后 serial 更纯。

**判据可信度问题（更要紧）**：quay-init-loop-core [serial] / driver/runtime/vendor [lowconc] 的 GROUP
NOTE 文本逐字相同——同一家族、同一段理由，一个在 serial 三个在 lowconc，至少一边错。实际判据是
【core 有 18 处嵌套 runner、另三个没有】——即【实际判据 = 嵌套 runner，写在注释里的理由 = load-
sensitive】。**提升"嵌套 runner"为 serial 组的显式判据**（注释/文档写明：进 serial 的唯一理由是
spawn 自己 worker 池的子套件；其它理由（低负载/时序）走 lowconc），让人能靠读注释判断新文件归组。

## Contract

measure serial_members = `grep -rlE '@test-group[[:space:]]+serial' plugin/test/ packages/*/test/ 2>/dev/null | wc -l` stdout 数字段（重编后 = 3：runner-grouping/select-tests-for-touches/quay-init-loop-core）
measure serial_dur_s = `grep -A1 "selected .* files (groups=serial)" .quay/full-suite.log | grep duration_ms | tail -1` stdout 数字段（移走后应 <210s，现 246s）
band serial_members = 3 且 serial_dur_s = <210（serial 收窄为嵌套 runner 三文件）
invoke `bash scripts/test.sh --group serial 2>&1 | tail -3`
control serial 只留嵌套 runner 三文件；checker-cost/session-topology/install-config-driven-e2e 在 lowconc 隔离 + 并发 8 全绿；serial 注释写明"嵌套 runner"判据
resume 若中断，先跑 measure 读 serial 成员数与耗时

## Acceptance Criteria

- [x] AC1: **serial 收窄为 3 个嵌套 runner 文件**——runner-grouping / select-tests-for-touches /
      quay-init-loop-core；serial 段耗时 <210s（现 246s）
- [x] AC2: **移出 3 个**——checker-cost / session-topology / install-config-driven-e2e → lowconc；
      lowconc 组 cc3 下隔离 + 并发 8 全绿（无 flaky 放回）
- [x] AC3: **"嵌套 runner"提升为显式判据**——serial 组注释/文档写明唯一理由 = spawn 自己 worker 池的
      子套件；低负载/时序理由走 lowconc；GROUP NOTE 不再与判据对不上（core 与 driver/runtime/vendor
      的重复文本统一到新判据）
- [x] AC4: **负控制**——移出后各文件隔离 + 并发 8 全绿（session-topology hermetic tmux 不 flaky、
      install-config-driven-e2e 不依赖串行、checker-cost 在 lowconc 低负载下单调性断言过）
- [x] AC5: 与 gap-install-suite-cost-instrument-reporter-not-wired（仪器确认拆分/归组判据）、
      gap-lowconc-group-concurrency-3（lowconc 组成员）交叉标注

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（含 serial 段 before/after 耗时、移出文件在 lowconc 的隔离 + 并发 8 绿）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）——外层验证轮 full-suite 门（fan-in 时跑）

## 执行证据（2026-08-08，worktree task/gap-serial-group-recompose-nested-runner-criterion）

**AC1 — serial 收窄为 3 文件 + 耗时**（`bash scripts/test.sh --group serial`，单窗口干净跑，2026-08-08）：

    selected 3 files (groups=serial)
    __PERFILE__ duration_ms=77378   quay-init-loop-core.test.mjs        passed=true
    __PERFILE__ duration_ms=94579   runner-grouping.test.mjs             passed=true
    __PERFILE__ duration_ms=4362    select-tests-for-touches.test.mjs    passed=true
    ℹ duration_ms 176367.31   # serial 段 = 176.4s < 210s（现 246s 基线）

**AC2/AC4 — 移出文件在 lowconc 全绿 + 隔离全绿**（`--group lowconc` cc3 组跑 + 各文件隔离跑）：

    __PERFILE__ duration_ms=4705    checker-cost.test.mjs               passed=true   (lowconc cc3)
    __PERFILE__ duration_ms=12704   session-topology.test.mjs           passed=true   (lowconc cc3)
    __PERFILE__ duration_ms=95434   install-config-driven-e2e.test.mjs  passed=true   (lowconc cc3)
    隔离：checker-cost 8/8 pass · session-topology 10/10 pass · install-config-driven-e2e 10/10 pass

**AC3 — 判据文档 + GROUP NOTE 对齐**：`plugin/loop/fast-mode-loop-tick.md`「serial 组的显式判据」
一节写明唯一理由 = spawn 自己 worker 池的子套件；`quay-init-loop-core`（serial）与
`quay-init-loop-{driver,runtime,vendor}`（lowconc）的 GROUP NOTE 由逐字重复的 load-sensitive 文本
统一为新判据（core = 嵌套 runner 留 serial；另三个 = 非嵌套 runner 走 lowconc）。

**AC5 — 交叉标注**：`tasks/gap-install-suite-cost-instrument-reporter-not-wired.md`、
`tasks/gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive.md` 的 Touches 各加一条
`gap-serial-group-recompose-nested-runner-criterion`（AC5 交叉标注）。

**scoped gate**：`bash scripts/test.sh --for-task gap-serial-group-recompose-nested-runner-criterion --allow-thin`
→ EXIT 0；scoped 静态层（test-impl-census / task-contract strict-subset / adr016 / dead-code）全绿；
selector 0/4 Touches 解析（thin，移出文件已是 lowconc），full suite 在 fan-in 跑。

**附带说明**：`--group lowconc` 全组 22 文件有 2 个非本任务文件的失败——`stage-receipt.test.mjs`
（隔离也红，develop 既有确定性失败，line 314 CLI 断言）与 `session-liveness-signals.test.mjs`
（隔离 27/27 绿，cc3 组载下 flaky，属 lowconc 隔离族）。均与本任务组注解改动无关。

## Touches
- plugin/test/session-topology.test.mjs / install-config-driven-e2e.test.mjs / checker-cost.test.mjs
  （@test-group serial → lowconc）
- plugin/loop/fast-mode-loop-tick.md 或 scripts/test.sh（serial 组"嵌套 runner"显式判据注释）
- tasks/gap-install-suite-cost-instrument-reporter-not-wired.md（AC5 交叉标注）
- tasks/gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-07T19:0xZ
changed: 管理者 18:5x 审计 serial 组（混两种理由、两个文件站不住）。外层裁定：serial 收窄为 3 个嵌套
  runner 文件（runner-grouping/select-tests-for-touches/quay-init-loop-core）；checker-cost（需低负载
  非 cc1）/session-topology（自隔离并发安全）/install-config-driven-e2e（串行是验收标准非技术必要）
  → lowconc；省 ~37s（15% serial）只改组注解。"嵌套 runner"提升为 serial 显式判据（GROUP NOTE 与
  判据对齐）。
