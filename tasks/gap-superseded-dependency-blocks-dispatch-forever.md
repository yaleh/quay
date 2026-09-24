---
id: gap-superseded-dependency-blocks-dispatch-forever
title: depends_on 指向 superseded（终态）的任务永久派不出去——allDepsDone 只认 done，散文路径已有的豁免没跟到关系边
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

## Proposal

**机制**：`plugin/scripts/driver-filters.ts:67` `allDepsDone` 要求每个依赖 `statusOf(depId) === TASK_STATUS.DONE`。
`superseded` 是**终态**（前提被人裁定删除，不是"进行中"）⇒ 一个 `depends_on` 指向 superseded 任务的任务，
`depsReady` **恒为 false**，且**没有任何事件能把它翻过来**——superseded 不会再变成 done。

**生产实例（本条立案的直接量）**：`gap-ac194-production-criterion-owner`（todo）的唯一依赖
`gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check` 已被 superseded（其任务体 `## Superseded`
节逐字写明并入 `gap-suite-ambient-reds-block-all-code-landings`）。后果读数：

- `ready-pool-check --json`：该任务 `inPool=true`、`fourArtifacts=true`、`touchesResolve=true`、
  `selfTouchOk=true`，**唯独 `depsReady=false`** ⇒ `eligible=false`。
- `.quay/promotion-round.jsonl`：连续 260+ 轮（round 260 / 261 仍如此）报
  `fixes:[{id:"gap-ac194-production-criterion-owner", spawned:false, unfixable:["depsReady=false"]}]`、
  `pool:0`、`should_apply:false`。

⇒ 这不是"在等依赖"，是**永久停摆**；而它在台账里与"依赖尚未满足"**同形**（硬规则 3b 的形态：
不可满足 与 合格 共用输出）。

**这是硬规则 5b 的兄弟实例，不是一次意外**：同一原则**已经在散文路径上修过**——
`plugin/scripts/ready-pool-check.ts:1442-1453` `prosePrereqRefs` 的 `add()` 逐字写着
「A retired task (`superseded`) is not a current-prereq target — its successor carries the real dependency」，
并把 `superseded` 与 `done` 一起排除出 gap 集（该修复的动机在注释里：2026-09-18 一条 cited task 早已 done
的句子造成 88 次连续跳过，"no future event could ever clear it, so the only exit was a human rewording the
sentence"）。**同一个成因、同一个后果，在关系边（`depends_on`）这条路径上没修。**

本仓自己的既有约定也支持把两者并列：`plugin/scripts/meta-driver.ts:1793`
`if (existingStatus === "done" || existingStatus === "superseded")`。

**全仓扫描（立案当轮实测）**：`tasks/*.md` 中 `depends_on` 指向终态（done/superseded）的边共 **220** 条，
其中 219 条指向 `done`（**已满足**，`allDepsDone` 返回 true），**只有 1 条指向 `superseded`**——就是上面那条。
⇒ 当前生产影响面 = 1 条任务；但形态对下一次 superseded 完全通用。

**修法方向（⛔ 不是给这一条改 depends_on 了事）**：`superseded` 依赖必须**不再永久阻塞**，同时
⛔ **不得与「依赖全 done」同形**（硬规则 3b）。即判定要能把"依赖已被裁定退役、其继任者承载真依赖"
表达成一个**可区分的取值/读数**（例如 pool 候选上并列 `supersededDeps: [id]`），而不是静默当成 satisfied。
⛔ 不得放宽 `ready` / `todo` / 读不出 的依赖——那仍须 fail-closed（既有单测
`plugin/test/driver-filters.test.mjs:93` 逐字钉着「not-done dep blocks」「missing dep ⇒ fail-closed」，不得改红）。

**5b 姊妹实例（立案当轮 grep 同一原则的其它适用点，命中 3 处，前 3 条）**：

