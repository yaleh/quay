---
id: gap-reclassify-serial-lowconc-no-isolation-reason-to-main
title: 默认进 main——16 个既无隔离缺陷也无自指理由的 serial/lowconc 文件挪回 engine（人 2026-09-05
  裁定：留在非 main 相才需要理由）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

人 2026-09-05 裁定（本任务立案的直接依据）：**测试缺省就应该进 main 相，进其它相（serial/lowconc）才是需要理由的**——判据方向反转：不是要求"证明挪到 main 安全"，而是"没有理由留在 serial/lowconc 就该在 main"。

`gap-serial-lowconc-reclassify-post-waterline-cap`（done）已经把 5 个有**明确历史失败证据**（曾反复失败、随水位线可靠性上限修复消失）的文件挪回了 main（engine）。当时同一批梳理里，`plugin/test-isolation-violations.txt` 命中的 4 个文件（`runner-grouping-flags-only.test.mjs`/`runner-grouping-list-groups.test.mjs`/`runner-grouping-serial-anti-stomp.test.mjs`/`select-tests-for-touches.test.mjs`）与 3 个自指测试（测 grouping/cgroup/worker-driver 机制自身行为的 `full-suite-runner.test.mjs`/`full-suite-runner-cgroup.test.mjs`/`worker-driver.test.mjs`）被排除，留给各自的理由处理。

**本任务处理剩下的 16 个 serial/lowconc 文件——它们既不在隔离违规名单上，也不是自指机制测试，且真实历史失败率修复前就已经接近零**（`.quay/verification-round.jsonl` 全历史核对，水位线修复 2026-09-04T13:42:52Z 前）：

| 文件 | 原分组 | 修复前失败/总运行 |
|---|---|---|
| `packages/quay/test/sea-artifact-consumer-e2e.test.mjs` | serial | 1/480 |
| `plugin/test/checker-cost.test.mjs` | serial | 0/217 |
| `plugin/test/quay-init-conflict-state-hash.test.mjs` | serial | 0/7 |
| `plugin/test/quay-init-drift-report.test.mjs` | serial | 0/216 |
| `plugin/test/quay-init-laydown-closure.test.mjs` | serial | 0/220 |
| `plugin/test/quay-init-laydown-dist-closure.test.mjs` | serial | 1/216 |
| `plugin/test/quay-init-loop-consumer-doc-refs.test.mjs` | serial | 1/217 |
| `plugin/test/quay-init-loop-core.test.mjs` | serial | 2/216 |
| `plugin/test/quay-init.test.mjs` | serial | 1/218 |
| `plugin/test/threshold-scope-check.test.mjs` | serial | 0/216 |
| `plugin/test/cold-start-skill.test.mjs` | lowconc | 0/216 |
| `plugin/test/quay-init-tmux-detection.test.mjs` | lowconc | 0/216 |
| `plugin/test/runtime-landing.test.mjs` | lowconc | 0/216 |
| `plugin/test/slot-refill.test.mjs` | lowconc | 0/216 |
| `plugin/test/test-file-snapshot.test.mjs` | lowconc | 0/216 |
| `plugin/test/verify-deliver-coldstart.test.mjs` | lowconc | 0/427 |

**诚实说明这批证据跟上一个任务的差异**：上一个任务的 5 个文件有"曾反复失败、随已知机制修复消失"的清晰因果叙事；这 16 个文件从未表现出这种模式（失败率修复前就 ≤1%，多数是 0）——它们被分进 serial/lowconc 的理由，本次核实结果是**找不到**（不在隔离违规名单、非自指机制测试、无显著失败史），而不是"确认无害"。按人的裁定，找不到理由本身就是该挪的理由，不需要再等一个"修复后转绿"的叙事。

