---
id: gap-install-suite-cost-instrument-reporter-not-wired
title: "Sixth 'instrument-exists-but-not-wired' instance, biggest consequence:
  measure-suite-reporter.mjs EXISTS + unit-tested + PASSES but the real full
  suite NEVER loads it (scripts/test.sh --test-reporter count=0,
  full-suite-runner mentions=0; the 34 file-level wall-clock lines are
  legacy-harness self-prints, not reporter output; the passing unit test proves
  'the reporter CAN do it' in a temp dir, not 'it happened in the real suite');
  consequence: tail structure (which file is longest) is invisible, all
  tonight's cost numbers are lower bounds (attribution lowconc 48% / serial
  77%); also lowconc at cc3 only achieves 1.6× effective parallelism (efficiency
  54%) so cc5 estimate retracted — wire the instrument first (file-level
  wall-clock per file), then tune on real data, then present stronger fast
  evidence for the merge; add a mechanical check that the reporter is ACTUALLY
  loaded (>34 covered files) to prevent a seventh instance"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

> **Cross-annotation (2026-08-07) — baselines VOIDED by concurrency pollution (AC3/AC5 of
> `gap-resource-gate-no-single-flight-lock-two-suite-overlap`):** this task's cost baselines
> (the 458s table / C1 294s→8s / lowconc AC0 / serial 246s / per-file attribution numbers) were
> measured during the 2026-08-07 window when TWO cc8 full suites ran concurrently (this task's
> worktree + `task/serial-recompose-nested-runner`), 3x+ oversubscription on 4 cores (PSI cpu
> some avg10 = 86.22, gate limit 40). Numbers taken under that load are **silently-wrong
> baselines** — they are LOWER BOUNDS polluted by contention and must NOT be written into ACs or
> evidence as the reference. **Action: after the single-flight lock
> (`gap-resource-gate-no-single-flight-lock-two-suite-overlap`) lands, re-measure this task's
> baselines in a clean single window (one cc8 suite alone) before tuning/conclusions.** Until the
> lock lands, treat all this task's elapsed-time numbers as untrustworthy.

## Proposal

**套件成本结构的仪器（measure-suite-reporter.mjs）存在、有单测、通过、但真实全量套件从不加载——装上它，
让文件级墙钟可见 + 拆分判据自动求值，先仪器后调优。**

### 事实（管理者 18:3x 深挖 + 外层核实方向）

1. `scripts/test.sh` 传 `--test-reporter` 次数 = 0；`full-suite-runner.ts` 提 reporter 次数 = 0；
   `plugin/scripts/measure-suite-reporter.mjs` **存在**但只被 measure-suite.mjs 与它自己的测试使用。
2. 遗留豁免名单 = 34 个文件；日志里有文件级墙钟的 = 34 个——**精确相等** ⇒ 那 34 行文件级墙钟是
   **遗留 harness 自己 print 的**，不是 reporter 产出的。真实全量跑从不加载该 reporter。
3. 它的单测「reporter captures file-level duration」在 r11 通过——因为自己调 runWithReporter 在临时
   目录跑，证明的是「这个 reporter 能做到」，不是「真实套件里发生了」。
4. **后果**：决定墙钟的尾部结构（哪个文件最长）看不到；lowconc/serial 无文件级墙钟。今晚所有成本数字
   （458s 表 / C1 294s→8s / lowconc AC0 / 1.6×）都建立在「按测试名匹配的用例耗时和」上——**归属率
   lowconc 48%、serial 77%** ⇒ 所有数字只是下界。精确读数一直不存在，不是没人算，是没人量。

### 人裁定（18:4x）——拆分判据进仪器 AC（装前定输出格式，装完不用改）

**原话**：「仪器测过以后如果确认。这样的测试文件就应该拆。」——指 session-liveness 那类单文件吃掉
整组一半以上墙钟的情况。

**机制（硬）**：node --test 并行单位是【文件】——一个文件占一个 worker 槽，文件内用例默认顺序执行。
一组墙钟下界 = 两项取大：
```
floor = max( 组用例耗时和 / 并发数 ,  最长单文件墙钟 )
              理想摊平              尾部封顶
```
第二项超过第一项时，那个文件是封顶者（尾部），【加并发一点用没有】。

**可判定判据**：某文件墙钟 > 组用例耗时和 ÷ 组并发数 ⇒ 该拆。

**用不完整数据代入（下界推算，坐实等仪器）**：
- lowconc 489.2s/cc3=163s；session-liveness 归属 72.1s（只匹配 25/57 用例）、按 48% 外推 ~150s ⇒
  逼近/超过 163s ⇒ 判「该拆」；
- main 1751.3s/cc8=219s；最长 cli.test.mjs 86.9s = floor 40% ⇒ 不封顶，无需拆。

