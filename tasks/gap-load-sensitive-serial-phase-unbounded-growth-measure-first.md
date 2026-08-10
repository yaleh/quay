---
id: gap-load-sensitive-serial-phase-unbounded-growth-measure-first
title: KNOWN-LOAD-SENSITIVE 标注只进不出、串行相零并行度快速扩容⇒套件轮时长被推高(48h 900-1100s→1847s,标注 3
  倍加速,nproc 未变)；与绿快照活锁同根；处方=③ measure-first 对照实验(串行相内部并发
  2)+②退出机制(根因修完复核标注)+①实验通过则上调默认并发；round-206 AC6 25s 窗超时是活实例
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**KNOWN-LOAD-SENSITIVE 标注过去 5 天 18 次（均速 3.6 次/天）、今晚 10 小时 5 次（12 次/天，3 倍加速）——但 nproc 全程未变（=4）。套件轮时长被「只进不出」的串行相/负载敏感相快速推高：绿轮 1836-1847s（30.8min）vs 早期（08-09 02:57-08:31）典型 900-1100s。每修一个 load-flake，标准处置是加标注挪进串行相，而串行相内部零并行度，每加一个测试线性加墙钟。这直接拉大套件轮时长与 integration 提交节奏（中位 147s）的差距——正是绿快照活锁（gap-merge-green-snapshot-verified-commit-livelock）的推手之一。两条配套处方：①串行相/负载敏感相内部给个小并发（如 2）而非 1；②**串行相要有退出机制（人明确要求，硬约束）**——load-flake 标注后通常跟着真实根因修复，根因修完该测试是否还需留在串行相，从没人回头复核。底线（③）：先跑对照实验拿到真实数字再改默认——gap-suite-cost-model-is-wrong-optimizations-buy-nothing 的教训（墙钟差异落 17-63s 噪声带）是真的。**

### 实证（manager 2026-08-10 核实 + 更正 + outer 复核）

- **48h 趋势**：早期（08-09 02:57-08:31）绿轮典型 900-1100s；今晚（21:49-23:35）绿轮定格 1836-1847s（30.8min）。
- **数据读法（注意）**：round 记录的 tests/durationMs 是**触发终态那条 lane 的读数**，不是全套件汇总——红轮报先失败的并发相（~700-1050s/~3100 测试），绿轮报最后完成的串行相（测试少但慢），不能直接比 per-test；**轮次总时长可比**。
- **并发证据更正（manager 2026-08-10，比我上一条说的薄）**：
  - 「nproc=4 是墙钟甜点」来自 AC5 cost-side experiment——那是个 **selected set（较小样本）**，不是全量套件。**真实生产证据**：laneCount 历史分布 8 用了 28 轮 / 4 用了 72 轮 / 1 用了 25 轮，切换点是 916b1feb（08-08 16:56 "AC5 cost-side experiment, land concurrency default to nproc"）。
  - **切换前 28 轮里 5 次真实绿轮**（105/120/123/125/138）durationMs **718-893s**，0 cancelled。
  - **切换后 4-lane 真绿轮**（141/142/145/146/153/157/158 时代 896-1024s；170/171/176/204 时代 **1573-2480s**），0 cancelled——**两组区间基本重叠且近期更慢，没有「4 更快」的清楚证据**；近期 2-3× 变慢是串行相扩容（本任务主题），不是 lane count。
  - ⇒ **main 组该不该继续用 4，证据基础薄**——历史 8 是有 28 轮真实生产验证的。这个更正不改「本任务 ③ measure-first」的结论，反而**强化**它：连当前默认并发本身都没有坚实的全量证据，改任何值都必须先测。
- **串行相退出机制（人明确要求）**：每条 KNOWN-LOAD-SENSITIVE/serial 标注应记录**【进入原因 + 进入时间】**，定期（每 N 轮或每周）复核该测试当初的 flake 根因是否已修——已修的应尝试退回原并发相验证，**不是永久留在串行相**。
- **round-206 现场证据**：`session-liveness-signals.test.mjs` AC6 negative control（busy-mask 新增测试，e392ec9e）——round-204 同树绿过、solo 6.4s，套件内 29.5s = 25s `waitForOutput` 窗超时（5 个 tmux-heavy 文件在 lowconc 相并发抢资源）。这是「负载敏感相扩容」的活实例。

**为什么重要**：这不是单点 flake，是套件轮时长被负载敏感相**结构性推高**——直接放大绿快照活锁。若不管，每修一个 flake 套件变慢一分，活锁更紧一分。

### 选定机制方向（实现归内层，接法留执行时）

