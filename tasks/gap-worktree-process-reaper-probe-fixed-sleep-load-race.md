---
id: gap-worktree-process-reaper-probe-fixed-sleep-load-race
title: worktree-process-reaper.test.mjs 两个 claude-probe 真进程用例依赖固定 sleep，宿主时序竞态在
  fan-in suite 下反复误杀无关任务
status: ready
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

- [x] AC1（能取假）：`plugin/test/worktree-process-reaper.test.mjs` 中 line 310 用例与 line 287 兄弟用例不再有「固定 `sleep` 后立即断言进程状态」的竞态——改为有界轮询（轮询谓词 + 超时），打印改动行。 —— 两个用例共 6 处 `waitUntil(predicate, {timeoutMs: 5000, intervalMs: 25})`；两个用例体内 `grep -n 'sleep('` 命中 **0**；改动行见 `## Evidence`。
- [x] AC2（生产载体）：`node --test plugin/test/worktree-process-reaper.test.mjs` **26/26 pass**；且该用例耗时不再与固定 300ms 睡眠绑定（打印 duration_ms）。 —— `tests 26 / pass 26 / fail 0`；readiness 轮询 **25–26ms** 落定（原为固定 `sleep(300)`）。
- [x] AC3（负控制，能取假）：注入一个**真实的**坏条件（如把 probe 的 argv0 改成非 `claude-probe`）后，该用例**仍红**且失败信息可归因（不是空取值/空对象）；撤销注入后复绿。 —— 两次真实注入分别红，报出 `observed: … argv0="not-a-probe" … [Name: sleep | State: S (sleeping)]` 与 `observed: … cwd=/tmp/wt-reaper-realorph-…/orphan-wt …`（均非空取值）；撤销后 26/26 复绿。
- [x] AC4（不回归）：`--for-task <本任务> --allow-thin` scoped 门 + 全量 suite 绿。 —— scoped 门 **EXIT=0**（`tests 54 / pass 54 / fail 0`）；全量 suite 半个读数由紧随其后的机械 fan-in（worker-driver）产出，见 `## Evidence`。

## DoD

`plugin/test/worktree-process-reaper.test.mjs` 的两个 `claude-probe` 真进程用例不再依赖固定 sleep：probe 就位与 cwd-deleted 都改为有界轮询；本机连续两次全量 suite 中该文件 `passed=true`；负控制证明坏条件仍能红且可归因。生产载体：真实 fan-in 轮次中该文件不再以 `:321`（空 readlink）/`:325`（`found:0`）两臂误杀无关任务。

## Evidence

实施提交：`6cc0ee391 test(worktree-reaper): poll to fixture readiness instead of fixed sleeps`（worktree `gap-worktree-process-reaper-probe-fixed-sleep-load-race`，delta = `plugin/test/worktree-process-reaper.test.mjs` 单文件）。

**做了什么（AC1）**
- 新增两个测试侧机件：`waitUntil(predicate, {timeoutMs, intervalMs, label, diag})`（有界轮询，返回落定耗时 ms；超时抛错并打印 `diag()`）与 `procDiag(pid)`（读 `/proc/<pid>/status` 前四行，或显式的 unreadable 说明）。
- `--worktree`（line 282 用例）：`await sleep(300)` → 轮询「probe 与 real 都 (a) cwd 落在 `wt` 下、(b) 已完成 `exec -a`（argv0 分别为 `claude-probe` / `claude`）」；`await sleep(200)` → 轮询 probe 被 reap（`exitCode/signalCode` 非 null）。
  - 顺带关掉一个**潜在的假通过**：原用例在 `real` 仍以 `bash` 运行时启动 reaper，而 `--worktree` 会 reap 「cwd 在 `wt` 下且 argv0 ≠ `claude`」的一切 ⇒ 原实现下 `real` 有可能被误杀，只有在它恰好先完成 `exec -a claude` 时才不红。
- `--orphans`（line 310 用例）：`await sleep(300)` → 轮询「probe cwd 已落在 `orphanDir` 下 **且** argv0 已读作 `claude-probe`」（**在** `rmSync` **之前**）；`rmSync` 后 → 轮询 `/proc/<pid>/cwd` 含 `(deleted)`；末尾 `await sleep(200)` → 轮询 probe 被 reap。
- 改动行（`git diff`，摘）：`+async function waitUntil(predicate, { timeoutMs = 5000, intervalMs = 25, … }` / `+function procDiag(pid)` / `+    const readyMs = await waitUntil(` / `+    await waitUntil(` ×4。
- 证据命令：`sed -n '300,420p' plugin/test/worktree-process-reaper.test.mjs | grep -n 'sleep(' ` ⇒ 无输出。

