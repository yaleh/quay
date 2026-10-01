---
id: gap-coverage-miss-fail-closed-stops-code-landings
title: 一条历史覆盖缺口的读数被接成 fail-closed 硬闸——单次漏记的代价不是一条红色读数，而是全部 code delta
  落地停摆一整天（2026-10-01 实测）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

**一条「历史事实」的读数被接成 fail-closed 硬闸，于是单次漏记的代价不是一条红色读数，而是全部 code delta 落地停摆一整天。**

### 实测

2026-10-01（UTC）：`gate-event-coverage-check` 因窗口 `[2026-09-30]` 覆盖率 16/17 = 94% < 95% 判红（`--days 1 --gate`，接线在 `plugin/scripts/runner-static-gate.ts:960`）。静态闸 fail-closed ⇒ 当天每一条 code delta 的 fan-in 在静态闸中止，**套件根本没跑**（`.quay/full-suite-state.json` `reason=static-check`；日志尾 `# tests 0 / # fail 46 / # suite red static-check`）。

**负控制（同窗口反例）**：同日 `gap-ac251-resident-unified-host-dead-no-restore` 因 delta 为 doc-only ⇒ `delta → doc-only delta → skip suite` ⇒ 静态闸被跳过，正常落地（有 `append-complete-gate-event` 记录）。⇒ 停的是 code 面，不是全部；**且停摆的成因是「前一天的一条历史读数」，与当轮任何 delta 无关**。

### 为什么这是设计问题而不是运气

<!-- dedup-ref --> `tasks/gap-complete-gateevent-coverage-has-a-residual-gap.md`（status: done）在「## 一处我自己的判断」第 3 条里把这条判据当作漏记的**缓解措施**：「静默不是风险：漏记由**次日**的覆盖率判据报出 …… 告警 + 可检测 = 该失败不可能与「一切正常」同形」。「次日」是**知情**的（同段逐字写了），**没被计价的是「这条判据是阻断性的」** —— 「可检测」被当成了「无害可检测」。这正是本仓库反复出现的那一形态：*检测* 与 *检测的代价* 是两件事。

同一处注释（`runner-static-gate.ts:955-957`）显示作者**已经**为同一理由把窗口从 3 天收窄到 1 天：「窗口 3 天会把某一天的漏记变成持续 3 天的红、挡住无关任务的 fan-in（本仓已记过这类「成本落在无关任务头上」的缺陷）；1 天把影响面限制在次日」。⇒ **「成本不该落在无关任务头上」这条原则已被承认，但只施加在【窗口宽度】这一维，没有施加到【fail-closed 与否】这一维。**

### 与相邻任务的分工

<!-- dedup-ref --> `tasks/gap-ac194-release-bump-classified-as-bypass.md`（status: needs-human）修的是**某一条**误分类（release-cut step-5 版本 bump）；本条修的是**误分类的代价为何由无关任务承担**（接线形态）。

<!-- dedup-ref --> `tasks/gap-silent-completion-path-writes-no-gate-event.md` 修**写侧**（漏记为何发生）；本条修**读侧的后果放大**。两条互补，⛔ 不互相替代。

### 请求动作

二选一（或都做），⛔ 不含「把某个 id 加进豁免表」：

1. **判据的取值与阻断解耦**：让「覆盖率不足」以**独立第三态**或**告警**表达，而不是让整个 code 面 fail-closed；「闸坏了」与「昨天漏记了一条」必须可区分（硬规则 3b）。
2. **把成本限制在出事的那一条**：例如把该判据移出 fail-closed 集合（对齐 `task-contract-check` 的 `--no-block` 形态，见 `runner-static-gate.ts:227`），或使其只对该判据声明的 `@static-object` 面生效。

## AC

- [ ] **AC1（现状固化）** 贴出该判据的接线行（`runner-static-gate.ts:960`）、其 fail-closed 归类依据，与 2026-10-01 的**两次独立**生产读数（fan-in suite 日志 + `.quay/full-suite-state.json`）。
- [ ] **AC2（负控制）** 贴出同窗口 doc-only 落地（`gap-ac251-resident-unified-host-dead-no-restore`）成功的读数，证明停摆面是 code delta 而非全部。
- [ ] **AC3（处置可核）** 修掉 或 写明「已有机制在管、失败在哪一步」；⛔ 不以「已注意到」结案。若选「修掉」，须给出**能取假**的负控：构造一次历史覆盖缺口 ⇒ 新形态下 code delta **仍能落地**，且该缺口**仍被报出**（⛔ 不得以「把它改成不报」收尾 —— 那会把真信号一起删掉）。
- [ ] **AC4（本任务自身的门）** `bash scripts/test.sh --for-task gap-coverage-miss-fail-closed-stops-code-landings` 绿。

## DoD

**真实落地**：在存在一条历史覆盖缺口的条件下，一次 code delta 的 fan-in **能跑到套件**（而不是在静态闸中止），同时该缺口**仍然被报出**（AC3 的负控两半都实跑）。⛔ 只把判据删掉/静音 ⇒ 不算完成。

## Touches

- `plugin/scripts/runner-static-gate.ts`
- `plugin/scripts/gate-event-coverage-check.ts`
- `plugin/test/gate-event-coverage-check.test.mjs`
- `tasks/gap-coverage-miss-fail-closed-stops-code-landings.md`