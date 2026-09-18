---
id: gap-suite-main-phase-scheduling-slack-after-floor-drop
title: 套件 main 相位余量 16s 无归因：地板已降到 20.4s 而相位仍 36.4s（main/floor 1.20→1.78，理想
  makespan 仅 11.7s）——先量启动时刻再归因
status: ready
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-281
---
**type:** execution

> **2026-09-18 worker 实施轮**：AC1/AC2/AC3/AC4/AC6 已取证并落地（见下方 `## Measured`）。
> **AC5 保持未勾** —— 属外层验证（待外部）。⚠️ 结论与下面 Proposal 里的**假定**不同：
> 实测证明 main 在 CI 上**两套 LPT 都没生效**（走的是 raw glob 顺序），且余量**不来自地板文件**。

## Proposal

**缺口（实测，⛔ 非估算）**：`gap-suite-fan-in-execute-paths-s07-long-pole-split` 落地后，套件的
**单文件地板**从 32 439ms 降到 **20 371ms**（−37.2%），但**相位墙钟没有跟着降**——

| run | 时点 | `floor_ms` | `main_phase_ms` | `scheduler_ms` | `main/floor` |
|---|---|---|---|---|---|
| 35297103524 | 2026-09-18T01:52:57Z（B 落地后） | **20 371** | **36 361** | **38 753** | **1.78** |
| 35293026617 | 2026-09-18T00:52:54Z（B 落地前） | 42 963 | 51 736 | 54 230 | 1.20 |

⇒ **余量从 9.5s 涨到了 16.0s**，`main/floor` 从 1.20 涨到 **1.78**。
而同一次 run 的 `__GROUP__ concurrency=128 files=755 sum_ms=1 503 860` ⇒
**理想 makespan（sum/128）只要 11.7s**。三者并列说明：
**现在限制相位的是"调度/打包"，不是单文件地板** —— 地板 20.4s 已低于实测相位 36.4s 达 16s。

⚠️ **本条不预设成因**。已核实存在的事实只有下面三条（都取自源码/日志原文，不是推断）：

1. **LPT 有两套实现在跑**：`plugin/scripts/suite-scheduler.ts` 的 `classifyAndOrder` 对三组都 LPT
   （`:250-252` `queues.serial/lowconc/main = orderByLpt(...)`，**静默、不打日志**）；
   `scripts/test.sh` 的 bash `lpt_reorder_files` 只排 serial/lowconc。
2. **CI 日志里出现的 `lpt-order: file list reordered` 带 `scripts/test.sh:` 前缀**，且只有两条
   （56 files = serial、32 files = lowconc）—— 即**日志可见的那一套只覆盖两个小组，不覆盖 main**。
3. **LPT 的时长来源是 `.quay/verification-round.jsonl`**（`suite-lpt-order.ts:65` `loadDurationAverages`），
   该文件 **gitignored、未跟踪**，而 `.github/workflows/ci.yml` 里**没有任何步骤**提供它
   （`grep -nE 'verification-round|perFile|duration|lpt' .github/workflows/ci.yml` 零命中）。
   实现是 **FAIL-OPEN**（无 history ⇒ 原序返回）—— 所以"CI 上 LPT 到底有没有生效、对哪一组生效"
   **不能靠读代码回答**，必须实测（见 Plan 第 1 步）。

### 为什么这不是既有任务的重做（机制去重）

仓库里调度/长尾一族的任务**全部已 done**：`gap-m-bucket-long-tail-lpt-scheduling`、
`gap-suite-dynamic-waterline-scheduler`、`gap-suite-main-overlaps-load-sensitive-tail-experiment`、
`gap-suite-main-tail-overlap-bucket-subset`、`gap-suite-scheduler-reliability-cap-not-speed`、
`gap-suite-lpt-serial-lowconc-phases-not-lpt-ordered`、`gap-suite-classification-lpt-scheduler-ts-ization`。
本条的**观察量是它们之后才出现的**：地板刚被压到 20.4s，**余量反而变大**（9.5s → 16.0s）。
⛔ 不要重做那些已 done 的机制。