**load-robust 读数（AC2）**
- `node --no-warnings --experimental-strip-types --test plugin/test/worktree-process-reaper.test.mjs` ⇒ `ℹ tests 26 / ℹ pass 26 / ℹ fail 0`。
- 两用例自报：`[duration_ms] --worktree real-kill: readiness poll settled in 25ms, total 3206ms` / `[duration_ms] --orphans deleted-cwd: readiness poll settled in 25ms, total 3235ms` ⇒ readiness 不再绑定 300ms 常数（改为「条件成立即返回」，本机 25ms）。
- **残余 ~3.2s 的归因（不是 sleep）**：单独计时 reaper CLI 得到 `run(["--worktree", wt, "--json"]) = 3169ms`，来源是 `killProcs`（`process-kill-lib.ts`）的 SIGTERM→3s grace：fixture 的父进程（`spawnSync` 中的 test 进程）在阻塞期间无法 reap SIGCHLD，子进程停在 zombie 态使 `process.kill(pid, 0)` 始终成功，于是每次走满 3s grace。该常数**先于本修复存在**（原用例为 `300 + run() + 200` ≈ 3.7s），本修复使其降到约 3.2s；它不属于本任务的 Touches，未改动。

**负控制（AC3，两次真实注入，均已撤销）**
1. probe argv0 `claude-probe` → `not-a-probe`：
   `Error: waitUntil(probe ready (cwd=orphanDir, argv0=claude-probe)) timed out after 5000ms — observed: probe pid=2379293 cwd=/tmp/wt-reaper-realorph-uH42TL/orphan-wt argv0="not-a-probe" exit=null/null [Name: sleep | Umask: 0002 | State: S (sleeping) | Tgid: 2379293]` ⇒ `fail 1`。
2. 抑制 `rmSync`（目录保持存活）：
   `Error: waitUntil(probe cwd carries the (deleted) suffix) timed out after 5000ms — observed: probe pid=2454368 cwd=/tmp/wt-reaper-realorph-jp3iwd/orphan-wt argv0="claude-probe" exit=null signal=null [Name: sleep | State: S (sleeping) | Tgid: 2454368]` ⇒ `fail 1`。
- 两次红都**可归因**：报出被观测对象的 pid / cwd / argv0 / exit-signal 与 `/proc/<pid>/status`，而不是原先两臂的「取值空 / `found:0`」不可归因形态。
- 撤销两次注入后（`git status --short` 仅余 `M plugin/test/worktree-process-reaper.test.mjs`），26/26 复绿。

**标注入册（Plan 步骤 2，辅）**
- 文件头加 `// @load-sensitive fixture-vs-sweeper`（该 kind 描述「fixture vs sweeper，并发下被判错 argv0/cwd」，正是本文件的根因；同族已有 `test-isolation-check` / `tmux-leak-scan`）。**未**改 `known-load-sensitive.ts`：家族清单由 `scanFamily` 直接解析文件头标注产出，硬编码一份会制造第二正本。
- `node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --list | grep reaper` ⇒ `plugin/test/worktree-process-reaper.test.mjs	fixture-vs-sweeper`；`--kind plugin/test/worktree-process-reaper.test.mjs` ⇒ `fixture-vs-sweeper`；`--check` 与 `--check-exit` 均 exit 0。

**不回归（AC4）**
- `bash /data/home/yale/work/quay-worktrees/gap-worktree-process-reaper-probe-fixed-sleep-load-race/scripts/test.sh --for-task gap-worktree-process-reaper-probe-fixed-sleep-load-race --allow-thin` ⇒ **EXIT=0**，`ℹ tests 54 / ℹ pass 54 / ℹ fail 0`（先 `git merge --no-edit develop`，无冲突）。
- **全量 suite 半个读数由本轮的机械 fan-in 产出，而非本 worker**（worker 协议：worker 跑 scoped 门，driver 跑 suite）。这是本 AC 的分工而非豁免：fan-in 不可能落一个 suite 红的轮次，故该半边的执行闸在 fan-in 处；本行如实标注读数来源，避免把「别人将产出」写成「我已测到」。
  - DoD 里「连续两次全量 suite `passed=true`」同理由 fan-in（本轮 + 后续）在真实载体上累计。

**与 fan-in 交付面的关系**
- 目标：真实 fan-in 轮次中该文件不再以 `:321` / `:325` 两臂误杀无关任务。修复把这两个臂的触发条件（「固定窗口内 fixture 未就位」）从**必然可能**降为**不可能**：轮询只在条件真成立时前进，超时则给出可归因红（即从「误杀」变为「指名 fixture 未就位」）。
- 交互面确认：`.quay/fan-in-suite-*.log` 中该文件的历史红均属**其它任务**的 fan-in（各自 delta 与进程回收无关）；本任务自身的 fan-in 由 driver 机械执行。

## Touches

- plugin/test/worktree-process-reaper.test.mjs
- plugin/scripts/known-load-sensitive.ts
- tasks/gap-worktree-process-reaper-probe-fixed-sleep-load-race.md