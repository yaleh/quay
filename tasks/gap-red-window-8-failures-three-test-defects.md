---
id: gap-red-window-8-failures-three-test-defects
title: "full-suite red (8 fail / 2612 tests): capability-catalog 5 ACs = CONCURRENCY FLAKE (isolated 8/8 green twice), red-window-shared-gate AC1 = OVER-STRICT assertion (inner template says '暂缓已完成 agent 的 fan-in', test asserts contiguous '暂缓 fan-in' which only outer doc has — semantic equivalent, test introduced 21:12 never ran a full suite until now), runner-grouping = HEAVY test (nested test.sh --group governance, isolated >830s) fragile under concurrency (reporter summary missing) — none are this batch's product regressions; triage 2026-08-06 03:43 SUITE-RED"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**全量套件红（8 fail / 2612 tests）——三类都是测试缺陷，非本轮 merge 的产品回归（红窗分诊）。**

**【实测（2026-08-06 03:43 SUITE-RED）】**：套件跑 35.6min 后红，8 fail / 0 cancelled：

1. **capability-catalog.test.mjs 5 个 AC 失败**（AC1a/AC1b/AC5/AC1c/AC2）——**隔离运行 8/8 全绿**（重跑两次
   确认）⇒ **并发 flake**。失败模式：`catalog --json must exit 0`（全量并发下 exit code 非 0）。
2. **red-window-shared-gate.test.mjs AC1**——**测试断言过严**：`assert.ok(doc.includes("暂缓 fan-in"))`
   要求**连续子串**。inner 模板（`fast-mode-loop-tick.md` 行 653）正确措辞是「**暂缓已完成 agent 的
   fan-in**」（语义等价、中间夹词）；只有 outer 模板（orchestrator 行 654）用连续「暂缓 fan-in」。
   测试 21:12 引入、上次全量 20:05 早于它——**首次被全量执行即暴露**。隔离跑 14 tests/13 pass/1 fail
   （只 AC1 挂，AC2-AC4 consistency 都过）。
3. **runner-grouping.test.mjs**——**重测试**：真实调用 `scripts/test.sh --group governance`（嵌套跑
   子套件），隔离运行即 >830s（两次 120s timeout）。全量下 `reporter summary missing ℹ tests`。

**【判断】**：三者都是测试层缺陷，非本轮 16 个 merge 的产品回归。capability flake + runner-grouping
脆弱 + AC1 断言过严。

### 选定机制

1. **修 red-window-shared-gate AC1 断言**：inner 文档接受「暂缓已完成 agent 的 fan-in」措辞
   （或断言放宽为 /暂缓.*fan-in/）
2. **capability-catalog 并发 flake 定位**：`catalog --json must exit 0` 在全量并发下非 0——查是否有
   共享资源竞争（catalog 读 fs 时与并发测试写文件冲突）
3. **runner-grouping 重测试**：评估是否移到慢测试组 / 隔离跑 / 缩小嵌套范围

## Acceptance Criteria

- [ ] AC1: red-window-shared-gate AC1 断言修正——inner 模板措辞（暂缓已完成 agent 的 fan-in）被接受，
       14/14 绿
- [ ] AC2: capability-catalog 并发 flake 根因定位（隔离 8/8 绿 vs 全量 5 fail 的竞争源）或标记
       KNOWN-LOAD-SENSITIVE 入豁免
- [ ] AC3: runner-grouping 处置——隔离可跑完（非永久超时）或标记慢测试
- [ ] AC4: 全量套件重归 green（fail 0）

## Definition of Done

- [ ] AC1-AC4 全勾（red-window-shared-gate AC1 断言修正 14/14 绿；capability-catalog 并发 flake 根因定位或 KNOWN-LOAD-SENSITIVE 入豁免；runner-grouping 处置；全量套件重归 green）
- [ ] 三个 test-defect 各自处置实测（隔离 vs 豁免 vs 标记）
- [ ] scoped 门 `scripts/test.sh --for-task gap-red-window-8-failures-three-test-defects` 绿

## Touches
- tasks/gap-red-window-8-failures-three-test-defects.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/test/red-window-shared-gate.test.mjs（AC1 断言修正）
- plugin/test/capability-catalog.test.mjs（flake 定位/豁免）
- plugin/test/runner-grouping.test.mjs（重测试处置）
- plugin/scripts/test.sh 或 test-grouping 配置（慢测试组，若采用）

## Contract

measure   suite_green = `python3 -c "import json; print(json.load(open('.quay/full-suite-state.json'))['state'])"` stdout
band      suite_green = green（重跑后）
invoke    `grep -n '暂缓 fan-in\|暂缓已完成 agent 的 fan-in' plugin/test/red-window-shared-gate.test.mjs plugin/loop/fast-mode-loop-tick.md`
control   AC1 断言修后 14/14 绿（AC1）；capability 隔离 8/8 绿（AC2）
resume    断言修正与 flake 定位分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T03:5xZ
changed: 红窗分诊立案——8 fail 三类测试缺陷，非本轮产品回归。capability=并发 flake（隔离绿），
AC1=断言过严（语义等价措辞不匹配），runner-grouping=重测试脆弱。内层修测试层，全量重归绿后恢复派发。
