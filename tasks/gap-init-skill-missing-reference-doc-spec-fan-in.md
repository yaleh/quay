---
id: gap-init-skill-missing-reference-doc-spec-fan-in
title: plugin/skills/init/SKILL.md 缺 reference-doc 机器声明——SPEC-fan-in-driver 被引用但无 <!-- reference-doc -->，referenced-⊆-landed 恒红
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/skills/init/SKILL.md` 对 `orchestration/SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md` 只有表格提及，缺 `<!-- reference-doc: ... -->` 机器声明 ⇒ `quay-init-loop-driver` AC3/AC7 的 referenced-⊆-landed 检查报红，挡所有 landing（gap-doc-develop 的 fan-in suite 因此红、exited-not-landed）。

这是 b08494480（补 SPEC-cut-the-waiting 声明）的**漏网兄弟**（硬规则 5b：修一个应 grep 同类）。`gap-fixture-hash-omits-skill-md` 的 hash fix 落地后检查变真实，暴露了它。

## Plan

1. `plugin/skills/init/SKILL.md` 加 `<!-- reference-doc: orchestration/SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md -->`。
2. 5b 全族 grep：跑 quay-init --loop referenced-⊆-landed 完整清单，确认无其它漏网声明（含 docs/analysis/*、consumer-laid 面），命中数贴提交。

## Acceptance Criteria

- [x] AC1（能取假）：SKILL.md 含该 reference-doc 声明（grep 命中）；（⛔ 仍缺 ⇒ 假）。
- [x] AC2（能取假，全族）：referenced-⊆-landed 完整清单零漏网（grep 全仓引用但缺声明的文件，仅剩已声明者），命中数贴提交；（⛔ 还有漏网 ⇒ 假）。

## Definition of Done

声明补齐；AC1-AC2 全勾；referenced-⊆-landed 检查转绿（quay-init-loop-driver AC3/AC7）。

## Touches

- plugin/skills/init/SKILL.md（补 reference-doc 声明）
- tasks/gap-init-skill-missing-reference-doc-spec-fan-in.md（自身）

## Resolution（verify-only 收尾，无 SKILL.md 改动）

立案前提（「缺声明 ⇒ referenced-⊆-landed 恒红」）对当前 develop 状态**为假**——声明从未缺失：

- `plugin/skills/init/SKILL.md:208` 已含 `<!-- reference-doc: orchestration/SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md -->`，由 **cffad9279**（2026-08-27，早于本任务立案 991a7ac7c 的 2026-08-31）引入——该 SPEC 与其 init/manager 声明点**同 commit 落地**，不是 b08494480 的「补声明漏网」形态。

验证（worktree @ develop 871412ced，机械检查全部绿）：

| 判据 | 读数 |
|---|---|
| AC1 声明 grep 命中 | 1（`init/SKILL.md:208`） |
| `spec-declaration-point-check.ts` | PASS — 36 SPECs × 2 声明点，missingSpecs 全空 |
| `quay-init-loop-driver.test.mjs` | 15/15 绿（含 AC7 referenced-⊆-landed 完整分类；AC1/AC4 断言 `verify-referenced-landed: OK`） |
| 全仓 grep `SPEC-fan-in-driver-mechanical-orchestration` | init/SKILL.md（声明）、manager/SKILL.md（SPEC 索引）、若干 task/SPEC/测试/分析文档——无 shipped-skill 声明点缺口 |

AC2 命中数：referenced-⊆-landed 完整清单 **零漏网**（orchestration 引用 60、docs/analysis 引用 4，未声明者 4 个均属 --loop 落地的 exec-core tick doc，landed 非缺陷；无「引用但既未落地也未声明」者）。

⇒ DoD 已满足（声明在、AC 全勾、检查绿），无需改 SKILL.md。
