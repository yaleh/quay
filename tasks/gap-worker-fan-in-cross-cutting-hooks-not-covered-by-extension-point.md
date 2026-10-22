---
id: gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point
title: WorkerPool 扩展点只覆盖「结局处理」——GOAL-909 之后新增仍 93.8%
  落在中心文件，因为翻转前后的横切钩子（读数/暗轴）没有注册位；跨项目同形状：扩展点只盖叶子、不盖主干
status: ready
labels:
  - gap
  - defect
  - meta
  - refactor-slice
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**事实一（读数，2026-10-22，HEAD `329087733`）**：`worker-post-909` 窗口（`024f9d7f2..HEAD`，基线是 AC-915 扩展点落地提交）里，中心文件（`worker-driver.ts` + `worker-fan-in.ts`）新增 **288** 行，非中心新增 **19** 行 ⇒ **93.8%**（只计新增口径；净口径 102.13%，见 `gap-design-evolution-share-caliber-net-vs-additions`）。登记预测时定的判读门槛是分母 ≥1000 行，当前 307 行，**未达门槛，不作判读**；这里只记录方向。

**事实二（这些增长是什么）**：窗口内触碰中心文件的两个提交是 `e53aa1d3d`（slice-readings 接线：派发抓基线、fan-in 抓终值）与 dark-axis 谓词接线（`d88ad2db8`、`80d75e886`）。它们都不是「worker 结局处理」的变体——而是**横切关注点**。

**事实三（为什么扩展点没接住）**：GOAL-909 的 `WorkerPool` 扩展点（AC-915）定义的是「新的**结局处理**单元可从外部注册」。读数与暗轴谓词挂在**翻转前/翻转后**这条主流程上，不属于结局处理，于是只能直接写进 `worker-fan-in.ts`。这正是 R1/R2 模型的那句限定：**扩展点只对它定义的那一类变体有效**，不是「有扩展点就不会再往中心写」。

**事实四（后果）**：每新增一个横切关注点（读数、暗轴、将来的审计、指标）都要再改一次中心文件，增长回流的结构性成因没有消除。

**事实五（跨项目同形状，claudecodeui 会话 2026-10-22 提供并复核）**：它的 driver 重构给读数开了 registry（叶子），但 `startHost` / `bind` / `submit` / `interrupt` 这些**编排主干步骤**没有注册位，所以 `methodCount` 停在 **86**、`outDegree` 停在 **187**。它自己的表述是「**扩展点只盖叶子、不盖主干**」，与本节事实三互证。两个代码库、两个不同系统、同一形状 ⇒ 按硬规则 12 发生率 ≥2，够格做成机制。

**事实六（判据要分层）**：叶子与主干需要不同的 Π——
- **叶子注册表**：新变体从外部注册即可生效（现有 AC-915 那类）；
- **主干步骤注册**：新增一个横切步骤**不修改中心文件**，且正臂断言钩子被调用**恰好 1 次**、负臂断言 **0 次**（计数断言，不是「函数存在」）。
只把主干步骤抽成几个可替换函数、顺序仍硬编码在中心，那只是 R1（提取），出度大概率还会升；要让「阶段顺序」本身成为可注册的数据（例如一个有序步骤表，中心只负责遍历），才算 R2。

## Plan

1. **盘点现有硬接线钩子**：列出 `worker-fan-in.ts` 与 `worker-driver.ts` 里位于翻转前后、目前以直接调用形式存在的横切步骤（至少包含 slice-readings 的 baseline/post 与 dark-axis 谓词），逐条给 `file:line` 与调用点。
2. **引入主干步骤注册**（不是叶子注册表）：新增一个叶子模块（例如 `plugin/scripts/worker-fan-in-hooks.ts`），导出 `registerFanInHook({ name, phase: "pre-flip" | "post-flip", run })` 与一个唯一的 runner；**阶段顺序本身作为注册数据**（有序步骤表），中心文件只遍历、不点名任何钩子。只做「抽成几个函数」不满足本条。
3. **迁移一个真实消费者**：把 slice-readings 的 post 读数改成注册式，证明迁移可行（不是只造一条没人用的 seam）。
4. **负对照**：未注册的探针钩子必须**不被调用**（计数 0）；已注册的必须被调用一次（计数 1）。两臂都要断言，且正臂断言的是**计数**而不是「函数存在」（`triggered=1`）。
5. **诚实记账**：本任务自身也会给中心文件加行（runner 调用与类型），在任务里用 `git diff --numstat` 如实贴出，不掩饰。
6. **不动 WorkerPool 的结局处理扩展点**：那是另一个变体轴，不合并。

