---
id: gap-goal-branch-ff-merge-source-param
title: ff-merge 的源不再写死 task/<id>——支持把目标分支 ff 到一个指定提交（goal 并入的 --no-ff 合并提交）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-327
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.7、裁定⑲）：goal 并入 develop 时，要在锁内的临时 worktree 里用 `git merge --no-ff goal/<id>` 造出一个合并提交、跑完验证，再把 develop **ff** 到这个合并提交（develop 仍只做 ff）。而 `packages/quay/src/fan-in/ff-merge.ts` 的源写死为 `refs/heads/task/${task}`（`:562`、`:825`、`:911`、`:980`）——无法以一个合并提交为源。

**修法（方向）**：增加一个源参数（如 `--source-ref <ref|sha>`），缺省仍为 `refs/heads/task/<task>`，现有任务路径逐字不变；ancestry / landed-sha 前后校验对给定的源同样生效；源不是 mergeTarget 的后代时拒绝且不动任何 ref。

## AC

- [x] `plugin/test/fan-in-ff-merge.test.mjs` 新增用例并断言：① 不传源参数时既有用例全部通过；② 源 = 一个第一父为 develop tip 的合并提交 SHA ⇒ develop 被 ff 到该 SHA，退出 0；③ 源不是 mergeTarget 后代 ⇒ 非 0 退出，且 develop 与源 ref 均未改变。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 5b 邻近扫描：在 `packages/quay/src/fan-in/` 与 `plugin/scripts/worker-fan-in.ts` 内 grep `refs/heads/task/`，把命中数与前 3 条贴进 Evidence，逐条判断是否处在「源」路径上；在源路径上且在 Touches 内的一并参数化。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-ff-merge-source-param` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：goal 并入时 develop 能被 ff 到一个经过验证的合并提交，现有任务 fan-in 不受影响。生产读数由 GOAL-028 的 AC-327（每个并入的 goal 在 develop first-parent 上恰为一个提交）在第一个试点 goal 并入后取得。

## Touches

- packages/quay/src/fan-in/ff-merge.ts
- packages/quay/test/ff-merge.test.mjs
- plugin/test/fan-in-ff-merge.test.mjs
- plugin/skills/init/SKILL.md
- plugin/skills/manager/SKILL.md
- tasks/gap-goal-branch-ff-merge-source-param.md

## Evidence

**实现**：`packages/quay/src/fan-in/ff-merge.ts` 新增 `sourceRefOf(args)`（单点解析源：`--source-ref` 覆盖，缺省 `refs/heads/task/<task>`，导出供单测），四处「源」路径——cert-gate tip（原 `:562`）/ pre-flight 存在性（原 `:825`）/ ff refspec+arg（原 `:911`）/ post-check（原 `:980`）——全部改为读它；`--source-ref <ref|sha>` 进 `parseArgv`+`HELP`。改动后 `packages/quay/src/fan-in/` 只剩该 helper 的缺省字面量。

**AC1 — 既有用例 + 新增用例**
- 既有全文（不传源参数）：`node --test plugin/test/fan-in-ff-merge.test.mjs` ⇒ 54 pass / 0 fail（改动前基线）。
- 新增后全文：**tests 55 / pass 55 / fail 0**（exit 0）。
- 新用例 `gap-goal-branch-ff-merge-source-param — --source-ref ff's develop to a merge commit; a non-descendant source refuses touching no ref; the omitted source is unchanged`，三段：① 不传源参数仍 ff 到 task tip（默认不变，stdout 仍 `fast-forwarded to task/<id>`）；② 源 = 第一父为 develop tip 的 `--no-ff` 合并提交 SHA ⇒ develop ff 到该 SHA、退出 0、`git rev-list --parents` 显示 landed tip 有 2 父（即合并提交本身）、release 事件 `landedSha` = 该 SHA；③ 源非 develop 后代 ⇒ 非 0 退出、develop 与源 ref 均未改变。

**AC2 — 取假（`cp` 备份恢复，⛔ 不用 `git checkout --`）**
- 备份 `cp` → `.quay/gbffsrc-evidence/ff-merge.ts.bak`，md5 = `cd32d6979d6cc9db00a53bf4ed97246f`。
- 变异：把 `sourceRefOf` 改为忽略覆盖（恒返回 `refs/heads/task/<task>`）。
- 红（exit 1）：
  ```
  ✖ gap-goal-branch-ff-merge-source-param — ... (134.052804ms)
  AssertionError [ERR_ASSERTION]: ff to the merge commit must succeed:
  fan-in-ff-merge: source ref refs/heads/task/goal-g1 not found in /tmp/faninff-srcref-oZUpdJ
  2 !== 0
  ℹ pass 0 / fail 1
  ```
- 恢复 `cp` 回原文件 ⇒ md5 复原 `cd32d6979d6cc9db00a53bf4ed97246f`。
- 绿（exit 0）：`✔ gap-goal-branch-ff-merge-source-param — ... (454.110698ms)` / `pass 1 / fail 0`。

