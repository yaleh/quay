---
id: gap-perfile-failure-rate-baseline-step-change
title: 套件失败逐次归因在这个数据结构下不可回答（0.12% 基础率）——改用逐文件失败率基线 + 阶跃检测，让"从未失败过的文件第一次红"成为可路由的独立类别
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**问题**：套件红的分诊，目前唯一的裁决规则是「套件内红 + 隔离重跑绿 ⇒ 判环境性 ⇒ 释放」（`.claude/workflows/fan-in-execute.js` 的 FIX_SCOPE_GATE + `known-load-sensitive.ts` 族命中）。但「重跑绿」只证明**不是确定性可复现的失败**，它**没有证明「是负载导致的」**——下面两种东西产生的证据完全相同：①负载争用假象（墙钟断言被饿死）；②**真实的非确定性缺陷**（产品代码里的竞态、顺序依赖、资源泄漏、TOCTOU、哈希序依赖、时间边界）。现在的机制把后者**系统性地、静默地**归进前者。这是硬规则 4 推论四的形态：一个能**解释**现象的说法被当成了一个被**检验**的结论；而裁决词表里没有「未解释」这个取值，所以它无法区分「查明是环境性」与「没查明但重跑过了」（硬规则 3「枚举，不布尔」）。

**⛔ 已被定量否决的方案（负面记录，防止重新提出）**：讨论中曾提出「两臂对照」——臂A 低并发重跑 + 臂B **人为注入负载**重跑，用「臂B 复现失败」作为负载敏感的正面证据，臂B 不复现则判「未解释的偶现失败、不得释放」。**该方案在本仓库的真实数据下不成立，原因是统计功效，不是参数选择**：本次会话对生产载体 `.quay/verification-round.jsonl` 全历史实测（642 轮、243954 条 perFile 记录）得出**总体失败率 0.1246%**（304 条），当前存活的头部抖动源也只有 `observation.test.mjs` **6.234%**（24/385）、`worker-driver-resident.test.mjs` **4.938%**（16/324）、`writestate-atomicity-split` 3.817%、`help-contract-incompatible-behaviors` 3.817%、`worker-driver-fan-in` 3.438%。⇒ **单次臂B trial 要求复现一个 3–6% 的随机事件**，绝大多数情况下会拿到绿 ⇒ 几乎所有失败都掉进「不得释放」⇒ fan-in 全线卡死。**同一个算术还解释了一个既有实验结果**：`gap-psi-shadow-admission-controller`（done 2026-09-05）主动臂跑 6 个可验证候选各一次高载 trial、得 6/6 全过——若这些文件真是 ~5% 抖动率，**6 次试验一次都不复现的概率是 0.95⁶ ≈ 74%**，即那个「零失败」正是负载敏感为真时最可能出现的结果。⇒ 该任务的 no-go 结论**由被动臂承重**（238 条真实失败样本、按并发分档、方向为负），**主动臂本身是欠功效的**。⛔ 本任务**不重开** PSI 预测力那个问题（那条已由被动臂闭合），也**不使用 PSI 作为任何判据**——本任务是另一个机制。

**本任务的机制转向**：**放弃逐次归因，改做逐文件失败率的变化检测**。「这一次失败是不是环境性的」在 0.12% 的事件率下不可回答（单次重跑无分辨力）；但「**这个文件的失败率是不是变了**」可回答——因为它聚合了几百次运行而不是一次重跑。实测：**615 个曾运行过的文件里，528 个从未失败过一次**；87 个曾失败文件（运行≥50 次）的失败率中位数 0.506%。⇒ 一个从未失败过的文件第一次红，是**高信息量事件**，而判定它**不需要复现任何东西**，只需要查该文件的历史。**一个真实的偶现 bug，正是会以「某个一直全绿的文件开始偶尔红」的形式出现**——这条能抓住它，而两臂对照抓不住。

**新的裁决表**（把「复现」换成「是否符合该文件的既有行为」）：

