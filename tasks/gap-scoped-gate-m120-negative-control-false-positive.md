---
id: gap-scoped-gate-m120-negative-control-false-positive
title: 修缺：scoped-gate 把 build-dist.test.mjs 的 m120 负控制 stderr 误判为真实失败
status: ready
role: primitive
labels:
  - scoped-gate
  - false-positive
  - fan-in-blocker
  - cross-suite-violation
created: 2026-09-03T03:10Z
extra:
  depends_on:
    - gap-retire-session-liveness
  schema: execution
---

## Finding

**严重度**：🔴 blocks fan-in（已两次实例）
**发现者**：driver development progress (cross-session)

### 现象
scoped-gate（`scripts/test.sh --for-task <task> --allow-thin`，`worker-driver.ts` 的
`scopedGateCommandFor`）报红，输出中包含：
```
✘ [ERROR] Could not resolve "/tmp/quay-m120-does-not-exist.ts"
```

### 已核实的根因线索
1. 该字符串来自 `packages/quay/test/build-dist.test.mjs:99` 的**负控制测试 (c)**
   （`"(c) failure path: a nonexistent QUAY_BUILD_DIST_ENTRY makes buildDist() reject loudly"`）：
   故意把 `QUAY_BUILD_DIST_ENTRY` 设成一个不存在的路径,断言 `buildDist()` 必须 reject——
   esbuild 内部把解析失败打到 stderr,是**该测试通过的预期副产物**,不是真实故障。

2. `worker-driver.ts:2781` 的 `isFailureSignalLine()` 正则**故意**把 `Could not resolve` /
   `[ERROR]` 列为失败信号词——这是为了修复它的姊妹缺陷
   `gap-scoped-gate-reason-stderr-drops-stdout`（scoped 门**真红**时,esbuild 构建失败的这行
   摘要之前会被丢弃,导致 reason 里看不到真实原因）。

3. **本缺陷是该修复的镜像反例**：当 scoped-gate **整体通过**（负控制测试本身 `ok`,exit 0）,
   这行 stderr 文本依然出现在 stdout+stderr 合并流里；若下游把 `isFailureSignalLine` 的
   **非空匹配**当作「存在失败」的判据（而不是仅用于「已知失败后生成可读摘要」）,就会把
   一次真实通过的 scoped-gate 误判为红。

### 待查（下一步，实施者需现场确认，不猜测）
- `extractFailureSummary`/`extractFirstFailureLine` 的**调用点**：是否有任何调用方把
  「非空摘要」当作 pass/fail 判据本身用,而不是只在已知 `exit code ≠ 0` 之后才调用它们
  生成 reason 文本？（按 `worker-driver.ts:2793-2810` 的函数注释,设计意图是后者——
  需要现场核实是否有调用点违反了这个契约）
- `scripts/test.sh --for-task` 对 `node --test` 子进程的**真实 exit code** 在两次事故里
  分别是多少？如果 `node --test` 本身报 0（因为所有测试含负控制测试都是 `ok`）,而 fan-in
  仍判红,说明误判发生在**摘要提取层**之外，需要往上一层找（`select-static-checks-for-touches.ts`
  或 fan-in-execute 的判定逻辑）。

### 影响
- 🔴 **第一次**：`gap-unified-frontmatter-parser` 撞上,后续重派 scoped-gate 才通过
  （绕过而非修复,问题仍在）
- 🔴 **第二次（当前）**：`gap-task-write-schema-depends-on-documentation` 撞上,挡住 fan-in
- ⚠️ 全局缺陷（硬规则 5b）：非任务自身 Touches 问题（`TOUCHES-DIR-GLOB-HINT` 明确 hint only）,
  会挡住任何 scoped test 集合恰好包含 `build-dist.test.mjs` 的任务

---

## Result（实施者现场核查，2026-09-03）

**判定点核查（DoD #1）**：scoped-gate 的 pass/fail 判据是 `mechSh` 的 `ok: status === 0`
（真实 exit code），不是「非空摘要」。`extractFailureSummary` / `extractFirstFailureLine` 的
全部调用点（`worker-driver.ts` 的 `fail()` / `step()` trace reason / `failSuite`）都在**已知失败
之后**才调用（`!a.ok` / `!r.ok` / `sr.outcome !== "done"`），无一反向参与判定 ⇒ **判定侧无
「摘要函数结果被当判据」的误用**（原 Finding 假设 3 证伪）。

**两次红的真实原因（证伪「m120 误判」假设）**：`worker-outcome.jsonl` 两条 scoped-gate red
记录的 `exitCode=1`，真实失败是 `plugin-packaging.test.mjs` 的
`shipped schema-check modules are byte-identical …`（`task-schema.ts` 与 canonical 漂移），
不是 build-dist 负控制测试。该漂移已由 `dd1a9fda5` / `eb9db3c42` 修复——当前 scoped-gate
`--for-task gap-task-write-schema-depends-on-documentation` 实测 118/118 绿、exit 0。