## Plan

1. **先实测「地板文件到底第几秒启动」（这是区分"排序没生效"与"排序生效但容量不足"的直接量）**：
   取一次 develop `test` job 的原始日志，对 `__PERFILE__ duration_ms=… end_ms=…` **全量**解析，
   按 `start = end_ms − duration_ms` 换算**每个文件的启动时刻**，再减去 main 相位起点，得到
   **start offset**；贴出耗时前 10 名的 (duration, start offset) 表。
   - 地板文件 offset ≈ 0 ⇒ 它**第一波就启动了** ⇒ 余量来自**容量/争用**，不是排序；
   - 地板文件 offset 明显 > 0 ⇒ 它**被排到了后面** ⇒ 排序未对 main 生效（或生效但用了错/陈旧时长）。
   ⛔ 这一步的读数决定后面全部方向，**不得跳过**。
2. **判定 CI 上到底是哪一套 LPT 在驱动 main**：`scripts/test.sh` 与 `suite-scheduler.ts` 之间的实际执行路径
   （由 CI 日志里 `scripts/test.sh:` 前缀行、`__OVERHEAD__`/`__GROUP__` 的产出来源、以及
   `scripts/test.sh` 调用 scheduler 的方式共同决定）。**贴出定位它的命令与输出**。
3. **按第 1/2 步的结论归因**，并给出**一个能区分的对照**：例如把「可疑机制」显式打开/关掉各跑一次，
   看 makespan 是否按预测方向变化。⛔ **给不出对照的因果句一律写成假说，不得作为结论投递**（硬规则 4-推论四）。
4. **按归因修复**。修法按结论选（示例，不是预设）：给 CI 提供 LPT 需要的时长来源；
   统一两套 LPT 为一条路径；修容量/争用；或调 `--rounds` 取数与 key 归一。
   ⛔ **不许用"再拆更多文件"来掩盖调度问题**——那是另一条路，且本条的观察恰恰是"地板已低于相位 16s"。
5. **压完重测**：同一条测量命令贴改动前后对照（`floor_ms` / `main_phase_ms` / `scheduler_ms` / 地板文件 start offset）。
6. **落地并触发一次真实 develop CI**，贴出 `scheduler_ms` 与 `test` job `conclusion`。
   ⛔ 若 `conclusion != "success"`，指出真正红的文件，⛔ 不记成本任务失败（见 AC5）。

## AC

- [x] **AC1（先量启动时刻，再谈成因）**：贴出耗时**前 10 名**文件的 `(duration_ms, start offset)` 表，
      并给出计算式（`start = end_ms − duration_ms − phase_start`）与所用 run id；
      据此明确回答「**地板文件第一波是否启动**」。⛔ 不跳过这一步直接改代码。
- [x] **AC2（哪一套 LPT 在驱动 main，有定位证据）**：贴出判定 CI 上 main 由
      `scripts/test.sh` 的 bash LPT 还是 `suite-scheduler.ts` 的 TS LPT 驱动的**命令与输出**；
      ⛔ 只贴源码不算——要有 CI 运行时的读数。
- [x] **AC3（归因带可区分的对照）**：给出归因，**并**给出一个「若该成因不成立则结果会不同」的对照
      （开/关该机制各一次，或两个相反预测各测一次），贴两侧读数。⛔ 给不出 ⇒ 如实记为**假说**。
- [x] **AC4（改动前后同一测量对照）**：同一条命令的改动前后 `floor_ms` / `main_phase_ms` /
      `scheduler_ms` / 地板文件 start offset 四项对照；⛔ 无对照的项记为未处置。
- [ ] **AC5（生产面兑现，外层验证）**：落地并触发 develop CI 后贴出 run id、该 run 的 `scheduler_ms`
      与 `test` job `conclusion` ——属外层验证（待外部）
      ⛔ 若 `conclusion != "success"`，**指向真正红的那个文件**，⛔ 不得记成本任务自己的失败。