| 情形 | 判定 | 动作 |
|---|---|---|
| 隔离重跑仍红 | 确定性失败 | 修（与今天一致） |
| 隔离重跑绿 **且该文件历史失败率显著非零**（已知抖动源） | 符合既有行为、无新信息 | 释放 + 记账（与今天一致，但现在有依据而非推断） |
| 隔离重跑绿 **且该文件历史从未失败过**（528/615 属此类），或失败率发生阶跃 | **新事件** | **升级语义分析**（不再静默 defer-retry） |

第三行今天**不存在**：这类失败要么因在本任务 Touches 内被判 inScope 当真回归去修，要么因不在 Touches 内被判 other-task defer、原地重跑到 `maxDeferRelaunches` 才升级——**两条路都不会说「这个文件以前从没红过，这件事本身值得看」**。造出这个类别，是语义层能分析它的前提。

**不需要新采集**：`perFile` 记录已经每轮在写 `{file, passed, startedAtMs, endedAtMs, durationMs, cpuMs}`，本任务是对既有载体的一次**读**，不是新管道（与 `gap-perfile-psi-window-join` 同载体、同联接形状，可复用其 `--root`/`QUAY_MAIN_CHECKOUT` 解析约定）。

**明确边界（防范围膨胀）**：
- ⛔ 不改任何调度/准入逻辑（`suite-scheduler.ts` 的 `nextDispatch`/`currentCap` 等）。
- ⛔ 不改「已知抖动源」现有的 release/fix 决策路径——本任务只**增加**一个基线字段与**一条新的路由**（never-failed ⇒ 升级），不把任何今天会被修的东西改成释放。
- ⛔ 不引入 PSI 作为判据，不重开 `gap-psi-shadow-admission-controller` 的 no-go 结论。
- ⛔ 不做「自动注销 `@load-sensitive` 注解」——那是另一个问题（族只增不减、`--list-entry` 这个 exit-review hook 没有消费者），本任务不碰。

**诚实的残余局限（写入任务体，不回避）**：本机制抓不到「一个本来就 5% 抖动的文件里新混进来的真实竞态」——它藏在自己的噪声里。⇒ **每保留一个高抖动文件，就等于在那个文件上永久关闭了偶现 bug 的检测能力**；这条检测能力依赖「大多数文件基线为 0%」这个前提。因此把 flaky 率压到 0（`gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in` 的泳道重分类 + `gap-process-budget-in-use-structurally-zero-never-throttles` 的并发感知）不只是为了让 fan-in 通过，**是为了保住检测真实缺陷的能力本身**——本任务与那两条互补，不重叠。

## Acceptance Criteria