## Acceptance Criteria

- [x] AC1 钩子盘点：贴出翻转前后直接调用的横切步骤清单（≥2 条），每条含 `file:line`、当前调用方、所属阶段（pre-flip / post-flip）；并贴 `grep -n` 的原始命中行。
- [x] AC2 外部注册可生效：新建一个测试文件，从 `worker-fan-in.ts` **之外**注册一个探针钩子，跑一次翻转流程后断言探针被调用**恰好 1 次**（计数断言，不是存在性断言）；贴测试名与断言。
- [x] AC3 负对照：同一测试里不注册该探针，断言调用计数为 **0**；贴该断言与两次运行的输出。
- [x] AC4 中心文件只有一个 runner 调用点：`grep -n 'runFanInHooks\|registerFanInHook' plugin/scripts/worker-fan-in.ts` 中 runner 调用出现 1 次、且不再有对 slice-readings 的直接调用；贴这两条 grep 结果。
- [x] AC5 迁移真实消费者：slice-readings 的 post 读数经注册式钩子触发，贴注册处与一次真实运行的记录（`.quay/slice-readings/<task-id>.json` 中 `post` 阶段的 `evaluated:true`）。
- [x] AC6 如实记账：`git diff --numstat <基线>..<本任务头> -- plugin/scripts/worker-fan-in.ts plugin/scripts/worker-driver.ts` 贴出中心文件的新增/删除行数，并在任务里写明「本任务自身为中心文件贡献了多少行」；不要求为 0。
- [x] AC7 扩展点判据：本任务用的是「钩子注册」这一扩展点形态，用 `node --experimental-strip-types plugin/scripts/extension-point-criteria.ts --scaffold` 生成的骨架填四臂后，`extension-point-criteria-check.ts` 判 `satisfied`；贴两次输出（填前 `missing-arms`、填后 `satisfied`）。
- [x] 正臂（活性检查）：从 `plugin/scripts/worker-fan-in-hooks.ts` 之外（`plugin/test/worker-fan-in-hooks.test.mjs`）注册一个探针钩子、**不改 `worker-fan-in.ts`**，跑一次翻转流程后断言探针被调用**恰好 1 次**（计数断言 triggered=1，不是「handler 存在」）。取假方式：删掉注册后同一断言读数为 triggered=0 ⇒ 本条必红。**这条正臂就是活性检查，不另配。**
- [x] 负臂：同一探针【未注册】时读数为 triggered=0，并同时断言 handlerRegistered=false（`listFanInHooks()` 中无此名——把「根本没注册」与「注册了但分派器忽略」两条绿路拆开）。取假方式：分派器泄漏 / 无条件触发时该断言必红。⚠️ 负臂与上面的 counted 正臂成对存在（只写负臂 ⇒ 判据无效）。
- [x] 注入泄漏：把分派器替换成泄漏实现（`makeLeakyDispatcher`，无视注册表、无条件调用探针），**负臂的同一断言 `triggered === 0` 必须打红**（实测变成 1）。取假方式：替换后仍绿 ⇒ 该臂没测到分派器。它证明【负臂断言本身不真空】，不是给正臂兜底。
- [x] 红线基线：改动前 `wc -l plugin/scripts/worker-fan-in.ts` 的基线是 **3988**，断言「改动后中心文件行数 < 3988」；在改动前跑该断言必然为红（3988 < 3988 为假）。改动后实测 **3834 < 3988** ⇒ 绿。**本 AC 是单次验收、非常设棘轮**，任务 done 后不复评，不进常设检查链。

### 固定说明

本 AC 是单次验收、非常设棘轮：红线基线只在本次重构任务验收时由 worker 检查一次，任务 done 后永不复评，不进入常设检查链，也不需要重锚规则。常设棘轮属于设计演进读数例程（design-evolution-readings.ts）的领域，本 AC 不假装拥有它。

## Evidence

### 实现（新增叶子模块 + 迁移两个真实消费者）

