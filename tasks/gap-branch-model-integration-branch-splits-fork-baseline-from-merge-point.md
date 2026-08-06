---
id: gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point
title: "introduce an integration branch to split the 'fork baseline' from the
  'merge point' (reference git-flow extension: inner forks develop, merges to
  integration, outer verifies, batch-merges integration→develop fast-forward) —
  master currently bears BOTH roles, which is WHY the red-window must stop
  dispatch (structural fix, more fundamental than the shared-gate heuristic);
  measured: master landings 97x/median 3min with 4 gaps >20min (max 38) =
  red-window stop-dispatch, the new model fills them (throughput HIGHER, the
  'lower frequency is a cost' judgment was wrong); baseline-staleness and
  touch-disjointness are the SAME constraint; cost bounded (integration→develop
  always fast-forward, task→integration conflicts only from touch-declaration
  imprecision — existing defect); naming: integration; dependency via fork
  baseline (independent→develop, declared-dependency→integration); rulings: ①
  two lines (develop+integration, master release role empty), ② fix fragile
  global-count assertions FIRST, ③ clean 60 historical branches FIRST"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`orchestration/SPEC-branching-model-integration-branch-2026-08-05.md`（人提出参考 git-flow 扩展）。
**核心：现在 `master` 同时是「分叉基线」和「汇入点」，红窗必须停派发正是因为这两个角色压在同一个 ref
上——拆开即无此冲突**（结构性，比「红落共享闸门才停派发」那个启发式更根本）。

**实测支持**（今晚 22:00 起）：master 落地类提交 97 次、间隔中位 3 分钟，**4 次 >20 分钟空档（最大 38
分钟）正是红窗停派造成**——新模型下 integration 照常接收合并、空白被填上 ⇒ **develop 吞吐高于现在的
master**（「更新频率更低是代价」判断错了，人指出 + 实测支持）。

**关键论证**：基线陈旧只对**触摸集相交**的任务造成麻烦，而相交任务本来就该串行（checkTouchesPair +
disjointness 排序在做）——**能并发的任务恰好就是不在乎基线陈旧的那些，两个约束是同一个**。

**成本有上界**：integration→develop 永远 fast-forward 无冲突；task→integration 一次面对的分歧更宽但
并发上限 3 + disjointness 已筛，剩余冲突只来自触摸集声明不准（既有缺陷，非本方案引入）⇒ **增量 = 声明
不准的程度**。

### 选定机制（含外层对三个开放问题的裁定）

**两线模型**（裁定①：**两线**——develop 已验证基线 + integration 待验证汇入；master 发布线角色目前
是空的 [quay 无发布流程、push 需人显式授权]，等真有发布授权时再加 master，那时语义才实）：

1. **分叉**：inner 从 `develop`（已验证，绿）分叉独立任务；声明依赖前序任务的从 `integration`（含未
   验证前序）分叉——**分叉基线即依赖声明**，不需新机制，可机械检查（touches 与 integration 上未验证
   任务相交就该从 integration 分叉）。
2. **合并**：任务合回 `integration`（待验证汇入点，红窗期照常接收——结构性消除停派）；outer
   verification-round 验证后**批量合回 `develop`**（integration 是 develop 后代 ⇒ fast-forward 无冲突）。
3. **命名 = `integration`**（gate 与 quay 的 gate 概念打架 / staging 暗示部署 / next 表达不出待验证）。
4. **前置**（裁定②：**先修断言**）——全局计数断言（B3-2 已记载脆弱）在模型下更频红，**先修成相对
   基线判据再让模型上线**，模型轮次不被断言噪声遮蔽；
   （裁定③：**先清分支**）——60 个历史遗留分支（experiment-4-iteration-* / _master_check 等）先清，
   否则新旧并存让「哪条线是权威」更难看清。

## Acceptance Criteria

- [x] AC1: **两线模型**——`develop`（已验证基线）+ `integration`（待验证汇入）；master 发布线角色空置
      （裁定①；等真有发布授权时再加，语义才实）
- [x] AC2: **分叉基线即依赖声明**——独立任务从 develop、声明依赖的从 integration 分叉（不需新依赖
      字段，机械检查：touches 与 integration 未验证任务相交 ⇒ 从 integration 分叉）
- [x] AC3: **合并机制**——任务合回 integration（红窗期照常接收）；outer verification-round 批量合回
      develop（fast-forward 无冲突）；红窗停派结构性消除（develop 永不从未验证树分叉）
- [x] AC4: **前置② 先修全局计数断言**——脆弱断言（B3-2 族）改成相对基线判据，先于模型轮次落地
      （前置任务：`gap-global-count-assertions-fragile-relative-baseline`，其 AC1–AC5 全绿后本 AC 视为满足）
- [x] AC5: **前置③ 先清历史分支**——60 个历史遗留（experiment-4-iteration-* / _master_check 等）清理，
      保留有未合并工作的分支
- [x] AC6: **命名 = integration**——gate/staging/next 被否（语义打架/暗示部署/表达不出待验证）
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`（合并路径 fixture：integration→develop
      fast-forward；task→integration 触摸声明冲突暴露）

### Invoke evidence

- **AC2/AC3/AC7 实跑**（scoped 选中集 `bash scripts/test.sh --for-task ... --allow-thin`，11/11 pass，
  fail 0 / cancelled 0，exit 0）——真实输出（2026-08-06）：

```
warning: test-selection-thin: task gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point resolved tests for 2/7 Touches entries (0.29) < 0.5; pass --allow-thin to run anyway
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
test-framework-policy-check — 228 glob file(s), 34 exemption(s)
PASS: every test file uses node:test or is a listed legacy exemption; exemption list is at/below the ratchet ceiling and did not grow; new files declare @test-group.
test-isolation-check — 228 glob file(s), 44 current violation(s) [fixed-path-write=12 ...]
PASS: all 44 violation(s) are baselined in plugin/test-isolation-violations.txt; the list can only get SHORTER ...
test-impl-census: checked 228 test files · clean 228 · impl-deleted 0
task-contract-check: no violations.
  strict-subset mode (scoped static-check tier) — a violation on a scanned task FAILS this run (exit 1)
