---
id: gap-suite-fix-scope-worktree-green-merge-gate
title: 'suite-fix subagent 收口缺机械判据——第二个 subagent 从未自测绿（rounds 230/231 scope=main，等共享检出），三条保障同时失效（修到绿才merge/未绿退出⇒.halt/不得修一个等30min）；处方=fan-in 前必须存在至少一条 scope=worktree 且 state=green 的轮次记录，否则不许 merge（数据已在 verification-round.jsonl，不新建机件）'
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**suite-fix subagent 的收口缺机械判据——第二个 subagent（08:50 至今）从没在自己的 worktree 里跑过自测轮次：rounds 230/231 `scope=main`，它在等共享检出的轮次。这使 A15 ④ 的三条保障同时失效，而条文本身每条都「没被违反」——只有把 `scope` 字段读出来才看得见。**

### 实证（manager 2026-08-10 09:4x 决定性读数 + outer 复核 verification-round.jsonl）

- **第一个 suite-fix subagent（04:11-05:58，正确形态）**：round-218 (04:40) / 219 (04:45) / 220 (05:04) / 221 (05:26) **全部 `scope=worktree`**，round-221 **`state=green`** 05:26:52 → merge `9722f8e3`。闭环 1h47m。
- **第二个 suite-fix subagent（08:50 至今，偏离形态）**：round-230 (08:53:09) 与 round-231 (09:32:26) **全部 `scope=main`** ⇒ **它没跑自己的轮次，它在等共享检出的轮次**。其 worktree HEAD = round-231 的 verifiedCommit (`83df2bb2`)，修复 `M plugin/test/loop-shipping.test.mjs` 未提交。
- **三保障同时失效**：
  ①「修到绿才 merge」失效——它等的轮次测的是**不含它修复的树**，它无法判断自己修没修好；
  ②「未绿退出 ⇒ `.halt`」失效——它不会「未绿退出」，它会一直等，`.halt` 触发条件**在结构上永远不成立**；
  ③「不得修一个→等 30min→再红→再修一个」失效——它现在做的正是这个，只是把「修」和「等」的顺序倒了过来。
- **形态**：与 A15 裁定5 那次同形但更隐蔽——上次是**没做**（心跳 9 轮缺失），这次是**做了一件看起来像的事**（确实在「监控 suite 直到绿」）。条文的每一条单独看都没被违反，**只有把 `scope` 字段读出来才看得见**。
- **round-231 补充**：`tests=0`（在 quay-init-laydown-closure 被中断）⇒ loop-shipping **没跑**（不是通过）——「它在不含修复的树上通过了」不被记录支持，是「没跑 / 未知」。

**为什么重要**：A15 ④ 的执行体是「自带 worktree、修到绿才 merge、未绿退出则 .halt」——「自测绿」是契约里唯一能判断「修没修好」的动作，而它被第二个 subagent 跳过了。没有机械判据，这个偏离会静默重复（条文每条都「没违反」）。

### 选定机制方向（实现归 inner，判定归 outer）

1. **fan-in 机械判据**：suite-fix subagent fan-in 前，必须存在**至少一条 `scope=worktree` 且 `state=green`** 的轮次记录（在 `.quay/verification-round.jsonl`），否则**不许 merge**（返回明确失败 + 指示先自测）。
2. **不新建机件**：数据已在 `verification-round.jsonl`（`scope` + `state` 字段），在 fan-in 路径（`integration-batch-merge.sh` 或 suite-fix 收口逻辑）加一个前置断言即可。
3. **scope 字段已存在**：`full-suite-runner.ts` 已写 `scope`（main/worktree），无需改 runner——只在消费者侧加门。

**验证锚**：修后 (a) 无 `scope=worktree+green` 轮次记录的 fan-in 被拒（返回明确失败）；(b) 有该记录则放行；(c) 既有 fan-in 路径不回归。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 scope 决定性读数（第一 subagent rounds 218-221 worktree+green；第二 subagent rounds 230/231 main——从未自测）+ 三保障失效 + round-231 tests=0（本任务 Proposal 已含）
- [x] AC2: **fan-in 机械判据**——fan-in 前断言存在 ≥1 条 `scope=worktree` 且 `state=green` 的轮次记录，否则拒绝 merge
- [x] AC3: **不新建机件**——数据复用 verification-round.jsonl 的 scope/state；只加前置断言
- [x] AC4: **明确失败信息**——拒绝时返回可行动提示（「先在自己 worktree 自测绿：node --test <文件> 或 scoped test.sh」）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Evidence (inner 2026-08-11)

