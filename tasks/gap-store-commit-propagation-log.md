---
id: gap-store-commit-propagation-log
title: commitTaskWrite 传播决定落生产日志（.quay/store-commit-propagation.jsonl）——AC-220 判据的直接载体
status: done
labels:
  - gap
  - meta-driver
parent: null
children: []
extra:
  schema: finding
goal_ac: AC-220
---
## Finding

**本条是一条【追溯性记录】，工作已于 2026-09-09/10 完成并落地 develop，创建它是为了补上缺失的证据链，而非安排新工作。**

背景：AC-220（GOAL-011 退出条件②）原判据是"落地后 fan-in ff-red 率相对 SPEC 7 天基线（31/291）实测下降"。人 2026-09-09 反馈「现有 AC 牵扯的因素太多」——实测该比率混入了与 AC/evidence 写完全无关的普通代码合并冲突，且落地窗口并发吞吐量与基线均值不可比（45 次/11h vs 291 次/168h），比率既不能证实也不能证伪修复效果。

因此改为直接测量 `commitTaskWrite` 自己的传播决定：

**已落地的实现**：
- `packages/quay-native/src/store.ts` 新增 `logPropagationOutcome`，把每次 `committed:true` 的传播决定（含 `changeKind` / `branchClass` / `propagated`）追加写入 `<root>/.quay/store-commit-propagation.jsonl`（gitignored 运行时日志，worker-outcome.jsonl 同族）。日志写入 best-effort、try/catch 吞掉，⛔ 不阻塞真实 commit/propagate 结果（观测不得阻塞主执行，人 2026-08-30 裁定）。
- `packages/quay-native/test/store.test.mjs` 新增 AC8/AC9 两条单测：self-only 写正确记 `propagated:false`；混合写（负控制）正确记 `propagated:true`——防分类器把范围看宽而不自知。
- `plugin/test/goal011-propagation-log-self-only-never-propagates.test.mjs` 落地，作为 AC-220 的新判据：查该日志的硬不变式——`changeKind=self-only` 的写 `propagated` 恒为 false（非统计比率，不需与历史基线比较）。
- 同批还重写了 AC-221 的判据 `plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs`：用 git 历史回放 develop 在事件时刻的状态、跑生产同一判定函数 `flipAcGateVerdict` 自动消歧"真复发 vs worker 真没做完"，消除原判据需人工逐条核对的 confound。
- 两个判据文件都带 `QUAY_GOAL_CRITERION_LIVE=1` 门（默认在全量 suite 中 SKIP 不断言），因为此前它们被 scripts/test.sh 无条件扫到、判据据实 FAIL 时拖垮了两个与 GOAL-011 无关任务的 fan-in（gap-ac201-productization-verification-*、gap-goal-gap-done-task-not-traction-respawns-every-round）。修法照搬既有 QUAY_TEST_LIVE_GITHUB 先例。

**落地提交**：`1e4f006bd`（实现 + 判据重写）、`adead611b`（LANDING_SHA 注释修正）。

**实测结果**：AC-220 判据于 2026-09-10T04:07 起实测通过（5/5 self-only 样本、0 违规、负控制绿）；AC-221 判据 3/3 绿（0 真复发）。二者随后被 goal-driver 机械翻 achieved，GOAL-011 于 2026-09-10T04:28:29 由 goal-driver 判 `sufficiency covered` 后翻 achieved。

**为什么需要这条记录**：AC-220 的 `origin` 字段已经引用了任务名 `gap-store-commit-propagation-log`，但该任务此前并不存在——引用悬空。更实质的问题是：实现工作当时直接以 git 提交完成，没有经任务库立案，导致 AC-220/AC-221 全程无 `goal_ac` 关联任务，证据链断裂（也正因如此，goal-driver 的 triage 一直判它们 `hold`，最终靠人手工激活才进入判定——该激活判据本身的缺陷已另案立于 gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics）。

## AC（draft）

- [x] `.quay/store-commit-propagation.jsonl` 在生产上真实产生记录，且 `changeKind` 能区分 self-only 与 must-propagate（实测：37 条记录中 5 条 self-only 全部 propagated=false、32 条 must-propagate 全部 propagated=true）
- [x] `node --no-warnings --experimental-strip-types --test packages/quay-native/test/store.test.mjs` exit 0（含新增 AC8/AC9 两条日志单测）
- [x] AC-220 判据 `QUAY_GOAL_CRITERION_LIVE=1 node --no-warnings --experimental-strip-types --test plugin/test/goal011-propagation-log-self-only-never-propagates.test.mjs` exit 0
- [x] AC-221 判据 `QUAY_GOAL_CRITERION_LIVE=1 node --no-warnings --experimental-strip-types --test plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs` exit 0

## DoD（draft）

实现已落 develop（1e4f006bd / adead611b）；AC-220、AC-221 均已由 goal-driver 判 achieved；GOAL-011 已由 goal-driver 判 `sufficiency covered` 翻 achieved。本记录的交付物即"证据链本身"——AC-220 的 `origin` 所引用的任务名从此可解析，且 `goal_ac: AC-220` 使该 AC 的达成有可追溯的任务对象。

## Touches
- packages/quay-native/src/store.ts
- packages/quay-native/test/store.test.mjs
- plugin/test/goal011-propagation-log-self-only-never-propagates.test.mjs
- plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs
- tasks/gap-store-commit-propagation-log.md
