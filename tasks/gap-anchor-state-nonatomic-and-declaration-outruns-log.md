---
id: gap-anchor-state-nonatomic-and-declaration-outruns-log
title: driver-anchor 的 writeState() 非原子（O_TRUNC）+ 同趟把 declaration
  发布在「静默脱离」日志之前最多一个 reconcile 周期 ⇒ 夹具 AC4/AC5 在 suite 负载下随机红（两机制均实测）
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

**缺口（两个症状，同一窗口，两个不同任务的 suite 日志）**

`plugin/test/driver-anchor-declaration.test.mjs` 在**全量 suite 负载**下随机红；同窗口（相隔约 30s）内**两个不同任务**各红一次，且**失败断言不同** ⇒ 是 anchor 夹具/载体本身的负载敏感竞态，不是某个任务的 delta 缺陷（两个任务的 delta 都不含该文件，该文件在两边都与 develop 逐字节相同）。

| 载体（`.quay/fan-in-suite-*.log`） | 失败用例 | 判词 | 观测 |
|---|---|---|---|
| `…gap-ac295-criterion-cmdline-port-literal-stale~…-096d14.log` | AC4 | `AssertionError: the anchor logs the silent departure (⛔ not silent)` | `anchor.json` 已报 `declaration.quality=not-declared`（该断言之前的四条断言全过），但 `anchor.log` 里**没有**那行 —— 文件全文只有 header + 6 条 `loop started` |
| `…gap-unrelated-suite-red-exemption-unreachable~…-43b4eb.log` | AC5 | `TypeError: Cannot read properties of null (reading 'kinds')` | `readAnchorJson()` 返回 null（`anchor.json` 当时不可解析） |

**两个机制（立案轮在本机实测；探针写在 repo 外、不落盘，读数与复现参数逐字贴在下面）**

**M1 —— 同一趟 reconcile 里 `wanted` 是快照，而派生读数是现算，二者可指向不同的期望态。**
`plugin/scripts/driver-anchor.ts:487` 在趟首读一次 `const wanted = readDesired(opts.root)?.kinds ?? []`；`:512` 的 `silent` 由 `undeclaredKinds()` **重新读盘**得到、再用**陈旧的 `wanted`** 过滤；而 `writeState` 内的 `:437` `kindDeclarationMap(opts.root)` **又读第三次**盘。若期望态在这三点之间发生变化（另一进程写 desired；`writeDesired` 是 tmp+rename 原子写，所以只会读到完整的新集合），这一趟就会**发布 `not-declared` 而 `silent` 为空 ⇒ 不打那行**；那行落到**下一趟**（≤1 个 reconcile 周期）。

读数（夹具：真 anchor `--reconcile-ms 100`；4 个夹具 × 40 次「6 kinds ↔ 4 kinds」翻转；负载 = 96 个 CPU burner；读者以 ~1ms 抢采样）：
```
flipsObserved=160  stateWithoutLine=4  neverAppeared=0
lagMs=[113,122,117,119]   positiveControl_lineSeen=160/160
```
（正控制是谓词零计数的配套半边：那行最终在 160/160 次都出现了 ⇒ 谓词不是恒假。）

**M2 —— `writeState()` 写 `.quay/anchor.json` 不是原子写。**
`driver-anchor.ts:417-418` 用裸 `fs.writeFileSync(paths.stateFile, …)`（O_TRUNC 后 write），而同一文件族里的 `writeDesired`（`driver-runtime.ts:912-917`）是 tmp+rename。⇒ 并发读者可观测到**零长度/半写**的 `anchor.json`，夹具的 `readAnchorJson` 把解析失败映射成 `null`（⛔ 与「文件不存在」同形，硬规则 3b）⇒ 上表 AC5 那条 `TypeError`。

读数（预测：若机制为真，torn 率应随宿主负载上升；同一夹具 6 秒 × 6 个无 sleep 读者）：

| 负载（CPU burner） | reads | null/torn | 率 |
|---|---|---|---|
| 0 | 8,256,412 | 779 | 9.4e-5 |
| 32 | 6,116,392 | 11,337 | 1.85e-3 |
| 96 | 4,659,846 | 46,581 | 1.0e-2 |

**为什么只在 suite 里红**：两个机制都要靠宿主负载放大窗口（M1 要「另一进程的期望态写入正好落在趟内那一段同步体里」，M2 要「读者的读正好落在 O_TRUNC 窗口里」）。单跑该文件 12/12 绿（含 8 路自并行），与全量 suite（127 路并发 + 子进程风暴）不是一个量级。

