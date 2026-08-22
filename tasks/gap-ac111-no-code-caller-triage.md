---
id: gap-ac111-no-code-caller-triage
title: AC111 无代码调用者机件逐条三选一判定（重扫 + wired/retired/manual-by-design，仅 .md 类归零）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 投「结晶」阶段首批立案（AC111，判据正本在 `orchestration/manager-phase-goal.md` AC111 段）。人令已切阶段（manager 495ddd26 标 AC110-117+AC128 为当前阶段）。

「结晶」阶段首要靶心：**无代码调用者的机件逐条判定**。08-16 快照 19 条（8 catalog-only + 11 .md-only）已漂（本阶段新增 `suite-bucket-*.ts` 等），需切换时重扫 + 逐条三选一（wired/retired/manual-by-design），使「仅 .md 文档提及」类归零。这类机件的「调用者」是 `*-tick-core.md`/`SKILL.md` 里的散文指令，靠某一层每轮记得跑 ⇒ 硬规则 9「守与不守在记录上无法区分」的活样本。

**为什么 inner 执行**：重扫 + 判定 + 记录落盘（不直接退役）属产品机件审计 → inner 域（若判定接机械触发点则涉及代码）。

## Plan

1. **重扫**：用 08-16 扫描谓词（含排除 `packages/quay/plugin/` 镜像的修正），产出现推的当前无代码调用者清单。
2. **逐条三选一判定并落记录**：`wired`（接进机械触发点）/ `retired`（删除）/ `manual-by-design`（保留 + 写明为何必须靠人跑）。
3. **重扫验证**：同一谓词重扫，「仅 .md 文档提及」类 = 0。

## Acceptance Criteria

- [x] AC1（能取假）：判定完成后同一谓词重扫，「仅 .md 文档提及」类 = 0（要么有代码调用者，要么文件不存在，要么显式 manual-by-design）。
- [x] AC2：每条判定有记录（三选一 + 理由）。
- [x] AC3：retired 条目**不在本任务删除**——退役在后续按记录单独立任务，每条带「它防的缺陷现在由什么防」或「该缺陷类已不可能发生」的理由（⛔ 不得因「很久没报红」就退役）。

## Definition of Done

- [x] 重扫清单落盘 + 逐条三选一记录完整 + 重扫验证「仅 .md」类 = 0；AC1-3 全勾；land 到 develop。

## Retires

net-add: 本任务是扫描 + 判定，不直接退役；退役在后续按三选一结果单独立任务。

## Touches

- .quay/no-code-caller-triage.jsonl (new)（判定记录落点）
- tasks/gap-ac111-no-code-caller-triage.md（自身）
