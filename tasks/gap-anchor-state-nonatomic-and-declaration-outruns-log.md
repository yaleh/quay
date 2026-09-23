---
id: gap-anchor-state-nonatomic-and-declaration-outruns-log
title: driver-anchor 的 writeState() 非原子（O_TRUNC）+ 同趟把 declaration
  发布在「静默脱离」日志之前最多一个 reconcile 周期 ⇒ 夹具 AC4/AC5 在 suite 负载下随机红（两机制均实测）
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

- [x] AC1（M1 能取假）：用「同趟 wanted 快照 vs 派生读数不一致」的夹具在**负载下**取到 `declaration=not-declared` 与「日志行缺席」同现，且该行在**下一个 reconcile 周期**出现（贴 lag 读数）。立案轮改前读数 = `160 次翻转中 4 次；lag 113/122/117/119 ms；neverAppeared=0；正控制 160/160`

      ▶ 本轮改前读数（改前 = develop 基线 `d1942b1b0` 的 `driver-anchor.ts`/`driver-runtime.ts`；夹具 = 本次新增的「21 个 fresh drop 集合」版；`--reconcile-ms 10`；读者 1ms 抢采样）：

      ▶ `96 路 CPU burner`：`flipsObserved=21 samples=866 stateWithoutLine=385 neverAppeared=0`；另一次 `samples=299 stateWithoutLine=194`；`lagMs=[32,31,25,30,46,24,35,37,121,128,82,135,36,71,195,166,47,106,105,157,82]`；`positiveControl_lineSeen=21/21`

      ▶ `0 burner（本机 ambient load≈49/128）`：`samples=303 stateWithoutLine=210`；另一次 `samples=349 stateWithoutLine=238`；`neverAppeared=0`；`positiveControl_lineSeen=21/21`

      ▶ **对照（硬规则 4 推论四）**：同一改前内核、同一夹具，把「把翻转嵌进 anchor 正在 start 一批 kind 的那一趟」这一步关掉（`NOTRICK=1`）⇒ `samples=268 stateWithoutLine=0`。⇒ 分叉**只在翻转落进那一趟的同步体里时**才出现；夹具的取假能力来自它把这个窗口做得可达，⛔ 不是来自谓词本身恒真。

      ▶ 修前它在 suite 里的原形（`driver-anchor-declaration.test.mjs` AC4 的那条 `assert.match`）在 96 路负载下同样红 —— 本次夹具原形的首次运行读数 = `violations=200/309 samples`。

- [x] AC2（M1 修法）：同一夹具在**同一负载**下 `stateWithoutLine=0`，且正控制仍命中（⛔ 若只把夹具改成「先等日志再断言」而生产代码未动 ⇒ 假）。贴改前/改后两份读数

      ▶ 改后（HEAD = 本任务落地提交 + develop 合并）读数 —— 同一夹具、同一负载：

      ▶ `96 路 CPU burner`：`samples=284 stateWithoutLine=0`、`samples=301 stateWithoutLine=0`、`samples=316 stateWithoutLine=0`；`neverAppeared=0`；`positiveControl_lineSeen=21/21`

      ▶ `0 burner`：`samples=302 stateWithoutLine=0`、`samples=306 stateWithoutLine=0`；`positiveControl_lineSeen=21/21`

      ▶ ⛔ 夹具断言一行未放宽：M1b 断的仍是「anchor **发布**的每一个非空 `not-declared` 集合，日志里必须有**同名的那一行**」，⛔ 没有改成「先等日志行再断言」（那会把测量换成回声）。生产侧改动见 `driver-anchor.ts` 的 `snap` 与 `driver-runtime.ts` 的 `DeclarationSnapshot`。

- [x] AC3（M2 能取假）：并发读者对 `.quay/anchor.json` 的 `null/torn` 率随宿主负载上升（贴 0/32/96 三档、形如 9.4e-5 / 1.85e-3 / 1.0e-2 的读数）

      ▶ 改前（develop 基线；`--reconcile-ms 100`；6 个并发读者；20 秒/档）实测三档：`load=0 reads=592010 torn=554 rate=9.36e-4` / `load=32 reads=1195696 torn=657 rate=5.49e-4` / `load=96 reads=567535 torn=443 rate=7.81e-4`。（另一次 15 秒/档：`5.62e-4 / 5.17e-4 / 1.43e-3`。）

      ▶ ⚠️ **诚实降级**：本轮**未能复现**「率随负载**单调上升**」这一形状 —— 三档都非零且量级相近，96 档不高于 0 档。本机 128 核、ambient load≈49/128，故「0 档」并非空载。⇒ 本 AC 按其实质判定：**M2 能被取假 —— 三档都取到非零 `torn`**（且在 `reconcile-ms 5` 的夹具里改前稳定红，见 Proposal 的现场）。那条单调性**未被本轮测量支持**，⛔ 不作为结论投递（硬规则 4 推论四）；立案轮的 9.4e-5/1.85e-3/1.0e-2 是**另一宿主/另一负载条件**下的读数，本轮不冒充。

      ▶ 谓词非恒假的配套控制见 AC4 与 `anchor-state-atomicity.test.mjs` 的 M2 正控制。

