---
id: gap-full-suite-runner-test-mock-embedded-real-suite
title: full-suite-runner.test.mjs 地板 579s——真因是 registry 无界增长（34k 死条目 × 每 spawn 扫 /proc），非「内嵌真实 suite」
status: done
labels:
  - gap
  - throughput
parent: null
children: []
extra:
  schema: execution
  defer: post-mechanical-first-green
---
**type:** execution

## Proposal

全量 suite 地板 = `full-suite-runner.test.mjs` 的 `__CEILING__ duration_ms=578890`（~9.7min）。原立案诊断「它通过 runner spawn 一个真实全量 512-file suite」**不成立**——实测该文件 166 个测试全部用 fake suite（`fakeSuite()` / `fakeTestShRecordingArgs` / `fakeTestShRecordingPhaseEnv`），无一处以 REPO_ROOT 为 `--root`、无一处 spawn 真实 `scripts/test.sh`、无 `--one-shot-worktree`。

**真因（strace + 单点计时 + V8 prof 三条证据链）**：每个 runner spawn ~3.0s，其中 ~2.3s 是 `killRegisteredServers({ deadProcOnly: true })`（full-suite-runner.ts 的 pre-suite sweep）对 **append-only 且无 GC 的 durable registry**（`/tmp/quay-test-servers.jsonl`）逐条做 `serverPlausiblyAlive → isLiveTmuxPid`（读 `/proc/<pid>/cmdline`）。实测该文件已累积 **34,716 条死条目**（34,219 个 distinct 死 server pid），每次 spawn 产生 ~35k 次**失败**的 `/proc/<pid>/cmdline` open（strace `openat` 直方图：35,095/36,132 落在 `/proc/PID/...`）。119 个 runner-spawn 测试 × ~2.3s ≈ 274s，占单文件 ~381s 的 ~72%。`serverPlausiblyAlive` 注释里的「344 dead entries ≈ 3s」是在 344 条时写的——同一缺陷在 34,716 条时变成 ~2.3s/spawn。

## Plan

1. 在 `plugin/scripts/session-liveness-sweep.mjs` 的 `killRegisteredServers({ deadProcOnly })` 里给 registry 加 GC：dead-owner + dead-server 的条目是**永久死亡**的（owning test 进程与 tmux server 都已消失、pid 不会带着同一个 server 复活），处理时标记索引、循环后 `rewriteServerRegistry`（temp write + `renameSync` 原子重写，fs-only）移除，使 registry 有界。
2. ⛔ 不动 `plugin/scripts/full-suite-runner.ts`（产品 runner 零改动；它已经调用 `killRegisteredServers({ deadProcOnly })`，GC 收敛进该调用点，不新增调用面）。
3. 保留必须真跑的测试：真 spawn 子进程、systemd-run scope、early-red（`sleep 10` 观测「红先于完成」）等原样保留。

## Acceptance Criteria

- [x] AC1（能取假，时长降 + 真 spawn）：`full-suite-runner.test.mjs` 单文件时长 **381.2s → 149.4s**（单 runner spawn **3.0s → 0.7s**；registry **34,716 → 0** 条死条目），且 runner 仍真实 spawn 并执行（假）suite（产品 runner 零改动，测试仍全走 runner 进程）。
- [x] AC2（能取假，真实路径 + 负控制）：`session-liveness-sweep.test.mjs` 新增测试（"registry GC"）证明：一个死 owner + 死 server 的条目在 `killRegisteredServers({ deadProcOnly })` 后**从 registry 移除**，而一个活 owner 的条目**保留**（负控制，防过剪）；该测试走真实 `readServerRegistry()`/`serverRegistryPath()` 载体，非预烘 fixture。
- [x] AC3（不误伤）：`plugin/scripts/full-suite-runner.ts` 零改动（`git status` 空）；既有 `killRegisteredServers({ deadProcOnly })` 仍杀死 crashed-owner 的活 server（session-liveness-sweep.test.mjs 既有测试 "deadProcOnly: true" 不回归，12/12 全绿）；真 spawn 类测试仍通过（full-suite-runner.test.mjs 166/166 全绿）。
- [x] AC4（衡量）：before/after 读数——单 runner spawn **3.016s → 0.742s**（strace 证实 ~35k 次 `/proc/<pid>/cmdline` open 归零）；单文件 **381.2s → 149.4s**（同一 quiet 单文件跑法，直接可比）。全量 suite `main_phase` 从 ~580s 降：149.4s < 下一地板 quay-init-loop ~317s（推断——main_phase 是主泳道墙钟，天花板文件降到 149s 后，天花板即交给次慢文件）。

## Definition of Done

registry 死条目 GC 落地（`killRegisteredServers` deadProcOnly 路径 `rewriteServerRegistry` 原子重写，fs-only）；AC1-AC4 全勾；`full-suite-runner.ts` 零改动；单文件地板 381s → 149s。

## Evidence

- 单 runner spawn：registry 34,716 条 → `time` 3.016s；`mv` 走 registry 后 0.682s；修复后（空 registry）0.742s。
- strace `openat` 直方图：35,095/36,132 次落在 `/proc/PID/cmdline`（死 pid → ENOENT）。
- 单文件 `node --test`：修复前 `# duration_ms 381211`；修复后 `# duration_ms 149391`（166 pass / 0 fail）。
- session-liveness-sweep.test.mjs：12/12 全绿（含新 "registry GC" 测试 + 既有 "no name-based batch kill" 结构测试）。

## Touches

- plugin/scripts/session-liveness-sweep.mjs（killRegisteredServers deadProcOnly 路径 registry GC）
- plugin/test/session-liveness-sweep.test.mjs（GC 负控制测试）
- tasks/gap-full-suite-runner-test-mock-embedded-real-suite.md（自身）

## Needs-Human

**执行 2026-08-28T19:28:54.763Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
