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
status: done
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

> **AC3 交叉标注——权威与推送方向（2026-08-06，来自 `tasks/gap-two-machine-collaboration-git-branch-claiming.md`）**：
> 两机认领协议的权威/推送方向与本模型**逐条一致**（认领协议就是本模型「多源汇入、基线陈旧」的跨主机
> 天然用例）：
> - **认领与 task 分支推送：双向**——任一机可把空 `task/<id>` 认领分支推到共享裸仓库、可把自己的 task
>   工作合并进 `integration`（integration 是待验证汇入点，设计上就是「多个来源汇入」，跨主机是其天然
>   用例）；
> - **develop：单一权威**——只由外层 verification-round 批量合推进（`integration-batch-merge.sh`），
>   任一机的 task 分支永不直推 develop（develop 永不从未验证树推进，本模型 AC3 不变式跨主机保持）；
> - **master 发布线：继续空置**——quay 无发布流程，push 需人显式授权，两机都不推 master；
> - **跨主机破坏性/批量操作：两方向对称禁止**（外层裁定 2026-08-05 17:2xZ：伤害不认方向）。
> 认领的触摸相交检查复用同一单一来源 `checkTouchesPair`（`claim-task.ts`）——**同机串行与跨机不认领是
> 同一个约束**，只是跨机把它提前到认领时（AC2）。

> **AC4 前置②交叉标注（2026-08-05，来自 `tasks/gap-global-count-assertions-fragile-relative-baseline.md`）**：
> 本 AC4（先修全局计数断言）由 `gap-global-count-assertions-fragile-relative-baseline` 实现并已落地其 AC1–AC3
> （基线快照 helper `plugin/scripts/test-file-snapshot.sh` + B3-2 场景 fixture `plugin/test/test-file-snapshot.test.mjs`，
> scoped 5/5 绿）。模型轮次上线时无需再被断言噪声遮蔽。

> **AC 交叉标注——integration 分支扩展到双向代码合并（2026-08-13，来自 `tasks/gap-two-peer-quay-developers-continuous-bidirectional-merge.md` AC4）**：
> 本任务（integration 分支模型）已做「多源汇入」的**单机**一侧；`gap-two-peer-quay-developers-continuous-bidirectional-merge`
> 把它扩展到**跨机对等**：两个 quay 开发者（A/B 机）各自把本地 develop 与 GitHub origin/develop 双向同步
> （`sync-lag-check.sh --push` 上行 + `--pull` 下行），integration 分支仍是「待验证汇入点」，只是汇入源现在
> 跨主机。权威「最新」= develop/GitHub（人 2026-08-06 裁定，见该任务 AC2/manager-phase-goal.md AC15 权威模型）。

> **AC3 FF-only 假设否证交叉标注（2026-08-07，来自 `tasks/gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling.md`）**：
> 本任务 AC3 的机制假设「integration→develop 永远 fast-forward（integration 永远是 develop 后代，
> SPEC §4）」**已被 2026-08-06 23:48 实证否证**（develop 直提 271 次、对齐后一分钟内又领先 3 提交）。
> 方向裁定：integration→develop 从 FF 改真 merge。`plugin/scripts/integration-batch-merge.sh` 因此新增
> `--merge` 真 merge 模式（默认仍 dry-run 安全）：NOT-FF 报告分歧面 + 共享文件冲突 develop-authoritative
> 自动解 + 真实代码冲突 fail-closed（不盲 --ours/--theirs）。本任务 AC3 的「真分歧负控制」语义保留——
> 只是不再由「FF-only 脚本 exit 1」承载，而是由「`--merge` 的 fail-closed 分支」承载（落地详情与实跑输出
> 见该 gap 任务体）。

## Acceptance Criteria

- [x] AC1: **两线模型**——`develop`（已验证基线）+ `integration`（待验证汇入）；master 发布线角色空置
      （裁定①；等真有发布授权时再加，语义才实）
      落地：`git branch develop master` + `git branch integration develop`（两线建立，integration 初始
      = develop ⇒ `git merge-base --is-ancestor develop integration` exit 0）；两 loop 文档均写入两线
      分支模型表（内层 `fast-mode-loop-tick.md` 步骤 2「两线分支模型」、外层 `orchestrator-loop-tick.md`
      步骤 3b「批量合 integration→develop」）；master 发布线角色空置（quay 无发布流程）。
