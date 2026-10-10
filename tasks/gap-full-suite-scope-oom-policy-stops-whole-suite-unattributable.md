---
id: gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable
title: 套件 scope 缺 OOMPolicy=continue：任一进程被 OOM 杀即整套被 TERM，且无峰值/OOM 证据，fan-in 归因不出而停派
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象与证据（2026-10-10，claudecodeui 工作区，本机 journal 复核）**：同一类 fan-in 红 `not ok - suite-watchdog: terminated by an external signal before the suite finished`（`watchdog-trace` elapsed 32–49s、max_silence ≤10s、`full-suite-state.json` `reason:"failed"`、`failingTestFiles` 不可归因）自 10-09 12:00 起在 136 个 `test.sh` 套件 scope 中出现 16 次，对应任务 P1c（3 轮）、input-outline（3 轮）、effective-capacity-probe（2 轮）、with-memory-cap（2 轮）、vitest-worker-pool、upstream-pool-rotation、ac315、ac188 等；每一次 `journalctl --user` 里该 `run-uNNN.scope` 都是 `A process of this unit has been killed by the OOM killer` + `Failed with result 'oom-kill'`，结束秒数与 fan-in `suite-end` 吻合。结果：任务被「失败无法归因」规则停派到 needs-human，每个任务白耗 1–2 轮 worker（约 20–35 分钟/轮）。

**机制（非症状）**：`plugin/scripts/full-suite-runner.ts` 的 `buildSystemdRunArgv` 只给套件 scope 传 `MemoryMax/CPUQuota/TasksMax`，**没有 `OOMPolicy=continue`**（anchor 的 `scopeLaunchArgv` 有）。systemd 对 scope 的默认 OOMPolicy 是 stop：scope 内**任意一个**进程被 OOM 杀，整个 scope 即被 TERM，`test.sh` 的 `suite_abort` trap 在 `$WATCHDOG_VERDICT` 为空时打印上面那行，其余 270 个测试被标 cancelled，**没有任何失败文件**可归因。其二，scope 用 `--collect`，退出后单元消失，`Result=oom-kill` 与 `memory.events` 都读不回来；`suite-cgroup-evidence.txt` 只记上限，不记峰值与 OOM 计数，也是单槽会被下一轮覆盖。其三，`worker-driver.ts` 的归因步骤看不到 OOM 证据，只能把它说成「基建/契约疑似」。

<!-- dedup-ref -->相关但机制不同：`gap-driver-anchor-runs-without-host-derived-memory-envelope`（done，只包 anchor 组）、`gap-full-suite-runner-memory-max-host-derived-envelope`（done，只定上限的推导）、`gap-systemd-scope-probe-params-differ-from-real-scope`（done，探测与真实参数同源）。本任务补的是套件 scope 的 OOM 语义与证据，不改上限的推导。

**提案**：①套件 scope 加 `-p OOMPolicy=continue`，使被 OOM 杀的只是单个测试进程，由该测试文件自己的失败被归因；探测与真实调用走同一个参数数组（见上面第三个相关任务，沿用其常量）。②套件运行期间每 2s 读 scope cgroup 的 `memory.peak`、`memory.events`（`oom`、`oom_kill`）与当前阶段名，teardown 前再读一次，写入 per-run 的 `<state-dir>/suite-memory-evidence-<runId>.json`（不是单槽文件）。③`worker-driver.ts` 在 suite 红时读该证据：`oom_kill>0` 则失败原因分类为 `suite-oom`，停派文案写明峰值/上限/阶段，而不是「基建/契约疑似」；无证据时行为不变。

**不做**：不改 `scripts/test.sh`；不改上限的推导；不因 OOM 自动放宽上限（放宽是人的决定，已在 claudecodeui 一侧通过 `QUAY_TEST_SYSTEMD_RUN_LIMITS` 完成）。

## AC

- [ ] `node --test plugin/test/full-suite-runner-oom-policy.test.mjs` 退出码 0：`buildSystemdRunArgv` 的 argv 含 `OOMPolicy=continue`，且探测所用参数数组与真实调用同源（改一处两处同变）
- [ ] 真 cgroup 负控制（同一测试文件内）：把套件 scope 的 `MemoryMax` 压到 300M，让其中一个子进程超配被 OOM 杀；断言兄弟进程存活、runner 返回的是该子进程的非零退出而不是 TERM 终止，`suite-memory-evidence-<runId>.json` 的 `oom_kill>=1`；systemd 不可用或拒绝 `OOMPolicy` 时输出独立的 skip 原因而不是静默通过
- [ ] 证据文件内容：含 `peakBytes`、`memoryMaxBytes`、`oomKill`、`phase`（OOM 发生时的阶段名）、`runId`；两次连续运行得到两个不同文件，互不覆盖
- [ ] `node --test plugin/test/worker-driver-suite-oom-attribution.test.mjs` 退出码 0：`oom_kill>0` 的红 ⇒ 失败原因类 `suite-oom` 且文案含峰值与上限；无证据的红 ⇒ 与改动前逐字相同的「无法归因」文案
- [ ] 取假形态必须变红：去掉 `OOMPolicy=continue` ⇒ 负控制用例红；证据写成单槽文件 ⇒ 不覆盖用例红；归因忽略证据 ⇒ 归因用例红
- [ ] `npm run typecheck` 与 plugin 的 lint 命令退出码 0

## DoD

真实落地标准：在 claudecodeui 的一个真实 worktree 上，用 `QUAY_TEST_SYSTEMD_RUN_LIMITS=MemoryMax=3G` 把 P1c 的 fan-in 套件跑一次，必然被 OOM；记录里要有 ①`suite-memory-evidence-<runId>.json` 的 `oomKill>=1` 与 `phase`，②失败被归到具体测试文件或明确的 `suite-oom` 类，而不是「无法归因」，③该任务**未**被停派到 needs-human 的「基建疑似」类。贴出这三项的原始读数与 journal 对应行，而不是只贴测试通过。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/scripts/full-suite-runner-types.ts
- plugin/scripts/worker-driver.ts
- plugin/test/full-suite-runner-oom-policy.test.mjs (new)
- plugin/test/worker-driver-suite-oom-attribution.test.mjs (new)
- tasks/gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable.md