`plugin/scripts/worker-fan-in-hooks.ts`（376 行）导出：
- `registerFanInHook({ name, phase: "pre-flip" | "post-flip", run })` —— 有序步骤表，返回 unregister handle；同名重复注册直接 throw（⛔ 静默覆盖会让「内置没了」与「内置还在」同形）。
- `PHASE_ORDER = ["pre-flip", "post-flip"]` —— **阶段顺序本身是注册数据**。
- `runFanInHooks(ctx, flip)` —— 唯一的 runner：遍历 `PHASE_ORDER`，**在两相之间调用 `flip()` 恰好一次**（flip 不是钩子，是相位的固定中点）。
- 内置两条（**在本模块内注册，不在中心文件**）：`dark-axis`（pre-flip，拒翻）与 `slice-readings-post`（post-flip，FAIL-OPEN 观测）。
- 该模块**不 import `worker-fan-in.ts`**（叶子的证明：`import-graph-check` 的 `valueSccs` 仍为 0）。

`worker-fan-in.ts` 现在只有：`import * as fanInHooks` + **一处** `fanInHooks.runFanInHooks(...)` 调用 + 一处失败映射 `failClean(hookRun.step, hookRun.reason)`。拒绝语义逐字保留：hook 名即 step 名，`dark-axis` 的拒绝仍报在自己的名下。三个 dark-axis 辅助函数经 `export { … } from "./worker-fan-in-hooks.ts"` 保持既有 test import 面逐字不变。

### AC1 —— 翻转前后硬接线的横切步骤（基线提交 `4284b8351`）

`git show 4284b8351:plugin/scripts/worker-fan-in.ts | grep -n '…'` 原始命中：

```
1792:function runSlicePostReading(
3394:    if (workspaceEnforcesDarkAxis(root)) {
3398:      const darkVerdict = darkAxisVerdictForTaskFile(taskFile);
3422:    const flip = await flipTaskDone(worktree, task, mergeTarget, { root, cause: { runId } });
3430:    const slicePost = runSlicePostReading(root, task, worktree);
3471:      const docSync = await syncDoneToDocFace(root, task);
3484:    const gateEvent = await appendCompleteGateEvent(root, task);
```

`git show 4284b8351:plugin/scripts/worker-driver.ts | grep -n …`：

```
5242:function queueSliceBaseline(taskId: string, rootDir: string): void {
5260:    const argv = kernelSiblingArgv("slice-readings.ts", ["--baseline", "--task-id", taskId, "--root", rootDir, "--head", headSha]);
5333:  if (role === "task-worker") queueSliceBaseline(taskId, rootDir);
```

清单（翻转 = `worker-fan-in.ts:3422` `flipTaskDone`）：

| # | 步骤 | file:line | 调用方 | 阶段 | 本任务处理 |
|---|---|---|---|---|---|
| 1 | dark-axis 谓词（ADR-007，拒翻） | `worker-fan-in.ts:3394-3420`（判定 `:3398`，写 GateEvent `:3399`） | `runMechanicalFanIn` | **pre-flip** | **迁入 hooks 模块并注册**（`dark-axis`） |
| 2 | slice-readings post 读数 | `worker-fan-in.ts:3430`（helper `:1792`） | `runMechanicalFanIn` | **post-flip** | **迁入 hooks 模块并注册**（`slice-readings-post`） |
| 3 | slice-readings baseline 读数 | `worker-driver.ts:5260`（`:5333` 调用） | `runOneWorker` | 派发前（翻转流程之外） | 不在本任务的 fan-in 相位轴上；留原处（另一条相位轴，⛔ 不强行合并） |
| 4 | complete GateEvent 补写 | `worker-fan-in.ts:3484` | `runMechanicalFanIn` | post-flip（ff 之后） | 未迁（本任务只要求 ≥1 个真实消费者迁移；它仍是候选第 2 个） |
| 5 | goal 分支 doc-face done 同步 | `worker-fan-in.ts:3471` | `runMechanicalFanIn` | post-flip（ff 之后，仅非 develop 目标） | 同上 |

⇒ 翻转前后**直接调用的横切步骤 5 条**，其中第 1、2 条是 Proposal 事实二点名的两个；两条都已迁移为注册式。第 4、5 条尚未迁移，**如实记录**（不是「已全迁」）。

### AC2 / AC3 —— 正臂与负臂（`plugin/test/worker-fan-in-hooks.test.mjs`）

正臂测试名：`正臂 — a hook registered OUTSIDE worker-fan-in.ts is triggered exactly ONCE (triggered=1)`

```js
const unregister = registerFanInHook(probe);   // registration lives in THIS file, not the centre
const { result, flipCalls } = await runFlipFlow(ctx);
assert.equal(triggered, 1, "正臂 must be a COUNT of invocations, not 'the handler exists'");
assert.equal(flipCalls, 1, "the flip runs exactly once, between the phases");
```