- [x] AC2: **分叉基线即依赖声明**——独立任务从 develop、声明依赖的从 integration 分叉（不需新依赖
      字段，机械检查：touches 与 integration 未验证任务相交 ⇒ 从 integration 分叉）
      落地：`plugin/scripts/fork-baseline.ts`——`decideForkBaseline(candidate, unverified, expand)`
      复用单源 `checkTouchesPair`，任一未验证任务相交 ⇒ `integration`、全不相交 ⇒ `develop`；
      CLI 从 `git log --format=%s develop..integration` 机械导出未验证集；内层派发步骤 4 新增
      「分叉基线判定」子步骤（`fork_baseline_is_dependency = 1`）。实跑输出见任务体「AC2 实跑输出」。
- [x] AC3: **合并机制**——任务合回 integration（红窗期照常接收）；outer verification-round 批量合回
      develop（fast-forward 无冲突）；红窗停派结构性消除（develop 永不从未验证树分叉）
      落地：`plugin/scripts/integration-batch-merge.sh`——ref-level fast-forward（`git update-ref` +
      CAS on old develop tip），pre-check `git merge-base --is-ancestor <develop> <integration>` 非 0
      即 fail-closed（真分歧 needs-human，绝不 blind --ours/--theirs）；measure
      `git merge-base --is-ancestor <integration> <develop>`（band=0）；外层步骤 3b 在 suiteGreen 时调它，
      红窗期只挡 develop 推进、不挡 integration 接收。实跑输出见任务体「AC3 实跑输出」。
- [x] AC4: **前置② 先修全局计数断言**——脆弱断言（B3-2 族）改成相对基线判据，先于模型轮次落地
      落地：由 `tasks/gap-global-count-assertions-fragile-relative-baseline.md` 实现并已落地其 AC1–AC3
      （`plugin/scripts/test-file-snapshot.sh` + `plugin/test/test-file-snapshot.test.mjs`，scoped 5/5 绿）；
      本任务与其双向交叉标注（Touches 互引 + 本任务 Proposal AC4 前置②注明）。
- [x] AC5: **前置③ 先清历史分支**——60 个历史遗留（experiment-4-iteration-* / _master_check 等）清理，
      保留有未合并工作的分支
      落地：`git branch -d` 清理 **31 个** fully-merged-into-master 历史分支（experiment-4-iteration-0..12、
      `_master_check`、`_review-master-check`、`__mt_master`、`master-check`、`master-latest`、
      `milestones/M6x-cryst-*`、`worktree-agent-*`、`worktree-wf_*` 等——全部为 master 祖先，提交已保留）；
      保留全部有未合并工作的分支（`experiment-4-iteration-13..19`、`dir-loop-wake`、`dist-plugin-*`、
      `salvage/exp5-m01-attempt-1`、在飞 task 分支、`milestone/M239/iteration-0`）。删除前后清单见任务体
      「AC5 实跑输出」。
- [x] AC6: **命名 = integration**——gate/staging/next 被否（语义打架/暗示部署/表达不出待验证）
      落地：SPEC §5 命名裁定（integration ✅ / gate ✗ 与 quay gate 概念打架 / staging ✗ 暗示部署 /
      next ✗ 表达不出待验证）；helper 名 `integration-batch-merge.sh`、`integration` 分支、两 loop 文档
      均用 `integration`。
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
      落地：`plugin/test/branch-model.test.mjs`——7 个测试全绿（`fail 0` / `cancelled 0`）：
      AC3 fast-forward 正路径 + 真分歧负控制 + `--dry-run` 不动 ref；AC2 相交→integration / 不相交→develop /
      git 导出未验证集 / 无 Touches 保守 integration。实跑输出见任务体「AC7 实跑输出」。

## AC 实跑输出（scoped 2026-08-05，worktree 内）

**AC7（测试，7/7 绿）：**
```
✔ AC3: batch-merge fast-forwards develop to integration when integration is a descendant (integration→develop)
✔ AC3 negative control: a TRUE divergence (develop has commits integration lacks) FAILS closed, nothing moved
✔ AC3 --dry-run reports ff-ability and the pending surface WITHOUT moving any ref
✔ AC2: a task whose touches overlap an unverified task on integration forks from INTEGRATION
✔ AC2: a task whose touches are disjoint from every unverified task forks from DEVELOP
✔ AC2: git-derived unverified set — a task/<id> merged into integration (not develop) is detected via develop..integration
✔ AC2: a candidate with NO ## Touches cannot be proven independent → conservative integration
ℹ tests 7   ℹ pass 7   ℹ fail 0   ℹ cancelled 0
```

