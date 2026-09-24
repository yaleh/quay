---
id: gap-superseded-dependency-blocks-dispatch-forever
title: depends_on 指向 superseded（终态）的任务永久派不出去——allDepsDone 只认 done，散文路径已有的豁免没跟到关系边
status: done
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

<!-- dedup-ref -->
**生产实例（本条立案的直接量，仅登记为实证对象，⛔ 不构成前置）**：`gap-ac194-production-criterion-owner`（todo）的唯一依赖
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

- [x] AC1（立案直接量·复现固化）`node --experimental-strip-types plugin/scripts/ready-pool-check.ts --json` 中
      `gap-ac194-production-criterion-owner` 的读数为 `inPool=true` ∧ `depsReady=false` ∧ `eligible=false`，
      并贴 `.quay/promotion-round.jsonl` 最近 2 轮的 `unfixable:["depsReady=false"]` 原文 —— 见 ## Evidence E1
- [x] AC2（归因 + 对照，硬规则④推论四）贴出 `allDepsDone`（`driver-filters.ts:67-72`）与 `prosePrereqRefs`
      豁免（`ready-pool-check.ts:1442-1453`）两处原文并点名差异；给出**一条若该归因为假则读数会不同的对照**
      （例如把该 dep 的 status 临时当成 `done` 后 `depsReady` 翻 true）—— 见 ## Evidence E2（对照组 = 同一生产
      root、同一 ref、**未修**代码 ⇒ false / **已修**代码 ⇒ true；唯一变量是代码）
- [ ] AC3（真值恢复·**生产载体**，⛔ 非 fixture）修复落地后，于同一生产 root 上 `gap-ac194-production-criterion-owner` 的 `depsReady=true` ∧ `eligible=true`；贴 `--json` 原文与时间戳（待外部）
      ⛔ **为何此刻不是 [x]（如实登记，⛔ 不是没做）**：AC3 的判据量取真于「修复**落地**后」那一刻，而本任务
      **此刻尚未落地**；且 `gap-ac194-production-criterion-owner` 的生产 `depends_on` 里现在还有**第二条活边**
      —— **本任务自己**（该边由 commit `e40c77779` 于 2026-09-24T10:42:20Z 加上，即本任务立案后 106 秒，
      见 ## Evidence E3 的原文）。⇒ 生产 root 的**活读数**是
      `supersededDeps=["gap-reflog-…"]`（已退役，⛔ 不再阻塞）+ `blockingDeps=["gap-superseded-dependency-blocks-dispatch-forever"]`（= 本任务，尚未 done）。
      本任务一落地（fan-in 翻 done）该活边即 settled ⇒ `depsReady`/`eligible` 同时翻 true，这正是 AC3 字面所指的读数。
      判据的**机制侧真值**已在生产载体上取到（E3：同一 root + 同一 ref `2ddba1a54`，未修代码 false / 已修代码
      `depsReady=true ∧ eligible=true`）。⇒ 按既有「待外部」约定登记，首个 post-landing 轮次可复核。
- [x] AC4（⛔ 不得与合格同形，硬规则 3b）对**已退役依赖**给出可区分读数（形如 `supersededDeps:[<id>]`
      或等价物），并贴一条**含 superseded 依赖**的候选读数原文，证明它与"依赖全 done"**取值可区分** —— 见 ## Evidence E4
- [x] AC5（负控制·既有语义不得放宽）`plugin/test/driver-filters.test.mjs` 既有断言
      「any not-done/missing ⇒ false」**逐字仍通过**；另注入一条 `ready` 依赖与一条**读不出状态**的依赖 ⇒
      `depsReady` 均为 false（贴读数）—— 见 ## Evidence E5
- [x] AC6（5b 姊妹实例）对 `portfolio-choice.ts:77` 给出**同一条原则**的处理（修，或逐字论证它为何不适用），
      并贴修完后同一 grep 的命中数与前 3 条 —— 见 ## Evidence E6（已修：改走同一份 `judgeDepStatus`）
- [x] AC7（防第 6 次）造一个**此前未出现过的**"依赖被退役"形态（例如 superseded 依赖同时又是 parent 边、
      或多条 superseded 依赖并存），判定仍给出可区分取值而非永久 false（贴输出原文）—— 见 ## Evidence E7
- [x] AC8（本任务自身的门）`bash scripts/test.sh --for-task gap-superseded-dependency-blocks-dispatch-forever` 绿；
      若本任务零代码改动，改贴 `git diff --name-only` 证明改动仅限本任务文件 —— 见 ## Evidence E8

