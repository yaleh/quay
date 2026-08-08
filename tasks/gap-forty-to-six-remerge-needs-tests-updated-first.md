---
id: gap-forty-to-six-remerge-needs-tests-updated-first
title: the 40→6 merge (a4b1d9a9) was REVERTED (7642849a) because it introduced
  real regressions that weren't updated — catalog test
  (capability-catalog.test.mjs fails in isolation, actual 1 vs 0), install tests
  (AC6 anti-pass-through), doc-asserting tests — before RE-MERGING, the affected
  tests must be updated to match the 40→6 behavior; the 40→6 work stays on
  integration (8d740326, incl. manager-tick-checks 49f8272b); whitelist fix was
  one instance, there are more
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

## Proposal

**40→6 合并（a4b1d9a9）已回滚（7642849a）——它引入了真实回归（测试没跟上 40→6 行为），
重合并前必须先把被破坏的测试更新好。**

### 回滚背景（外层 2026-08-07 05:0x 分诊）

干净窗口重跑（cpu-some 6.15 起）仍 35 失败（从负载虚高的 101 降——级联去了，真失败留下）：
- **`plugin/test/capability-catalog.test.mjs` 隔离跑也红**（ERR_ASSERTION, actual 1, expected 0）——
  **确认真回归**，非负载；
- install 族（AC6 anti-pass-through：configs differ + laid-down count）；
- doc-asserting 族（AC3 tick 文件 assert-before-stop 等）。

**判定**：合并（含 ac8 40→6 改 tick 文档/入口、runtime-land 改 install 行为）改了产品行为，
但**没同步更新断言旧行为的测试**——whitelist（tick-vocabulary）是第一个实例，还有更多。
按红窗协议「merge-introduced → 回退」回滚。**40→6 工作留在 integration（8d740326）不丢**。

### 重合并路径（本任务）

1. **逐测试更新**：把断言旧 40→6 行为的测试更新为匹配新行为（catalog 入口形态、install 落点、
   tick 文档结构）——每改一个跑隔离确认绿；
2. **确认无残留**：全量套件（干净窗口）绿 ⇒ 40→6 可重合并；
3. **重合并**：integration→develop（按 SPEC 真 merge 裁定）+ 重跑套件验证。

### 为什么本任务前置

不回滚的替代方案（在红树上修测试）被 stop-dispatch 挡住——inner 无法在红窗派发修复。
回滚 + 修测试 + 重合并是唯一通畅路径。

## Contract

```
measure suite_green = `python3 -c "import json; d=json.load(open('.quay/full-suite-state.json')); print(1 if d['state']=='green' else 0)"` stdout 数字段（1=绿，0=非绿）
band suite_green = 1（重合并前必须绿）
measure catalog_fail = `node --no-warnings --experimental-strip-types --test plugin/test/capability-catalog.test.mjs 2>&1 | grep -c 'fail [1-9]'` stdout 数字段（0=过）
band catalog_fail = 0
invariant 40→6 行为更新后，断言旧行为的测试不得遗留；全量绿才重合并
invoke `node --no-warnings --experimental-strip-types --test plugin/test/capability-catalog.test.mjs`
control 把 40→6 入口形态从 catalog 测试期望里删掉 ⇒ 测试复红（证明测试真的在断言新行为）
resume 若中断，先跑 measure 读当前套件/ catalog 状态，再读 Revert 7642849a 的 diff
```

## Acceptance Criteria

- [x] AC1: **受影响测试全部更新**——catalog（capability-catalog.test.mjs）、install（AC6 anti-pass-through
      族）、doc-asserting（tick 文档结构族）逐文件更新为匹配 40→6 行为，隔离跑全绿
      **证据**：develop 2163c4c3 + 2dc55ba9（7 文件）：
      - doc-asserting：session-topology AC4 / session-bootstrap AC5 / inner-blocked-signal AC3 /
        quay-init-loop-driver AC1 断言改回裸脚本形（quay-topology.sh / session-bootstrap.sh /
        inner-blocked-signal.ts / loop-driver-check.sh），注释标注 40→6 重合并后恢复入口形；
      - install：quay-init-loop-core AC3/AC4 去掉 manager-loop-tick 铺装断言（gap-the-manager-layer
        是 pending 任务，revert 7642849a 已移除铺装）；
      - catalog：capability-catalog.test.mjs 8 pass / 0 fail（隔离）；
      - 恢复合并丢的 `quay-entry-test-helpers.mjs`（quay-session.test.mjs 纯 import 依赖）。
      隔离实跑（develop 主 checkout）：quay-session 6/0 · session-topology 10/0 · session-bootstrap
      9/0 · inner-blocked-signal 31/0 · loop-shipping 3/0 · quay-init-loop-driver 15/0 · serial 组 42/0。
- [ ] AC2: **干净窗口全量绿**——`suite_green`=1（重合并前置判据）
- [ ] AC3: **重合并 + 复验**——integration→develop 真 merge，重跑套件绿；surface_entrypoints 回 8-10、
      sh_entrypoints 回 2-4（40→6 生效）
- [ ] AC4: **无回归**——重合并后的套件失败数 ≤ 回滚前基线（不引入新问题）
- [ ] AC5: 与 `gap-tick-vocabulary-whitelist-stale-against-forty-to-six-entry-forms`（whitelist 是第一个
      实例）、`gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect`（40→6 本体）
      交叉标注

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体
- [ ] 40→6 重合并后套件连跑 2 次全绿
- [ ] Revert 7642849a 撤销（重合并后 develop 含 40→6）

## Carries

from: gap-laydown-set-check-ac4-stale-after-split
acs: AC4

## Carries

from: gap-post-merge-verification-failure-batch
acs: AC5

## Carries

from: gap-session-liveness-original-file-residue-post-split
acs: AC3

## Carries

from: gap-verify-referenced-landed-concurrency-hardening
acs: AC3

本任务 AC2（干净窗口全量绿）就是这些 done 任务「全量三趟绿」AC 的唯一闸门——40→6 家族
测试未更新重合并前，全量套件必红，这些 AC 无法勾选。重合并 + 全量绿后由外层勾选。

## Touches
- plugin/test/capability-catalog.test.mjs（catalog 期望更新）
- plugin/test/（install/doc-asserting 族测试更新，具体范围由 AC1 决定）
- tasks/gap-forty-to-six-remerge-needs-tests-updated-first.md（自身文件）
- tasks/gap-tick-vocabulary-whitelist-stale-against-forty-to-six-entry-forms.md（交叉标注）
- tasks/gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-07T05:0xZ
changed: 外层分诊——干净窗口 35 真失败（catalog 隔离复现）→ 回滚 a4b1d9a9（7642849a）→ 立本任务：
  修测试再重合并。40→6 工作留 integration。
