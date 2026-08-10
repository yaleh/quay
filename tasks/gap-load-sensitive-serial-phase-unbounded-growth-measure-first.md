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

**KNOWN-LOAD-SENSITIVE 标注过去 5 天 18 次（均速 3.6 次/天）、今晚 10 小时 5 次（12 次/天，3 倍加速）——但 nproc 全程未变（=4）。套件轮时长被「只进不出」的串行相/负载敏感相快速推高：绿轮 1836-1847s（30.8min）vs 早期（08-09 02:57-08:31）典型 900-1100s。每修一个 load-flake，标准处置是加标注挪进串行相，而串行相内部零并行度，每加一个测试线性加墙钟。这直接拉大套件轮时长与 integration 提交节奏（中位 147s）的差距——正是绿快照活锁（gap-merge-green-snapshot-verified-commit-livelock）的推手之一。两条配套处方：①串行相/负载敏感相内部给个小并发（如 2）而非 1——历史实验（并发=nproc 甜点、cancel 不是问题）没有理由只适用主相；②串行相要有退出机制——load-flake 标注后通常跟着真实根因修复（今晚 watchdog、KNOWN-LOAD-SENSITIVE glob 缺口都是真 bug），根因修完该测试是否还需留在串行相，从没人回头复核。底线（③）：先跑一次串行相内部并发=2 的对照实验拿到真实数字，再决定改默认——gap-suite-cost-model-is-wrong-optimizations-buy-nothing 的教训（墙钟差异落在 17-63s 噪声带）是真的。**

### 实证（manager 2026-08-10 核实 + outer 复核）

- **48h 趋势**：早期（08-09 02:57-08:31）绿轮典型 900-1100s；今晚（21:49-23:35）绿轮定格 1836-1847s（30.8min）。
- **数据读法（注意）**：round 记录的 tests/durationMs 是**触发终态那条 lane 的读数**，不是全套件汇总——红轮报先失败的并发相（~700-1050s/~3100 测试），绿轮报最后完成的串行相（测试少但慢），不能直接比 per-test；**轮次总时长可比**。
- **历史唯一证明有效的优化**：并发从硬编码 8 改为按 nproc 推导（8 workers 在 4 核 = 4.25× 超订 / 17 进程；08-08 成本实验实测并发 4 和 8 的 cancelled 均 0，「避免 cancel 需更高并发」被推翻；现为 max(1, floor((nproc-in_use)/1.0)) 预算感知推导）。同源第二招：负载敏感测试挪进独立串行相。
- **重要反面记录**：`gap-suite-cost-model-is-wrong-optimizations-buy-nothing` —— 其它优化尝试实测墙钟差异落 17-63s 噪声带，等于没有可用数字。**不是所有看起来合理的优化都真省时间。**
- **为什么现在又慢（量化）**：KNOWN-LOAD-SENSITIVE 标注提交——过去 5 天 18 次（3.6 次/天），今晚最近 10 小时 5 次（12 次/天，3 倍加速）。nproc 未变（=4），**是串行相在快速扩容**——每修一个 load-flake 加标注挪进串行相，串行相零并行度，每加一个测试线性加墙钟。
- **round-206 现场证据**：`session-liveness-signals.test.mjs` AC6 negative control（busy-mask 新增测试，e392ec9e）——round-204 同树绿过、solo 6.4s，套件内 29.5s = 25s `waitForOutput` 窗超时（5 个 tmux-heavy 文件在 lowconc 相并发抢资源）。这是「负载敏感相扩容」的活实例。

**为什么重要**：这不是单点 flake，是套件轮时长被负载敏感相**结构性推高**——直接放大绿快照活锁。若不管，每修一个 flake 套件变慢一分，活锁更紧一分。

### 选定机制方向（实现归内层，接法留执行时）

1. **对照实验（③ 前置，measure-first）**：跑一次「串行相内部并发=2」对照——测 0-cancelled 是否保持 + 墙钟是否下降，拿到真实数字再决定改默认。gap-suite-cost-model 教训：**先在实验里测，再改默认值**。
2. **串行相内部小并发**：若实验确认 0-cancelled，串行相（及 lowconc 相）内部给并发 2（或测得的最优值）而非 1——负载敏感相内部冲突通常是与并发相抢资源，不一定是内部互相冲突。
3. **退出机制**：load-flake 标注后真实根因修复落地时，回头复核该测试是否还需留在串行相——加一个「根因修复 ⇒ 复核标注」的机械钩子（或 review 清单）。
4. **本次 AC6 窗超时的应急**：25s waitForOutput 窗在 lowconc 相并发下不够（实测 29.5s）——宽到 40-60s 或按实验后新的并发配置重测。

