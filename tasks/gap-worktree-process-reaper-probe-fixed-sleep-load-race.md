---
id: gap-worktree-process-reaper-probe-fixed-sleep-load-race
title: worktree-process-reaper.test.mjs 两个 claude-probe 真进程用例依赖固定 sleep，宿主时序竞态在
  fan-in suite 下反复误杀无关任务
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal

`plugin/test/worktree-process-reaper.test.mjs` 的 "CLI --orphans — real reaps a probe whose cwd dir was deleted (the orphan signature)" (line 310) 是一个**宿主时序 flake**：它 spawn `bash -c 'exec -a claude-probe sleep 10000'`，固定 `await sleep(300)` 等子进程 chdir，`rmSync` 掉 cwd 目录，再固定 `await sleep(200)`，然后断言 `/proc/<pid>/cwd` 带 `(deleted)`（line 322）与 reaper `killed >= 1`（line 325/326）。

Node 通过 `posix_spawn` 的 file-action 在 **fork 之后** 应用 `cwd` —— 子进程被调度饿到 300ms 窗口之外时，它的 `chdir` 在目录已被删之后才跑，失败并退出 ⇒ `/proc/<pid>/cwd` 消失（`:321` 臂，readlink 取值空）；或 bash 尚未执行 `exec -a`，`/proc/<pid>` 仍读作 `argv0=bash` ⇒ reaper 的 `isProbe`（basename 含 `claude-probe`）匹配不到任何东西 ⇒ `found:0`/`probes:[]`（`:325` 臂）。

**这不是本任务的缺陷，但它正在系统性误杀无关任务**：`.quay/fan-in-suite-*.log` 语料中该文件已在 ≥7 个无关任务上红过（各自的 delta 都与进程回收无关，文件均 `git diff develop` 为空且不在各自 `## Touches`），其中 `gap-routine-semantic-dedup-scan-parse-args-handrolled-variants` 已**连续 3 轮 fan-in 被它误杀**（`:325` @10:17Z、`:321` @10:47Z、`:325` @11:02Z；主机负载 12–15/128，远低于 ×2=256 门 ⇒ 间歇而非纯负载阈值）。每轮误杀都烧掉一次共享池里的全量 suite（~19min）。

**为什么现在必须立案**：该文件 **未** 标注 `@load-sensitive`，`plugin/scripts/known-load-sensitive.ts --list` 不含它 ⇒ 机械 red-window 分诊不会自动把它分区，隔离重跑不覆盖该臂；且全仓库**无 open 任务**覆盖此修复（所有提及该文件的 `tasks/*.md` 均 done；最接近的 `gap-fan-in-suite-red-load-sensitive-flaky-no-isolate-rerun` 已 superseded）。反复误杀 >3 轮而无人立案，正是「该给它造产物，而不是把提醒写得更醒目」的情形。

## Plan

1. 消除固定睡眠竞态，改为**轮询到条件成立**（有界超时，超时后给出可诊断信息而非静默）：
   - 等 probe 真正就位：轮询 `/proc/<pid>/comm`（或 `/proc/<pid>/cmdline` 的 argv0）直到读作 `claude-probe`（覆盖 `:325` 臂：bash 已完成 `exec -a`），超时 ~5s 后 fail 并打印 `/proc/<pid>/status`。
   - `rmSync` 之后轮询 `/proc/<pid>/cwd` 直到 readlink 含 `(deleted)`（覆盖 `:321` 臂：chdir 已生效），超时 ~5s。
   - 同款修 line 287/291 的兄弟用例（同一 fixture、同一 300ms 竞态）。
2. 可选双保险：给该测试文件加 `// @load-sensitive wall-clock` 并注册进 `known-load-sensitive.ts` 家族（让 red-window 分诊至少能识别它）。注意 `gap-fan-in-suite-red-load-sensitive-flaky-no-isolate-rerun` 已被裁定「隔离重跑不该耦合进 worker-driver 产品层」，故**本修复以「让测试自身 load-robust」为主**，标注入册为辅，二者不互相依赖。
3. 负控制：修复后全量 suite 绿；并注入一个真实坏条件验证断言仍能红且**可归因**（不是再度退化成「取值空/空对象」的不可归因红）。

## AC

- [ ] AC1（能取假）：`plugin/test/worktree-process-reaper.test.mjs` 中 line 310 用例与 line 287 兄弟用例不再有「固定 `sleep` 后立即断言进程状态」的竞态——改为有界轮询（轮询谓词 + 超时），打印改动行。
- [ ] AC2（生产载体）：`node --test plugin/test/worktree-process-reaper.test.mjs` **26/26 pass**；且该用例耗时不再与固定 300ms 睡眠绑定（打印 duration_ms）。
- [ ] AC3（负控制，能取假）：注入一个**真实的**坏条件（如把 probe 的 argv0 改成非 `claude-probe`）后，该用例**仍红**且失败信息可归因（不是空取值/空对象）；撤销注入后复绿。
- [ ] AC4（不回归）：`--for-task <本任务> --allow-thin` scoped 门 + 全量 suite 绿。

## DoD

`plugin/test/worktree-process-reaper.test.mjs` 的两个 `claude-probe` 真进程用例不再依赖固定 sleep：probe 就位与 cwd-deleted 都改为有界轮询；本机连续两次全量 suite 中该文件 `passed=true`；负控制证明坏条件仍能红且可归因。生产载体：真实 fan-in 轮次中该文件不再以 `:321`（空 readlink）/`:325`（`found:0`）两臂误杀无关任务。

## Touches

- plugin/test/worktree-process-reaper.test.mjs
- plugin/scripts/known-load-sensitive.ts
- tasks/gap-worktree-process-reaper-probe-fixed-sleep-load-race.md