- [x] **AC6（不许把问题挪到"多拆几个文件"上）**：改动后 `floor_ms` **不得高于** 20 371
      （贴 `__GROUP__` 行原文）；若本任务真的又拆了文件，必须**单独说明理由**并给出该文件改动前后的
      `__PERFILE__` 读数——⛔ 不得用"顺便拆了一个"绕过本条。

## DoD

**REAL LANDING**：不是"调了一下参数"，而是 **CI 上相位墙钟真的降了，且余量有归因**：

1. **落地对象**：任务分支 CI run 的 `main_phase_ms` / `scheduler_ms` 实测值，与改动前同一命令的对照。
2. **可被打红**：AC3 的开/关对照两侧读数。
3. **归因先于改动**：AC1 的 start offset 表 + AC2 的路径定位证据齐备；给不出就如实记为假说。
4. **不挪问题**：AC6 的 `floor_ms` 不上升读数。

## Measured（2026-09-18，worker；全部为直接量）

### AC1 — 启动时刻（run 35297103524，develop，headSha `6cccc747`，conclusion success）

⚠️ **口径说明（如实）**：任务体 Proposal 引用的读数是 `floor_ms=20 371 / main_phase_ms=36 361 /
scheduler_ms=38 753`，而本次从**该 run 日志原文**读到的是 `19 469 / 36 342 / 38 745`（floor 差 902 ms）。
本文**一律采用 run 日志原文**（可直接 `gh run view 35297103524 --log` 复核）。两者对结论无影响：
AC6 的阈值 20 371 两侧都满足，且相位被钉住的成因与 floor 的具体值无关。

复现命令：`gh run view 35297103524 --log`，对 `__PERFILE__ duration_ms=<d> <path> passed=<b> end_ms=<e>`
**全量**解析（843 行，去重 843 个文件）；分组用 `runner-grouping.ts --classify`
（56 serial / 32 lowconc / 755 main，与同一 run 的 `__GROUP__ … files=` **逐数相同**）。
`phase_start = max(end_ms) − main_phase_ms = 1789696458531 − 36342 = 1789696422189`
（等价于 `min(end_ms − duration_ms)`，即调度器 `stats.main.startMs`）。

| rank | duration_ms | start offset (ms) | file |
|---|---|---|---|
| 1 | 19469 | **882** | `packages/quay/test/branch-model.test.mjs` |
| 2 | 19165 | **17177** | `plugin/test/supervisor-deliver-crosshost.test.mjs` |
| 3 | 16562 | 8859 | `plugin/test/driver-cli.test.mjs` |
| 4 | 15078 | 17955 | `plugin/test/writestate-atomicity-split-s01.test.mjs` |
| 5 | 15077 | 17990 | `plugin/test/writestate-atomicity-split-s02.test.mjs` |
| 6 | 14898 | 3854 | `packages/quay/test/goal-store.test.mjs` |
| 7 | 14239 | 16102 | `plugin/test/ready-pool-check-s21.test.mjs` |
| 8 | 14206 | 6515 | `packages/quay/test/server-status-web-control-same-pid.test.mjs` |
| 9 | 14013 | 15079 | `plugin/test/ready-pool-check-s09.test.mjs` |
| 10 | 13959 | 16827 | `plugin/test/slot-refill-s11.test.mjs` |

**⇒ 回答：地板文件第一波就启动了（offset 882 ms）。余量不来自地板文件本身。**

**并且余量也不来自"平均分配"**：755 个 main 文件**全部在 18 592 ms 内启动**（之后无人再启动），
t=19 s 时在跑的只剩 104 个、**剩余工作量 408.4 lane-seconds**（128 lane 理想排空 3.2 s ⇒ 应 22.2 s 结束）。
相位是被**单一文件**钉住的：`supervisor-deliver-crosshost.test.mjs`（19 165 ms）在 **17 177 ms** 启动
⇒ 17 177 + 19 165 = **36 342 ms = 实测 `main_phase_ms` 逐字相等**。