负臂测试名：`负臂 — the SAME probe NOT registered reads triggered=0 and handlerRegistered=false`

```js
const handlerRegistered = listFanInHooks().some((h) => h.name === "ac3-probe");
const { result, flipCalls } = await runFlipFlow(ctx);
assert.equal(triggered, 0, "an unregistered hook must not fire");
assert.equal(handlerRegistered, false, "the registry confirms there is no such handler");
assert.equal(flipCalls, 1, "the flip still runs — an absent hook is not a refusal");
```

两次运行输出（`node --experimental-strip-types --test plugin/test/worker-fan-in-hooks.test.mjs`）：

```
✔ 正臂 — a hook registered OUTSIDE worker-fan-in.ts is triggered exactly ONCE (triggered=1) (2.407715ms)
✔ 负臂 — the SAME probe NOT registered reads triggered=0 and handlerRegistered=false (0.529871ms)
✔ 注入泄漏 — a leaking dispatcher (ignores the registry) makes the 负臂 assertion RED (0.476436ms)
✔ phase order is registration data: pre-flip hooks run before the flip, post-flip after (0.734469ms)
✔ a refusing pre-flip hook stops the flip and skips every post-flip hook (1.440456ms)
✔ a throwing hook is a refusal with its own reason — never a silent skip (硬规则 3b) (0.673256ms)
✔ a duplicate hook name is refused (no silent replacement) (0.432189ms)
✔ the built-ins are registered from OUTSIDE the centre: dark-axis pre-flip, slice-readings-post post-flip (0.119287ms)
ℹ tests 8  ℹ pass 8  ℹ fail 0
```

注入泄漏臂（同一文件，`makeLeakyDispatcher` 无视注册表）：

```js
const { result, flipCalls } = await runFlipFlow(ctx, makeLeakyDispatcher(probe));
assert.notEqual(triggered, 0, "a leaking dispatcher must be caught by the negative arm");
assert.equal(triggered, 1);
```
⇒ 负臂在注入下**确实变红**（0 → 1），负臂断言不真空。

### AC4 —— 中心文件只有一个 runner 调用点

```
$ grep -n 'runFanInHooks\|registerFanInHook' plugin/scripts/worker-fan-in.ts
3266:    const hookRun = await fanInHooks.runFanInHooks(
```

（1 行 = 1 个调用点。`import * as fanInHooks` 的命名空间写法是刻意的：否则 import 语句会成为第二处文本命中，读数不再诚实。）

```
$ grep -n 'runSlicePostReading(' plugin/scripts/worker-fan-in.ts
(无输出)
$ grep -n 'slice-readings' plugin/scripts/worker-fan-in.ts
1962:// `worker-post-909` window (`024f9d7f2..HEAD`), this step plus the slice-readings post reading were
3264:    //     内置两条：`dark-axis`（pre，拒翻）/ `slice-readings-post`（post，FAIL-OPEN 观测）。
```

（只有注释命中——按硬规则 2「按位置判定」，注释**不算**调用。**零调用点**。）

### AC5 —— 迁移后的真实运行（经注册钩子触发）

注册处（`worker-fan-in-hooks.ts` 末尾，模块级）：

```ts
export function installBuiltinFanInHooks(): string[] { … }
installBuiltinFanInHooks();   // 注册发生在 worker-fan-in.ts 之外
```

真实运行（走 `runFanInHooks`，与 `worker-fan-in.ts` 同一条路径；`darkAxisTaskFile` 是既有测试缝，用来跳过 pre-flip 内置）：

```
registered hooks: [{"name":"dark-axis","phase":"pre-flip"},{"name":"slice-readings-post","phase":"post-flip"}]
run result: {"ok":true,"executed":[{"name":"dark-axis","phase":"pre-flip","ok":true},
             {"name":"flip-done","phase":"flip","ok":true},
             {"name":"slice-readings-post","phase":"post-flip","ok":true,"ms":10513}]}
EVENT {"step":"slice-readings-post","ok":true,"ran":true,"evaluated":true,
       "delta":{"centralFileLines":-154,"centralFileBodyLines":-77,"callOutDegree":-4,"methodCount":-3,"cycles":0}}
```

carrier `.quay/slice-readings/gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point.json`：

```
baseline.evaluated: true | post.evaluated: true
post.delta: {"centralFileLines":-154,"centralFileBodyLines":-77,"callOutDegree":-4,"methodCount":-3,"methodShellCount":0,"cycles":0,"centralChurnShare":0.29228998849252014,"centralSlimRatio":0.018659105460532333}
post.analyzedTree: {"kind":"in-place","path":"…/quay-worktrees/gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point"}
```

