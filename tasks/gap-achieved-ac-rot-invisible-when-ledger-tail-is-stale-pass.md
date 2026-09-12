---
id: gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass
title: achieved 判据在最后一次记录后失效时对所有机制不可见——AC-242 检「被记录的失败」而非「当前为假」，实测 4 条已红
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**「achieved 却已失效」目前只有在【被重跑过】之后才可见；从未被重跑者的失效，对所有机制都不可见。**

两个机制各覆盖一半，缺口正好落在中间：

- **I5 复验域**（`goal-store.ts` `checkAchievedFailing`）只收「活跃 goal 名下 ∪ 显式 `long-term: true`」的 achieved AC。goal 一关闭，其未声明的 AC 即离域，此后不再被跑。
- **AC-242** 判「冻结的 achieved 却失败」时读的是**台账尾事件**（`.quay/gate-events.jsonl` 中该 AC 的最后一条 `verdict`）。尾事件为 `pass` 时它判通过——**而尾事件只反映最后一次被跑的结果，不反映判据当前是否为真**。

⇒ 一条 AC 在最后一次记录之后才失效，就同时逃出两者：域外不跑它，台账里它还是 pass。

## Evidence

2026-09-12 实测（逐条真跑判据，⛔ 非推断）：

- 已关闭 goal 名下、`status: achieved`、未标 `long-term`、且有非空判据的 AC 共 **79 条**（分布：GOAL-001 11 / GOAL-002 13 / GOAL-003 13 / GOAL-007 4 / GOAL-008 6 / GOAL-009 8 / GOAL-010 12 / GOAL-011 3 / GOAL-012 5 / GOAL-013 3 / GOAL-015 1）。
- 把这 79 条逐条跑一遍：exit 0 = 75，**exit 1 = 4**，NOT-EVALUATED = 0。
- 这 4 条**当前为假**，而它们的台账尾事件**全是 `pass`**：

| AC | goal | 实跑 | 台账尾事件 | 尾事件距今 | 失败输出 |
|---|---|---|---|---|---|
| AC-147 | GOAL-002 | exit 1 | pass | 112h | `ERR_MODULE_NOT_FOUND` |
| AC-149 | GOAL-002 | exit 1 | pass | 112h | `ERR_MODULE_NOT_FOUND` |
| AC-172 | GOAL-001 | exit 1 | pass | 70h | **无任何输出** |
| AC-228 | GOAL-012 | exit 1 | pass | 42h | **无任何输出** |

⇒ AC-242 对这 4 条**结构上不可能报红**（它读 pass），I5 也不跑它们（域外）。其中 2 条还是静默失败，即便被跑到也无成因可归。

**与既有两条任务的分工（⛔ 不重复）**：`gap-meta-inachievedreverifyscope` 处理的是把 `long-term` 声明落到具体字段上（对象是 AC-217）；`gap-meta-goal-store-activation-gate` 处理的是激活写面缺少「名下至少一条 AC」这道闸。本条处理的是**第三件事**：AC-242 的判定口径——它检「被记录的失败」，而非「当前为假」。

## AC

- [ ] AC1（缺口复现，可取假）：构造/选取一条「台账尾事件 = pass 且判据实跑 exit≠0」的 AC，喂给 AC-242 的判据原文 ⇒ 改前 AC-242 **exit 0**（看不见它）。
- [ ] AC2（修法）：让「achieved 却已失效」的判定不再单靠台账尾事件。⛔ 不得把 79 条无差别纳入每轮复跑（那是被 `goal-store.ts` 注释明令禁止的无差别放宽，且成本不可控）；须给出**有界**的方案并在任务体写明其成本上界。
- [ ] AC3（改后读数，枚举非布尔）：同一条样本上 AC-242（或其继任判定）**exit 1 并点名该 AC**；输出为清单而非布尔。
- [ ] AC4（双向控制）：一条「尾事件 pass 且实跑 exit 0」的健康 AC 在改后仍判通过 ⇒ 修法没有把正常态一并判红。
- [ ] AC5（存量归零）：上表 4 条各自要么被修好（实跑 exit 0），要么被显式处置（`superseded`/降级并写明理由）；⛔ 「已知悉」不算处置。
- [ ] AC6（静默失败）：AC-172 与 AC-228 的判据补上成因输出，失败时 stderr 非空（与 AC-241 同一纪律）。
- [ ] AC7（全量绿）：`scripts/test.sh` 全量绿。

## DoD

生产读数可验证：存在一个机制，能在「判据当前为假但台账尾事件为 pass」这一形态下报红，并在上表 4 条上实际报出过；且该机制的每轮成本有明确上界（写进任务体，非口头）。⛔ fixture 与单测是必要不充分条件（DIR-026 Reading A）。

## Touches

- goals/AC-242-台账不得留下-已离开复验域却尾事件为-fail-的-ac-否则下游判据-ac-241-结构上永不通过-被误读成-还有真缺.md
- packages/quay/src/goal-store.ts
- packages/quay/test/goal-store.test.mjs
- tasks/gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass.md