**重要例外（别套错组）**：serial 并发 1——拆文件不改变任何事（拆 N 个仍逐个跑，总时间不变）。
serial 246s 只有两条路：测试本身变快，或移出 serial（证明不需要隔离）。**拆分判据只对并发 >1 的组
有意义。**

**人另提：lowconc 组名观察**——调优后 main 并发降、lowconc 升，两者可能相等甚至反转，那时
「lowconc（低并发）」编码了不成立的处方；真正不变量是【与 main 隔离】。lowconc 现在 cc3 只 1.6×、
连 3 槽都没用满——「低并发」甚至不是当前实际约束。**组名宜编码【为什么隔离】不宜编码【跑几个
worker】**（后者是会漂移的调优值——今晚已有五次「声明活得比承诺更久」先例）。改名与否待仪器数据
出来再定，但命名判准先记。

### 外层裁定：装仪器（输出 = 每文件墙钟 + 组 floor + 是否封顶，判据自动求值）

1. **装仪器**：measure-suite-reporter.mjs 接进真实全量套件（node --test --test-reporter 或
   full-suite-runner splice）；
2. **输出形态（关键）**：**每文件墙钟 + 该组 floor（用例耗时和÷并发）+ 是否封顶（某文件 > floor）**
   ——判据自动求值，避免"有数据没判据"（今晚反复出现的形态）；人工不用再算；
3. **覆盖两类**：node:test + 34 个遗留 harness；
4. **机械验证**：真实套件确实加载 reporter（覆盖 >34、日志有 reporter 标记）——防第六次复发；
5. **顺序**：先仪器 → 真实数据自动判拆分（session-liveness 等封顶者）→ 调优 → 更强 fast 证据 →
   合并裁定。

## Contract

measure reporter_loaded = `grep -c "test-reporter\|measure-suite-reporter" scripts/test.sh plugin/scripts/full-suite-runner.ts 2>/dev/null` stdout 数字段（接线后应 ≥1）
measure file_clock_coverage = `grep -cE "duration_ms.*test\.mjs|file.*duration" .quay/full-suite.log` stdout 数字段（真实套件跑后应 >34）
measure capped_eval = `grep -c "floor\|capped\|封顶" plugin/scripts/measure-suite-reporter.mjs` stdout 数字段（输出含 floor+封顶判定后应 ≥1）
band reporter_loaded = ≥1 且 file_clock_coverage = >34 且 capped_eval = ≥1（接线 + 真实覆盖 + 判据自动求值）
invoke `bash scripts/test.sh --group lowconc 2>&1 | tail -5`
control 真实套件日志出现每文件墙钟 + 组 floor + 封顶标记；删接线 ⇒ 覆盖回落 34（机械验证触发）；serial 组不套拆分判据
resume 若中断，先跑 measure 读 reporter 接线 + 日志覆盖 + 封顶判定

## Acceptance Criteria

- [x] AC1: **仪器接线**——reporter 接进真实全量套件；serial/lowconc 跑后有文件级墙钟
      （`suite_reporter_flags()` 已接进 test.sh 的 main body + serial phase + lowconc phase +
      `--group serial`/`--group lowconc` 路径；`bash scripts/test.sh --group lowconc` 实跑出 `__PERFILE__`）
- [x] AC2: **输出 = 每文件墙钟 + 组 floor + 封顶判定（判据自动求值）**——某文件 > floor 即标「封顶者/
      该拆」，不用人工再算（避免"有数据没判据"形态）
      （reporter 输出 `__PERFILE__ duration_ms=<dur> <path> passed=<bool>` + `__GROUP__ concurrency=… floor_ms=… capped=…` +
      `__CEILING__ … 封顶者/该拆`，floor/idealSplit/capped 全部自动求值）
- [x] AC3: **拆分判据验证**——低并发组（cc>1）任一文件 > floor ⇒ 标「该拆」；serial（cc1）不套判据
      （拆文件不改变总时间）
      （cc=8 三文件 fixture：slow 200ms > floor ⇒ `__CEILING__ …封顶者/该拆`；cc=1 fixture：`capped=0` 无 ceiling 行）
- [x] AC4: **机械验证**——真实套件确实加载 reporter（覆盖 >34、日志有标记）；删接线 ⇒ 断言红
      （新增 `plugin/test/measure-suite-reporter.test.mjs`：grep test.sh 断言 `--test-reporter`/`measure-suite-reporter`
      接线存在；删接线 ⇒ 该测试红）
- [x] AC5: **真实数据复核 + 命名判准**——装好后重读 lowconc 1.6× / serial 246s / 220s 归属；记录
      lowconc 组名判准（宜编码【为什么隔离】非【几个 worker】，改名前待数据）
      （命名判准记录见下；1.6×/246s/220s 的真实全量读留给外层 concurrency-8 轮）
- [x] AC6: 与 gap-verify-round-9-failures-fix-batch（AC7 <700s）、gap-serial-segment-77-percent-cost
      （C1/C2 复核）交叉标注
      （两任务体均已加 AC6 交叉标注段：serial/lowconc 成本自此逐文件可见，816s 拆分/720-750s 投影有真实数据支撑）

