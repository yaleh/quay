---
id: gap-verification-round-empty-state-lumps-three-distinct-causes
title: /tests 空状态把三个不同成因合并成一句「尚未跑过验证轮」—— 结构性问题被说成时序问题
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（2026-09-13 实测，真实第三方项目 `/home/yale/work/quay-fleet`）**：`/tests` 页面显示

```
Tests — 验证轮记录
数据源：.quay/verification-round.jsonl（每轮 suite 完成时追加，红绿皆入账）
未接入/无数据 — .quay/verification-round.jsonl 不存在（尚未跑过验证轮 → 未接入）
```

**该措辞把三个不同成因合并成一句话**，而其中只有一个成因与「再跑一轮」有关 ⇒ 读者被导向一条对另外两个成因**并不存在**的解决路径。

**⛔ 立案时被证伪的一个前提（保留此段，以免再犯同形错误）**：本条初稿曾依据 `plugin/scripts/full-suite-runner.ts` 与 `plugin/scripts/pre-verified-round-record.ts` 的**头注释**（"the only other verification-round writer" / "the SHARED verification-round writer"）断言「该载体只有两个写者、都只在 quay 自己的路径上 ⇒ 第三方结构上永远无数据」。**那是旧注释，不是当前的执行路径** —— 当前路径是 `plugin/scripts/worker-driver.ts:1225 readLoopTestOutput`（其头注释自带 `gap-verification-round-bound-to-quay-shaped-suite-entry AC5` 标记）与同文件的 `appendDelegatedSuiteRound`：第三方项目经机械 fan-in **能**落账，已在真实第三方项目 archguard 上真跑验证过。⇒ **本任务不碰写者接入，只修「措辞 + 取值枚举」这一半。**

**对照读数（决定性，2026-09-13 实测）**：

```
quay-fleet  .quay/fan-in-step-trace.jsonl      不存在                     ⇒ fan-in 从未在此跑过
quay-fleet  .quay/config.yml loop.test_output  已声明（node --test 形状）  ⇒ 写者能力已具备
            readLoopTestOutput('/home/yale/work/quay-fleet') → {pass,fail,cancelled,tests}
            负控制 readLoopTestOutput('/tmp')                 → null
quay 自己   .quay/fan-in-step-trace.jsonl      11305 行，verification-round-record 步 13 次
```

⇒ quay-fleet 的页面报的其实是**使用状态**（有写者能力、尚未产出记录），却被渲染成与「本项目根本无写者接入」**逐字相同**的一句话。

**现状契约（不得回归）**：`packages/quay/src/observation.ts:10-16` 的 DEGRADATION CONTRACT 已经把 `status:"empty"`（无数据）与 `status:"error"`（读失败）做成**可区分**的两态，并写明「『无数据』 and 『读失败』 are ALWAYS distinguishable」。**缺陷不在这一层** —— 而在于 **`empty` 这一个取值内部还压着两个成因**，且它的 `reason` 串把其中一个成因说成了时序问题（「尚未跑过验证轮」）。这正是硬规则 3 的反面：布尔化的取值把两个需要不同处置的状态合并了。

**⛔ 仅追溯，不构成依赖声明**：quay-fleet 的 fan-in 至今一轮未跑，级联自 `gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root`（driver 的实质判据在该项目上全部取不到值）。**本任务不依赖它修复** —— 措辞与取值枚举在渲染侧即可取真实读数验证。

<!-- dedup-ref -->
## 与既有任务的关系（仅追溯，⛔ 不构成依赖声明）

- **`gap-verification-round-bound-to-quay-shaped-suite-entry`（done，2026-09-12）** —— **同一页面、不同半边，⛔ 不要重做它**：它覆盖的是**写者接入**（第三方用自己的 suite 入口时台账结构性缺失），AC1–AC5 已在真实第三方项目 archguard 上跨机验证并 done。它的 AC3 证据里那句 `未接入/无数据 — .quay/verification-round.jsonl 不存在（尚未跑过验证轮 → 未接入）` **正是本任务要改的那句**，但它只要求「该串不再出现（因为终于有记录了）」，**从未要求区分『没有记录』的不同成因**。⇒ 本任务只取它未覆盖的**措辞 / 取值枚举**那一半。
- **`gap-ac95-webui-15-views`（done）** —— 其 AC3 只要求「空态诚实：数据源空/不可用渲染『未接入/无数据』，不得留白/显示 0」，即**把空态当成一个取值**；本任务要求的正是把那一个取值再拆开，⛔ 不与它冲突，是它的细化。

## Plan