## DoD

<!-- dedup-ref -->
真实落地：`gap-ac194-production-criterion-owner` 在生产 root 上 `depsReady=true ∧ eligible=true`（AC3），
且**它不是靠放宽依赖语义换来的**——`ready` / `todo` / 读不出状态 的依赖仍 fail-closed（AC5 逐字过）。
退役依赖在读数上**可区分**（AC4），不是静默当成 satisfied。把 `allDepsDone` 改成"对一切非 done 返回 true"、
或只给 `gap-ac194-production-criterion-owner` 单条改 `depends_on` 了事 ⇒ 均不算完成。
**（本段与上方「生产实例」段对该 id 的引用是实证对象登记，⛔ 不构成前置：本任务与它是【反向】关系——
它 `depends_on` 本任务所修的机制，⛔ 不是本任务 `depends_on` 它。加 `<!-- dedup-ref -->` 的原因即此：
`ready-pool-check.ts` 的 `prosePrereqRefs` 只能看关键词、看不出关系方向，会把这条登记读成一条前置声明。）**

## Evidence

### E1 — AC1 立案直接量（修前读数，生产 root `/data/home/yale/work/quay`）
时间戳 `2026-09-24T02:47Z`（修前，主检出未修代码）+ 修前 `--json` 候选原文：

    { "id": "gap-ac194-production-criterion-owner", "kind": "gap",
      "touchesResolve": true, "touchesNarrow": true,
      "depsReady": false, "fourArtifacts": true, "missingArtifacts": [],
      "selfTouchOk": true, "prosePrereqGap": [], "eligible": false }

`.quay/promotion-round.jsonl` 最近 2 轮原文（round 272 / 273）：

    {"round":272,"pool":2,"should_apply":false,"fixes":[{"id":"gap-ac194-production-criterion-owner","spawned":false,"missing":[],"unfixable":["depsReady=false"],"exitCode":null,"stderr":null,"timedOut":false,"argv":null,"durationMs":null}]}
    {"round":273,"pool":2,"should_apply":false,"fixes":[{"id":"gap-ac194-production-criterion-owner","spawned":false,"missing":[],"unfixable":["depsReady=false"],"exitCode":null,"stderr":null,"timedOut":false,"argv":null,"durationMs":null}]}

### E2 — AC2 归因 + 对照
修前（`driver-filters.ts:67-72`，逐字）：

    export function allDepsDone(depIds, statusOf) {
      if (depIds.length === 0) return true;
      for (const depId of depIds) {
        if (statusOf(depId) !== TASK_STATUS.DONE) return false;
      }
      return true;
    }

已修的散文路径（`ready-pool-check.ts:1455`，逐字）：

    if (status === "superseded" || status === "done") return;   // ← 注释：A retired task (`superseded`) is not a
                                                                 //   current-prereq target — its successor carries
                                                                 //   the real dependency. A FINISHED task (`done`) is
                                                                 //   not an UNSATISFIED prereq.

差异点名：散文路径**已有**「退役 ⇒ 不是未满足前置」的判据（并把 `superseded` 与 `done` 并列排除）；关系边路径
（`allDepsDone`）只有 `done` 一条臂 ⇒ 同一成因在两条路径上后果不同。这就是本条要补的那条臂（硬规则 5b）。

对照（若归因为假，读数会不同 —— 唯一变量是**代码**，数据/root/ref 全部相同）：
生产 root `/data/home/yale/work/quay`，ref `2ddba1a54`（该 ref 上该任务只有**一条** dep 且其 status=`superseded`）：

    未修代码（主检出 plugin/scripts）:  {"depsReady": false,  "eligible": false}
    已修代码（本 worktree）:            {"depsReady": true,   "eligible": true,
                                        "supersededDeps": ["gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check"],
                                        "blockingDeps": []}

⇒ 归因成立：翻 true 的**唯一**变化是依赖判定多了「退役」这条臂（不是数据变了、不是 schema 变了）。

### E3 — AC3 真值恢复（生产载体）与其「待外部」的理由
已修代码 + 生产 root + ref `2ddba1a54`（时间戳 `2026-09-24T02:56:45Z`）：

    {"id":"gap-ac194-production-criterion-owner","depsReady":true,"depsDone":[],
     "supersededDeps":["gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check"],
     "blockingDeps":[],"fourArtifacts":true,"touchesResolve":true,"selfTouchOk":true,"eligible":true}