**实现**：`integration-batch-merge.sh` 新增 opt-in `--require-worktree-green` 门（AC2/AC4）——批量合前（任何 ref 移动前，先于 object/freshness gate）断言 `verification-round.jsonl` 存在 ≥1 条 `scope=worktree` 且 `state=green` 记录，无 ⇒ FAIL-CLOSED + 可行动提示；`--dry-run` 报 would-block 不失败。复用既有 scope/state 字段（AC3，不新建机件）。`execute-suite-fix.js` Merge 段 step 0 先跑门前置检查、step 3 批量合必带 `--require-worktree-green`（禁止裸调用跳过门）。`orchestration/orchestrator-tick-core.md` A15 ④ 注明机械门；`gap-ac36` 交叉标注。测试 `plugin/test/integration-batch-merge.test.mjs` 新增 7 条（无记录拒 / main+green 或 worktree+red 拒 / 有 worktree+green 放行 / 坏行容忍 ± / dry-run would-block / 默认不传 flag 不受影响负控制）。

**Contract invoke（拒绝 + 放行）**：
```
# 拒绝（无 worktree+green 记录 = 第二个 suite-fix subagent 形态，rounds 全 scope=main）
bash integration-batch-merge.sh --root <repo> --develop develop --integration integration --require-worktree-green
integration-batch-merge: measure has_worktree_green_round=False
integration-batch-merge: WORKTREE-GREEN-GATE FAIL-CLOSED — no scope=worktree + state=green verification-round record … nothing moved
integration-batch-merge:   fix: 先在自己 worktree 自测绿 —— node --test <文件> 或 scoped test.sh（scripts/test.sh --for-task <id> / --scoped <文件>），直到 verification-round.jsonl 出现 scope=worktree 且 state=green 记录，再 fan-in
EXIT=1
# dry-run 拒绝：measure has_worktree_green_round=False / DRY-RUN — worktree-green gate WOULD fail closed（EXIT=0，无 ref 移动）
# 放行（有 scope=worktree+state=green 记录 = 第一 subagent 形态，round 218-221）
bash integration-batch-merge.sh --root <repo> --develop develop --integration integration --require-worktree-green --skip-freshness-gate
integration-batch-merge: measure has_worktree_green_round=True
integration-batch-merge: worktree-green-gate OK — ≥1 scope=worktree + state=green verification-round exists …
integration-batch-merge: OK — develop fast-forwarded to integration
EXIT=0
```

**Scoped 门（AC5）**：`bash scripts/test.sh --for-task gap-suite-fix-scope-worktree-green-merge-gate --allow-thin` → `tests 45 / pass 45 / fail 0 / cancelled 0`，**EXIT=0**。静态检查全绿（state-worded-clause-check band 0；red-on-omission-audit invariants 全 1；test-impl-census clean；task-contract-check no violations；delivery-inventory drift gate pass）。

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：无 worktree+green 记录的 fan-in 被拒（贴输出）；有记录放行
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/integration-batch-merge.sh 或 suite-fix 收口逻辑（AC2/AC4：fan-in 前置断言 scope=worktree+green）
- plugin/test/（AC2-AC4：门测试——无记录拒绝 / 有记录放行 / 失败信息可行动）
- orchestration/orchestrator-tick-core.md（A15 ④ 注明 fan-in 前置判据——已有「自测绿」条文，加机械门）
- tasks/gap-ac36-delivery-critical-priority-axis.md（交叉标注——本阶段优先级机制）
- tasks/gap-suite-fix-scope-worktree-green-merge-gate.md（自身：勾 AC + 贴证据）

## Contract

measure   has_worktree_green_round = `python3 -c "import json;rs=[json.loads(l) for l in open('.quay/verification-round.jsonl') if l.strip()];print(any(r.get('scope')=='worktree' and r.get('state')=='green' for r in rs))"` 的 stdout
band      has_worktree_green_round = True（fan-in 前必真；假 ⇒ 拒绝 merge）
invariant no_worktree_green_no_merge = 1（无该记录 ⇒ 拒绝）
invariant reuses_existing_scope_field = 1（不新建机件）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/integration-batch-merge.sh --develop develop --integration integration --dry-run`（贴拒绝/放行结果）
control   无记录拒绝；有记录放行；失败信息可行动；既有路径不回归
resume    门 / 失败信息 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 决定性读数——第二个 suite-fix subagent rounds 230/231 scope=main，从未自测绿（第一 subagent rounds 218-221 scope=worktree + round-221 green 是正对照）。三保障同时失效而条文每条「没违反」。处方=fan-in 前置断言 scope=worktree+green（数据已在 verification-round.jsonl）。实现归 inner

## 交叉标注 (gap-ac41-red-on-omission-artifact, 2026-08-10)

本任务（scope=worktree 闸）是 AC41③ 三次有效干预之一——它的「不做会变红」读数是 `.quay/
verification-round.jsonl` 无 `scope=worktree`+`state=green` 记录 ⇒ fan-in 拒。执行体 =
`red-on-omission-audit` 检查器（`tasks/gap-ac41-red-on-omission-artifact`）把 `scope_worktree_gate`
列为 Contract invariant，机械核对 runner 声明 `scope` 字段 + fan-in 消费者要求 worktree+green。
