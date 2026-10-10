---
id: gap-ac356-criterion-environment-fatal-window-check-unsatisfiable
title: gap-ac356：AC-356 判据的 environment-fatal hard-return 子检查结构上恒假（锚点落在
  QuickDeathCause 类型别名、400 字符窗口取不到分支自身的 return r;）——就地修判据并加负控制
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-356
---
**type:** execution

## Proposal

<!-- dedup-ref --> 相关任务（仅追溯，机制不同）：`goal-035-needs-human-transition-unify`（顶层 `goal_ac: AC-356`，已 `done`——它落地的实现是对的，见下）；`goal-035-needs-human-transition-contract-tests`（`goal_ac: AC-357`，`ready`）；`goal-035-merge-and-postmerge-verify`（`goal_ac: AC-358`，`todo`）。按机制查重：`task_list --search applyNeedsHumanTransition` 只有这三件，其中唯一以顶层 `goal_ac: AC-356` 认领本 AC 的那件已 `done` ⇒ 这不是重复立案，而是「旧修复未持住」的补案（一个已 `done` 的认领任务 = 证据，不是重复）。

**AC-356 现在是 FALSE，而没持住的是判据本身，不是实现。**

- **实现是对的、且在场。** 在 AC-356 的求值根——分支 goal 工作树 `/data/home/yale/work/quay-worktrees/goal-GOAL-035`（HEAD `3947c0ae1`）——实测：`plugin/scripts/driver-filters.ts` 恰一处 `export function applyNeedsHumanTransition(`（:956）；`NeedsHumanKind = "retry-cap" | "stop-terminal" | "quick-death-backoff" | "other"`（:873）；`plugin/scripts/worker-driver.ts` 里 `retryState.needsHuman.add(` = 0、`retryState.counts.set(` = 0、`applyNeedsHumanTransition(` = 2（三条路径收敛）。逐字跑现判据，除下述一条外其余子检查全过。
- **判据的 environment-fatal 子检查结构上不可能取真（恒假）。** 判据里：

  ```js
  const efIdx=wfText.indexOf("environment-fatal");
  const efWindow=wfText.slice(efIdx,efIdx+400);
  if(!/return r;/.test(efWindow)){ ... CAUSE=nongoal-moved ... }
  ```

  在注释剥离后的 `worker-driver.ts` 上，`indexOf("environment-fatal")` 命中的是类型别名 `export type QuickDeathCause = "environment-fatal" | ...`（实测偏移 **103796**），**不是** halt 分支；真实 halt 分支在 **145462**（`if (backoff.cause === "environment-fatal") {`），其自身的 `return r;` 在锚后 **+432** 字符——**超出作者写死的 400 字符窗口**。两个独立缺陷叠加 ⇒ 该子检查在**任何**树上都红。

  ⇒ 硬规则 4 的形态（结构上不可能取真的读数不是测量）+ 硬规则 3b 的镜像（读不懂输入的仪器返回了与判定同形的「失败」，把合格误判为违规）。判据恒红 ⇒ 每轮重评每轮 fail ⇒ AC-356 永远 active。
- **为什么老修复未持住（本条的关键）**：实现没有回退。判据自 `be2d8e876`（GOAL-035 批次）写入起**从未被改动**（`git log -- goals/AC-356-*.md` 仅 batch + draft→active 两次提交），它自出生起就恒假；只是判据首行 `grep -q applyNeedsHumanTransition "$pf" || exit 3` 在实现落地前把整个 scan 短路成 `exit 3`（NOT-EVALUATED），掩盖了这个子检查**从未被真正执行过**——直到实现落地、scan 真正跑到它，才暴露。

**本刀**：把该子检查就地修成【直接测量它自己声明的那条性质】——「environment-fatal 分支必须在触达任何 needs-human 代码之前硬 return」——用位置比较取代魔法窗口；`criterion` 其余全部子检查逐字不动；并用负控制证明修好的检查**有判别力**（把该分支的硬 return 破掉 ⇒ 必须红）。

**非目标（显式排除）**：⛔ 不改任何 `plugin/scripts/**` 或 `plugin/test/**` 源码（实现已在场且正确）；⛔ 不借机放宽其余子检查；⛔ 不新增「窗口锚点」类的通用检测器——立案前实测该形态在全仓 `goals/` 中**只有本处 1 例**（`grep -lE 'slice\([a-zA-Z]+, *[a-zA-Z]+\+' goals/*.md` ⇒ 1），按硬规则 12 不凭单例立新机制，仅记为观察项；⛔ 不触发 `goal/GOAL-035` 的合并（那是 `goal_ac: AC-358` 那件的活）；⛔ 不重启任何生产进程。Touches 只有 goal 记录 + 本任务自身文件（唯一交付物是一次判据写入），与同批的 goal 文件类任务同形。

## Plan