但**活**生产 root（develop HEAD）上该任务此刻另有一条**活** dep —— 原文（`git show develop:tasks/gap-ac194-production-criterion-owner.md`）：

    depends_on:
      - gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check
      - gap-superseded-dependency-blocks-dispatch-forever     ← 本任务（commit e40c77779, 2026-09-24T10:42:20Z 加）

活读数（已修代码，develop HEAD）：

    {"depsReady": false, "supersededDeps": ["gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check"],
     "blockingDeps": ["gap-superseded-dependency-blocks-dispatch-forever"], "eligible": false}

⇒ 退役依赖**已不再阻塞**（从 `blockingDeps` 中消失并单独成类）；唯一剩下的阻塞**是本任务自己尚未落地** ——
这是正常的依赖排序，不是本条所修的永久停摆。本任务落地后该活边即 settled，AC3 的判据量随之取真。

### E4 — AC4 可区分读数（硬规则 3b）
判定输出词表里 `done` / `superseded` / `blocking` 三值分离，读数上三个集合不相交（`.quay/ac-superseded-deps-verify.mjs` 输出）：

    "AC4-superseded-vs-done": {
      "gap-cand-done":    {"depsReady":true, "depsDone":["gap-landed"], "supersededDeps":[],             "blockingDeps":[], "eligible":true},
      "gap-cand-retired": {"depsReady":true, "depsDone":[],             "supersededDeps":["gap-retired"], "blockingDeps":[], "eligible":true}
    }

两者 `depsReady` 相同、**取值可区分**：`depsDone` 与 `supersededDeps` 是**分开的两个集合** —— ⛔ 退役依赖
既不与 done 合并（否则「前提被删除」伪装成「前提做完了」），也不落进 blocking（否则永久停摆）。

### E5 — AC5 负控制（既有语义不得放宽）
1) 既有断言逐字仍通过（`plugin/test/driver-filters.test.mjs:93` 那条，未改一字）：

       test("allDepsDone — empty deps ⇒ true; all done ⇒ true; any not-done/missing ⇒ false", ...)
       ✔ allDepsDone — empty deps ⇒ true; all done ⇒ true; any not-done/missing ⇒ false

   （`allDepsDone(["a","b"], id=>id==="a"?"done":"ready") === false` 与 `allDepsDone(["a"], ()=>null) === false` 均仍断言通过）

2) 新注入的负控制读数：

    "AC5-ready-dep-blocks":      {"depsReady":false,"depsDone":[],"supersededDeps":[],"blockingDeps":["gap-live"],        "eligible":false}
    "AC5-unreadable-dep-blocks": {"depsReady":false,"depsDone":[],"supersededDeps":[],"blockingDeps":["gap-no-such-task"],"eligible":false}

⇒ `ready` 依赖与**读不出状态**的依赖仍 fail-closed，⛔ 语义未被放宽（不是「对一切非 done 返回 true」）。