1. **先取直接量，再动代码**：打印 `readTests()` 当前实际产出的 `(status, reason)` 全部取值（⛔ 不要只报结论；引用计数前先打印匹配到的实际内容，硬规则 2）。
2. **把 `empty` 拆成两个取值**：`no-writer`（本项目无任何写者接入路径）与 `writer-but-zero-records`（有写者能力、尚未产出记录）。判定量由实现者定，但**必须是渲染时读得到的直接量**（如工作区 `.quay/config.yml` 的 `loop.test_command` / `loop.test_output` 声明、fan-in 痕迹载体是否存在），且**必须能取假** —— ⚠️ 硬规则 4c：该量要穿过 `observation.ts` 这一层仍取得到，⛔ 不要挑一个只有 driver 侧才有的量。
3. **渲染三态**：`serve-render.ts` 的 `obsNote` 按取值给出不同文案；`no-writer` 给**接入指引**，`writer-but-zero-records` 才允许出现「等一轮」语义，`unreadable` 保持既有「读失败」形态。
4. **把 (b) 半边的契约说清楚**：或提供并文档化一个公开的 append 入口，或明确裁定「第三方只能经机械 fan-in 落账」并把这一事实写进指引 —— 两者都算把契约说清楚，⛔ 但不得两者都不做而只改措辞。
5. **负控制（不得回归）**：quay 自己（已有 1500+ 条记录）的 `/tests` 页面文案**不得变化**；打印改前/改后两向 diff。

## Acceptance Criteria

- [ ] AC1（负控制，改前必须红）：在 **quay-fleet**（已声明 `loop.test_output`、`.quay/verification-round.jsonl` 不存在）渲染 `/tests` —— 改前页面含「尚未跑过验证轮」；改后该串**不再出现**，代之以「有写者接入、尚未产出记录」语义的文案。贴出改前/改后两段**实际 HTML 文本**（⛔ 不以 HTTP 200 为证据，硬规则 4）。
- [ ] AC2（枚举而非布尔，硬规则 3）：三个取值 `no-writer` / `writer-but-zero-records` / `unreadable` 的实际渲染文案**两两不同形** —— 逐条打印三条文案原文；任意两条相同即判红。其中 `unreadable` 仍与另两者可区分（⛔ `observation.ts:10-16` 的既有 DEGRADATION CONTRACT 不得回归）。
- [ ] AC3（`no-writer` 给的是接入指引而不是等待暗示）：在一个**无写者接入路径**的工作区（无 `loop.test_output` 声明、无 fan-in 可达性）渲染 `/tests`，文案明确指出「本项目无写者接入该载体」并给出接入方式；**该指引点名的入口必须实际存在**（文件路径可读 / 子命令可解析到）—— ⛔ 不得写一个不存在的命令名，否则只是把一句误导换成另一句。
- [ ] AC4（契约落地，二选一并在任务体写明所选）：① 提供并文档化公开 append 入口 ⇒ 在 quay-fleet 上真跑一次，页面**离开** `writer-but-zero-records` 态并显示该轮的 `state` 与 `tests` 计数；或 ② 裁定「第三方只能经机械 fan-in 落账」⇒ 把该事实写进 AC3 的指引与文档，并在一个 fan-in **可跑**的工作区（quay 自己或 archguard 形态）真跑一轮，证明该契约陈述为真。⛔ 不得两条都不做。
- [ ] AC5（不回归）：quay 自己（已产出记录态）的 `/tests` 页面文案与改前**逐字一致** —— 打印两向 diff，差集为空。
- [ ] AC6：全量 `bash scripts/test.sh` 绿。

## Definition of Done

- 六条 AC 全部满足。
- **AC1 的证据取自真实第三方项目 quay-fleet（非 fixture）**，AC5 的证据取自 quay 自己的生产载体 `.quay/verification-round.jsonl`；**fixture 满足不算数**（硬规则 4 推论三：一个只能被 fixture/注入数据满足的判据不是测量）。若某一态（如 `unreadable`）确实无法取到真实实例，须在任务体写明**为什么**，⛔ 不得默默用 fixture 顶替而不标注。
- 两个真实项目恰好覆盖两个需要区分的取值：**quay-fleet = 有写者能力、零记录**；**quay 自己 = 有写者且已产出**。⇒ ⛔ 不必为这两态另造 fixture。
- ⛔ **不得改动 `plugin/scripts/pre-verified-round-record.ts`** —— 其头注释第 6-12 行的裁定「⛔ RETIRED FROM THE FAN-IN PATH … do NOT re-wire it into the fan-in path — route through the runner instead」经复核成立。
- ⛔ **不得只在页面上多加一句话而让三个成因仍共用同一个 `status` 取值** —— 取值本身必须可枚举（硬规则 3），否则下一个读者仍然无法从数据上区分它们。

## Touches

- packages/quay/src/observation.ts
- packages/quay/src/serve-render.ts
- packages/quay/test/serve-tests-empty-state.test.mjs
- tasks/gap-verification-round-empty-state-lumps-three-distinct-causes.md
