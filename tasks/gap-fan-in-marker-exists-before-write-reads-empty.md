---
id: gap-fan-in-marker-exists-before-write-reads-empty
title: fan-in suite 的 .exit marker「先建后写」——存在性判据读到空文件，误判 suite 红
status: ready
labels:
  - gap
  - finding
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

**症状**（2026-09-19 实测；同一现象由两次独立 worker 会话分别诊断）：`plugin/test/fan-in-execute-paths-s12.test.mjs` 的「⑧⑩ 锁等待负控制」用例在**全量 suite 并发负载下**红：

```
AssertionError [ERR_ASSERTION]: the suite must run to exit 0 after acquiring the freed slot, got:
  actual: ''      expected: /exit=0/
```

marker 文件**存在、但内容为空**。该用例单独跑 2/2 绿（实测 5.3s），全量并发下偶发红 ⇒ 负载相关，但**不是「慢」**。

**机制（读码定位，非推断）**：
- 生产者 `plugin/workflows/fan-in-execute.js:236`（SUITE_LAUNCH；`:275` 的 ISOLATE_LAUNCH 同形）用 `printf "exit=%s\n..." > "$4"` 写 `suite_exit_marker`——shell 重定向**先 `open(O_TRUNC)` 建出 0 字节文件，再写入内容**。
- 消费者 `plugin/test/helpers/fan-in-execute-paths-harness.mjs:498` 的 `waitForMarkerOrDeath()` 只判存在性：`:502` `if (fs.existsSync(markerPath)) return "marker";`，`:514` `fs.watch(dir, () => { if (fs.existsSync(markerPath)) finish("marker"); })`。
- ⇒ `IN_CREATE`/watch 先赢 ⇒ 返回 `"marker"` ⇒ 调用方 `readFileSync` 得 `''` ⇒ `assert.match(markerText, /exit=0/)` 红。
- 负载越重，`open()` 与 `write()` 之间的调度间隙越宽 ⇒ 命中率越高。**完成事件的粒度错了**：把「文件被创建」当成了「文件被写完」。

**为什么 load-sensitive 标注/隔离重跑都治不了它**：`waitForMarkerOrDeath` 的等待本身已是事件驱动、无墙钟预算（`gap-suite-not-robust-at-high-derived-concurrency` 的设计，见该文件 `:31-41` 注释）。缺陷不在等待时长，在完成事件粒度 ⇒ 标注只把红改判，不改真值。

**发生率（查历史，非估计）**：
- `.quay/fan-in-suite-*.log` 中含该测试者 56 份、其中 1 份红（≈1.8%）；09-12 起窗口内该用例 3/18（≈16.7%）。
- **跨任务复发（≥2 不同任务）**：`gap-arch-sh-census-check`（`.quay/fan-in-suite-gap-arch-sh-census-check~wk-prod-anchor~1789804509750-f6d477.log:9285`）、`gap-context-slim-p2-memory-archive`（`...~1789804737079-….log:9027` 与 `...~1789802894948-….log:9029`）各因其 suite 红。
- driver 的 `judgeRetryExemption`（`plugin/scripts/worker-driver.ts:2276`，verdict 分支 `:2330`）已把它判为 `unrelated-flaky-exempt` ⇒ **不消耗该任务重试上限** ⇒ 任务被反复重派，每轮白烧一次 ~19min 全量 suite 而不推进。

**同形第二处（硬规则 5b）**：`fan-in-execute.js:275` 的 ISOLATE_LAUNCH 用同一 `printf > "$3"` 形状写同一个 marker ⇒ 修 `:236` 时必须一并处理 `:275`，否则只修了被报出来的那一个。

**注**：`packages/quay/plugin/workflows/fan-in-execute.js` 是 quay-init 落盘副本（`dual-source-check.ts` 未跟踪该文件），改动经 laydown 同步，不在本任务 Touches 内单列。

## Acceptance Criteria

- [ ] AC1（能取假，负控制）：在 marker 路径上构造「先建空文件 → 延时再写 `exit=0`」序列，当前 `waitForMarkerOrDeath` 必须返回 `"marker"` 且读到空串（证明谓词会被先建后写骗过）；改为内容判定后，同一序列在写入完成前必须**不**返回 `"marker"`。⛔ 若改后仍返回 `"marker"` 且读到空串 ⇒ 判据是假的。
- [ ] AC2（修复，生产载体）：至少落地一条并写清选型——① 消费者侧：完成事件改为「marker 内容可解析出 `exit=`」；② 生产者侧：原子写（写 `.tmp` 再 `mv`）。选 ② 时 `plugin/workflows/fan-in-execute.js` 的 `:236` 与 `:275` 两处都要改。
- [ ] AC3（能取假，真实载体非 fixture）：用 `plugin/workflows/fan-in-execute.js` 的真实 SUITE_LAUNCH 块跑一次，marker 从「存在」到「含 `exit=0`」之间不再有可观测空窗；打印修复前后同一序列的读数。
- [ ] AC4（不回归）：`plugin/test/fan-in-execute-paths-s12.test.mjs` 单独绿 + 全量 suite 绿；`scripts/test.sh --for-task <本任务> --allow-thin` 退出 0。

## Definition of Done

真实落地：全量 suite 并发负载下，`fan-in-execute-paths-s12.test.mjs` 的 ⑧⑩ 用例在观察窗口内连续 N 轮不再因空 marker 判红（N 与窗口写进 Resolution，含修复前后同窗口对照读数）；且 `gap-arch-sh-census-check` 与 `gap-context-slim-p2-memory-archive` 两个已被误杀任务因该 flake 的重派次数不再增长。

## Touches

- plugin/test/helpers/fan-in-execute-paths-harness.mjs
- plugin/workflows/fan-in-execute.js
- plugin/test/fan-in-execute-paths-s12.test.mjs
- tasks/gap-fan-in-marker-exists-before-write-reads-empty.md（自身）