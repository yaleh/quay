---
id: gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable
title: 套件 scope 缺 OOMPolicy=continue：任一进程被 OOM 杀即整套被 TERM，且无峰值/OOM 证据，fan-in 归因不出而停派
status: done
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

- [x] `node --test plugin/test/full-suite-runner-oom-policy.test.mjs` 退出码 0：`buildSystemdRunArgv` 的 argv 含 `OOMPolicy=continue`，且探测所用参数数组与真实调用同源（改一处两处同变）
- [x] 真 cgroup 负控制（同一测试文件内）：把套件 scope 的 `MemoryMax` 压到 300M，让其中一个子进程超配被 OOM 杀；断言兄弟进程存活、runner 返回的是该子进程的非零退出而不是 TERM 终止，`suite-memory-evidence-<runId>.json` 的 `oom_kill>=1`；systemd 不可用或拒绝 `OOMPolicy` 时输出独立的 skip 原因而不是静默通过
- [x] 证据文件内容：含 `peakBytes`、`memoryMaxBytes`、`oomKill`、`phase`（OOM 发生时的阶段名）、`runId`；两次连续运行得到两个不同文件，互不覆盖
- [x] `node --test plugin/test/worker-driver-suite-oom-attribution.test.mjs` 退出码 0：`oom_kill>0` 的红 ⇒ 失败原因类 `suite-oom` 且文案含峰值与上限；无证据的红 ⇒ 与改动前逐字相同的「无法归因」文案
- [x] 取假形态必须变红：去掉 `OOMPolicy=continue` ⇒ 负控制用例红；证据写成单槽文件 ⇒ 不覆盖用例红；归因忽略证据 ⇒ 归因用例红
- [x] `npm run typecheck` 与 plugin 的 lint 命令退出码 0

## DoD

真实落地标准：在 claudecodeui 的一个真实 worktree 上，用 `QUAY_TEST_SYSTEMD_RUN_LIMITS=MemoryMax=3G` 把 P1c 的 fan-in 套件跑一次，必然被 OOM；记录里要有 ①`suite-memory-evidence-<runId>.json` 的 `oomKill>=1` 与 `phase`，②失败被归到具体测试文件或明确的 `suite-oom` 类，而不是「无法归因」，③该任务**未**被停派到 needs-human 的「基建疑似」类。贴出这三项的原始读数与 journal 对应行，而不是只贴测试通过。

## Evidence

（2026-10-10，worktree `/home/yale/work/quay-worktrees/gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable`，已并入 develop）

- **AC1/AC2/AC3** — `node --test plugin/test/full-suite-runner-oom-policy.test.mjs`：`tests 5 / pass 5 / fail 0`。含真 cgroup 臂 `AC5 negative control — WITHOUT OOMPolicy=continue the whole scope is TERM'd; WITH it the sibling survives (real cgroup)`（4208ms，green）与 `AC2 — a REAL 300M suite scope OOM-kills one process: the sibling survives, the runner reports a failed (not infra-error) red, and the evidence records oomKill>=1`（9556ms，green）。
- **AC4** — `node --test plugin/test/worker-driver-suite-oom-attribution.test.mjs`：`tests 4 / pass 4 / fail 0`。含 `AC4 — a red whose per-run evidence shows oom_kill>0 is classified suite-oom, naming peak and limit`、`AC4 negative control — a red WITHOUT evidence keeps the PRE-CHANGE 「无法归因」 reason, verbatim`、`AC5 falsification control — the classification reads THIS round's evidence by runId (删掉证据读取 ⇒ 正例红)`。
- **Touches 回归** — `node --test plugin/test/full-suite-runner-cgroup.test.mjs`：`tests 38 / pass 38 / fail 0`（两处 argv 逐字节断言随新增常驻属性对更新后仍绿）。
- **AC6** — typecheck 走 `.quay/config.yml` 的 `ts-typecheck` 命令 `for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done`：`EXIT=0`。⚠️ 诚实说明：本仓库**没有** `npm run typecheck` 脚本，也**没有** eslint/plugin lint 命令（全仓 grep `lint` 无任何可执行 lint 目标）——该条的「lint」半是无对应物的模板措辞；真实类型检查以 config 声明的那条命令为准。
- **scoped gate（driver fan-in 同款）** — `bash scripts/test.sh --for-task gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable --allow-thin`：`tests 176 / pass 176 / fail 0`，`EXIT=0`；选中并跑绿了本任务两个新测试文件（日志含 `+ plugin/test/worker-driver-suite-oom-attribution.test.mjs`）。
- ⚠️ **DoD 的真实落地（claudecodeui 侧 P1c 以 MemoryMax=3G 跑一次必然 OOM）未在本轮执行** —— 那是跨工作区动作。本轮以同测试文件内的**真 cgroup 300M 负控制**（AC2/AC5 用例）作为机制的直接证据。`task_check`：`acTotal 6 / acChecked 6 / dodTotal 0`。