1. **对照实验（③ 前置，measure-first）**：跑一次「串行相内部并发=2」对照——测 0-cancelled 是否保持 + 墙钟是否下降，拿到真实数字再决定改默认。**因并发证据已被更正为薄，实验更要覆盖 main 相 lane=4 vs 8 的对照**（8-lane 有 28 轮生产验证、真绿 718-893s；4-lane 真绿近轮 1573-2480s——lane 数本身也该测，不预设 4 是对）。
2. **串行相内部小并发**：若实验确认 0-cancelled，串行相（及 lowconc 相）内部给并发 2（或测得的最优值）而非 1。
3. **退出机制（人明确要求，硬约束）**：每条 KNOWN-LOAD-SENSITIVE/serial 标注记录【进入原因 + 进入时间】；定期（每 N 轮或每周）复核该测试的 flake 根因是否已修；已修的尝试退回原并发相验证，不永久留在串行相。
4. **本次 AC6 窗超时的应急**：25s waitForOutput 窗在 lowconc 相并发下不够（实测 29.5s）——宽到 40-60s 或按实验后新的并发配置重测。

**验证锚**：修后 (a) 对照实验贴数字（串行相并发 2 的 0-cancelled + 墙钟 vs 并发 1；main 相 lane 4 vs 8 若测）；(b) 若实验通过，串行相/负载敏感相默认并发上调；(c) **退出机制接线（每条标注有进入原因+时间，复核钩子存在，已修测试有退回验证记录）**；(d) AC6 negative control 套件内不再 25s 超时。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录量化（48h 趋势 900-1100s→1847s、标注 18 次/5 天 vs 5 次/10h、round-206 AC6 25s 窗超时现场、并发证据更正版）（本任务 Proposal 已含）
- [ ] AC2: **对照实验**——串行相内部并发=2 vs =1 的对照：0-cancelled 保持 + 墙钟数字（贴任务体）；若可行，补 main 相 lane=4 vs 8 对照（8-lane 28 轮生产证据 vs 4-lane 近轮更慢）
- [ ] AC3: **默认并发上调（若实验通过）**——串行相/负载敏感相默认并发从 1 调至实验测得最优（≥2）
- [x] AC4: **退出机制（人明确要求）**——每条 KNOWN-LOAD-SENSITIVE/serial 标注记录【进入原因+进入时间】；定期（每 N 轮或每周）复核根因是否已修；已修的尝试退回原并发相验证（不永久留串行相）；复核钩子可机械检查
- [x] AC5: **AC6 窗超时修复**——session-liveness-signals AC6 negative control 套件内不再 25s 超时（宽窗或新并发下重测）
- [ ] AC6: **既有不回归**——`--for-task` scoped 门绿；0-cancelled 保持

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] 对照实验数字贴任务体（串行相并发 2 的墙钟 + 0-cancelled；main lane 4 vs 8 若测）
- [ ] 退出机制实跑：至少 1 条已修根因的标注测试退回原并发相验证通过（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（串行相/负载敏感相内部并发参数：默认 1 → 实验测得值；--serial-concurrency / --lowconc-concurrency 透传 QUAY_SERIAL_CONCURRENCY / QUAY_LOWCONC_CONCURRENCY）
- plugin/scripts/known-load-sensitive.ts（退出机制：@load-sensitive-entry 标注【进入原因+进入时间】+ --list-entry/--check-exit 复核钩子）
- scripts/test.sh（串行相 / lowconc 相并发参数 SERIAL_CONCURRENCY / LOWCONC_CONCURRENCY——默认 1/3，env 可覆盖）
- plugin/test/session-liveness-signals.test.mjs（AC6 negative control 25s 窗 → 60s）
- plugin/test/full-suite-runner.test.mjs（AC2/AC3 并发参数透传 + 失败关闭测试）
- plugin/test/known-load-sensitive.test.mjs（AC4 退出机制解析/检查/CLI 测试）
- plugin/test/runner-grouping.test.mjs（serial 相结构 pin 更新为 env 驱动）
- tasks/gap-load-sensitive-serial-phase-unbounded-growth-measure-first.md（自身：勾 AC + 贴实验数字）

> 注：21 个 serial 组 family member 的 `@load-sensitive-entry` 是**注释级**改动（每文件一行），不在此逐一列
> 为 Touches——它们由 `plugin/test/known-load-sensitive.test.mjs` 的 AC4 机制测试 + `--check-exit`
> 不变量机械覆盖（每个 serial 组 family member 必须有 entry 记录）。把它们放进 scoped 门会让 21 个
> 负载敏感文件在 c4 并发下跑，反而引入 flake 假回归，故 scoped 门不选它们（全量套件门覆盖）。
> 交叉标注任务：gap-merge-green-snapshot-verified-commit-livelock / gap-suite-cost-model-is-wrong-
> optimizations-buy-nothing / gap-session-liveness-busy-mask-idle-with-subagents /
> gap-serial-group-recompose-nested-runner-criterion / gap-load-sensitive-session-family-confounds-
> step-three / gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive /
> gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles /
> gap-suite-concurrency-4-vs-8-measurement / gap-serial-phase-install-test-residue-dependency /
> gap-relation-sync-load-flake-child-spawn-under-suite（见 Proposal/实现记录，不占 Touches 测试分辨率）。

