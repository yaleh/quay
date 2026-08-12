---
id: gap-suite-start-verifies-target-commit
title: 套件起跑不校验 verifiedCommit 含目标修复 → 一轮 550s 与问题无关
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-12，round 53 作废）**：round 53 起跑时 verifiedCommit=3b2854b6，
而类型修复 c19e70a1 落在它开跑之后（19:12:44 < 19:13:31）⇒ **round 53 验的是修复前树**，
红是预期（ts-typecheck 必红）、结果不采信、550s 全废。
**类型修复至今无任何一轮全量套件证据。**

**根因**：`verifiedCommit` 字段已存在、runner 已在写，但**没人读它、没人拿它与「本轮想验证的修复提交」比对**——
又一个「仪器在报，无人声明判据」（今天第 N 次）。

## Plan

1. 套件起跑前置：**verifiedCommit 必须包含「本轮想验证的那个修复提交」**。
2. 判据：`git merge-base --is-ancestor <期望修复提交> <verifiedCommit> && echo 含`，否则拒绝起跑/标注「验非目标」。
3. **读历史轮次同一条判定（manager 补充，2026-08-12）**：读历史轮次时同样问「这一轮的 verifiedCommit 含不含我关心的提交」——
   `git merge-base --is-ancestor <关心的提交> <该轮的 verifiedCommit>`。**机械、就地、不依赖任何注记**（注记会漂）。
   ⇒ round 53 作废不用加注记，读 jsonl 时用同一条判定自然判出「验非目标」。
4. 纳入 suite-state-trigger 的起跑判据或 outer 起跑前校验。
5. **verifiedCommit 相等闸（manager 2026-08-12，round 62 实证）**：起跑前确认**本次将验的 commit ≠ 最近绿轮的 commit**
   且期间无新提交 ⇒ 跳过起轮（round 62 就是 IDLE-GREEN 2min 阈值 < 收尾耗时造成的 400s 同树重复）。
   **不调 IDLE-GREEN 阈值**（收尾时长是外生变量，硬规则 4 推论）——用「树变没变」判，不用「等了多久」判。
   与 AC1 是同一字段（verifiedCommit）的两半：AC1 防「验了不该验的树」，本条防「重复验同一棵树」。

## 真实样本（2026-08-12 19:23，立案当轮第一次真触发）

round 53 记录写进 jsonl 后，读历史半边按新判据直接判：
```
round=52 red verifiedCommit=7b5e0385
round=53 red verifiedCommit=3b2854b6
git merge-base --is-ancestor c19e70a1 3b2854b6 → NO
⇒ round 53 验的不是目标树，其红不回答「类型修好没有」——无需任何注记，就地判出「验非目标」
```
这是当天唯一一个「立案当轮就真触发并判对」的机制（对比 AC36 轴/`__CEILING__`/message-bus/`(src:N)`/systemd Consumed 全数「建成零触发」）。**有真触发记录的机制比只有测试的机制难被静默退化。**

## AC

- [x] AC1: 起跑时校验 verifiedCommit 含目标修复提交（git merge-base --is-ancestor）
- [x] AC2: 不满足 ⇒ 明确标注「验非目标」/拒绝起跑（不做无意义 550s 轮）
- [x] AC3: 负控制——round-53 类（修复落于起跑后）被该判据挡住
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿
- [x] AC5: 重复验同一棵树被拦——本次将验的 verifiedCommit == 最近绿轮的 commit 且期间无新提交 ⇒ 跳过起轮（round 61→62 同树 400s 重复被拦住）

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 复现用例（起跑时 verifiedCommit 不含目标 → 拒跑/标注）贴出（见 Evidence）
- [ ] 全量套件绿

## Touches

- plugin/scripts/suite-state-trigger.ts（起跑前置校验）
- plugin/scripts/full-suite-runner.ts（若需要 —— 本实现未改 runner；verifiedCommit 写入已存在，起跑闸全在 trigger）
- plugin/test/suite-state-trigger.test.mjs（被触脚本的伴生测试——`--for-task` 选择器按 Touches 把该测试拉进门）
- tasks/gap-suite-start-verifies-target-commit.md（自身）

## Evidence（2026-08-12，scoped 门绿）

**机制**：`suite-state-trigger.ts` 新增两半 verifiedCommit 起跑闸（同一字段，`spawnRetriggerRun` 起跑前判定）：
- **AC1 验非目标**：`checkVerificationStartGates` → `git merge-base --is-ancestor <target> <被测树 HEAD>`。target 优先 `--verify-target <commit>` / `QUAY_SUITE_VERIFY_TARGET` env，缺省取 integration HEAD（验 worktree 测旧树的场景）。target 不在被测树 ⇒ `SUITE-SKIP-NON-TARGET` 标注 + 拒绝起跑（round-53 类：修复落于起跑后 ⇒ 550s 验修复前树被拦）。
- **AC5 同树重复**：`readLastGreenCommit`（verification-round.jsonl 倒扫最后绿轮 commit）——本次将验树 == 最近绿轮树 ⇒ `SUITE-SKIP-SAME-TREE` 跳过起轮（round 61→62 400s 同树重复被拦；用「树变没变」判，不调 IDLE-GREEN 阈值）。
- **读历史轮次同一条判定**：`verifiedTreeContainsCommit(c19e70a1, round.commit, root)` 就地判「验非目标」，无注记。

**scoped 门**：`scripts/test.sh --for-task gap-suite-start-verifies-target-commit`（worktree 根）退出 0：

```
== scoped static checks (change-relevant tier) ==
task-contract-check: no violations.
superseded-capability check: PASS
tick-core-static-check: PASS — execution cores are statically covered.
delivery-inventory drift gate: PASS

ℹ tests 155
ℹ pass 155
ℹ fail 0
ℹ cancelled 0
```

**新增 11 个测试**（plugin/test/suite-state-trigger.test.mjs，AC1/AC3/AC5 直接钉住）：
- `AC1 — verifiedTreeContainsCommit is the shared ancestor predicate (round-53 class: a LATER fix is NOT in the verified tree)` → false
- `AC1 — the round-53 historical judgment is IN-PLACE, no annotation` → 判「验非目标」
- `AC1 — checkVerificationStartGates blocks (验非目标) when the to-be-verified tree does NOT contain the explicit target`
- `AC1 — default target = integration HEAD: a worktree full-suite on an OLDER tree is blocked (验非目标)`
- `AC1 — spawnRetriggerRun SUPPRESSES a round whose tree does NOT contain the target fix (SUITE-SKIP-NON-TARGET, no spawn) — round-53 class`
- `AC5 — readLastGreenCommit scans verification-round.jsonl BACKWARDS for the last GREEN round's commit`
- `AC5 — checkVerificationStartGates blocks (同树重复) when the to-be-verified tree EQUALS the last green round's tree`
- `AC5 — spawnRetriggerRun SUPPRESSES the same-tree duplicate (SUITE-SKIP-SAME-TREE, no spawn) — round 61→62 shape`
- `AC1/AC5 — a NORMAL round start (changed tree, contains target) is NOT blocked by the gates`
- `resolveVerifyTarget — --verify-target CLI wins over QUAY_SUITE_VERIFY_TARGET env, then null default`
- `AC1 — verifiedTreeContainsCommit fails CLOSED on a non-git root / unresolvable commit`

既有测试全绿：`plugin/test/suite-state-trigger.test.mjs` 47/47、`plugin/test/full-suite-runner.test.mjs` 108/108（未改 runner，回归绿）。