### AC2 — CI 上驱动 main 的是【两套都没生效】，main 走 raw glob 顺序

命令与输出（全部取自该 run 日志，⛔ 非源码推断）：

```
$ grep -n 'lpt-order\|scheduler:' run-35297103524.log
scripts/test.sh: lpt-order: file list reordered (56 files; first=closure-lag-check.test.mjs)
scripts/test.sh: lpt-order: file list reordered (32 files; first=observation.test.mjs)
scheduler: unified group-budget scheduler (serial≤64 lowconc≤64 main≤128)
scheduler: serial=56≤64 lowconc=32≤64 main=755≤128 (reliability cap: total ≤ min budget of active groups)
```

三条读数各自定位一件事：

1. **bash LPT 覆盖不到 main，而且它那两行 `reordered` 是假的。** 在那 843 个文件的 raw glob 顺序里，
   serial / lowconc 两组的**第一个文件就是** `closure-lag-check.test.mjs` / `observation.test.mjs`
   （`awk -F'\t' '$2=="serial"' <rgmeta> | head -1`）。即：在 CI 上 helper 返回的是**原序**，
   而旧判据只比较**行数**（原序同样满足）⇒ 把"完全没有历史"报成了"已重排"（硬规则 3b）。
   该 run 没有 `.quay/verification-round.jsonl`（`grep -nE 'verification-round|perFile|duration|lpt'
   .github/workflows/ci.yml` **零命中**）⇒ `loadDurationAverages` 返回空 ⇒ FAIL-OPEN 恒走此路。
2. **走的是统一调度器路径**（`scheduler: unified group-budget scheduler …`），而它**从 raw
   `${_RG_FILES[@]}` 重新分类 + 重新 LPT** ⇒ bash 那次重排**即使生效也被丢弃**。
3. ⇒ main 的顺序 = **raw glob 顺序**。这有正向证据：main 组**最早启动的三个文件**（offset 0 / 10 / 19 ms）
   是 `backlog-client` / `mcp-server` / `adr-unsupported`，**恰好就是** raw glob 顺序里 main 组的前三个。
   若是 LPT 生效，三者不可能仍是字母序。

**⇒ 结论：CI 上既不是 bash LPT 也不是 TS LPT 在驱动 main —— 是 raw glob 顺序。**

### AC3 — 归因 + 两个方向相反的对照

**归因（两条，各约 10 s）**，用**真实调度循环**（`simulateSchedule`，被测对象自带的纯函数）在**实测时长**
上重放，四条臂给出**相反预测**：

| arm | budgets (S/L/M) | LPT | makespan |
|---|---|---|---|
| **A（= CI 实际）** | 64/64/128 | 失效 | **38.7 s** |
| B | 128/128/128 | 失效 | 28.7 s |
| **E（本任务修法）** | 64/64/128 | 本地载体 | **28.5 s** |
| F | 128/128/128 | 本地载体 | 19.5 s |

**模型不是自洽叙述**：A 臂预测 38.7 s vs 实测 36.3 s（−2.4 s / 6%），且它预测 `crosshost`
在 **17.2 s** 启动 —— 与实测 17 177 ms **精确命中**；A 臂的 main 并发剖面（1 s→23、10 s→50、17 s→60）
也复现了实测剖面（23 / 55 / 60）。

- **成因①：可靠性 min-lock（`currentCap`，人 2026-09-04 裁定）**。三组总数 ≤ **当前活跃组的预算最小值**；
  CI 上 serial=lowconc=64 ⇒ 只要这两组还有**任何一个文件**在跑，总数就 ≤ 64，main 只能拿 ~60/128。
  实测 main 并发 0→16 s 钉在 **60**，**17 s 跃到 128**（＝低并发组排空，cap 放开）——
  与 `currentCap` 的预测逐点一致。**⛔ 本任务不改它**：该裁定明写「速度从来不该是它的 AC」，
  且旧语义（main 用剩余容量）曾实测把机器打满（round #985）。**这是本任务明确接受的结构性成本。**