### E6 — AC6 姊妹实例（`portfolio-choice.ts:77`）
已修：`findUnmetDependency` 改走**同一份** `judgeDepStatus`（`driver-filters.ts` 单一真相源），
原 `if (dep.statusById.get(target) === "done") continue;` 换成 `if (judgeDepStatus(...) !== "blocking") continue;`。
修后同一 grep 的命中数与前 3 条：

    $ grep -rn --include=*.ts -E '(dep|prereq|Dep)[A-Za-z]*Status[^;]*==="done"|depStatus !== "done"' plugin/scripts/
    plugin/scripts/it0-split-or-commit-check.ts:367:      if (depStatus !== "done") {      ← 命中 1（唯一残点，判定见下）

    $ grep -rn --include=*.ts -E 'judgeDepStatus|judgeDeps' plugin/scripts/
    plugin/scripts/driver-filters.ts:106:export function judgeDepStatus(status: string | null): DepVerdict {   ← 单一真相源
    plugin/scripts/portfolio-choice.ts:91:      if (judgeDepStatus(dep.statusById.get(target)) !== "blocking") continue; // done or retired
    plugin/scripts/ready-pool-check.ts:2026:  return judgeDeps(deps, (depId) => {                          ← depsReadinessFor 复用

    $ grep -rn --include=*.ts -E '"done"\s*\|\|[^;]*"superseded"|TASK_STATUS\.SUPERSEDED' plugin/scripts/
    plugin/scripts/ready-pool-check.ts:1455:    if (status === "superseded" || status === "done") return;   ← 散文路径既有（本条的模板）
    plugin/scripts/meta-driver.ts:1793:      if (existingStatus === "done" || existingStatus === "superseded") {
    plugin/scripts/driver-filters.ts:108:  if (status === TASK_STATUS.SUPERSEDED) return "superseded";

另：`slot-refill.ts` 的 `depsReadyFor` 未改一字，经 `allDepsDone` 自动继承同一条臂（单一核的另一半好处）。
**新浮现的第 4 个适用点（立案当轮 5b 扫描未列出）**：`plugin/scripts/it0-split-or-commit-check.ts:367`
`if (depStatus !== "done")` —— **逐字论证为何不适用**：该处判的不是「某任务能否准入/派发」，而是
**对已 done 任务的回溯不变量**（`DEP-DONE-IFF-DEPS`：一个已 done 的任务，其 `depends_on` 前置必须都已 done）。
两个判定的作用方向相反：本条的四个点都在回答「**这件事能不能往前走**」（准入/派发/选择），把退役前置当「活的
未满足前置」会让工作**永久停摆**；而 it0 那处在回答「**过去那次落地是否自洽**」，把退役前置算成「未满足」
恰好**正是它该报的信号**（一条指向已退役前置的陈旧边值得浮出来给人改），且它不阻塞任何未来动作。
⇒ 判为**不适用**，本任务不改它（该文件亦不在本任务 `## Touches` 内）。⛔ 不是静默忽略：命中数与前 3 条已在此逐字贴出。

### E7 — AC7 新形态（此前未出现过）
`.quay/ac-superseded-deps-verify.mjs` 输出原文：

    "AC7-multiple-superseded":      {"depsReady":true, "depsDone":[], "supersededDeps":["gap-r1","gap-r2","gap-r3"], "blockingDeps":[], "eligible":true}
    "AC7-superseded-parent-edge":   {"depsReady":true, "depsDone":[], "supersededDeps":["gap-retired-parent"],       "blockingDeps":[], "eligible":true}
    "AC7-mixed-retired-and-live":   {"depsReady":false,"depsDone":[], "supersededDeps":["gap-retired-parent","gap-retired-dep"], "blockingDeps":["gap-live-dep"], "eligible":false}

形态 A = 多条 superseded 依赖并存（生产只出现过 1 条）；形态 B = superseded 依赖**同时是 parent 边**
（生产只出现过 depends_on 边）；形态 C = 退役边与**活**边共存 ⇒ `depsReady=false` 但
`supersededDeps` 仍逐条点名（⛔ 两种条件不共用取值）。另有单测逐字钉住（`plugin/test/driver-filters.test.mjs`：
`AC7 (novel shape A/B/C)` 三条，B 含「同一 parent 边 status=ready ⇒ 仍阻塞」的负控制）。
配套负控制：`AC7-mixed-retired-and-live` 证明「退役不阻塞」不足以让 `depsReady` 恒真 —— 活依赖仍 fail-closed。

### E8 — AC8 本任务自身的门
`bash scripts/test.sh --for-task gap-superseded-dependency-blocks-dispatch-forever --allow-thin` ⇒ **EXIT=0**
（scoped 静态检查全绿 + `ℹ tests 88 / pass 88 / fail 0`）。
因 scoped 选择偏薄，另行直接跑了改动模块的消费者测试，全部绿：

    ready-pool-check-s01..s06             48 tests  pass 48  fail 0
    ready-pool-check-s07..s15             72 tests  pass 72  fail 0
    ready-pool-check-s16..s21 + heartbeat 52 tests  pass 52  fail 0
    slot-refill-s01..s06 + heartbeat      39 tests  pass 39  fail 0
    promotion-driver-s01..s08             47 tests  pass 47  fail 0
    worker-driver.test.mjs               110 tests  pass 110 fail 0
    driver-filters.test.mjs               66 tests  pass 66  fail 0
    portfolio-choice.test.mjs             22 tests  pass 22  fail 0

代码改动面（`git diff --name-only`，⛔ 与 `## Touches` 一致，零越界）：

    experiments/quay-perpetual-stream/test/portfolio-choice.test.mjs
    plugin/scripts/driver-filters.ts
    plugin/scripts/portfolio-choice.ts
    plugin/scripts/ready-pool-check.ts
    plugin/test/driver-filters.test.mjs

## Touches

- plugin/scripts/driver-filters.ts
- plugin/scripts/ready-pool-check.ts
- plugin/scripts/portfolio-choice.ts
- plugin/test/driver-filters.test.mjs
- experiments/quay-perpetual-stream/test/portfolio-choice.test.mjs
- tasks/gap-superseded-dependency-blocks-dispatch-forever.md