1. `plugin/scripts/driver-filters.ts:70` `if (statusOf(depId) !== TASK_STATUS.DONE) return false;` ← 本条主缺陷
2. `plugin/scripts/portfolio-choice.ts:77` `if (dep.statusById.get(target) === "done") continue; // already landed — satisfied`
   ← **同形**：`superseded` 不在 `done` 上 ⇒ 落到下一行报 `unresolved dependency: …`，把已退役的前置当成"未选中的开放依赖"
3. `plugin/scripts/worker-driver.ts:1334` `if (status !== null && status !== TASK_STATUS.DONE) return false;`
   ← **经核对该处判的是「本任务自己是否落地」**（`verifyIndependently` 的落地证真），不是依赖边，不适用本条

## AC

- [ ] AC1（立案直接量·复现固化）`node --experimental-strip-types plugin/scripts/ready-pool-check.ts --json` 中
      `gap-ac194-production-criterion-owner` 的读数为 `inPool=true` ∧ `depsReady=false` ∧ `eligible=false`，
      并贴 `.quay/promotion-round.jsonl` 最近 2 轮的 `unfixable:["depsReady=false"]` 原文
- [ ] AC2（归因 + 对照，硬规则④推论四）贴出 `allDepsDone`（`driver-filters.ts:67-72`）与 `prosePrereqRefs`
      豁免（`ready-pool-check.ts:1442-1453`）两处原文并点名差异；给出**一条若该归因为假则读数会不同的对照**
      （例如把该 dep 的 status 临时当成 `done` 后 `depsReady` 翻 true）
- [ ] AC3（真值恢复·**生产载体**，⛔ 非 fixture）修复落地后，于同一生产 root 上
      `gap-ac194-production-criterion-owner` 的 `depsReady=true` ∧ `eligible=true`；贴 `--json` 原文与时间戳
- [ ] AC4（⛔ 不得与合格同形，硬规则 3b）对**已退役依赖**给出可区分读数（形如 `supersededDeps:[<id>]`
      或等价物），并贴一条**含 superseded 依赖**的候选读数原文，证明它与"依赖全 done"**取值可区分**
- [ ] AC5（负控制·既有语义不得放宽）`plugin/test/driver-filters.test.mjs` 既有断言
      「any not-done/missing ⇒ false」**逐字仍通过**；另注入一条 `ready` 依赖与一条**读不出状态**的依赖 ⇒
      `depsReady` 均为 false（贴读数）
- [ ] AC6（5b 姊妹实例）对 `portfolio-choice.ts:77` 给出**同一条原则**的处理（修，或逐字论证它为何不适用），
      并贴修完后同一 grep 的命中数与前 3 条
- [ ] AC7（防第 6 次）造一个**此前未出现过的**"依赖被退役"形态（例如 superseded 依赖同时又是 parent 边、
      或多条 superseded 依赖并存），判定仍给出可区分取值而非永久 false（贴输出原文）
- [ ] AC8（本任务自身的门）`bash scripts/test.sh --for-task gap-superseded-dependency-blocks-dispatch-forever` 绿；
      若本任务零代码改动，改贴 `git diff --name-only` 证明改动仅限本任务文件

## DoD

真实落地：`gap-ac194-production-criterion-owner` 在生产 root 上 `depsReady=true ∧ eligible=true`（AC3），
且**它不是靠放宽依赖语义换来的**——`ready` / `todo` / 读不出状态 的依赖仍 fail-closed（AC5 逐字过）。
退役依赖在读数上**可区分**（AC4），不是静默当成 satisfied。把 `allDepsDone` 改成"对一切非 done 返回 true"、
或只给 `gap-ac194-production-criterion-owner` 单条改 `depends_on` 了事 ⇒ 均不算完成。

## Touches

- plugin/scripts/driver-filters.ts
- plugin/scripts/ready-pool-check.ts
- plugin/scripts/portfolio-choice.ts
- plugin/test/driver-filters.test.mjs
- experiments/quay-perpetual-stream/test/portfolio-choice.test.mjs
- tasks/gap-superseded-dependency-blocks-dispatch-forever.md