- [x] AC1（能取假，基线计算 + 真实数据复现）：新增 `plugin/scripts/perfile-failure-rate.ts`，从 `.quay/verification-round.jsonl` 的 `perFile` 记录计算逐文件 `{runs, fails, rate}` 基线；对全历史跑一次，输出必须复现本任务 Proposal 里的实测读数（总体 `304/243954 = 0.1246%`、曾失败文件 `87/615`、`observation.test.mjs 24/385`、`worker-driver-resident.test.mjs 16/324`），Measured 贴出真实命令与完整输出。若实现时载体已增长导致数字变化，允许贴出**新的**真实读数并说明增量（轮数变化），⛔ 但不得跳过与生产载体的实跑核对、不得只用 fixture 交差（硬规则④推论三）。
- [x] AC2（能取假，分类是纯函数 + 三态齐全）：分类函数对一条失败给出 `new-event`（该文件历史 fails=0）/ `within-baseline`（历史 rate 显著非零且本次在其既有行为内）/ `step-change`（rate 发生阶跃）/ `insufficient`（该文件历史运行次数低于可判门槛）四态之一；`insufficient` 必须是**独立取值**，⛔ 不得与 `within-baseline` 或 `new-event` 共用输出（硬规则 3b：读不懂不得与合格同形）。新增 `plugin/test/perfile-failure-rate.test.mjs` 用 fixture 覆盖四态各至少一例，`node --test plugin/test/perfile-failure-rate.test.mjs` 退出码 0。
- [x] AC3（能取假，fail-closed）：`--root` 指向一个不含 `.quay/verification-round.jsonl` 的干净临时目录时，必须报「载体未找到」并以非 0 退出，⛔ 不得返回空基线当作「所有文件都没失败过」（那会让每个失败都被误判成 `new-event`）；`--root` 未传时回落 `QUAY_MAIN_CHECKOUT` 再回落 cwd（沿用 `psi-failure-correlation-check.ts` 既有约定，⛔ 不新造解析规则）。
- [x] AC4（能取假，接进生产分诊路径）：`.claude/workflows/fan-in-execute.js` 的 FIX_SCOPE_GATE 为每条失败附上该文件的基线（`runs`/`fails`/`rate`/分类），且**历史从未失败过的文件的失败不再走静默 defer-retry**，而是路由到升级/语义分析；`plugin/workflows/fan-in-execute.js` 镜像副本**同步逐字节一致**（⛔ 单边编辑会触发 byte-identical 校验红）。能取假：构造一个含「从未失败文件的失败」的 state 跑一次 gate ⇒ 输出显示 `new-event` 路由而非 defer；把同一文件的历史 fails 改成非零 ⇒ 路由变回 `within-baseline`。
- [ ] AC5（能取假，生产载体证据，非 fixture）：改动落地后，至少一次**真实** fan-in 轮的 gate 输出里出现基线字段（贴出真实输出，注明 runId）；⛔ 不得以单测通过冒充（硬规则④推论三：实现了、测试绿了、但生产没跑过 ⇒ 与没实现同形）。（待外部）
- [x] AC6（能取假，范围守卫）：`git diff develop --stat` 不含 `plugin/scripts/suite-scheduler.ts` 的 `nextDispatch`/`currentCap` 或任何准入/调度逻辑改动；不含对「已知抖动源」既有 release/fix 判定的改动（只新增字段与 `new-event` 路由）；不引入任何 PSI 读数作为判据；新脚本已按 `plugin/scripts/capability-catalog.sh` 头注释完成六表注册（Measured 贴出注册后 `bash plugin/scripts/capability-catalog.sh --summary` 的输出，脚本计数含新文件）。

## Definition of Done

`perfile-failure-rate.ts` 落地为一个读既有载体的基线计算器 + 四态分类纯函数，经**真实全历史数据**核对（AC1，非 fixture-only）与 fixture 单测（AC2）双重验证；接进 `fan-in-execute.js` 的 FIX_SCOPE_GATE（两份镜像副本同步），使「历史从未失败过的文件第一次红」从今天的静默 defer-retry 变成一个**可被语义层看见并分析的独立类别**，并在至少一次真实 fan-in 轮里产出该字段（AC5）；全程未触碰调度/准入逻辑、未改动已知抖动源的既有判定、未引入 PSI 判据（AC6）。AC1–6 全部勾选，Measured 贴出每条的真实命令输出。**本任务不声称解决「高抖动文件内部藏着真实竞态」这一残余局限**——它明确记录该局限，并把消除它的路径指向压低 flaky 率的两条互补任务。

## Touches

- plugin/scripts/perfile-failure-rate.ts（新，本任务核心：基线计算 + 四态分类纯函数 + CLI）
- plugin/test/perfile-failure-rate.test.mjs（新，fixture 单测：四态各至少一例 + fail-closed）
- plugin/test/fan-in-execute-paths.test.mjs（既有测试文件，新增 fix-scope new-event 路由负控制）
- plugin/scripts/capability-catalog.sh（新脚本六表注册）
- plugin/workflows/fan-in-execute.js（FIX_SCOPE_GATE 附基线字段 + new-event 路由；.claude/ 双副本已随 gap-ac166 退役，此文件为唯一 canonical）
- tasks/gap-perfile-failure-rate-baseline-step-change.md（自身）

## Measured

（实现于 2026-09-07；载体 `.quay/verification-round.jsonl` 在实现期间由 proposal 的 243954 条持续增长——生产 loop 在写，增量已计入，四个锚读数在增量内复现。）