<!-- dedup-ref -->**去重核对（机制维度，非症状关键词）**：`grep -rln '静默脱离\|not-declared' tasks/*.md` 命中里，`gap-ac255-anchor-kind-set-silent-loss`（done）是本夹具与被测特性的**引入者**，`gap-writestate-atomicity-split`（done）修的是**另一个**测试文件（`writestate-atomicity-split.test.mjs`）的采样型 liveness 断言，`gap-unrelated-suite-red-exemption-unreachable`（ready）修的是**复发判词的证据来源**（`worker-driver.ts` 的 `recurringSignatureTasks` 改为消费记录内留存签名）——三者机制均与本条不同，本条与它们无前置关系。

## Plan

1. **夹具先行（把两个机制固化成能取假的读数）**：新增 `plugin/test/anchor-state-atomicity.test.mjs`，使 M1、M2 各自可独立取假且与生产载体同源（M1：断言「同一趟发布的 `declaration` 与同一趟的日志行必须同现」；M2：并发读者计数 `null/torn`）。改前必须红（贴原文）。
2. **M1 修法**：reconcile 趟内**只读一次期望态**，把该快照同时用于 `wanted`、`silent` 与发布（让 `kindDeclarationMap`/`undeclaredKinds` 接受快照参数，或在趟首一次算好两处读数）。⛔ 不得靠放宽夹具断言（例如 `waitFor` 里再等日志行）来「修」——那是把测量换成回声。
3. **M2 修法**：`writeState` 改 tmp+rename（复用 `writeDesired` 同款手法），字段集与语义逐字不变。
4. **顺带把「读不懂」与「不存在」分开**（硬规则 3b）：`readAnchorJson` 的 `null` 目前同时表示「文件不存在」与「解析失败」，夹具与消费者都应能区分。

## Acceptance Criteria

- [ ] AC1（M1 能取假）：用「同趟 wanted 快照 vs 派生读数不一致」的夹具在**负载下**取到 `declaration=not-declared` 与「日志行缺席」同现，且该行在**下一个 reconcile 周期**出现（贴 lag 读数）。立案轮改前读数 = `160 次翻转中 4 次；lag 113/122/117/119 ms；neverAppeared=0；正控制 160/160`
- [ ] AC2（M1 修法）：同一夹具在**同一负载**下 `stateWithoutLine=0`，且正控制仍命中（⛔ 若只把夹具改成「先等日志再断言」而生产代码未动 ⇒ 假）。贴改前/改后两份读数
- [ ] AC3（M2 能取假）：并发读者对 `.quay/anchor.json` 的 `null/torn` 率随宿主负载上升（贴 0/32/96 三档、形如 9.4e-5 / 1.85e-3 / 1.0e-2 的读数）
- [ ] AC4（M2 修法）：同一夹具在同一负载下 `null/torn = 0`，且 `anchor.json` 的字段集与语义对照不变（贴字段对照）
- [ ] AC5（不回归 + 作用域）：`bash scripts/test.sh --for-task gap-anchor-state-nonatomic-and-declaration-outruns-log` 绿；`plugin/test/driver-anchor-declaration.test.mjs` 在 96 路负载下重复跑 ≥20 次 0 红（贴次数与结果），并说明改后的夹具为什么不再依赖 reconcile 与读者采样的相位

## Definition of Done

**REAL LANDING（DIR-026 Reading A）**：不是「夹具改宽了、单测绿了」，而是**生产机制改了、且改后读数在负载下能取假**——(a) M1：`declaration` 的发布与「静默脱离」日志行在同一趟内一致（负载下重复测量 0 例分叉）；(b) M2：`.quay/anchor.json` 在负载下并发读 0 例 torn（对照：改前三档读数见 AC3）。⛔ 三种凑绿明令禁止：放宽夹具断言、把 `null` 吞成 `{}`、把 M1 的那行改成「每趟都打」（刷屏会淹没信号 —— AC-255 的原设计是集合变化时一行）。

## Touches

- plugin/scripts/driver-anchor.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/anchor-state-atomicity.test.mjs (new)
- plugin/test/driver-anchor-declaration.test.mjs
- tasks/gap-anchor-state-nonatomic-and-declaration-outruns-log.md