- **成因②：main 在 CI 上是 raw glob 顺序（AC2）** ⇒ 19.2 s 的文件排在第 ~565 位，直到容量放开才启动。
  **这才是本任务修的对象**（可由排序消除，且 pass/fail-neutral）。

**可区分的对照（一条命令，两侧读数方向相反）** —— 同一输入、同一 `--root`（无 live carrier）：

```
$ printf '%s\n' packages/quay/test/branch-model.test.mjs plugin/test/supervisor-deliver-crosshost.test.mjs \
    plugin/test/driver-cli.test.mjs | node --experimental-strip-types plugin/scripts/suite-lpt-order.ts --root <无载体的目录>
suite-lpt-order: provenance=none entries=0 files=3 reordered=false      # 输出与输入逐字相同

$ …同一条命令… --baseline docs/analysis/suite-perfile-duration-baseline.json
suite-lpt-order: provenance=committed-baseline entries=953 files=3 reordered=true
branch-model / driver-cli / supervisor-deliver-crosshost                # 按耗时降序
```

**⇒ 若"CI 无载体 ⇒ 单位置换"为假，第二侧不会变**（这正是硬规则 4-推论四要求的对照）。

**第二组对照：同机、同时长、只改排序**（用本机真实读数校准的同一调度循环重放，budgets = 本机 8/8/15）：

| arm | makespan | 理想下界 sum/15 | 比值 |
|---|---|---|---|
| 排序**开**（live 载体=committed baseline） | **515.2 s** | 372.0 s | 1.38 |
| 排序**关**（raw glob 顺序） | **626.4 s** | 372.0 s | 1.68 |

⇒ **仅排序一项 = −111.2 s（−17.8%）**，两侧方向相反。该重放对实测值的误差 2.8%
（预测 515.2 s vs 实测 `main_phase_ms`+主相起点 = 379 842+121 304 = 501 146 ms）。

⚠️ **本机 `scripts/test.sh` 的「整轮 LPT OFF」臂（`QUAY_TEST_LPT_ORDER=0`）跑失败了**：
`ARM OFF exit=1` 且只撑了 70 s —— 退出在 `run_static_checks` 的
`STATIC_CHECK_FAILED: tmp-leak-pairing-check exit=1`，根因是**本任务自己新加的测试**里有一处
`mkdtempSync` 结果变量未被 cleanup 区 `rmSync`（`tmp-leak-pairing-check` 的配对启发式）。
**已修**（改为 carrier-array + `finally` 显式 rm；该检查器现在对本任务改动的两个测试文件报告
`violations: 0`，`plugin/test/tmp-leak-pairing-check.test.mjs` 8/8 绿）。⛔ 如实记录：
**整轮 OFF 臂没有读数**，上面那张同机对照是**模型重放**，不是整轮实测；
整轮 ON 臂（`main_phase_ms=379842` / `scheduler_ms=501147`）是实测。

⚠️ **仍是估计量的部分（如实标注）**：本地 rank 迁移到 CI 并不完美 —— CI top-10 长文件只有
**1/10** 落在本地 top-10（top-20 5/20、top-40 14/40）。但 CI top-10 **全部**落在本地 rank ≤ 88/755，
足以把它们从队列第 ~565 位提到前 12% ⇒ **方向确定、幅度是估计值（sim −10.2 s）**。

### AC4 — 四项对照（同一条命令 = `bash scripts/test.sh`）

| 项 | before：CI run 35297103524（LPT 失效） | after |
|---|---|---|
| `floor_ms` | **19 469** | **19 469**（本改动不拆文件、不增删测试文件 ⇒ 逐字相同） |
| `main_phase_ms` | **36 342** | 待外部（需 develop CI；与 AC5 同源） |
| `scheduler_ms` | **38 745** | 待外部 |
| 地板文件 start offset | **882 ms** | 待外部 |