**一个未消除的风险，如实标注**：`quay-init-tmux-detection.test.mjs` 从文件名看疑似探测 tmux 状态；本仓库另有 `session-liveness-*` 家族因真实 tmux 探针在高并发下建立失败已被退役删除（`gap-retire-session-liveness`）。本文件是否属于同一类真实 tmux 探针（而非仅测试检测函数本身的纯逻辑），本任务落地前必须先读一遍该文件源码确认，不能仅凭文件名判断；若确认是真实 tmux 探针，从本次批次里单独摘出，留在原分组，在任务体记录排除理由。

**落地订正（AC1 逐文件读源码核实结果，Plan 步骤 1）**：16 个候选逐一核实后，**排除 4 个、重分类 12 个**。

- `quay-init-tmux-detection.test.mjs`（lowconc）：**真实 tmux 探针**——`spawnSync('tmux', ['new-session','-d',...])` 真实启动 hermetic tmux server（私有 TMUX_TMPDIR socket，仍是真实 tmux 服务端进程）、真实 `list-sessions`/`has-session -t` round-trip、并真实跑 `quay-init.sh --loop` install（文件头自注 `@load-sensitive real-install` + "never competing with the concurrency-N main body"）。与已退役 `session-liveness-*` 家族"真实 tmux 探针在高并发下建立失败"同一失败模式（服务端 establishment 非 wall-clock 慢），非"仅测试检测函数本身的纯逻辑"。保留 `lowconc`。
- `runtime-landing.test.mjs`（lowconc）、`checker-cost.test.mjs`（serial）、`quay-init.test.mjs`（serial）：**被现存 ratchet 测试钉住**——`known-load-sensitive.test.mjs` AC3 断言 runtime-landing "must still be in the lowconc lane"、checker-cost "stays serial (child-spawn broke at lowconc c3)"；`suite-bucket-load-sensitive-isolation.test.mjs` AC5 以 quay-init.test.mjs 作为 serial 例。三者均有 `@load-sensitive`（real-install/child-spawn）+ 文件头自注的 wall-clock/child-spawn 负载敏感证据，属"有理由留在原相"，按 AC1「核实发现真实进程依赖仍强行重分类 ⇒ 假」排除、保留原分组。本地全量实测证实：仅这 3 个文件挪走即让上述 2 个 ratchet 测试转红。

其余 12 个文件逐一核实无真实 tmux 探针/端口绑定/独占资源依赖（`@load-sensitive` 标记为历史 wall-clock 文档，同 `gap-serial-lowconc-reclassify-post-waterline-cap` 先例——保留标记、仅改 `@test-group`），全部重分类回 `engine`。

## Plan

1. **逐文件读源码核实（尤其 `quay-init-tmux-detection.test.mjs`）**：落地前对 16 个文件中"文件名暗示可能有真实进程/端口/tmux 交互"的候选（`quay-init-tmux-detection.test.mjs` 明确点名；其余若在阅读中发现类似信号也一并排查）逐一确认其断言内容是否依赖独占/低并发环境；确认后在 Measured 里逐个记录判断依据。若某文件在阅读后判定不适合本批次，从 Touches 移除并在 Proposal 追加订正说明理由（不是本任务失败，是核实后的正确收窄）。
2. **逐文件、非批量重分类**：其余确认可挪的文件，把文件头 `// @test-group serial|lowconc` 改为 `// @test-group engine`。每个文件的改动在 diff 里必须可单独识别。
3. **落地前本地核验**：`scripts/test.sh` 本地跑一次全量，确认这批文件加入 main 桶后没有跟 main 桶内其它文件产生新的资源冲突；如实记录结果（含任何新失败）。
4. **落地**：提交 `@test-group` 变更；记录落地提交 SHA 与真实墙钟时间戳。
5. **监控窗口（真·待外部，同 `gap-serial-lowconc-reclassify-post-waterline-cap` 先例）**：落地后 ≥20 轮真实生产全量套件运行里，这批文件在 `engine` 分组下全部通过——不阻塞落地，阻塞"确认稳定"结论；任何复现失败精确回滚该文件并留痕，不批量撤回。

## Acceptance Criteria

