---
id: gap-per-file-cpu-report-mem-key-collides-parent-and-isolated-child
title: per-file-cpu-report 的 .mem 只按文件路径作 key ⇒ 隔离子进程模式下父进程覆盖子进程读数：五个重型文件全被读成
  ~50 MB（低估约 35×）
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal

`plugin/scripts/per-file-cpu-report.mjs` 的输出文件名只由**测试文件路径**决定、**不含 pid**：

- `:166` `const key = crypto.createHash("sha256").update(abs).digest("hex").slice(0, 16);`（`abs` = resolve 后的 `argv[1]`）
- `:168`/`:170` 写 `<cpuDir>/<key>.cpu` 与 `<cpuDir>/<key>.mem`
- `:71` 的注释把这个 key 写成 "MUST stay byte-identical" 的契约 —— 契约本身没错，但它**只标识文件、不标识进程**。

而 `node --test --test-isolation=process <file>` 会为测试文件起一个**隔离子进程**，且父进程的 `argv[1]` 与子进程**相同** ⇒ **同一个 key** ⇒ 两个进程写同一个 `<key>.mem`；父进程退出时用它自己的小读数覆盖掉子进程的真实峰值。

**实测（2026-10-16，一手读数，已记在 `tasks/gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison.md` 的 Evidence 里）**：用生产 preload 直读时，五个重型文件**全都**读出几乎相同的 51224–52384 KB（≈50 MB）—— 那不是任何文件的峰值，是覆盖效应。改用**同一读数**、**按 pid 分文件**（`<key>.<pid>.mem`，取各 pid 的最大值）后，逐文件复现了该任务自己记录的 1.7–1.8 GB 量级。

⇒ 后果：**任何按文件读这份成本的消费者，在隔离子进程模式下读到的是父进程的读数**（"每个文件约 50 MB"）—— 一个系统性低估约 35× 的假读数；而 `mem_peak_kb=` 那条链（`measure-suite-reporter.mjs` / `full-suite-runner.ts` / `measure-trend-check.ts` / `pre-verified-round-record.ts`）正建立在它上面。

## Plan

1. **复现。** 按生产形状（同一 preload、`--test-isolation=process`、一个已知重型文件）跑一轮，粘贴 `<key>.mem` 读到的假读数（~50 MB 量级）与文件名；再用按 pid 分文件的变体粘贴真峰值，给出两者倍数差。
2. **修。** 让这一维**不可被父进程覆盖**：记为 `<key>.<pid>.mem` 而读者取各 pid 的最大值；或让父进程在检测到自己只是隔离父进程时不写这一维。⛔ 契约变更必须同步**所有**读者，不许只改写侧。
3. **判据。** 读侧不得因父进程的小读数而丢掉子进程的大读数（夹具：同一 key 下父写小值、子写大值 ⇒ 读侧必须得大值）。
4. ⛔ 不改 `mem_peak_kb=` 那条既有格式；⛔ 不放宽或删除任何既有判据来达成读数。

## Acceptance Criteria

- [ ] AC1: 粘贴复现读数：同一重型文件，生产 preload 形状**直读**得到 ~50 MB 量级，而按 pid 分文件得到真实峰值；给出文件名、pid、两值倍数差。
- [ ] AC2: 粘贴修复后的 A/B：修复后**直读即得真实峰值**（不再需要绕道），并写明契约怎么变的、哪些读者跟着改了。
- [ ] AC3: 判据（落测试文件）：同一 key 下父进程写小值、隔离子进程写大值 ⇒ 读侧读到**大值**；负控 = 只写小值时读到小值（证明它不是恒取大）。
- [ ] AC4: `scripts/test.sh --for-task <本任务>` 绿；anti-drift 报 OK（改动全在 Touches 内）。

## Definition of Done

- AC1–AC4 全部勾选并附实测读数。
- 既有判据（`plugin/test/measure-suite-reporter.test.mjs` 等）要么原样通过、要么在证据里说明哪个用例因契约变更**必须**改及为什么；⛔ 不得放宽或删除。
- 落地后 `mem_peak_kb=` 那条链在隔离子进程模式下给出的是**子进程的真实峰值**，而不是父进程的读数。

## Touches
- tasks/gap-per-file-cpu-report-mem-key-collides-parent-and-isolated-child.md
- plugin/scripts/per-file-cpu-report.mjs
- plugin/scripts/measure-suite-reporter.mjs
- plugin/test/measure-suite-reporter.test.mjs