## Test-Files

- plugin/test/full-suite-runner.test.mjs
- plugin/test/known-load-sensitive.test.mjs
- plugin/test/session-liveness-signals.test.mjs
- plugin/test/runner-grouping.test.mjs
- plugin/test/resource-gate.test.mjs

## 实现记录（inner 2026-08-10）

**机制（已提交部分，AC4/AC5/AC6 实装）：**

1. **串行相/负载敏感相并发参数（AC2/AC3 的旋钮，measure-first）**：
   - `scripts/test.sh`：`SERIAL_CONCURRENCY="${QUAY_SERIAL_CONCURRENCY:-1}"`、`LOWCONC_CONCURRENCY="${QUAY_LOWCONC_CONCURRENCY:-3}"`——串行相、lowconc 相、`--group serial/lowconc` 四个执行点全部读 env；**默认仍 1/3**，实验通过前不上调。
   - `plugin/scripts/full-suite-runner.ts`：新增 `--serial-concurrency` / `--lowconc-concurrency`（默认 1/3），透传为 `QUAY_SERIAL_CONCURRENCY` / `QUAY_LOWCONC_CONCURRENCY` 到子进程 env；非法值（0/非数字/负）fail-closed。Contract measure `grep -n "serial" ... | grep -i concurrency` 命中 `DEFAULT_SERIAL_CONCURRENCY = 1`。
   - `plugin/test/full-suite-runner.test.mjs` AC2/AC3：默认 1/3 透传、覆盖值透传、非法值 fail-closed 三条测试。
   - `plugin/test/runner-grouping.test.mjs` serial 结构 pin 更新为 `--test-concurrency="$SERIAL_CONCURRENCY"` + 默认 1 断言。

2. **退出机制（AC4，人明确要求）**：
   - `plugin/scripts/known-load-sensitive.ts`：新增 `// @load-sensitive-entry <YYYY-MM-DD> <reason>` 伴生标注（同文件族头），`parseLoadSensitiveEntry` / `scanFamily` 携带 entry；`isSerialGroupFile` 判 serial 组；`checkSerialEntries` = 每个 serial 组 family member 必须有 entry（机械复核钩子）；CLI `--list-entry`（按 entry 日期升序 = 最长留串行相优先复核）与 `--check-exit`（缺 entry 即 fail）。
   - 21 个 serial 组 family member 全部补 `@load-sensitive-entry`（日期按 admission commit 定，reason 摘自各自头部 KNOWN-LOAD-SENSITIVE 文档）。
   - `plugin/test/known-load-sensitive.test.mjs` AC4：解析/检查/负控制/CLI/真实仓 check-exit 全绿（22 测试）。

3. **AC6 窗超时修复（AC5）**：`plugin/test/session-liveness-signals.test.mjs` 全部 5 处 `25000` RESUMED 窗 → `60000`（round-206 AC6 negative control 实测 29.5s > 25s 窗）；注释同步更新。

**对照实验（AC2，待跑）**：串行相内部并发=2 vs =1，贴墙钟 + cancelled。**AC3 默认上调待实验 0-cancelled 确认后落地。**

## Contract

measure   serial_phase_internal_concurrency = `grep -n "serial" plugin/scripts/full-suite-runner.ts | grep -i "concurrency"` 后的默认值
band      serial_phase_internal_concurrency >= 2（若 AC2 实验 0-cancelled 成立）
invariant zero_cancelled_preserved = 1（对照实验 + 修后套件均 0 cancelled）
invariant ac6_negative_control_no_25s_timeout = 1（套件内该测试不再 25s 超时）
invariant measure_first_noise_band_respected = 1（改默认前有对照实验数字，非盲改）
invariant load_sensitive_exit_reviewed = 1（每条标注有【进入原因+进入时间】+ 复核钩子存在）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root <repo> --lane-count 4 --state-dir .quay --log-file /tmp/full-suite-exp.log`（串行相并发 2 对照实验，贴墙钟 + cancelled）
control   对照实验数字在档；0-cancelled 保持；AC6 不再超时；退出机制接线；既有不回归
resume    对照实验 / 并发上调 / 退出机制 / AC6 窗修分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 套件耗时分析（48h 900-1100s→1847s + 标注 3 倍加速 + 串行相只进不出）⇒ 立案。三条建议裁定：①串行相内部并发 2 值得测（③ 前置）；②退出机制真缺，接线；③改默认前先测。round-206 AC6 25s 窗超时是活实例。**manager 更正 2026-08-10：nproc=4 甜点来自 selected-set 实验，生产证据薄（8-lane 28 轮真绿 718-893s vs 4-lane 近轮 1573-2480s，无「4 更快」证据）——更正强化 measure-first，main 相 lane 数也该测。退出机制升级为人明确要求的硬约束（进入原因+进入时间+定期复核+退回验证）。** 实现归内层