- [x] AC1（能取假，逐文件核实）：Measured 逐一记录 16 个候选文件的核实结论（尤其 `quay-init-tmux-detection.test.mjs` 是否为真实 tmux 探针）；被排除的文件（如有）列出理由并从本次 Touches/AC2-4 范围移除；（⛔ 未逐一核实、或核实发现真实进程依赖仍强行重分类 ⇒ 假）。——实测（逐一读源码核实 16/16）：排除 4、重分类 12。① `quay-init-tmux-detection.test.mjs` 确认为**真实 tmux 探针**（`spawnSync('tmux', ['new-session','-d',...])` 真实启动 hermetic tmux server + `list-sessions`/`has-session -t` round-trip + 真实 `quay-init.sh --loop` install）——与已退役 `session-liveness-*` 家族同一失败模式（服务端 establishment 非 wall-clock 慢），保留 lowconc。② `runtime-landing.test.mjs`/`checker-cost.test.mjs`/`quay-init.test.mjs` 被现存 ratchet 测试钉住（`known-load-sensitive.test.mjs` AC3：runtime-landing "must still be in the lowconc lane"、checker-cost "stays serial (child-spawn broke at lowconc c3)"；`suite-bucket-load-sensitive-isolation.test.mjs` AC5：quay-init 为 serial 例）——三者均有 `@load-sensitive` real-install/child-spawn 负载敏感证据，属"有理由留在原相"，保留原分组。其余 12 文件逐一核实无真实 tmux 探针/端口绑定/独占资源依赖，重分类回 engine。
- [x] AC2（能取假，重分类落地）：`git diff` 显示 AC1 确认可挪的文件的 `@test-group` 头从 `serial`/`lowconc` 改为 `engine`，逐文件可辨识；未改动 `plugin/scripts/runner-grouping.ts` 分类逻辑本身；（⛔ 有文件遗漏或误改分类逻辑代码 ⇒ 假）。——实测：`git diff --name-only` 恰为 12 个 test 文件（8 个 serial + 4 个 lowconc），每文件仅 `@test-group` 头一行 `serial`|`lowconc`→`engine`，逐文件可辨识；未触碰 `runner-grouping.ts` 分类逻辑；被排除的 4 个文件（`quay-init-tmux-detection`/`runtime-landing`/`checker-cost`/`quay-init`）保持原分组未改。
- [x] AC3（能取假，落地前本地核验）：落地前本地跑一次 `scripts/test.sh`，Measured 贴出真实命令与结果（0 failed/0 cancelled，或如实记录任何新失败并判断是否与本次重分类相关）；（⛔ 未真实跑过、或跑出新失败却未如实记录判断 ⇒ 假）。——实测：`bash scripts/test.sh`（全量默认，16 泳道）exit 0，pass 6707 / fail 0 / cancelled 0。第一轮（15 文件重分类）跑出 2 个真实失败：`known-load-sensitive.test.mjs` AC3（runtime-landing "must still be in the lowconc lane"、checker-cost "stays serial"）与 `suite-bucket-load-sensitive-isolation.test.mjs` AC5（quay-init 应为 serial 例）——均为本次重分类直接触发（这 3 个文件被 ratchet 测试钉住），据此 AC1 排除这 3 个文件后，第二轮（12 文件重分类）全绿。
- [ ] AC4（能取假，真·待外部——监控窗口，不阻塞落地，阻塞"已确认稳定"结论）：任务体记录落地提交 SHA 与真实时间戳；DoD 声明该窗口尚未验证时本条标"真·待外部"而不是伪造读数；一旦有 ≥20 轮真实生产记录可查，须补一次真实核验并追加读数；出现复现失败须如实记录并回滚该文件；（⛔ 编造未核验的"全部通过" ⇒ 假；⛔ 复现失败却隐瞒/不回滚 ⇒ 假）。——落地提交 SHA=909aaf864（909aaf8642ee2cfe5a1e816e7c5e0faaea5c88e5），落地时间戳=2026-09-05T12:52:53Z（git 提交时刻，非任务开始时刻）；监控窗口（≥20 轮真实生产全量）尚未验证，本条留空（待外部）
- [x] AC5（能取假，范围守卫）：`git diff` 不含 `plugin/scripts/suite-scheduler.ts` 的准入/调度逻辑改动，也不含 `plugin/scripts/runner-grouping.ts` 分类算法本身的改动；（⛔ 动了调度或分类算法代码 ⇒ 超范围 ⇒ 假）。——实测：`git diff --name-only` 仅上述 12 个 test 文件 + 任务体自身，无 `suite-scheduler.ts` / `runner-grouping.ts`（`grep -E 'runner-grouping|suite-scheduler'` 命中 0）。

