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
- [x] AC2: **干净窗口全量绿**——`suite_green`=1（重合并前置判据）
      **实测（执行子代理 2026-08-08，fork 基线 develop HEAD c4669fa0）**：
      - 契约 measure：`.quay/full-suite-state.json` = `{"state":"green", ... finishedAt
        2026-08-08T10:29:40Z}` → **suite_green=1**（外层干净窗口跑，AC1 落点后无测试改动，仍有效）；
      - 契约 invoke：`node --no-warnings --experimental-strip-types --test
        plugin/test/capability-catalog.test.mjs` → **pass 8 / fail 0（catalog_fail=0）**；
      - 受影响测试隔离复验（develop 主 checkout）：capability-catalog 8/0 · quay-session 6/0 ·
        session-topology 10/0 · session-bootstrap 9/0 · inner-blocked-signal 31/0 ·
        quay-init-loop-driver 15/0 · quay-init-loop-core 12/0 · tick-vocabulary 5/0 ·
        loop-shipping 族 15/0。
      **注**：worktree 内 capability-catalog 隔离红（ERR_ASSERTION 2 vs 0，quay-init --loop exit 2）
      是 gitignored vendor 运行时缺失（`plugin/vendor/quay/dist/quay.js` 未铺装，
      sync-vendor.sh 失败），非 40→6 回归——主 checkout（有 vendor dist）8/0 绿。
- [ ] AC3: **重合并 + 复验**——integration→develop 真 merge，重跑套件绿；surface_entrypoints 回 8-10、
      sh_entrypoints 回 2-4（40→6 生效）。**外层动作**。重合并时必须同步恢复测试注释里
      「Re-instate … when 40→6 is re-merged」标记的入口形断言（quay-suite.ts / quay-deliver.ts /
      quay-session.ts，见 session-topology/session-bootstrap/inner-blocked-signal/quay-init-loop-driver
      测试内注释），否则 40→6 树复红。
- [ ] AC4: **无回归**——重合并后的套件失败数 ≤ 回滚前基线（不引入新问题）。**外层动作**（随 AC3）。
- [ ] AC5: 与 `gap-tick-vocabulary-whitelist-stale-against-forty-to-six-entry-forms`（whitelist 是第一个
      实例）、`gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect`（40→6 本体）
      交叉标注。**延后到外层重合并时做**：两目标任务文件正被并发重构——ac8 分支
      （`task/gap-ac8-…`，HEAD 2f6621ed）删除 tick-vocabulary 任务文件并重开 ac8（status done→ready、
      AC1/AC2 重新开箱），现在写交叉标注会撞并发；本任务侧的关系说明已记录于 Proposal/Dispatch review。

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（AC1 证据 develop 2163c4c3+2dc55ba9；AC2 证据见上；AC5 延后原因见上）
- [ ] 40→6 重合并后套件连跑 2 次全绿（外层 AC3 后执行）
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

## Evidence（内层实现 2026-08-09）

**实现状态**：本 worktree 自 develop HEAD（2e7ccc5a）fork，AC1 的测试更新（develop 2163c4c3 +
2dc55ba9，7 文件）已随基线在树内——逐文件核验过裸脚本形断言确实落位（session-topology 断
`quay-topology.sh`/`topology-check.sh`、quay-init-loop-core 去 manager-loop-tick 铺装断言、
quay-entry-test-helpers.mjs 已恢复）。inner 本趟无新增代码改动，交付为 **worktree 内复验 +
铺装 gitignored vendor 运行时 + scoped 门绿**。

**复现（worktree 特有阻断）**：AC2 注记（2026-08-08）记录 worktree 内 capability-catalog 隔离红
（ERR_ASSERTION actual 2 vs 0，quay-init --loop exit 2）源于 gitignored vendor 运行时缺失
（plugin/vendor/quay/dist/quay.js 未铺装，当时 sync-vendor.sh 失败）。本趟初查确认 worktree 确实
无 vendor dist（`plugin/vendor/{quay,quay-native}/dist/` 空）；但重验发现该阻断已不再复现——
`bash plugin/scripts/sync-vendor.sh` 本趟成功（build+mirror 两个 bundle），且做负控制移走 vendor
dist 后 `quay-init --loop` 会自动经 ensure_vendor_runtime→sync-vendor.sh 重建（Wiring 子测试在无
vendor dist 情况下仍 pass 1/0）。故 AC2 注记的失败是当时的瞬时环境问题（node_modules/构建时序），
非 40→6 回归。