**`post.evaluated: true`**，Δ 中心文件 **−154** 行、callOutDegree **−4**、methodCount **−3**。

### AC6 —— 如实记账

```
$ git diff --numstat 4284b8351..HEAD -- plugin/scripts/worker-fan-in.ts plugin/scripts/worker-driver.ts
50	204	plugin/scripts/worker-fan-in.ts
```

`worker-driver.ts` 无变化（未出现在输出里）。

**本任务自身为中心文件贡献了多少行：新增 50 行、删除 204 行，净 −154 行。**
那 50 行是**扩展点的接线本身**（一次 runner 调用、ctx 构造、失败映射、以及说明为什么这一段必须存在而不能消失的注释）——它**不是**「扩展点失败的证据」，而是扩展点的**调用约定**：任何扩展点都必须有一个调用点。判据是**顺序是否还写在中心**（现在不是：`PHASE_ORDER` 住在 hooks 模块），不是「中心行数是否为 0」。非中心侧：`worker-fan-in-hooks.ts` +376，测试 +202/+12。

净口径警告（同 `gap-design-evolution-share-caliber-net-vs-additions`）：本任务把中心文件的行**搬**到了非中心，净口径会显示「中心 −154」而新增口径显示「中心 +50」；两个口径必须分开读，⛔ 不可互相引用。

### AC7 —— 扩展点四件套判据

`extension-point-criteria.ts --scaffold --task-id … --central plugin/scripts/worker-fan-in.ts --outside plugin/scripts/worker-fan-in-hooks.ts` 输出骨架后填四臂。

**填前**（只加了 `refactor-slice` 标签——该标签是本检查器的适用性开关；本任务确实是设计切片，⛔ 不是为了让检查器变绿而贴的标签，加了标签才会从 `not-applicable` 进入真正判定）：

```
{"evaluated":true,"verdict":"missing-arms","applicable":true,"satisfied":false,
 "arms":{"positive":false,"negative":false,"injectionLeak":false,"redLineBaseline":false},
 "missing":["positive","negative","injectionLeak","redLineBaseline"],
 "missingLabels":["正臂","负臂","注入泄漏","红线基线"],"acItems":7}
```

**填后**：

```
{"evaluated":true,"verdict":"satisfied","applicable":true,"satisfied":true,
 "arms":{"positive":true,"negative":true,"injectionLeak":true,"redLineBaseline":true},
 "missing":[],"missingLabels":[],"weak":[],"acItems":11}
message: satisfied — gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point: 四臂齐备 (正臂 / 负臂 / 注入泄漏 / 红线基线)
```

### ADR-007 dark-axis 记录

- L_D: import-graph-check valueSccs=0 typeSccs=0 reverseEdges=0 valueEdges=1356 (1352→1356, +4 全来自新增叶子模块) files=502 verdict.ok=true；中心文件 callOutDegree −4（slice-readings delta）——**结构没有恶化，且中心出度实际下降**。

### 不做 / 已知边界

- **未迁**：complete GateEvent 补写与 goal doc-face 同步（AC1 表第 4、5 条）仍在中心。本任务只要求迁移 ≥1 个真实消费者（Plan 3 / DoD 1），两条已迁的正是 Proposal 事实二点名的两个。剩余两条是**明确登记的下一步**，不是「已全迁」。
- **`plugin/test/slice-readings.test.mjs` 的一处 pin 被随迁更新**：原断言 `assert.match(fanIn, /runSlicePostReading\(/)` 钉的是**旧接线位置**；迁移后它改为钉 hooks 模块，并**新增** `assert.doesNotMatch(fanIn, /runSlicePostReading\(/)` 保证中心不再直调。这是「跟随调用点」，不是放松判据（详见该文件注释）。因此该文件列入 `## Touches`。

## Definition of Done

- 至少一个真实横切关注点（slice-readings）从「中心文件直接调用」迁移为「外部注册 + runner 调用」，且有正负两臂的计数断言。
- 新增第二个探针钩子不需要修改 `worker-fan-in.ts`（由 AC2 的测试证明：注册发生在另一个文件）。
- 中心文件的行数变化如实记录，且不把「这次自己加的行」算成「扩展点失败」。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in-hooks.ts
- plugin/scripts/slice-readings.ts
- plugin/test/worker-fan-in-hooks.test.mjs
- plugin/test/slice-readings.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point.md
