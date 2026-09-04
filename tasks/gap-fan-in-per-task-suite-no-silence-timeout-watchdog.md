---
id: gap-fan-in-per-task-suite-no-silence-timeout-watchdog
title: per-task fan-in suite 路径缺单次运行静默/超时看门狗——挂死无限等（已退役 full-suite-runner.ts 曾有
  SUITE_SILENCE_MS，fan-in detached 直跑无对应物）
status: superseded
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  superseded: true
  superseded_at: 2026-08-27
  superseded_by: gap-fan-in-driver-mechanical-orchestration
---
**type:** execution
> **SUPERSEDED / 作废（人 2026-08-27 裁定，新 SPEC gap-fan-in-driver-mechanical-orchestration）**：修复对象 fan-in-execute.js 随新 SPEC 退役（取消 workflow 子代理、driver 机械驱动）；新 SPEC「suite 不 detach」从根上消除挂死，per-task 看门狗失效。历史诊断保留，不重开。

## Proposal

per-task fan-in suite 路径（fan-in-execute.js 的 detached `setsid bash scripts/test.sh --buckets <task>`）**缺单次运行的静默/超时看门狗**，挂死时无限等。

**实测（2026-08-26，manager 诊断 + outer 读数核实）**：ac143 的 `plugin/test/worker-driver.test.mjs` 子进程挂死 34min（STAT=Sl、1% CPU 睡眠态、无 .exit marker、无输出），是史上最慢记录 224.4s 的 **9 倍**——不是固有慢，是真挂死。

**根因（三层，缺一不可）**：
```
① suite-lpt-runner 调 node --test 时 --test-timeout=0 ⇒ 单测试无超时上限
② worker-driver.test.mjs waitFor() 默认 10s 但只保护「轮询等待」这一种写法；
   卡在别的 await（真实子进程/promise）上，没有任何东西会杀它
③ fan-in-execute.js 对 per-task suite 执行这一步没有设任何超时/静默看门狗
```

**⊢ 对照（读码确认）**：已退役的 outer 全量 `full-suite-runner.ts` 曾有 `SUITE_MAX_RUNTIME_MS`(45min)/`SUITE_SILENCE_MS`(15min)（:500-501）——「单次 suite 卡死」检测。per-task fan-in 路径**无对应物**。fan-in-execute.js 的 `stuckHolderGraceSecs`(2700s，:144) 是**跨 relaunch 锁持有者卡死检测**（只在 relaunch 时刻评估「上一轮 hung 进程」），⛔ 不是单次运行 hang 看门狗——:144 注释自陈「与单次 SUITE_MAX_RUNTIME_MS/SUITE_SILENCE_MS【不同机制】：那两者在 full-suite-runner.ts 管『单次 suite 卡死』，且管不到本 detached 直跑路径（不经 full-suite-runner）」。

**⊢ 已查无既有任务覆盖**（manager 核实）：`gap-worker-print-bg-wait-ceiling-600s` 管的是 worker 会话被 print-mode 600s 宽限杀死，是另一个问题。

## Plan

1. 给 per-task fan-in suite 加**单次运行静默/超时看门狗**（对齐 full-suite-runner.ts 的 SUITE_SILENCE_MS 语义：N 分钟无 stdout/stderr ⇒ 判挂死 ⇒ SIGKILL 整进程组 + 写可区分失败态）。方向留实现方，⛔ 不代拍阈值。
2. `.claude/workflows/` 与 `plugin/workflows/` 双副本逐字节一致（dual-copy drift gate）。

## Acceptance Criteria

- [ ] AC1（能取假，静默看门狗生效）：per-task fan-in suite 无输出超 N 分钟（静默）⇒ 判挂死并 SIGKILL + 写可区分失败态（不再无限等）；（⛔ 仍无限等 ⇒ 假）。
- [ ] AC2（能取假，挂死与红可区分）：挂死被看门狗杀死后，fan-in 记录可区分的失败态（「挂死/超时」≠「套件红」≠「没跑完」——同 gap-fan-in-red-bucket-run-not-recorded 的成因可区分，硬规则 3b）；（⛔ 仍与红/没跑完同形 ⇒ 假）。
- [ ] AC3（能取假，负控制回放）：回放 ac143 的挂死场景（或注入一个挂死的测试），看门狗在 N 分钟内杀死它（不再需要 34min 手动 kill）；（⛔ 仍需手动 kill ⇒ 假）。

## Definition of Done

per-task fan-in suite 有单次运行静默/超时看门狗；AC1-AC3 全勾；挂死不再无限等、与套件红可区分。

## Touches

- .claude/workflows/fan-in-execute.js（per-task suite 单次运行静默/超时看门狗）
- plugin/workflows/fan-in-execute.js（dual-copy 同步，逐字节一致）
- plugin/test/（看门狗测试 + 挂死负控制回放）
- tasks/gap-fan-in-per-task-suite-no-silence-timeout-watchdog.md（自身）
