---
id: gap-m-bucket-long-tail-lpt-scheduling
title: M bucket 测试长尾：最后 5% 文件吃掉总时长 27%+（最慢 5% 串行和占 55%）——scripts/test.sh 未按已知耗时
  LPT 排序，长测试排尾部等 lane
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**更正（manager 2026-08-24 + 人裁定，撤销此前 supersede）**：先前 supersede 基于「LPT 交付方式被证伪」是**过度推广**——实际证伪的是「CLI 位置参数是有序文件列表」假设，不是 LPT 本身。Node v24.19.0：CLI 把位置参数当 `globPatterns` → `createTestFileList()` → `ArrayPrototypeSort(results)` ⇒ argv 顺序必被丢弃；**但 `run({files})` 直接提供 files 数组时 `createTestFileList()` 不被调用（`let testFiles = files ?? createTestFileList(...)`）⇒ 保序**。三组对照（观测子进程真实 spawn 时刻）：`run({files})` conc=1/2 均保序，CLI 同一批文件字母序——实验 C 决定性。

**现象（原任务，仍成立）**：M bucket（223 文件，16 lanes）最后 5% 文件吃掉总时长 27%+，最长文件 150-293s 排列表尾部等 lane。

## Plan

`scripts/test.sh` 里 `node --test "${files[@]}"` 换成一个调 `run({files: LPT_ORDER, concurrency: M, isolation:'process'})` 的 runner 脚本。**分桶逻辑完全不动**（减少复杂度，不增加维度）。`run()` 是共享工作队列 + 动态 list scheduling（lane 空取队列下一个），对耗时漂移天然免疫。

## Acceptance Criteria

- [x] AC1（能取假，保序双向对照）：合成探针证明 spawn 顺序跟随 files[]（正序 z→m→a 与反序 a→m→z 都跟随）——⛔ 仍按字母序 ⇒ 假。
- [x] AC2（能取假，前 M 项）：并发 M 时前 M 个启动文件 = LPT 前 M 项。
- [ ] AC3（能取假，生产 makespan）：生产 M-bucket makespan 下降（较基线 702.8s 或下界 451.9s）。（待外部）
- [ ] AC4（能取假，末 5% 占比）：末 5% 文件墙钟占比显著下降（较基线 27%+）。（待外部）
- [x] AC5（能取假，reporter 不断供）：改造后 `__PERFILE__` 仍产出、verification-round.perFile 仍非空——reporter 必须走 `stream.compose(reporter)` 而非 CLI flag（漏了会打断 per-file 耗时采集 → LPT 自己的输入 ⇒ 自我拆台）。

## Definition of Done

run({files}) 保序 runner 落地 develop；AC1-5 全勾；生产 M-bucket makespan 下降（AC3）、reporter 数据源不断（AC5）。

## Touches

- scripts/test.sh（node --test "${files[@]}" → run({files}) runner；reporter 改 stream.compose）
- plugin/scripts/suite-lpt-order.ts（LPT 排序，保留）
- plugin/scripts/suite-lpt-runner.mjs（run({files}) 保序 runner，新增）
- plugin/test/suite-lpt-order.test.mjs
- plugin/test/suite-bucket-perfile-emit.test.mjs（AC1 结构针更新：--buckets 分支改跑 runner）
- plugin/test/resource-gate.test.mjs（AC5 计数 6→5：--buckets 改经 bucket_test_concurrency）
- plugin/scripts/capability-catalog.sh（注册 suite-lpt-runner.mjs 六表）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 再生成 285→286）
- tasks/gap-m-bucket-long-tail-lpt-scheduling.md（自身）