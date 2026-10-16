---
id: gap-touches-parser-annotation-strip-single-shot-order-dependent
title: touches-parser 的注解剥离每种括号只做一次且顺序固定 ⇒ 同时带全角与 ASCII 注解、或注解后跟散文的 Touches
  条目解析成非路径，静默与「新文件」同形
status: ready
labels:
  - gap
  - mechanism
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象**：`plugin/scripts/touches-parser.ts` 的 `stripTouchAnnotation` 对 ASCII `(…)` 与全角 `（…）` 各做**一次**行尾剥离，且顺序固定（先全角、后 ASCII）。只要两种注解同时出现且 ASCII 在后，或注解之后还有散文，剥离即失败 ⇒ 解析结果是**非路径**（带残留反引号 + 注解原文）。

控制实验（5 例，全中）：

- ``- `x.ts`（说明）`` → OK（全角单独）
- ``- `x.ts` (new)`` → OK（ASCII 单独）
- ``- `x.ts` (new)（说明）`` → OK（全角在最后）
- ``- `x.ts`（说明）(new)`` → **FAIL**，解析为带残留反引号 + 注解原文的串
- ``- `x.ts`（说明）(new) extra`` → **FAIL**

根因：全角平衡括号扫描只在字符串以 `）` 结尾时触发；ASCII 的 `\s*\([^)]*\)\s*$` 只在以 `)` 结尾时触发。两者各触发一次且不重入 ⇒ 顺序反转时全角那趟永远不再被复查。

**发生率（硬规则⑫，已实测，冻结在提交上）**：

- quay @ `493b5c71a8f82e7b70ef340528d3172e875c45d3`：2550 条以反引号路径开头的 Touches bullet 中 **22 条**剥离失败，散在 **6** 个任务文件。
- claudecodeui @ `31ab0091fe53cd281da1f6c68f1e574e8ac8c654`：796 条中 **7 条**失败，**全部集中在当时在飞的 `gap-ac384-processing-single-writer`**。
- 合计 **29 条 / 7 个文件**。

**危害（不是「注解写法不规范」这种小事）**：失败结果**不被标记为畸形**，其下游读数与「这个文件从没落地过」**同形**（硬规则 3b：读不懂伪装成合格）：

- `task-granularity-advice.ts` 对它输出 `landed=0 medLines=— medRounds=—`，与真正的新文件一模一样。
- 同一个 parser 供 `checkTouchesPair`（`concurrent-batch-scheduler.ts`，并发资格）与 `select-tests-for-touches.ts`（scoped 选测）；一个不可解析的 Touches 条目在这些消费者眼里**不是那个文件**。

<!-- dedup-ref -->
该函数**已有同族前科**：`gap-touches-parser-strip-annotation-nested-parens`（done）修的是同一函数里 `(new)` 注解残留反引号 ⇒ `checkTouchesPair` 判成「matched nothing (likely a typo)」。**那次只修了「嵌套括号」这一个形状；「顺序」这个形状未修**（硬规则 5b：缺陷成簇，兄弟实例同函数）。本条与该任务机制相邻但不同形状，**不合并**。

<!-- dedup-ref -->
本轮实际后果：`gap-ac384-processing-single-writer` 的 14 条 Touches 里 7 条不可解析，其 merge-candidate 重叠判定在**最大最新的任务上系统性少报**。

**修法（供 inner 选）**：

1. 把两趟剥离放进 `while` 直到不动点（每种形状可剥多次）——最小改动；
2. 或改成一次扫描：剥离开头的反引号路径后**丢弃其余全部内容**（仓库路径不含空格/反引号）——最稳；
3. 或非正则的括号平衡扫描统一处理两种括号。

**⛔ 不改阻断语义**：真实越界仍必须拦；只修「剥离」这半边。

**⛔ 顺带核 Core 内的镜像（硬规则 5b 要求「同一载体里 grep 其它适用点」的结果）**：`packages/quay/src/observation.ts:507` 的 `parseTouchPaths` 自己写了一遍 `\s*\([^)]*\)\s*$`（**只 ASCII、只行尾**），与 plugin 版**已经漂移**——plugin 版头注释声称「single implementation / 无第二份」，而 Core 不能 import plugin 脚本故留了这个镜像。修 plugin 时必须同步决定该镜像的处置，否则两处行为继续分叉。

**不覆盖**：不批量改写既有任务文件的注解（新 parser 兼容它们）；不改 `checkTouchesPair` 的保守语义；不改 `task-granularity-advice` 的读数逻辑。

## Plan

1. 读 `plugin/scripts/touches-parser.ts` 的 `stripTouchAnnotation` + `plugin/test/touches-parser-parity.test.mjs`，确认当前两趟的顺序与「各只做一次」。
2. 选修法（建议 ②：路径之后即注解），落 `while` 或单次扫描。
3. 加单测：5 例控制实验 + 顺序反转 / 注解后跟散文 / 多路径 形态；**先红后绿**。
4. 决定 `packages/quay/src/observation.ts:507` 镜像的处置（同修，或显式记录为已知分歧并附理由）。
5. 复跑 `node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --task gap-ac384-processing-single-writer --root /data/home/yale/work/claudecodeui`，确认 7 条失败条目消失。