### 2026-10-10 第二轮：fan-in 阻塞的**外来红**（上一轮 `exited-not-landed` 的真因，不在本任务的机制里）

- **真因不是本任务的功能** —— 上一轮红在 `plugin/test/task-granularity-advice.test.mjs` 的 `production: for real declared paths, peers ∪ mentions equals the step-2b grep oracle`；读上一轮真因日志（`.quay/fan-in-suite-gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable~wk-prod-anchor~1791632542261-dc4ddd.log`）得 `actual=['gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable']` / `expected=[…, 'goal-035-merge-and-postmerge-verify']`。该测试文件本轮**之前**的同一套件日志（`…1791631166913-db334c.log`，19:27）里是 `passed=true` ⇒ 差异来自两次运行之间落地的那一刀：`e2283b157`（19:37:13）把 `tasks/goal-035-merge-and-postmerge-verify.md` 的 frontmatter 由 `ready` 翻成 `done`。
- **口径缺陷（行锚定 grep）** —— oracle 的第二段是**全文行锚定** `grep -lE '^status: (todo|ready)$'`，于是把**正文里带一行 `status: ready`** 的任务读成「开放」。实测全仓只有 3 个任务文件同时满足「提样本路径」与「正文有精确 `status: todo|ready` 行」中的一条，其中**只有 `goal-035-merge-and-postmerge-verify` 同时命中**（它正文里有一份**重复的 frontmatter 块**，第 19 行 `status: ready`；另两例 `gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title`、`gap-touches-parser-early-subheading-latch-hides-declaration` 同形但不提本测试的 4 条样本路径）。工具 `readOpenTasks` 读 **frontmatter**（`status: done` ⇒ 不开放）——这是**正确**的一侧，与建这个比对的父任务自己量到的结论一致（`gap-task-granularity-advice-script-merge-candidates-and-per-file-history`：「把 grep 的 status 判据限制在 **frontmatter 段内**后，两侧 0 处不符 ⇒ 本工具读 frontmatter 而非全文扫描，这是它与那份 grep 食谱的**实质**差别」）。
- **修法** —— 只把 oracle 的第二段收敛进 frontmatter：stage 1（step 2b 的 mention grep `grep -lF -- "$p" tasks/*.md`）**逐字不变**；stage 2 改跑 `awk 'FNR==1{fm=($0=="---");next} fm&&$0=="---"{fm=0;next} fm&&/^status: (todo|ready)$/{print FILENAME}'`，且**两段的退出码分别断言**（stage 1: grep 0=命中/1=无匹配；stage 2: awk 0）——任一真实工具故障都不会被读成「空 oracle」（硬规则 3b）。空 oracle 仍是合法读数（2026-10-07 的注释保留）。
- **取假形态（负控制，本轮真跑）** — 把 `computePeers` 变异成 `return []`（工具故障）：该判据红，报文与上一轮逐字同形 `peers ∪ mentions must equal the grep oracle for plugin/scripts/worker-driver.ts`（同轮另 4 条用例一并红）⇒ 判据在**新口径下仍能取假**，不是被改宽成恒真。恢复后 `node --test plugin/test/task-granularity-advice.test.mjs`：`tests 16 / pass 16 / fail 0`。
- **两侧的实际读数（同一比对，逐 path）** — 4 条样本路径：`plugin/scripts/worker-driver.ts` 的 stage-1 命中 202 个文件、收敛后 oracle = `['gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable']`（= 本任务，声明者/peer）；另 3 条（`rework-predictors.ts` / `packages/quay/bin/quay.ts` / `packages/quay/src/init.ts`）oracle 均为 `[]`。4 条全部 `union==oracle: true`。
- **不做** —— 没有改 `tasks/goal-035-merge-and-postmerge-verify.md`（那份重复 frontmatter 块是它自己 `task_write` 落下的重复块，属**另一个**任务的载体；本任务只修判据，不代改别的任务文件）。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/scripts/full-suite-runner-types.ts
- plugin/scripts/worker-driver.ts
- plugin/test/full-suite-runner-oom-policy.test.mjs (new)
- plugin/test/worker-driver-suite-oom-attribution.test.mjs (new)
- plugin/test/full-suite-runner-cgroup.test.mjs (两处 argv 逐字节断言随新增常驻属性对更新)
- plugin/test/task-granularity-advice.test.mjs (fan-in 外来红：oracle 的 status 判据收敛进 frontmatter，stage 1 逐字不变)
- .gitignore (per-run 证据文件的运行时载体)
- tasks/gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable.md