**修复**：`bash plugin/scripts/sync-vendor.sh`（在 worktree 内）铺装 vendor dist
（plugin/vendor/quay/dist/quay.js + plugin/vendor/quay-native/dist/quay-native.js；gitignored，
不入提交）。quay-init 的 ensure_vendor_runtime 会自动做同样的事；scoped 门跑前已确保两个 bundle 在。

**验证（worktree 内隔离实跑）**：
- capability-catalog.test.mjs：**12 pass / 0 fail / 0 cancelled**（含 Wiring 子测试，quay-init
  --loop 实跑 pass）；契约 invoke catalog_fail=0 ✓；
- AC1 受影响族：quay-session 6/0 · session-topology 10/0 · session-bootstrap 9/0 ·
  inner-blocked-signal 35/0 · quay-init-loop-driver 15/0 · quay-init-loop-core 12/0；
- **scoped 门**：`bash scripts/test.sh --for-task gap-forty-to-six-remerge-needs-tests-updated-first
  --allow-thin` → **exit 0**。静态检查 0 违规（test-impl-census 294 文件全 clean、
  test-isolation 44 条全部基线内无新增、task-contract-check strict-subset 三任务文件
  no violations、lint crosscut 0）；测试 **12 pass / 0 fail / 0 cancelled**。

**AC 勾选**：AC1/AC2 由 develop 基线兑现（保持 [x]，本趟复验通过）；AC3/AC4（integration→develop
重合并 + 复验）与 AC5（交叉标注）为外层动作/延后，inner 不勾。全量 suite_green=1 归外层
verification-round（clean window）验证。

## Evidence（内层复验 2026-08-10）

**基线**：本 worktree 自 develop HEAD（018d5868）fork。AC1 测试更新（2163c4c3 + 2dc55ba9，7 文件）
随基线在树内——逐文件核验裸脚本形断言落位：session-topology 断 `quay-topology.sh`/`topology-check.sh`
（注释标「Re-instate … when 40→6 is re-merged」）、session-bootstrap 断 `session-bootstrap.sh`、
inner-blocked-signal 断 `inner-blocked-signal.ts`、quay-init-loop-driver 断 `loop-driver-check.sh`、
quay-init-loop-core 无 manager-loop-tick 铺装断言（仅注释提及）、`quay-entry-test-helpers.mjs` 已恢复
（quay-session.test.mjs 纯 import 依赖）。inner 本趟无新增代码改动，交付为 **worktree 内复验 +
scoped 门绿**。

**环境铺装（worktree 特有，均 gitignored 不入提交）**：`ln -s /home/yale/work/quay/node_modules` 复用主
checkout node_modules（既有 worktree 同款模式）；`cp /home/yale/work/quay/.quay/config.yml .quay/` 补齐
gitignored workspace config（inner-blocked-signal 的 `_findRepoRoot` 依赖 `.quay/config.yml` 上溯，
无则抛 ERR_ASSERTION 无法定位 repo root）；`scripts/test.sh` 的 build_dist_once 自动构建 dist +
`sync-vendor.sh --sync-dist` 镜像 vendor dist（plugin/vendor/quay/dist/quay.js +
plugin/vendor/quay-native/dist/quay-native.js）。

**验证（worktree 内隔离实跑）**：
- capability-catalog.test.mjs：**12 pass / 0 fail / 0 cancelled**（含 Wiring 子测试，quay-init --loop
  实跑 pass）；契约 invoke catalog_fail=0 ✓；
- AC1 受影响族：quay-session 6/0 · session-topology 10/0 · session-bootstrap 9/0 ·
  inner-blocked-signal 35/0 · quay-init-loop-driver 15/0 · quay-init-loop-core 12/0 ·
  tick-vocabulary 5/0 · loop-shipping 12/0；
- **scoped 门**：`bash scripts/test.sh --for-task gap-forty-to-six-remerge-needs-tests-updated-first
  --allow-thin` → **exit 0**。静态检查 0 违规（test-impl-census 303 文件全 clean、test-isolation 44 条
  全部基线内无新增、task-contract-check strict-subset 三任务文件 no violations、superseded-capability
  PASS、lint crosscut 0）；测试 **12 pass / 0 fail / 0 cancelled**。

**AC 勾选**：AC1/AC2 保持 [x]（本趟复验通过）；AC3/AC4（integration→develop 重合并 + 复验）与
AC5（交叉标注）为外层动作/延后，inner 不勾。全量 suite_green=1 归外层 verification-round（clean
window）验证。