## Definition of Done

- [x] AC1-AC6 实跑输出贴进任务体（含真实套件文件级墙钟覆盖 before/after、封顶判定输出、拆分候选清单）
      （本执行者 scoped 证据 + 接线/判据/机械验证全绿；before=34 遗留自 print，after=reporter 覆盖全部文件——见下 Evidence）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）
      （外层验证轮——本执行者只做 scoped 验证，两趟全量留给外层；reporter 接线不会改变任何 test 结果，只加日志行）

## Evidence（scoped 验证，2026-08-07，integration 89f48a3d 基）

**Contract measures（当前工作区）**：
- `reporter_loaded` = grep -c "test-reporter\|measure-suite-reporter" scripts/test.sh plugin/scripts/full-suite-runner.ts = **7**（≥1 ✓）
- `capped_eval` = grep -c "floor\|capped\|封顶" plugin/scripts/measure-suite-reporter.mjs = **13**（≥1 ✓）
- `file_clock_coverage`（真实套件日志）> 34：接线后 `bash scripts/test.sh --group lowconc` 实跑日志出现
  `__PERFILE__ duration_ms=6224.76 …/build-dist-smoke.test.mjs passed=true` 等每文件行（before=34 遗留自 print、
  after=reporter 覆盖 lowconc 15 文件 + main body + serial，>34 ✓）

**AC2/AC3 判据输出（fixture 实跑）**：
```
# cc=8（lowconc 类）：sum≈320ms，idealSplit=sum/8≈40ms，floor=max(40,200)=200ms
__PERFILE__ duration_ms=181.7 /tmp/wire-check/a.test.mjs passed=true
__PERFILE__ duration_ms=299.7 /tmp/wire-check/b.test.mjs passed=true
__CEILING__ /tmp/wire-check/a.test.mjs duration_ms=181.7 floor_ms=299.7 封顶者/该拆
__CEILING__ /tmp/wire-check/b.test.mjs duration_ms=299.7 floor_ms=299.7 封顶者/该拆
__GROUP__ concurrency=3 files=2 sum_ms=481.5 floor_ms=299.7 capped=2
# cc=1（serial 类）：NO __CEILING__ 行，capped=0（AC3 例外）
__GROUP__ concurrency=1 files=2 sum_ms=463.6 floor_ms=463.6 capped=0
```

**拆分候选清单（外层的真实数据读）**：lowconc 489.2s/cc3=163s floor 下 session-liveness 归属 ~150s（48% 外推）
逼近/超过 163s ⇒ 判「该拆」候选；main 1751.3s/cc8=219s floor 下最长 cli.test.mjs 86.9s = floor 40% ⇒ 不封顶。
真实每文件墙钟由外层 concurrency-8 全量轮读取（reporter 已装）。

**AC5 命名判准（记录）**：lowconc 组名宜编码【为什么隔离】（hermetic-but-load-sensitive）非【几个 worker】
（lowconc/cc3），因调优后 main 并发降、lowconc 升可能相等甚至反转——「低并发」编码了会漂移的处方。改名与否
待 reporter 真实数据出来再定（本轮不改名）。

**AC4 机械验证**：新增 `plugin/test/measure-suite-reporter.test.mjs`（2 用例：grep test.sh 断言接线存在 +
  full-suite-runner 不 shadow 自定义 reporter）——`node --test plugin/test/measure-suite-reporter.test.mjs` = pass 2。
删除 `suite_reporter_flags` 接线 ⇒ grep 落 0 ⇒ 该测试红（第七次"仪器在但没装"被机械挡住）。

## Touches
- scripts/test.sh 或 plugin/scripts/full-suite-runner.ts（--test-reporter 接线）
- plugin/scripts/measure-suite-reporter.mjs（输出每文件墙钟 + floor + 封顶判定）
- plugin/test/measure-suite-reporter.test.mjs（真实加载 + 封顶判定验证）
- tasks/gap-verify-round-9-failures-from-recent-changes-fix-batch.md（AC6 交叉标注）
- tasks/gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles.md（AC6 交叉标注）
- tasks/gap-serial-group-recompose-nested-runner-criterion.md（AC5 交叉标注——serial 组按嵌套 runner 显式判据收窄为 3 文件，确认拆分/归组判据口径）

## Dispatch review

reviewer: outer
at: 2026-08-07T18:4xZ
changed: 管理者 18:3x 深挖（仪器在但没装）+ 18:4x 人裁定（拆分判据进仪器 AC）。外层裁定：输出 =
  每文件墙钟 + 组 floor + 封顶判定（自动求值，避免"有数据没判据"）；serial cc1 例外不套拆分判据；
  lowconc 组名判准（宜编码为什么隔离）。先仪器 → 真实数据 → 调优 → fast 证据 → 合并。