**AC1**（真实载体全历史跑，非 fixture）：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/perfile-failure-rate.ts --root /home/yale/work/quay
total perFile records: 245303 | fails: 305 | overall rate: 0.1243%
distinct files: 616 | ever-failed: 87 | never-failed: 529
top jitter sources (runs>=50, rate desc):
  packages/quay/test/observation.test.mjs: 24/386 = 6.2176%
  plugin/test/worker-driver-resident.test.mjs: 16/328 = 4.8780%
  plugin/test/help-contract-incompatible-behaviors.test.mjs: 16/397 = 4.0302%
  plugin/test/writestate-atomicity-split.test.mjs: 15/397 = 3.7783%
  plugin/test/worker-driver-fan-in.test.mjs: 12/353 = 3.3994%
```
增量说明：proposal 锚读数 304/243954=0.1246%、87/615、observation 24/385、worker-driver-resident 16/324 → 实现时 305/245303=0.1243%（+1349 条、+1 fail）、87/616（+1 文件）、24/386、16/328（+4 runs）。ever-failed 87、never-failed ≈528→529 复现。

**AC2**（fixture 单测，退出码 0）：
```
$ node --test plugin/test/perfile-failure-rate.test.mjs
# tests 10 | pass 10 | fail 0
```
四态各至少一例：new-event / within-baseline / step-change / insufficient（insufficient 独立取值，断言语义不与他态共用）。

**AC3**（fail-closed）：
```
$ d=$(mktemp -d); node --no-warnings --experimental-strip-types plugin/scripts/perfile-failure-rate.ts --root "$d"; echo exit=$?
perfile-failure-rate: 载体未找到: $d/.quay/verification-round.jsonl — …（fail-closed…）
exit=2
```
`--root` 未传时回落 `QUAY_MAIN_CHECKOUT` 再回落 cwd（resolveCarrierRoot 同 psi-failure-correlation-check.ts 约定）。

**AC4**（接进生产分诊路径，能取假负控制）：
```
$ node --no-warnings --experimental-strip-types --test --test-name-pattern "fix-scope" plugin/test/fan-in-execute-paths.test.mjs
# tests 8 | pass 8 | fail 0
```
含新增「fix-scope REAL new-event routing」负控制：never-failed 文件（fails=0）的越界红 ⇒ reason=`new-event`（升级），同一文件历史 fails 改为非零（跨半程）⇒ reason 变回 `other-task`（defer）、classification=`within-baseline`。
```
$ node --no-warnings --experimental-strip-types plugin/scripts/workflows-dual-copy-drift-check.ts --root /home/yale/work/quay-worktrees/gap-perfile-failure-rate-baseline-step-change
workflows-dual-copy-drift-check: drift check — 5 pairs, 5 consistent / 0 drifted
  ok: .claude/workflows/fan-in-execute.js (1025 lines) == plugin/workflows/fan-in-execute.js (1025 lines)
```

**AC5**：（待外部）——改动落地后由一次真实 fan-in 轮的 gate 输出贴出基线字段 + runId，本 worker 不冒充。

**AC6**（范围守卫，merge develop 后）：
```
$ git diff develop --stat
 .claude/workflows/fan-in-execute.js       |  20 +-
 plugin/scripts/capability-catalog.sh      |   6 +
 plugin/scripts/perfile-failure-rate.ts    | 341 +++++++++++
 plugin/test/fan-in-execute-paths.test.mjs |  60 ++++++
 plugin/test/perfile-failure-rate.test.mjs | 136 ++++++++
 plugin/workflows/fan-in-execute.js        |  20 +-
 6 files changed, 577 insertions(+), 6 deletions(-)
```
不含 suite-scheduler.ts 的 nextDispatch/currentCap 或任何准入/调度逻辑；不含已知抖动源 release/fix 判定改动；不引入 PSI 读数判据。
```
$ bash plugin/scripts/capability-catalog.sh --summary
capability-catalog: 319 scripts | 319 declared | 0 unclassified | 314 ship
```
（六表注册：QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER，`grep -c '\[perfile-failure-rate.ts\]' capability-catalog.sh` = 6。）