strategic-doc-staleness-check — 90 strategic doc(s) scanned (docs/proposals + orchestration/*.md)
stale_refs_found (new, beyond baseline): 0
drive-contract-check — 3 drive-contract doc(s) scanned (fast-mode-loop-tick / orchestrator-loop-tick / QUAY-OUTER-HANDOFF)
violations: 0
  [ok] plugin/loop/fast-mode-loop-tick.md: 1 order assertion(s), pair output present
  [ok] plugin/loop/orchestrator-loop-tick.md: 1 order assertion(s), pair output present
== build dist/quay.js ... ⚡ Done in 117ms ==
✔ AC2: independent task forks from develop (verified baseline) (1.04ms)
✔ AC2: a declared dependency forks from integration (no new dependency field needed) (0.16ms)
✔ AC2: touches overlapping unverified integration work ⇒ integration (mechanically checkable) (0.16ms)
✔ AC3: develop is an ancestor of integration (integration a descendant) ⇒ fast-forward, no conflict (0.19ms)
✔ AC3: invariant broken (integration diverged from develop) ⇒ blocked, never auto-merge (0.15ms)
✔ AC3: overlapping touch declarations surface the imprecision that makes task→integration non-ff (0.82ms)
✔ AC3: disjoint touch declarations produce no overlap (independent tasks stay ff at merge) (0.14ms)
✔ AC3: duplicated overlaps are deduped and blank entries are ignored (0.18ms)
✔ AC2: declaredTouches parses a task body's ## Touches list (0.44ms)
✔ AC2: declaredTouches strips (new) markers and stops at the next ## heading (0.33ms)
✔ AC2: declaredTouches returns [] for a body with no ## Touches section (0.17ms)
ℹ tests 11  ℹ pass 11  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
```

- **AC2/AC3 的 Contract invoke/measure 实跑**（`plugin/scripts/integration-branch-model.ts` CLI）：
  `--fork-baseline tasks/<本任务>.md --root ...` → `integration`；`--is-ancestor develop integration`
  → `ancestor`（exit 0，两线 ff 不变量成立）；`--pending develop integration` → `(none)`（当前
  develop 尚未从 integration 收编——pending 窗口在模型上线后的红窗期应非空，Contract invoke）。

- **AC4（前置②）**：`tasks/gap-global-count-assertions-fragile-relative-baseline.md` `status: done`、
  AC1–AC5 全部勾上（B3-2 族全局计数断言已相对化，fixture 复现绿）；本执行在本任务 Touches 内的该任务
  体加「## 交叉注（前置②执行确认）」双向标注。

- **AC5（前置③）**：`git branch -a` 实况无 `experiment-4-iteration-*` / `_master_check` 遗留分支
  （仅 3 local + 7 remote）；历史遗留已在分支切换时清理，本执行以观测确认（保留有未合并工作的分支）。

- **AC6（命名）**：两线分支名在 loop 文档与 helper 中统一为 `integration`；`gate`/`staging`/`next`
  均未采用（SPEC §5 三候选被否）。

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC2/AC3/AC4/AC5 实跑输出贴任务体
- [ ] develop+integration 两线运转：inner 分叉 develop/integration → 合 integration → outer 验证 → 批量
      合 develop；红窗停派结构性消除；历史分支已清；全局断言已修
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md
- plugin/loop/fast-mode-loop-tick.md（分叉/合并线：develop/integration）
- plugin/loop/orchestrator-loop-tick.md（verification-round 批量合 integration→develop）
- plugin/scripts/integration-branch-model.ts（分支模型 helper：分叉基线判定 / integration→develop 批量合）
- plugin/test/integration-branch-model.test.mjs（AC7：合并路径 fixture 测试）
- tasks/gap-global-count-assertions-fragile-relative-baseline.md（前置②交叉标注）
- orchestration/SPEC-branching-model-integration-branch-2026-08-05.md（引用）

## Test-Files

- plugin/test/integration-branch-model.test.mjs

## Contract

measure   integration_ff_merges = `git merge-base --is-ancestor <integration> <develop>` stdout 的退出码（0=是祖先）
band      integration_ff_merges = 0（integration 永远是 develop 后代 ⇒ fast-forward）
invariant fork_baseline_is_dependency = 1（独立→develop / 声明依赖→integration，机械可查）
invoke    `git log --oneline develop..integration`（应只见待验证任务合并，红窗期不空）
control   构造红窗期任务合 integration ⇒ 不阻塞（结构性消除停派）；触摸声明不准 ⇒ 冲突暴露（逼修真缺陷）
resume    两线迁移与前置（断言/清分支）分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T06:5xZ
changed: 外层读分支模型 SPEC 裁定立案 + 三问裁定：
(1) **两线**——develop + integration；master 发布线角色空（quay 无发布流程），等真有授权再加；
(2) **先修断言**——全局计数断言脆（B3-2 族）先修成相对基线判据，再让模型上线（防断言噪声遮蔽模型轮次）；
(3) **先清分支**——60 个历史遗留先清，保留有未合并工作的；
(4) **结构性 > 启发式**——红窗停派是 master 双角色压一 ref 的后果，拆开即无冲突（比共享闸门启发式根本）。
status: todo——结构性大改；排 ROUND 3 收尾后，高优先。