## Acceptance Criteria

- [ ] AC1：`node --test plugin/test/touches-parser-parity.test.mjs` 退出 0，且新增用例覆盖 5 例控制实验（`` `x.ts`（说明） ``、`` `x.ts` (new) ``、`` `x.ts` (new)（说明） ``、`` `x.ts`（说明）(new) ``、`` `x.ts`（说明）(new) extra ``）；后两例在修复前为红（先红后绿留痕）。
- [ ] AC2：对 quay @ `493b5c71a8f82e7b70ef340528d3172e875c45d3` 的 `tasks/`（`git archive <sha> tasks` 冻结）跑普查，`TARGET strip-failures` 为 **0**（修复前 22）。口径：一条 bullet 记为失败，当且仅当**它自己**开头的反引号路径**在盘上存在**，而解析该 bullet 的结果**不等于**该路径。
- [ ] AC3：同上对 claudecodeui @ `31ab0091fe53cd281da1f6c68f1e574e8ac8c654` 运行，`TARGET strip-failures` 为 **0**（修复前 7）。
- [ ] AC4（负控制）：AC2/AC3 两条普查输出中 `other unresolved` 桶**不减为 0**——即真正畸形的条目（既非路径、也不指向存在文件）**未被误当成有效路径**。附两桶计数前后对照。
- [ ] AC5：`node plugin/scripts/task-schema-check.ts tasks/gap-touches-parser-annotation-strip-single-shot-order-dependent.md` 退出 0；`--for-task` scoped 门绿。
- [ ] AC6：Core 镜像 `packages/quay/src/observation.ts:507` 的处置已决定并留痕——同修 ⇒ 有对应改动与读数；记录为已知分歧 ⇒ Evidence 中附理由与后续锚点。

## Definition of Done

- `plugin/scripts/touches-parser.ts` 的 `stripTouchAnnotation` 改为**顺序无关**（不动点或单次扫描），5 例控制实验全绿。
- 新增单测覆盖 5 例控制实验 + 顺序反转形态，且该用例在修复前为红（先红后绿，留痕）。
- 复跑 `node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --task gap-ac384-processing-single-writer --root /data/home/yale/work/claudecodeui`：该任务 Touches 中不再出现「真实文件被解析成非路径」的条目（修复前 7 条），读数贴进 Evidence。
- Core 镜像分歧已处置（同修，或显式记录为已知分歧并附理由）。
- 真实越界的阻断语义未变：anti-drift 对实际 diff 不在 Touches 内的样本仍 HARD FAIL（负控制样本留痕）。

## Touches

- plugin/scripts/touches-parser.ts（`stripTouchAnnotation` 两趟剥离改顺序无关）
- plugin/test/touches-parser-parity.test.mjs（新增 5 例控制实验 + 顺序反转形态）
- packages/quay/src/observation.ts（Core 镜像 `parseTouchPaths` 的处置落点）
- tasks/gap-touches-parser-annotation-strip-single-shot-order-dependent.md（自触）

## Evidence

本条全部读数冻结在提交上，可复跑：

- quay 任务仓冻结于 `493b5c71a8f82e7b70ef340528d3172e875c45d3`；claudecodeui 任务仓冻结于 `31ab0091fe53cd281da1f6c68f1e574e8ac8c654`（各 `git archive <sha> tasks`）。
- 控制实验与发生率普查脚本：`/data/home/yale/work/quay-scratch/touches-annot-probe-108269/`（`order.ts` 控制实验 5 例、`census4.ts` 发生率、`probe.ts` 双向对照）。**该目录是 scratch，落地前应把口径与最终读数复制进本条 Evidence**（脚本本身不必入库）。
- 判据口径：一条 bullet 记为失败，当且仅当**它自己**开头的反引号路径**在盘上存在**，而解析该 bullet 的结果**不等于**该路径——故「失败条目与『新文件』在输出上同形」这一点是被直接测出来的，不是推断。
- 控制实验实测输出（5/5 符合预测）：全角单独 OK、ASCII 单独 OK、全角在最后 OK、`（说明）(new)` FAIL、`（说明）(new) extra` FAIL。
- ⚠️ 测量期间 claudecodeui 的 `gap-ac384` 任务文件正被在飞 worker 编辑，首两轮读数取到了不同值（同一文件先测 14 条中 7 条失败、再测 1 条）；**一切数字以冻结 sha 为准**，「任务文件正在被改」这一点本身也是本条要防的形态。
- 合并候选检查（本 skill step 2b，`task-granularity-advice --touches`）：`peers(0)` / `mentions-only(0)` ⇒ **无合并候选**。同批读数：`touches-parser.ts` landed=2 medLines=161 medRounds=1.50；`observation.ts` landed=70 medLines=355（长期返工热点，改动需更谨慎）。