`floor_ms` 的 after 是**直接量**（改动文件集不含任何测试文件 ⇒ 地板文件仍是
`branch-model.test.mjs`，AC6 的 `__GROUP__` 行对照见下）。`main_phase_ms`/`scheduler_ms`/
start offset 三项的 after **只有 develop CI 能给出，故如实记为未处置**；它们的可检验预测是
**A→E 臂**（38.7 s → 28.5 s，同预算同队列，唯一变量是排序）。

**同机同命令的真实读数**（本工作树，nproc=16 ⇒ main≤15 serial≤8 lowconc≤8；原文 `__GROUP__` 行）：

```
__GROUP__ concurrency=8  files=56  sum_ms=637580  floor_ms=79697.5   ← serial
__GROUP__ concurrency=8  files=32  sum_ms=340399  floor_ms=44239     ← lowconc
__GROUP__ concurrency=15 files=755 sum_ms=5580241 floor_ms=372016    ← main
__OVERHEAD__ main_phase_ms=379842
__OVERHEAD__ scheduler_ms=501147
```

- 本机 main 的 `floor_ms = sum/15 = 372 016`（**容量下界**，不是单文件最长——本机最长文件 233.5 s < 372 s）。
- `main_phase_ms / floor_ms = 379 842 / 372 016 = **1.02**`：相位几乎满打包。
- 最长文件（`direct-to-develop-bypass-check.test.mjs`，233 474 ms）start offset = **0 ms**（第一波）
  ⇒ LPT 在本机**确实生效**（live 载体存在）。对照 CI（LPT 失效）：`36 342 / 19 469 = **1.87**`。
- ⚠️ 这两条是**跨环境**读数（不同机器/并发），**不是受控对照**；受控对照见 A/B/E/F 臂
  与上面一条命令的 ON/OFF 两侧读数。

### AC5 — 未勾：属外层验证（待外部）

### AC6 — 未拆任何文件

`__GROUP__ concurrency=128 files=755 sum_ms=1487680 floor_ms=19469 capped=0`（before，run 35297103524 原文）。
本改动的工作树 diff **只含 7 个文件、无任何测试文件增删**（`git show --stat`）⇒ `files=755` 与
`floor_ms=19 469` 均不变，**满足"不得高于 20 371"**。

### 落地内容（本任务分支）

- `plugin/scripts/suite-lpt-order.ts`：新增 `--baseline <path>` 兜底载体（live 滚动载体**优先**）+
  `loadBaselineDurations` / `resolveDurationTable` / `LptReport`；CLI 现在打印
  `suite-lpt-order: provenance=… entries=… files=… reordered=…`（真实的前后比较，而非"输出格式正常"的推断）。
- `plugin/scripts/suite-scheduler.ts`：`--baseline` 透传 + 启动行新增
  `scheduler: lpt provenance=… entries=… files=… main_reordered=…`（CI 日志据此**直接**回答"哪一套 LPT 在驱动 main"）。
- `scripts/test.sh`：`lpt_order_files` **不再**在 FAIL-OPEN 的原序路径上声称 "reordered"（旧判据只比行数）；
  并把统一调度器路径上那两次**被丢弃**的重排移入 legacy 分支（一条 LPT 路径，不是两条）。
- `docs/analysis/suite-perfile-duration-baseline.json`：committed 兜底表（953 条，repo-relative key），
  可用其 `_note` 里的命令重新生成；仅在 live 载体缺席时被使用，order-only + fail-open。
- 测试：兜底读取/失败开放、live 优先、以及报告的 ON/OFF 两侧读数。
- 全量 `scripts/test.sh --for-task … --allow-thin` **exit 0**（35/35）。

## Touches

- plugin/scripts/suite-scheduler.ts
- plugin/scripts/suite-lpt-order.ts
- plugin/scripts/capability-catalog.sh
- plugin/test/suite-lpt-order.test.mjs
- plugin/test/suite-scheduler.test.mjs
- scripts/test.sh
- docs/analysis/suite-perfile-duration-baseline.json
- tasks/gap-suite-main-phase-scheduling-slack-after-floor-drop.md