1. 记录修复前读数：在 `/data/home/yale/work/quay-worktrees/goal-GOAL-035` 逐字跑现判据 ⇒ `exit 1` + `CAUSE=nongoal-moved -- the environment-fatal branch must still hard-return before reaching any needs-human code`（唯一失败项）。
2. 在 `goals/AC-356-结构护栏-applyneedshumantransition-是-retrystate-needshuman-count.md` 的 `criterion` 内，把上面那三行锚/窗替换为同一性质的**位置检查**：

   ```js
   const efIdx=wfText.indexOf("backoff.cause === \x22environment-fatal\x22");
   if(efIdx<0){console.error("CAUSE=nongoal-moved -- the environment-fatal halt branch must still exist, unmodified");process.exit(1)}
   const efTail=wfText.slice(efIdx);
   const efReturn=efTail.indexOf("return r;");
   const efNeedsHuman=efTail.indexOf("applyNeedsHumanTransition(");
   if(efReturn<0||(efNeedsHuman>=0&&efNeedsHuman<efReturn)){console.error("CAUSE=nongoal-moved -- the environment-fatal branch must still hard-return before reaching any needs-human code");process.exit(1)}
   ```

   ⛔ 只改这一对锚/窗。`criterion` 其余行（单一定义 / `quick-death-backoff` / 直接变更归零 / callCount≥2 / qdWindow 的 `needsHumanResults.push` 与 `"needs-human"` 事件 / 三个既有函数名 / oos 越界检查）**逐字保持**。
3. 经 goal 记录 ABI 写入（在主检出根执行 `quay goal write AC-356 --criterion <repaired> --root /data/home/yale/work/quay`；取文本的确切形态以 `quay goal write --help` 实测为准）。写后核 diff **只落在 `criterion`**，`origin`/`status`/`goal`/`phase`/`title` 逐字未动。
4. 在 goal 工作树逐字重跑修好的判据 ⇒ `exit 0`，末行 `PASS: ...` 原文落 `## Evidence`。
5. **负控制**：把该工作树的两份源文件复制到一个 scratch 临时目录（⛔ 不在真工作树里改），只把 environment-fatal 分支里的 `return r;` 改名 `return r0;`，重跑同一段 scan ⇒ `exit 1` + 同一 `CAUSE`。与未改副本的 `exit 0` 并列落 `## Evidence`。
6. 取 AC-356 的直接读数：`quay goal gate AC-356 --timeout 600000 --root /data/home/yale/work/quay`（可先 `--dry-run --json`）⇒ `verdict: "pass"` / exit 0，`evaluationRoot` 指向 goal 工作树。
7. corpus-pin 复核：`grep -rn 'efIdx,efIdx+400' --include=* . | grep -v node_modules | grep -v '^./goals/'` 期望为空。

## Acceptance Criteria

- [ ] 修复前读数已记录：现判据在 `/data/home/yale/work/quay-worktrees/goal-GOAL-035` 上 `exit 1`，唯一 `CAUSE=` 是 environment-fatal hard-return 那条；原文进 `## Evidence`。
- [ ] `grep -c 'efIdx,efIdx+400' goals/AC-356-*.md` = 0，且 `criterion` 现在锚 `backoff.cause === "environment-fatal"` 并比较 `return r;` 与 `applyNeedsHumanTransition(` 的位置。
- [ ] **非放宽证据（负控制）**：scratch 副本里把 environment-fatal 分支的 `return r;` 改成 `return r0;` 后同一段 scan ⇒ `exit 1` + `CAUSE=nongoal-moved ... hard-return`；未改副本 ⇒ `exit 0`。两组读数并列进 `## Evidence`。⛔ 若改名后仍过 ⇒ 修的是哑检查，本任务未完成。
- [ ] `criterion` 其余子检查逐字未动：`git show <goal-写提交> -- goals/AC-356-*.md` 的 diff 只覆盖上述锚/窗片段。
- [ ] goal 记录写入提交的 diff **只含 `criterion` 字段**：`origin`/`status`/`goal`/`phase`/`title` 逐字未动；逐字段读数进 `## Evidence`。
- [ ] 修好的判据在 `/data/home/yale/work/quay-worktrees/goal-GOAL-035` 上逐字跑 ⇒ `exit 0`，`PASS:` 末行原文进 `## Evidence`。
- [ ] `quay goal gate AC-356 --timeout 600000` 求值根读 `verdict: "pass"`（exit 0）；原文进 `## Evidence`。
- [ ] 无 corpus pin 变红：`grep -rn 'efIdx,efIdx+400' . | grep -v node_modules | grep -v '^./goals/'` 为空；读数进 `## Evidence`。

## Definition of Done

AC-356 由 FALSE 变 TRUE——**通过让它的判据真正测量它自己声明的那条性质**，不是放宽它：`quay goal gate AC-356` 在分支 goal 的求值根上读 `verdict: pass`；修好的检查有判别力（负控制把硬 return 破掉 ⇒ 红）；`criterion` 其他子检查逐字未动、goal 记录 diff 只有 `criterion` 一个字段。本任务不改任何 `plugin/scripts/**` 或 `plugin/test/**` 源码、不动 `goal/GOAL-035` 的合并、不重启生产进程。

## Touches

- goals/AC-356-结构护栏-applyneedshumantransition-是-retrystate-needshuman-count.md
- tasks/gap-ac356-criterion-environment-fatal-window-check-unsatisfiable.md