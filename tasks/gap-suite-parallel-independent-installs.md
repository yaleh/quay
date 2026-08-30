---
id: gap-suite-parallel-independent-installs
title: runtime AC6 与 e2e-A1 的内部两次独立真 install 转 async spawn 并行（Promise.all，2 并发封顶）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

文件级内部并发对 spawnSync 家族是死路（实测：顶层 test({concurrency}) 对兄弟测试不生效；describe({concurrency:4}) 只对 async body 生效，4×spawnSync sleep1 仍 ~5.5s 串行——spawnSync 阻塞事件循环）。但 runtime AC6 与 e2e-A1 各自在测试内部做两次**相互独立**的真 install（ws1/ws2；round-161 已保证唯一 worktree root / tmux session / tmp dir），就地并行可把每题墙钟 ~32s → ~16s。用 promisify spawn 的 async helper + Promise.all，2 并发封顶。这是"内部并发"唯一受控生效的落点（load 敏感家族，需 AC2 纪律）。

## Plan

1. 新增 async spawn helper（promisify child_process.spawn，返回 {status, stdout, stderr}，对齐 spawnSync 契约；放 plugin/test/helpers/）。
2. runtime AC6：ws1/ws2 两个 runInit → Promise.all([spawnAsync, spawnAsync])。
3. e2e-A1：ws1/ws2 → Promise.all([...])。
4. 并行下独立性不变量保持：两 install 的 worktree_root / tmux session / workspace 互不相同。
5. 前后对照：同 selected set 跑 AC6/A1 前后各一次，墙钟 ~32s→~16s 且 0-cancelled（AC2 纪律——该家族曾在满套件负载下轮换 flake）。

## Acceptance Criteria

- [ ] AC1（能取假，机制）：AC6 与 A1 内部两次 install 并行启动（helper 记录两 spawn 启动时刻，间隔 < 单次 install 时长）。
- [ ] AC2（能取假，负控制）：并行后两 install 的 config 仍真不同（AC6）、字节恒等仍成立（A1），断言不回归。
- [ ] AC3（独立性）：两次 install 的 worktree_root / tmux session / workspace 互不相同（round-161 独立性不变量）。
- [ ] AC4（测量，AC2 纪律）：同 selected set 前后对照，AC6/A1 墙钟下降且 0-cancelled。

## Definition of Done

AC6 与 A1 的两 install 并行执行（Promise.all + async spawn），断言全部通过且独立性不变量保持；前后对照实测墙钟下降、0-cancelled；spawnSync→spawn 转换不扩散到其它测试。

## Touches

- packages/quay/test/install-config-driven-e2e-runtime.test.mjs（AC6 转 Promise.all）
- packages/quay/test/install-config-driven-e2e.test.mjs（A1 转 Promise.all）
- plugin/test/helpers/async-spawn.mjs（新——promisify spawn helper，或并入 install-fixture helper）
- tasks/gap-suite-parallel-independent-installs.md（自身）