**验证锚**：修后 (a) 对照实验贴数字（串行相并发 2 的 0-cancelled + 墙钟 vs 并发 1）；(b) 若实验通过，串行相/负载敏感相默认并发上调；(c) 退出机制接线（复核钩子存在）；(d) AC6 negative control 套件内不再 25s 超时。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录量化（48h 趋势 900-1100s→1847s、标注 18 次/5 天 vs 5 次/10h、round-206 AC6 25s 窗超时现场）（本任务 Proposal 已含）
- [ ] AC2: **对照实验**——串行相内部并发=2 vs =1 的对照：0-cancelled 保持 + 墙钟数字（贴任务体）
- [ ] AC3: **默认并发上调（若实验通过）**——串行相/负载敏感相默认并发从 1 调至实验测得最优（≥2）
- [ ] AC4: **退出机制**——load-flake 根因修复落地时复核标注的机械钩子或清单（不再只进不出）
- [ ] AC5: **AC6 窗超时修复**——session-liveness-signals AC6 negative control 套件内不再 25s 超时（宽窗或新并发下重测）
- [ ] AC6: **既有不回归**——`--for-task` scoped 门绿；0-cancelled 保持

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] 对照实验数字贴任务体（串行相并发 2 的墙钟 + 0-cancelled）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（串行相/负载敏感相内部并发参数：默认 1 → 实验测得值）
- plugin/scripts/known-load-sensitive.ts（退出机制：标注复核钩子 / 清单）
- plugin/test/session-liveness-signals.test.mjs（AC6 negative control 25s 窗 → 宽或按新并发重测）
- scripts/test.sh（串行相 / lowconc 相并发参数——同 full-suite-runner）
- plugin/test/full-suite-runner.test.mjs（AC2/AC3 对照实验 + 并发参数测试）
- tasks/gap-merge-green-snapshot-verified-commit-livelock.md（交叉标注——同根：串行相扩容推高轮时长，拉大与提交节奏差距）
- tasks/gap-suite-cost-model-is-wrong-optimizations-buy-nothing.md（交叉标注——measure-first 教训，本任务③ 前置引用）
- tasks/gap-session-liveness-busy-mask-idle-with-subagents.md（交叉标注——round-206 AC6 现场来源）
- tasks/gap-serial-group-recompose-nested-runner-criterion.md（交叉标注——串行相准入判据族）
- tasks/gap-load-sensitive-session-family-confounds-step-three.md（交叉标注——负载敏感族）
- tasks/gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive.md（交叉标注——lowconc 相并发 3 的既有定案）
- tasks/gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles.md（交叉标注——串行相成本）
- tasks/gap-suite-concurrency-4-vs-8-measurement.md（交叉标注——并发测量族）
- tasks/gap-serial-phase-install-test-residue-dependency.md（交叉标注——串行相内部顺序残留依赖，与内部并发↑ 的张力）
- tasks/gap-load-sensitive-serial-phase-unbounded-growth-measure-first.md（自身：勾 AC + 贴实验数字）

## Contract

measure   serial_phase_internal_concurrency = `grep -n "serial" plugin/scripts/full-suite-runner.ts | grep -i "concurrency"` 后的默认值
band      serial_phase_internal_concurrency >= 2（若 AC2 实验 0-cancelled 成立）
invariant zero_cancelled_preserved = 1（对照实验 + 修后套件均 0 cancelled）
invariant ac6_negative_control_no_25s_timeout = 1（套件内该测试不再 25s 超时）
invariant measure_first_noise_band_respected = 1（改默认前有对照实验数字，非盲改）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root <repo> --lane-count 4 --state-dir .quay --log-file /tmp/full-suite-exp.log`（串行相并发 2 对照实验，贴墙钟 + cancelled）
control   对照实验数字在档；0-cancelled 保持；AC6 不再超时；既有不回归
resume    对照实验 / 并发上调 / 退出机制 / AC6 窗修分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 套件耗时分析（48h 900-1100s→1847s + 标注 3 倍加速 + 串行相只进不出）⇒ 立案。三条建议裁定：①串行相内部并发 2 值得测（③ 前置）；②退出机制真缺，接线；③改默认前先测。round-206 AC6 25s 窗超时是活实例。实现归内层