## Definition of Done

对 16 个候选逐一核实后：4 个（`quay-init-tmux-detection.test.mjs` 真实 tmux 探针；`runtime-landing.test.mjs`/`checker-cost.test.mjs`/`quay-init.test.mjs` 被现存 ratchet 测试钉住、有负载敏感证据）有正当理由留在原分组、如实排除并记录理由（见 Proposal「落地订正」与 AC1 实测）；其余 12 个确认无理由留在 serial/lowconc（无隔离违规、非自指机制测试、无真实 tmux 探针/端口/独占资源依赖），改标为 engine（main 桶）；落地前本地全量跑通核验（AC2/AC3）；落地后真实监控窗口读数如实记录（AC4，真·待外部，不伪造）；任何复现失败精确回滚到该文件并留痕；全程未改动调度/分类机制本身（AC5）。核实后如实收窄、不强行凑数。

## Touches

- packages/quay/test/sea-artifact-consumer-e2e.test.mjs（@test-group 头：serial → engine）
- ~~plugin/test/checker-cost.test.mjs~~（⚠️ AC1 核实后**排除**：被 `known-load-sensitive.test.mjs` AC3 钉住 "stays serial (child-spawn broke at lowconc c3)"，保留 `serial`）
- plugin/test/quay-init-conflict-state-hash.test.mjs（@test-group 头：serial → engine）
- plugin/test/quay-init-drift-report.test.mjs（@test-group 头：serial → engine）
- plugin/test/quay-init-laydown-closure.test.mjs（@test-group 头：serial → engine）
- plugin/test/quay-init-laydown-dist-closure.test.mjs（@test-group 头：serial → engine）
- plugin/test/quay-init-loop-consumer-doc-refs.test.mjs（@test-group 头：serial → engine）
- plugin/test/quay-init-loop-core.test.mjs（@test-group 头：serial → engine）
- ~~plugin/test/quay-init.test.mjs~~（⚠️ AC1 核实后**排除**：被 `suite-bucket-load-sensitive-isolation.test.mjs` AC5 作为 serial 例钉住，保留 `serial`）
- plugin/test/threshold-scope-check.test.mjs（@test-group 头：serial → engine）
- plugin/test/cold-start-skill.test.mjs（@test-group 头：lowconc → engine）
- ~~plugin/test/quay-init-tmux-detection.test.mjs~~（⚠️ AC1 核实后**排除**：确认为真实 tmux 探针，保留 `lowconc`，不在本次重分类范围——见 Proposal「落地订正」与 AC1 实测）
- ~~plugin/test/runtime-landing.test.mjs~~（⚠️ AC1 核实后**排除**：被 `known-load-sensitive.test.mjs` AC3 钉住 "must still be in the lowconc lane"，保留 `lowconc`）
- plugin/test/slot-refill.test.mjs（@test-group 头：lowconc → engine）
- plugin/test/test-file-snapshot.test.mjs（@test-group 头：lowconc → engine）
- plugin/test/verify-deliver-coldstart.test.mjs（@test-group 头：lowconc → engine）
- tasks/gap-reclassify-serial-lowconc-no-isolation-reason-to-main.md（自身）