**AC3 — 5b 邻近扫描（grep `refs/heads/task/`）**
- `packages/quay/src/fan-in/` 改动前 = **4 命中**，全在 `ff-merge.ts`；前 3 条逐条判断：
  1. `:562 const suiteTip = git(root, "rev-parse", \`refs/heads/task/${args.task}\`)…` — **「源」路径**（待 ff tip，证书祖先判定）⇒ 已参数化。
  2. `:825 if (git(root, "rev-parse", "--verify", "--quiet", \`refs/heads/task/${args.task}\`)…` — **「源」路径**（存在性 pre-flight）⇒ 已参数化。
  3. `:911 ? ["git","-C",root,"push",".",\`refs/heads/task/${args.task}:refs/heads/${mergeTarget}\`]` — **「源」路径**（push refspec）⇒ 已参数化。
  - 第 4 条 `:980 const taskTip = git(root,"rev-parse",\`refs/heads/task/${args.task}\`)…` — **「源」路径**（post-check 比对 tip）⇒ 一并参数化。
- `plugin/scripts/worker-fan-in.ts` = **0 命中**。其唯一相邻用法 `:2162 git branch -D task/${task}` 是**落地后删分支**，非「源」路径（在 Touches 外）⇒ 不参数化。
- 同文件另有两处非 `refs/heads/` 的 `task/${args.task}`：`:922` in-lock inert-retry 的 worktree 分支 guard（判的是**任务 worktree 的分支**，非 ff 源；goal 并入无该 worktree）⇒ 不参数化；`:992` 人类可读标签 ⇒ 已随源参数化。

**AC4 — scoped gate**
- `bash scripts/test.sh --for-task gap-goal-branch-ff-merge-source-param` ⇒ **exit 0**：`ℹ tests 146 / pass 146 / fail 0`。
- 被执行的测试文件（selector `--paths-only`，非 thin，coverage 2/3）：`packages/quay/test/adr-gate.test.mjs`、`packages/quay/test/adr-store.test.mjs`、`packages/quay/test/build-dist.test.mjs`、`packages/quay/test/cli-adr.test.mjs`、**`packages/quay/test/ff-merge.test.mjs`**、`packages/quay/test/mcp-adr.test.mjs`、`packages/quay/test/npm-pack-e2e.test.mjs`、**`plugin/test/fan-in-ff-merge.test.mjs`**、`plugin/test/plugin-packaging.test.mjs`。
- 输出中确认执行到本任务的两条：`✔ sourceRefOf — absent/blank --source-ref falls back to the task branch; a ref or SHA overrides`、`✔ ff success — develop fast-forwards to the task tip…`、`✔ gap-goal-branch-ff-merge-source-param — --source-ref ff's develop to a merge commit…`。
- 说明：本模块的集成测试历史名为 `plugin/test/fan-in-ff-merge.test.mjs`（basename 与源 `ff-merge.ts` 不配对），**仅它一项时 selector 判 thin（1/3 < 0.5）**。新增 `packages/quay/test/ff-merge.test.mjs`（按仓库 `<source>.test.mjs` 约定，单测 `sourceRefOf` 的缺省/覆盖规则）后 coverage = 2/3 ≥ 0.5 ⇒ 非 thin。

**解除 develop 级静态阻断（边缘修复，非本任务 AC；见 `## Touches` 末两条的追加）**
- 阻断形态：fan-in 静态相位 `STATIC_CHECK_FAILED: spec-declaration-point-check exit=1` ⇒ suite 未跑（`# tests 0` / `# suite red static-check`），**任何**任务的 fan-in 都在 suite 之前失败。
- 复现（对 develop 检出直接跑该 checker）：`node --experimental-strip-types plugin/scripts/spec-declaration-point-check.ts` ⇒ `plugin/skills/init/SKILL.md missing: SPEC-goal-branch-2026-10-03.md`、`plugin/skills/manager/SKILL.md missing: SPEC-goal-branch-2026-10-03.md` ⇒ `FAIL: 2 missing SPEC declaration(s) across 2 declaration points`（exit 1）。
- 根因：`orchestration/SPEC-goal-branch-2026-10-03.md`（本 task 的机制正本，`d4b7ca1c2` 落 develop）未在两处 SPEC 声明点声明——正是该 checker 要拦的形态。
- 修法：`plugin/skills/init/SKILL.md` 的 `<!-- reference-doc: -->` 块加一行 + `plugin/skills/manager/SKILL.md` 的 SPEC 索引加一条（均为 doc-surface 增量，零行为改动）。
- 修后读数：`PASS: all 46 orchestration/SPEC-*.md declared at each of 2 declaration points`（exit 0）。
- 归属核实：全库 grep `tasks/*.md` 的 `## Touches`，无其它 `todo`/`ready` 任务持有该修复 ⇒ 按 anti-drift 的「声明过窄」臂如实追加两个路径进 `## Touches`（同 `plugin/scripts/direct-to-develop-bypass-check.ts:370/:383` 记载的历史止损先例）。