**m120 噪声的真实角色**：`✘ [ERROR] Could not resolve "/tmp/quay-m120-does-not-exist.ts"` 是
负控制测试 (c) 通过时的**良性 stderr**，但 `isFailureSignalLine` 把 `Could not resolve`/`[ERROR]`
当失败信号词（姊妹缺陷 gap-scoped-gate-reason-stderr-drops-stdout 引入），于是它在 scoped-gate
**真红时**污染 `extractFailureSummary` 的 reason、把真实失败行挤出 4000 字符窗口——正是这条噪声
让两次误诊把「task-schema 漂移」读成了「m120 是失败原因」。

**修复（源头侧，Plan Step 2 的 (b)）**：`build-dist.mjs` 的 `buildDist()` 新增 `logLevel` 透传
（默认 `"info"` 保持原行为）+ catch 块 `console.error` 仅在非 silent 时发射；负控制测试 (c)
传 `logLevel: "silent"`，从源头消除这行噪声（esbuild `logLevel:"silent"` 仍 throw ⇒
`assert.rejects` 断言语义不变）。

### 补充（2026-09-04 CONTINUE 轮）：fan-in 被无关的全局红挡住，本轮一并解

m120 修复本身已完成（3/3 AC 全勾、scoped-gate 实测绿）。但 fan-in 连续 4 轮 `step=suite: # fail 1`
的真实原因**不是本任务**，而是 develop 侧全局红：`orchestration/SPEC-tmux-retirement-2026-09-03.md`
由 `bd17daad3` 加入却未在两个 SPEC 声明点登记，`spec-declaration-point-check`（fail-closed）把
**所有** fan-in 挡在 suite 步。本轮在本任务工作树补登两个声明点（`plugin/skills/init/SKILL.md`
reference-doc + `plugin/skills/manager/SKILL.md` SPEC index），并把这两文件纳入 `## Touches`
（否则 anti-drift 越界 HARD FAIL）。这是对既有多起同形修复（`189e9dd17`/`c4dd6899b`/`0a5f20cea`/
`a71b1524c`）的延续，与本任务 m120 修复正交。

### 补充（2026-09-04 CONTINUE 第二轮）：m120 已落地，当前 suite 红是 develop 侧另一全局红

m120 修复已完成且是本分支相对 develop 的唯一实质变更（`git diff develop...HEAD` 仅 3 文件：
`build-dist.mjs` + `build-dist.test.mjs` + 本任务体；AC 3/3 全勾）。本轮 suite 红**不是本任务**，
而是 develop 侧另一条全局红：`plugin/test/direct-to-develop-bypass-check.test.mjs:651`
（"AC3 回放·CLI 全量扫描 b11ce720"）——checker 返回 exit 1，测试期望 exit 0 NOT-EVALUATED。

**成因**：合并提交 `c789d1f49`（"Merge fix/runtime-usage-ac4-host-corpus into develop"，触及
`plugin/test/runtime-usage-inventory.test.mjs`）被判 `confirmedBypass:true`——它不在 fan-in ledger
（`fan-in-ff-merge.sh` 只记 ff 落地的 `landedSha`，merge 落地漏记），reflog action `commit (merge):`
落入「直接提交」分支 ⇒ RED。已实测：主检出 develop（`a5873f548`）与工作树同红；两处 ledger
`grep -c c789d1f49` 均 0。

**待裁定（非本任务 Touches，⛔ 不擅自修）**：`c789d1f49` 属 (a) 合法 fan-in 落地但 ledger 漏记
⇒ 修 ledger 记 merge 落地；(b) 真实直接 merge develop ⇒ 入 ruled 表 + manager 裁定；(c) 测试期望
过期（基线区间已含真 bypass）⇒ 改确定性 fixture。三者任一本任务 Touches 均不覆盖，需 manager/outer
裁定后另立任务。

---

## Plan

### Step 1：定位真实判定点
现场跑一次 `bash scripts/test.sh --for-task gap-task-write-schema-depends-on-documentation --allow-thin`,
对照：
- `node --test` 子进程的真实 exit code
- 若干层调用链（`select-static-checks-for-touches.ts` → checker 汇总 → fan-in 判定)
  各自读到的 pass/fail 判据分别是什么

### Step 2：修复方向（二选一或组合，由 Step 1 结果决定）
- **(a) 判定侧**：确保 pass/fail 判据只用真实 exit code（或 TAP `# fail N`/`not ok` 计数),
  `isFailureSignalLine` 系列函数只能用于「已知失败」之后的摘要展示,不得反向参与判定
- **(b) 源头侧**：`build-dist.test.mjs` 的负控制测试 (c) 抑制 esbuild 的 stderr 输出
  （例如捕获后不透传到进程真实 stderr,只保留在 assert 断言内部),从源头消除这行噪声

### Step 3：回归验证
- 两个已撞上的任务（`gap-unified-frontmatter-parser` 的历史记录 + 当前
  `gap-task-write-schema-depends-on-documentation`）重跑 scoped-gate,确认不再误红
- 补充负测试：一个只跑 `build-dist.test.mjs` 的 scoped-gate 调用应始终报绿

---

## Acceptance Criteria