- [x] AC4（M2 修法）：同一夹具在同一负载下 `null/torn = 0`，且 `anchor.json` 的字段集与语义对照不变（贴字段对照）

      ▶ 改后同一夹具同一三档（`--reconcile-ms 100`；15 秒/档）：`load=0 reads=877084 torn=0` / `load=32 reads=320222 torn=0` / `load=96 reads=281342 torn=0` ⇒ 合计 **1,478,648 次并发读，0 例 torn、0 例 missing**（改前同档在 592k–1.2M 次读里 443–657 例 torn）。

      ▶ 夹具内（`--reconcile-ms 5`，回读面被重写 ~200 次/秒）另断言 `torn=0 ∧ missing=0`，且**正控制**（同一读者谓词对着一个故意 O_TRUNC + 分片写的子进程）必须报 `torn>0` ⇒ 零计数不是谓词恒假（硬规则 2）。

      ▶ **字段集对照**（改后实测一份 live `.quay/anchor.json`）：顶层 `["pid","startedAt","kinds","host","bundle","takeover","declaration"]`；`bundle` = `["state","kernel","builtAt","sourceDir","sourceMtime","kinds","rebuild","at"]`；`declaration` = 六个 kind 名。与改前逐字相同 —— `git diff` 显示对象字面量只被移进 `const body`（唯一的语义改动是 `declaration: kindDeclarationMap(opts.root, snap)`，即 AC2 的 M1 修法），写入方式由 `fs.writeFileSync(paths.stateFile, …)` 换成 `writeFileSync(tmp) + renameSync`（与同一文件族的 `writeDesired` 同款）；**读侧一行未改**。

- [x] AC5（不回归 + 作用域）：`bash scripts/test.sh --for-task gap-anchor-state-nonatomic-and-declaration-outruns-log` 绿；`plugin/test/driver-anchor-declaration.test.mjs` 在 96 路负载下重复跑 ≥20 次 0 红（贴次数与结果），并说明改后的夹具为什么不再依赖 reconcile 与读者采样的相位

      ▶ `bash scripts/test.sh --for-task gap-anchor-state-nonatomic-and-declaration-outruns-log --allow-thin` ⇒ **exit 0**；scoped 选中的测试 10/10 通过（含本任务两份夹具 + `driver-anchor.test.mjs` 的五条），静态检查层全过（`task-contract-check: no violations`）。

      ▶ `plugin/test/driver-anchor-declaration.test.mjs` 在 **96 路 CPU burner 负载**下重复跑 **20 次：20 pass / 0 fail**（改前：全量 suite 负载下随机红，见 Proposal 的两条现场）。

      ▶ 新增的 `plugin/test/anchor-state-atomicity.test.mjs` 在同一 96 路负载下重复跑 **8 次：8 pass / 0 fail**。

      ▶ **为什么改后不再依赖相位**：(a) M1 侧 —— `wanted` / `silent` / 发布面现在派生自**同一份** `DeclarationSnapshot`，而那一趟的日志追加排在 `writeState()` **之前** ⇒ 「发布面报出 `not-declared` 集合 S」蕴含「点名 S 的那一行已落盘」（或 S 与上一趟相同、那行更早已落盘），与读者何时采样、reconcile 走了几趟都无关。(b) M2 侧 —— tmp+rename 之后读者要么看到完整旧值、要么看到完整新值，「半写」这一取值在结构上不再存在；夹具的 `readAnchorJson` 也把 `missing`（文件不存在）与 `torn`（文件在但读不懂）分开报出 ⇒ 原来的 `TypeError: Cannot read properties of null (reading 'kinds')` 不再可能，且真出现损坏时报的是一条说清是**哪一种**的断言失败。

      ▶ **5b 核对**（同载体 grep 该原则的其它适用点）：`plugin/scripts/` 里非原子的 JSON 写者还有 `driver-anchor.ts:269`（`.quay/anchor-takeover.json`，一次接管最多写 3 次）与 `driver-runtime.ts` 的 control-plane 文件（每 kind 启动写一次）—— 与 `anchor.json` 同样是「多进程共享的回读面」形状，但**都是一次性事件写**，⛔ 不是每趟 reconcile 重写的周期型（本例的 torn 率正是靠 ~200 次/秒的重写才放大到可测）。本轮**未**测得它们的 torn 率 ⇒ 按硬规则 12 记为**观察项**，不纳入本次改动。

## Definition of Done

**REAL LANDING（DIR-026 Reading A）**：不是「夹具改宽了、单测绿了」，而是**生产机制改了、且改后读数在负载下能取假**——(a) M1：`declaration` 的发布与「静默脱离」日志行在同一趟内一致（负载下重复测量 0 例分叉）；(b) M2：`.quay/anchor.json` 在负载下并发读 0 例 torn（对照：改前三档读数见 AC3）。⛔ 三种凑绿明令禁止：放宽夹具断言、把 `null` 吞成 `{}`、把 M1 的那行改成「每趟都打」（刷屏会淹没信号 —— AC-255 的原设计是集合变化时一行）。

## Touches

- plugin/scripts/driver-anchor.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/anchor-state-atomicity.test.mjs (new)
- plugin/test/driver-anchor-declaration.test.mjs
- tasks/gap-anchor-state-nonatomic-and-declaration-outruns-log.md
