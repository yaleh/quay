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

- [ ] **AC1（先量启动时刻，再谈成因）**：贴出耗时**前 10 名**文件的 `(duration_ms, start offset)` 表，
      并给出计算式（`start = end_ms − duration_ms − phase_start`）与所用 run id；
      据此明确回答「**地板文件第一波是否启动**」。⛔ 不跳过这一步直接改代码。
- [ ] **AC2（哪一套 LPT 在驱动 main，有定位证据）**：贴出判定 CI 上 main 由
      `scripts/test.sh` 的 bash LPT 还是 `suite-scheduler.ts` 的 TS LPT 驱动的**命令与输出**；
      ⛔ 只贴源码不算——要有 CI 运行时的读数。
- [ ] **AC3（归因带可区分的对照）**：给出归因，**并**给出一个「若该成因不成立则结果会不同」的对照
      （开/关该机制各一次，或两个相反预测各测一次），贴两侧读数。⛔ 给不出 ⇒ 如实记为**假说**。
- [ ] **AC4（改动前后同一测量对照）**：同一条命令的改动前后 `floor_ms` / `main_phase_ms` /
      `scheduler_ms` / 地板文件 start offset 四项对照；⛔ 无对照的项记为未处置。
- [ ] **AC5（生产面兑现，外层验证）**：落地并触发 develop CI 后贴出 run id、该 run 的 `scheduler_ms`
      与 `test` job `conclusion` ——属外层验证（待外部）
      ⛔ 若 `conclusion != "success"`，**指向真正红的那个文件**，⛔ 不得记成本任务自己的失败。
- [ ] **AC6（不许把问题挪到"多拆几个文件"上）**：改动后 `floor_ms` **不得高于** 20 371
      （贴 `__GROUP__` 行原文）；若本任务真的又拆了文件，必须**单独说明理由**并给出该文件改动前后的
      `__PERFILE__` 读数——⛔ 不得用"顺便拆了一个"绕过本条。

## DoD

**REAL LANDING**：不是"调了一下参数"，而是 **CI 上相位墙钟真的降了，且余量有归因**：

1. **落地对象**：任务分支 CI run 的 `main_phase_ms` / `scheduler_ms` 实测值，与改动前同一命令的对照。
2. **可被打红**：AC3 的开/关对照两侧读数。
3. **归因先于改动**：AC1 的 start offset 表 + AC2 的路径定位证据齐备；给不出就如实记为假说。
4. **不挪问题**：AC6 的 `floor_ms` 不上升读数。

## Touches

- plugin/scripts/suite-scheduler.ts
- plugin/scripts/suite-lpt-order.ts
- scripts/test.sh
- tasks/gap-suite-main-phase-scheduling-slack-after-floor-drop.md