- [x] AC1（能取假·源头抑制）：`buildDist()` 失败路径（entry 不存在）+ `logLevel: "silent"` 时，
  进程 stderr 不含 `Could not resolve` / `[ERROR]`；`node --test packages/quay/test/build-dist.test.mjs`
  的输出零 `Could not resolve`（⛔ 移除 `logLevel` 透传或 `console.error` 守卫 ⇒ 测试 (g) 红）。
- [x] AC2（能取假·回归单测钉死）：`build-dist.test.mjs` 新增测试 (g) 用子进程跑失败路径构建并
  断言 `stderr` 不匹配 `/Could not resolve|\[ERROR\]/`；该文件 7/7 绿（⛔ 删掉 (g) 的
  `doesNotMatch` 断言 ⇒ 红）。
- [x] AC3（真实生产载体）：`bash scripts/test.sh --for-task gap-task-write-schema-depends-on-documentation
  --allow-thin` 的合并 stdout+stderr 不含 `Could not resolve "/tmp/quay-m120-does-not-exist.ts"`
  （两次误诊实例的载体都含这行；修复后消失）且 exit 0（119/119 绿，修复前 118，多出的 1 条即回归测试 (g)）。

---

## Definition of Done

- [x] 根因定位到具体的判定点（哪一层把非空摘要误当失败）——见 `## Result`：判定侧无「非空摘要当失败」误用，真实失败是 task-schema.ts 漂移。
- [x] 修复落地（判定侧和/或源头侧）——源头侧：`buildDist()` 透传 `logLevel` + 守卫 `console.error`，负控制测试 (c) 传 `logLevel: "silent"`。
- [x] `gap-task-write-schema-depends-on-documentation` 的 fan-in 可以继续推进——其 scoped-gate 实测 118/118 绿、exit 0（漂移已由 dd1a9fda5 修复），不再被红挡。
- [x] 回归测试补充,防止同型缺陷再次发生——`build-dist.test.mjs` 测试 (g) 子进程断言 stderr 无 `Could not resolve`/`[ERROR]`。
- [x] （若判定侧修复）审计是否还有其它 checker/gate 有同类「摘要函数结果被当判据」的误用——已审计 `extractFailureSummary`/`extractFirstFailureLine` 全部调用点：无一反向参与判定（均 exit-code 之后才调用）。

---

## Touches

- `packages/quay/scripts/build-dist.mjs`（`buildDist()` 透传 `logLevel` + 守卫 `console.error`）
- `packages/quay/test/build-dist.test.mjs`（负控制测试 (c) 传 `logLevel: "silent"` + 回归测试 (g)）
- `tasks/gap-scoped-gate-m120-negative-control-false-positive.md` (self)
- `plugin/skills/init/SKILL.md`（登记 `SPEC-tmux-retirement-2026-09-03.md` reference-doc——解 spec-declaration-point-check 全局红挡 fan-in）
- `plugin/skills/manager/SKILL.md`（登记 `SPEC-tmux-retirement-2026-09-03.md` SPEC index——解 spec-declaration-point-check 全局红挡 fan-in）

---

## References

- **Blocking**：gap-task-write-schema-depends-on-documentation（fan-in scoped-gate 红,当前实例）
- **Prior occurrence**：gap-unified-frontmatter-parser（重派绕过,未真正修复）
- **Sibling/root defect**：gap-scoped-gate-reason-stderr-drops-stdout（引入 isFailureSignalLine
  对 `Could not resolve`/`[ERROR]` 的匹配,本缺陷是其镜像反例）
- **Related**：gap-step-trace-reason-captures-gate-stdout（同一函数的另一次调整历史）


## Needs-Human

**执行 2026-09-03T07:50:44.249Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: == split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) ==
- run_id：wk-prod-1788285192
- session_id：78fee4bd-96e9-4cbe-93d7-9addb564315f
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-scoped-gate-m120-negative-control-false-positive~wk-prod-1788285192~1788421366597-8d597f.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-scoped-gate-m120-negative-control-false-positive-wk-prod-1788285192.log

## Needs-Human

**执行 2026-09-04T07:17:43.563Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
- 失败步/判词：step=suite: == split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) ==

## Needs-Human

**执行 2026-09-04T08:53:46.681Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=merge-develop: Auto-merging plugin/skills/init/SKILL.md
Auto-merging plugin/skills/manager/SKILL.md
CONFLICT (content): Merge conflict in plugin/skills/manager/SKILL.md
Automatic merge failed; fix conflicts and then commit the result.
- run_id：wk-prod-1788285192
- session_id：2f2b3c1b-b371-4162-8a64-b31533f9c6cf
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-scoped-gate-m120-negative-control-false-positive-wk-prod-1788285192.log

## Needs-Human

**执行 2026-09-04T10:11:07.477Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: NOT-EVALUATED 不得 RED（exit 0）: {
- run_id：wk-prod-1788285192
- session_id：633dda22-09cf-4403-a48b-9c38126de428
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-scoped-gate-m120-negative-control-false-positive~wk-prod-1788285192~1788516274054-0dff6b.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-scoped-gate-m120-negative-control-false-positive-wk-prod-1788285192.log