**AC1/AC3（integration→develop fast-forward，真实 repo 干跑）：**
```
integration-batch-merge: FF-OK — integration is a descendant of develop
integration-batch-merge: measure integration_ff_merges=0 (post: integration is ancestor of develop)
```

**AC5（历史分支清理，删 31 保未合并）：**
```
DELETED: __mt_master _review-master-check audit-m116-verify experiment-4-iteration-0..12(13)
         master-check master-latest milestones/M66-cryst-c1 M67-cryst-inv M68-cryst-b5 M69-cryst-b6
         worktree-agent-a32c837c361983abe worktree-wf_48b19a73-291-{6,7,8,9} worktree-wf_4e2016c0-10b-6
         worktree-wf_ccef4799-196-6 worktree-wf_dfc34384-83e-6
保留（未合并）：experiment-4-iteration-13..19 dir-loop-wake dist-plugin-archguard dist-plugin-local
         salvage/exp5-m01-attempt-1 task/* milestone/M239/iteration-0 worktree-wf_04ca99df-24b-6
         worktree-wf_aa397ddd-14f-6  master develop integration
```

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

- [x] AC1–AC7 全部勾上；AC2/AC3/AC4/AC5 实跑输出贴任务体
- [x] develop+integration 两线运转：inner 分叉 develop/integration → 合 integration → outer 验证 → 批量
      合 develop；红窗停派结构性消除；历史分支已清；全局断言已修
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

> **Touches 收窄交叉标注（2026-08-08，来自 `tasks/gap-touches-bare-dir-uncertain-declaration-drags-the-pool.md`）**：
> 本任务 `## Touches` 的裸目录 + 不确定声明（`plugin/scripts/（分支模型 helper：...，若成脚本）`）已在
> 2026-08-06 收窄为具体路径（`fork-baseline.ts` / `integration-batch-merge.sh` / `integration-branch-model.ts` 等）。
> 收窄裁定：Touches 禁裸目录 + '若成脚本'/'或等价'/'可能' 类不确定声明——声明具体路径或先占明确候选路径
> （如 `plugin/scripts/branch-helper.sh`）。机械检查见该任务 AC1（`bare-dir-uncertain-touch` 于
> task-contract-check.ts，shrink-only baseline `docs/analysis/bare-dir-touches-baseline.md`）。

## Touches

- tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/loop/fast-mode-loop-tick.md（分叉/合并线：develop/integration）
- plugin/loop/orchestrator-loop-tick.md（verification-round 批量合 integration→develop）
- plugin/scripts/fork-baseline.ts（分叉基线判定：独立→develop / 声明依赖→integration）
- plugin/scripts/integration-batch-merge.sh（integration→develop 批量合，fast-forward + CAS）
- plugin/test/branch-model.test.mjs（AC7 合并路径 fixture）
- tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md
- plugin/loop/fast-mode-loop-tick.md（分叉/合并线：develop/integration）
- plugin/loop/orchestrator-loop-tick.md（verification-round 批量合 integration→develop）
- plugin/scripts/integration-branch-model.ts（分支模型 helper：分叉基线判定 / integration→develop 批量合）
- plugin/test/integration-branch-model.test.mjs（AC7：合并路径 fixture 测试）
- tasks/gap-global-count-assertions-fragile-relative-baseline.md（前置②交叉标注）
- orchestration/SPEC-branching-model-integration-branch-2026-08-05.md（引用）

## Test-Files

- plugin/test/branch-model.test.mjs
- plugin/test/integration-branch-model.test.mjs

## Contract

measure   integration_ff_merges = `git merge-base --is-ancestor <integration> <develop>` stdout 的退出码（0=是祖先）
band      integration_ff_merges = 0（integration 永远是 develop 后代 ⇒ fast-forward）
invariant fork_baseline_is_dependency = 1（独立→develop / 声明依赖→integration，机械可查）
invoke    `git log --format=%s develop..integration`（应只见待验证任务合并，红窗期不空；AC2 实跑输出同命令）
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
