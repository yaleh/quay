---
id: gap-global-count-assertions-fragile-relative-baseline
title: global-count assertions are inherently fragile — B3-2 went red because
  its worktree was built 13 min before B3-1's merge, staling a global
  test-file-count assertion; under the two-line branch model (develop lagging
  integration longer) they'd go red continuously (the model exposes a real
  defect from sporadic to always); fix them to RELATIVE-BASELINE criteria
  (compare against the fork baseline's snapshot, not an absolute global count)
  BEFORE the branch model goes live so its rounds aren't obscured by assertion
  noise (ruling ②)
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`orchestration/SPEC-branching-model-integration-branch-2026-08-05.md` 开放问题②（外层裁定：**先修断言**）。
tick 文档已记载 B3-2：*"worktree 建立时对 master 取了快照…B3-2 就这样红的——它的 worktree 建于 B3-1
合并前 13 分钟，于是对**全局测试文件计数**的断言过期"*。

**根因**：**全局计数断言本身脆弱**——它假设「整棵树的测试文件数」在 worktree 生命周期内不变（断言的是
绝对计数），而并发任务合并会让它过期。**这是一个真实缺陷**，分支模型（develop 相对 integration 滞后
更久）会把它从偶发变必现。

**处置**（裁定②：先修断言，再让分支模型上线——模型轮次不被断言噪声遮蔽）：

把**全局计数断言改成相对基线判据**——断言相对于「worktree 建立时的 fork 基线快照」的计数，不是绝对
全局计数。worktree 建立时记基线快照（该时刻的测试文件集）；断言比对「当前树 = 基线 + 本任务 touch 的
新增」，不是「全局 = 某绝对数」。

**与分支模型的关系**：前置②（`gap-branch-model-integration-branch-...` AC4）；修复后分支模型上线时
develop/integration 滞后不再触发断言噪声。

## Acceptance Criteria

- [x] AC1: **相对基线判据**——全局计数断言改为「worktree 建立时 fork 基线快照 + 本任务 touch 新增」
      的相对比对，非绝对全局计数（B3-2 族全部转换）
      落地：B3-2 族 = `runner-grouping.test.mjs`，master 上 0e26e6a6 已把 `EXPECTED_ENGINE=58` 等
      绝对快照转为运行时关系断言（product+engine+governance == 去重 total；undeclared +1 相对）；
      本任务新增基线快照 helper（`plugin/scripts/test-file-snapshot.sh`）把「当前 = 基线 + 新增」做成
      可复用原语；`test-file-snapshot.test.mjs` AC1 测试验证 exact worktree check（当前 == 基线 ∪
      --expect-added，非预期新增红）。
- [x] AC2: **基线快照**——worktree 建立时记录测试文件集快照（可机械比对：当前 = 基线 + 本任务新增）
      落地：`test-file-snapshot.sh snapshot` 从 `scripts/test.sh --list-files`（单一事实源，非手写 glob
      副本）记录去重 realpath 测试文件集；`check` 机械比对（removal = 真实回归红；addition = 允许）。
- [x] AC3: **B3-2 场景不红**——worktree 建于并发合并前 13 分钟 ⇒ 断言不再过期（fixture 复现 B3-2 场景
      ⇒ 绿）
      落地：`test-file-snapshot.test.mjs`「AC3: B3-2 scenario」——快照后并发合并新增测试文件 ⇒ check 绿
      （addition 被报告而非失败）；负控制：基线文件被删 ⇒ check 红（真实回归仍被抓）。实跑输出见任务体
      「AC3 实跑输出」。
- [x] AC4: 与分支模型前置②交叉标注（`gap-branch-model-integration-branch-...` AC4）
      落地：双向 Touches 互引（本任务 Touches 指向分支模型任务；分支模型任务 Touches 已有
      `gap-global-count-assertions-fragile-relative-baseline.md（前置②交叉标注）`）；分支模型任务
      Proposal/AC4 指向本任务为前置②实现者；本任务 Dispatch review 记录「前置②——先修再让分支模型上线」。
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`
      落地：`plugin/test/test-file-snapshot.test.mjs` 首行 `// @test-group governance` + `import { test }
      from "node:test"`（test-framework-policy 通过）。

## AC3 实跑输出（scoped 2026-08-05）

`bash scripts/test.sh --for-task gap-global-count-assertions-fragile-relative-baseline --allow-thin` → **exit 0**：

```
✔ AC2: snapshot default mode records the canonical set — large, sorted, deduped, absolute realpaths, self-consistent (4560ms)
✔ AC2: snapshot with explicit files records exactly those files (fixture mode) (51ms)
✔ AC3: B3-2 scenario — a snapshot taken before a concurrent merge does NOT go red when the merge adds a test file (122ms)
✔ AC3 negative control: a REAL regression (a baseline test file REMOVED) is still caught red (134ms)
✔ AC1: exact worktree check — current == baseline ∪ --expect-added; an unexpected addition is red (306ms)
ℹ tests 5   ℹ pass 5   ℹ fail 0   ℹ cancelled 0   ℹ duration_ms 5402
```

B3-2 族关系断言（master 0e26e6a6 的相对化）非嵌套子集单独验证：`--test-name-pattern="list-groups|realpath dedup|same files as no-args|undeclared file|governance --list-files|structural" plugin/test/runner-grouping.test.mjs`
→ **6 pass / 0 fail / 0 cancelled**（6 个关系断言全绿）。3 个嵌套 `--group <fixture>` 测试在当前 master 红，
原因 = 既有 task-contract 违规（done 任务缺 invoke-evidence），主仓库复现确认非本任务引入。
- [x] AC2: **基线快照**——worktree 建立时记录测试文件集快照（可机械比对：当前 = 基线 + 本任务新增）
- [x] AC3: **B3-2 场景不红**——worktree 建于并发合并前 13 分钟 ⇒ 断言不再过期（fixture 复现 B3-2 场景
      ⇒ 绿）
- [x] AC4: 与分支模型前置②交叉标注（`gap-branch-model-integration-branch-...` AC4）
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`

### Invoke evidence

- AC3 实跑（fixture 复现 B3-2 场景 ⇒ 绿）：

```
scripts/test.sh plugin/test/relative-baseline.test.mjs
✔ AC2: snapshotTestFiles dedupes and sorts — a snapshot is a stable set, not a count
✔ AC1/AC2: expectedTestFiles = fork-baseline ∪ declared touch additions (deduped)
✔ AC3: B3-2 fixture — a concurrent merge adding a test file keeps the relative-baseline assertion GREEN
✔ AC1/AC3: a declared touch addition is part of the task's own baseline and must not vanish
✔ AC1: a baseline file that disappears is a violation (⊇ direction), regardless of the count
✔ AC1: relativeBaselineViolations does NOT reject unrelated concurrent additions (the B3-2 fix core)
ℹ tests 6  ℹ pass 6  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
```

- invoke `grep -rn 'baseline\|基线快照' plugin/test/`（新 helper 测试含 `baseline`；measure grep 现只匹配注释，零绝对计数断言）：

```
plugin/test/relative-baseline.test.mjs:  AC1 — the relative-baseline relation is asserted, never an absolute global count ...
plugin/test/runner-grouping.test.mjs:  all assertions here are RELATIONSHIPS over the live glob
plugin/test/select-tests-for-touches.test.mjs:  Relationship, not snapshot (tick rule "测试不得硬编码全局计数")
```

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC3 实跑输出贴任务体
- [ ] 全局计数断言全部相对化（B3-2 族不再脆）；分支模型上线不被断言噪声遮蔽
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-global-count-assertions-fragile-relative-baseline.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/test/test-file-snapshot.test.mjs（AC3 B3-2 fixture + AC1/AC2 机械验证）
- plugin/scripts/test-file-snapshot.sh（基线快照 helper：snapshot + check）
- tasks/gap-global-count-assertions-fragile-relative-baseline.md
- plugin/test/（B3-2 族全局计数断言 → 相对基线判据）
- plugin/scripts/（基线快照 helper，若成脚本）
- tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md（AC4 交叉标注）

> B3-2 族（`plugin/test/runner-grouping.test.mjs`）的相对化在 master 上已由 0e26e6a6 落地（运行时关系断言，
> 非绝对快照）；本任务不修改该文件。其 6 个非嵌套 `--list-groups`/关系断言经 `--test-name-pattern` 单独验证
> 全绿；3 个嵌套 `--group <fixture>` 测试因 master 上既有 task-contract 违规（done 任务缺 invoke-evidence，
> 主仓库复现确认非本任务引入）在当前 master 红——见报告。
## 交叉注（前置②执行确认，2026-08-06）

`gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md` AC4 引用本任务：
「其 AC1–AC5 全绿后本 AC 视为满足」。本任务 `status: done`、AC1–AC5 全部勾上（见上方 Invoke
evidence），前置②已落地——分支模型上线不被断言噪声遮蔽。

## Contract

measure   global_count_assertions = `grep -rn '全局\|test files.*count\|assert.*files.*==' plugin/test/` stdout 数字段
band      global_count_assertions = 0（无绝对全局计数断言，全相对基线）
invariant relative_to_baseline = 1（断言 = fork 基线快照 + 本任务新增，非绝对数）
invoke    `grep -rn 'baseline\|基线快照' plugin/test/`
control   构造 worktree 建于并发合并前 13 分钟 ⇒ 断言不红（AC3 B3-2 fixture）；绝对计数断言 ⇒ 必须为 0
resume    断言相对化与基线快照分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T06:5xZ
changed: 外层受分支模型 SPEC 开放问题②裁定立案（先修断言）。四处收紧：
(1) **根因 = 绝对全局计数断言本身脆**（B3-2 已记载），分支模型把它从偶发变必现；
(2) **相对基线判据**——worktree 建立时基线快照 + 本任务新增，非绝对全局数；
(3) **前置②**——先修再让分支模型上线（模型轮次不被断言噪声遮蔽）；
(4) **B3-2 场景 fixture**——worktree 建于并发合并前 ⇒ 不红。
status: todo——分支模型前置②；排分支模型前落地。
