---
id: gap-readme-drivers-cold-start-dev-loop-drift
title: README 的「启动 drivers/serve」「冷启动」「实际开发」三节与真实运维机制/仍在分发的 skill 不一致
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
**type:** execution

## Finding

复核会话历史里"实际怎样启动服务/drivers、怎样冷启动、怎样实际驱动开发"这条真实运维路径后，对照 README.md 现有文字，发现三处具体、可核实的缺口（另有 `gap-readme-option-a-npm-release-artifact-retired` 已单独覆盖"安装渠道优先级"这个不同问题，两者不重叠）。**本任务只描述机制本身，不引用任何具体第三方部署环境的主机名/项目名**——那些只是观察样本，不是文档该记录的内容。

### 缺口1：「启动 drivers + web server」一节只给了"一键调用"这一层，没给它包装的是什么

README `:412-413`（Enablement flow 步骤④）：

> `# 4. in that session, start the drivers + web server (one idempotent call):`
> `/quay:drivers`

`quay:drivers` skill 自身的定位（skill 清单原话）是"Start the promotion + worker drivers and the web server in ONE idempotent in-session call — wraps `quay driver start --kind promotion|worker` + `quay serve` via `plugin/scripts/start-drivers.ts`"。但 README 的「Driver processes」一节（`:562-588`）只列出了 `quay driver <verb> --kind <kind>` 这一个统一入口的 verb 语义表，完全没有说明：
- 一次正常运行的部署实际是 **promotion driver + worker driver 两个独立常驻进程**（各自可单独 start/stop/drain/resume/restart），不是"driver"这个抽象名词的单个实例；
- `quay serve` 是**独立的第三个进程**，生命周期与 driver 进程彼此独立（重启一个不必重启另一个）；
- `/quay:drivers` 包装的等价手工分步命令是什么——README 目前没给出，读者若在不支持 slash skill 的宿主环境下（裸 CLI/非 Claude Code 宿主）想手工达到同样效果，无处可查。

### 缺口2：「冷启动 skill 已退役」这句话与仍在分发的 `plugin/skills/cold-start/SKILL.md` 矛盾

README `:424-426`（紧接步骤④之后）原文：

> "The retired `outer`/`inner` two-session tmux model ... was **deleted, not migrated** ... The cold-start skill that re-created the "outer cron + drive inner" model is likewise retired; the drivers + manager skills above are its successors."

实测：`plugin/skills/cold-start/SKILL.md` **文件当前存在**，且是本仓库随插件分发、在会话技能清单里实际可调用的 skill（自述：「re-create the 20-minute outer cron, EXPLICITLY drive the inner session to start fast mode and dispatch the first task, then PROVE the loop is live by reading a real --task-start telemetry record in `.workflow-events/`」）。README 把它写成"已退役（likewise retired）"，与代码/skill 清单的现状不符——这是本仓库反复强调的"文档 vs 代码漂移"的又一具体实例，且发生在很容易被下一个采用者当真的一句话上。

此外，README 现有四步（install→init→drivers→manager）完全没有区分**"证明冷启动活性"**（一次性动作：装好之后读一条 `--task-start` telemetry 记录，确认循环真的在跑，而不是进程存在但事件送不到任何人——这条区分本身也是 `gap-cold-start-needs-a-human-to-dictate-eight-steps` 这条已 done 任务里明确落地过的判据）与**"持续派发"**（loop 靠 **cron** 周期性触发重新评估/派发任务，不是靠人反复手动触发）这两件不同的事——读者读完不知道装完之后任务是怎么开始被派发的。

### 缺口3：「Task lifecycle」一节只给了状态机命令形状，没有描述真实的自动化开发闭环

README `:656-696`「Task lifecycle: `todo` → `ready` → `done`」一节自己声明"not a transcript of this repo's own board"——只展示 `promote`/`complete`/`retreat`/`gate` 四个 CLI 动作的抽象命令形状。完全没有说明一个任务从 `ready` 被派发到真正"落地"之间，worker driver 实际做了什么：
- 每个被派发的任务在**独立 git worktree** 里隔离执行（implement → self-audit → gate），不是在主检出上直接改；
- 任务状态可能不是一条直线：`ready` 之后可能卡在 **`needs-human`**（需要人工介入的终态），再由人工或后续机制 `retreat` 回 `todo` 重来；
- 状态翻到 `done` 和"代码已经真正落地"是两件不同的事——真正落地还要经过 **fan-in**（合并回 `develop`、跑 scoped/全量测试、快进合并）这一步，README 目前完全没提 fan-in 环节。

## Acceptance Criteria

- [x] AC1: README「Driver processes」一节（或紧邻处）补充说明：一次部署包含 promotion driver + worker driver 两个独立常驻进程 + 独立的 `quay serve` 进程，并给出 `/quay:drivers` 包装的等价手工分步命令。取假判据：`grep -c 'kind promotion' README.md` 与 `grep -c 'kind worker' README.md` 改后均较改前增加（贴改前/改后计数对照）。
- [x] AC2: 删除或改写 README `:424-426` "The cold-start skill ... is likewise retired" 这句话，使其与 `plugin/skills/cold-start/SKILL.md` 当前仍存在且被分发的事实一致。取假判据：`test -f plugin/skills/cold-start/SKILL.md && ! grep -qi 'cold-start skill.*retired' README.md`（改后 exit 0；改前 exit 1，贴对照）。
- [x] AC3: README 补一段区分"证明冷启动活性"（一次性，读 `--task-start` telemetry 记录）与"持续派发"（cron 周期触发）。取假判据：改后 `grep -c 'cron' README.md` 与 `grep -c 'telemetry' README.md` 均较改前增加。
- [x] AC4:「Task lifecycle」一节补一段说明真实自动化开发闭环：worktree 隔离执行、`needs-human`/`retreat` 可能反复迁移、以及 fan-in（合并回 develop + 测试 + 快进）是"done 状态"之外必经的落地步骤。取假判据：改后在该小节附近 `grep -c 'fan-in'` 与 `grep -c 'worktree'` 均较改前增加。
- [x] AC5: 改动前后分别贴出这三处 README 原文与改后文本的 diff，以及支撑证据（`plugin/skills/cold-start/SKILL.md`、`plugin/skills/drivers/SKILL.md` 现有内容核对）；**不得在改动文字里引入任何具体第三方主机名/项目名**（负控制：`grep -iE 'tokyo-alpha|ad-arm1' README.md` 必须为 0 命中）。

## Evidence

**Implementing commits**（分支 `task/gap-readme-drivers-cold-start-dev-loop-drift`，worktree HEAD `9b65e7b06`）:

| commit | 内容 |
|---|---|
| `b8896ae5f` | 三节 README 与机制对齐（drivers / cold-start / landing path） |
| `deb0c1922` | liveness 一条改写成**在跑**的读数（见 AC3 说明） |
| `9b65e7b06` | merge `develop`（`d358bf413`）进任务分支 |

Scoped gate：`bash scripts/test.sh --for-task gap-readme-drivers-cold-start-dev-loop-drift --allow-thin` → **exit 0**，在 develop `d358bf4136f3b8ac237279aa6cad7a2ca531e7df` 上跑（= 写入 `.quay/scoped-gate-cache.json` 的那个 sha；首次跑在 `740ed2214` 上，期间 develop 前进，故 merge 后重跑重写，避免 cache sha 与实际门跑的 tip 不一致）。

### AC1 — drivers 一节

取假判据，改前/改后实测（全文计数）:

```
$ grep -c 'kind promotion' README.md   # 改前 0  →  改后 2
$ grep -c 'kind worker'    README.md   # 改前 0  →  改后 2
```

新增内容（README「Driver processes (`quay driver`)」节，verb 表之前）：一次部署是**三个独立常驻进程**（promotion driver + worker driver + 独立 `quay serve`），`/quay:drivers` 是包装、start 逻辑只在 `plugin/scripts/start-drivers.ts` 一处；并给出等价手工分步命令：

```sh
quay driver start --kind promotion [--root <path>]
quay driver start --kind worker    [--root <path>]
quay serve --host <ip> --port <p>          # default 0.0.0.0:4173
```

支撑证据（`plugin/skills/drivers/SKILL.md` 现有内容核对，`:20-26`）：

> `## What it wraps`
> The three commands the script wraps (per `quay driver --help` / `quay serve`, 2026-09-04 实测):
> `quay driver start --kind promotion [--root <path>]` / `quay driver start --kind worker    [--root <path>]` / `quay serve --host <ip> --port <p>`

driver kind 列表核对（`plugin/scripts/driver-runtime.ts:113`）：`type DriverKind = "promotion" | "worker" | "outer" | "quality" | "meta" | "goal"`。

### AC2 — cold-start skill

`plugin/skills/cold-start/SKILL.md` **确实存在且随插件分发**：

```
$ ls -l plugin/skills/cold-start/SKILL.md
-rw-rw-r-- 1 yale yale 30258 Sep 17 03:46 plugin/skills/cold-start/SKILL.md
```

其**自述横幅**（`:11-18`，支撑"model 退役 / file 保留"这个改写方向）：

> **⛔ RETIRED (2026-09-04, `SPEC-tmux-retirement-2026-09-03.md` §1.4/Layer 3b).**
> The two-session "start an outer loop, drive an inner session" model this skill describes is
> **retired** … The current enablement flow is **① install ② start a Claude Code session (your choice)
> ③ `/quay:init` ④ `/quay:drivers` ⑤ `/quay:manager`** — there is no "start outer" step. The
> content below is retained for historical reference pending a full rewrite

⇒ 改写取"**model** 退役、**file** 仍在分发且带 RETIRED 横幅、不得当现行流程照做"。

**⚠️ 该 AC 的字面取假判据改前就已 exit 0（判据本身取不到"改前"值）**：

```
$ git show develop:README.md > /tmp/pristine-readme.md
$ test -f plugin/skills/cold-start/SKILL.md && ! grep -qi 'cold-start skill.*retired' /tmp/pristine-readme.md
  → 改前 exit 0（PRISTINE: already passing!）
```

原因：原文那句话**跨行折行**（`README:440` 以 `The cold-start skill that` 结尾，`retired` 落在 `:441`），
`grep` 按行匹配够不到 ⇒ 这是硬规则 3b 的形态（一个读不懂输入却返回"合格"同形值的判据）。
补一个**能区分**的对照（先按换行摊平再匹配）：

```
$ tr '\n' ' ' < /tmp/pristine-readme.md | grep -qi 'cold-start skill.\{0,120\}retired'  → 命中（改前：该断言确实存在）
$ tr '\n' ' ' < README.md               | grep -qi 'cold-start skill.\{0,120\}retired'  → 不命中（改后：已移除）
```

### AC3 — 活性 vs 持续派发（**并修正了本 AC 的前提**）

取假判据，改前/改后实测：

```
$ grep -c 'cron'      README.md   # 改前 1  →  改后 5
$ grep -c 'telemetry' README.md   # 改前 2  →  改后 3
```

新增段落区分两件事：
- **活性（一次性）**：`quay driver status --kind promotion --json`（+`--kind worker`）报 `{supervisor_pid, driver_pid, alive, …}`；每个 driver 自己把心跳追加到 `.quay/<kind>-driver-liveness.log`；最强的读数是**直接量**——worktree 根下出现带真实提交的任务 worktree。**"进程存在"不是证据**。
- **持续派发（之后，无人值守）**：常驻 driver 自己持续派发；manager 层靠 **cron** tick 周期重评估——`/quay:manager` 武装恰好一个 `CronCreate`（哨兵 `[manager-tick]`，经 `plugin/scripts/manager-arm-loop.sh`）。⇒ 派发是周期性、无人值守的，**不是**人反复手动触发。

**⚠️ 本 AC 的前提被实测证伪，已按在跑的机制改写，不是照字面写**：AC 原文假设"证明冷启动活性 = 读 `--task-start` telemetry 记录"。实测该**生产载体已停摆**——`.workflow-events/` 最新记录是 `2026-09-06 20:18`，而驱动的 `.quay/fan-in-*.log` 写于 `2026-09-17T03:5xZ`、`.quay/promotion-driver-liveness.log` 每 ~90s 一条心跳 ⇒ 驱动在跑、该目录 11 天无人写。生产者是**已退役的 inner 层**：`worker-driver.ts` 不发射 `--task-start`，全仓非测试代码里 `fast-mode-telemetry.ts` 的唯一子进程调用者是 `outer-driver.ts ... --snapshot`。

⇒ 若照 AC 字面把 `--task-start` 写成**现行**活性判据，就是把"实现保留但生产不跑"的机制写进 README（硬规则 4 推论三），**等于给本任务要消灭的那类漂移再造一个实例**。故按在跑的读数写，并把 `--task-start` 降级为一条显式注记（"属于已退役的 inner 层与被保留的 cold-start skill；现行 driver 流水线不写该目录"）。`grep -c 'telemetry'` 因此仍递增（注记里出现该词）。

### AC4 — Task lifecycle 的落地路径

取假判据，**小节内**计数实测（`### Task lifecycle:` 到 `## Distribution` 之间）：

```
$ awk '/^### Task lifecycle: /{f=1} f&&/^## Distribution/{f=0} f' README.md | grep -c 'fan-in'    # 改前 0  →  改后 2
$ awk '/^### Task lifecycle: /{f=1} f&&/^## Distribution/{f=0} f' README.md | grep -c 'worktree'  # 改前 0  →  改后 2
```

新增段落说明三件事：① 每个被派发任务在**独立 git worktree** 里隔离执行（implement → self-audit → gate），共享检出从不原地改；② 可能停在 **`needs-human`**（终态），唯一合法回路是 `retreat` 回 `todo`，故 `ready → needs-human → todo → ready` 可反复多次；③ **fan-in 在状态翻转之后**：merge develop 进 worktree → 跑 typecheck + scoped 门 + 全量 suite → 才 ff-merge 进 develop。⇒ `done` 是任务状态、不是已落地改动。

### AC5 — diff 与负控制

三处 README 改动全文 diff（`git diff develop..HEAD -- README.md`，worktree 内实跑）：

```diff
@@ -437,9 +437,35 @@ session". The session's lifecycle belongs to the human; quay only turns an
 already-running session into a role. The retired `outer`/`inner` two-session tmux
 model (`session-liveness.sh` / `quay-topology.sh` / `outer-session-check.sh` /
 `topology-check.sh`) was **deleted, not migrated** — see
-`orchestration/SPEC-tmux-retirement-2026-09-03.md`. The cold-start skill that
-re-created the "outer cron + drive inner" model is likewise retired; the drivers +
-manager skills above are its successors.
+`orchestration/SPEC-tmux-retirement-2026-09-03.md`. The **model** the
+`quay-cold-start` skill described — "create an outer cron, then drive an inner
+session" — is retired, and the `drivers` + `manager` skills above are its
+successors. The skill **file itself is still shipped and still invocable**
+(`plugin/skills/cold-start/SKILL.md`, listed in the session skill set as
+`quay:cold-start`), but it opens with a `⛔ RETIRED` banner and the procedure it
+describes must not be followed; it is retained for historical reference pending a
+rewrite. Read it as history, not as the current cold-start procedure.
+
+**Proving the loop is live is a one-shot reading; staying live is a cron.** Two
+different things — only the first is a step you perform:
+
+- **Liveness (once, right after ③④⑤):** ask the drivers, don't inspect the process
+  table — `quay driver status --kind promotion --json` (and `--kind worker`) reports
+  `{supervisor_pid, driver_pid, alive, …}`, and each driver appends its own heartbeat
+  to `.quay/<kind>-driver-liveness.log`. The strongest reading is a *direct* artefact:
+  a task worktree appearing under the worktree root with real commits in it. Something
+  that merely *exists* is not evidence — a driver can be up while nothing is dispatched.
+- **Continuous dispatch (afterwards, unattended):** the resident drivers keep
+  dispatching on their own, and the manager layer re-evaluates on a **cron** tick —
+  `/quay:manager` arms exactly one `CronCreate` job (sentinel `[manager-tick]`, via
+  `plugin/scripts/manager-arm-loop.sh`), and the session's cron re-fires the tick.
+  Dispatch is therefore periodic and unattended, **not** a human re-running a
+  command; if the cron is gone the board stops moving while every process is still up.
+
+> An older liveness reading — a `--task-start` **telemetry** record under
+> `.workflow-events/*.jsonl` — belongs to the retired `inner` layer and to the
+> retained `quay-cold-start` skill that asserts it. The live driver pipeline writes
+> the readings in the first bullet above, not that directory; prefer them.

@@ -584,6 +610,33 @@ supervisor. The unified entry point:
 quay driver <start|stop|drain|resume|status|restart> --kind <promotion|worker|outer|quality|meta|goal> [--root <path>] [flags]
 ```

+**A running deployment is three independent resident processes, not one.** The
+enablement flow's step ④ (`/quay:drivers`) starts all three in one idempotent
+in-session call; `/quay:drivers` is a convenience wrapper, and the start logic
+lives in exactly one executable (`plugin/scripts/start-drivers.ts`) rather than
+in the skill body. What it wraps — the hand-run equivalent, for any host with no
+slash-skill channel (bare CLI, a non-Claude-Code host):
+
+```sh
+# 1. promotion driver — advances todo → ready by applying the author gate
+quay driver start --kind promotion [--root <path>]
+
+# 2. worker driver — dispatches ready tasks into per-task worktrees,
+#    runs them to a gate verdict, and lands them (see "Task lifecycle" below)
+quay driver start --kind worker [--root <path>]
+
+# 3. the web UI — a SEPARATE process, with no supervisor of its own
+quay serve --host <ip> --port <p>          # default 0.0.0.0:4173
+```
+
+All three have **independent lifecycles**: restarting one does not restart the
+others, and `quay serve` is *not* supervised by the driver supervisor — the start
+script backgrounds it itself (and reloads it when its `/health` reports
+`stale:true`, i.e. the code in memory is older than the code on disk). The driver
+kernel knows the kinds `promotion | worker | outer | quality | meta | goal`; a
+project's enablement flow starts **promotion + worker**, the two that make a board
+progress (`outer` the session role is retired — see the enablement-flow section).
+
 | verb | semantics |
 |---|---|
 | `start` | Start the resident driver under the supervisor (respawn on exit/kill/crash) |

@@ -710,6 +763,21 @@ as the legal backward path. `quay task check <id>` remains the ABI's gate
 assertion — it reports whether every AC checkbox is honestly backed and the
 task is in a gate-passing status, without mutating anything.
 
+**What the status machine does not show: the landing path.** `done` is a task
+state, not a landed change. Between `ready` and a landed change the worker driver:
+
+- **isolates every dispatched task in its own `git worktree`** — one worktree per
+  task (branched off `develop`), where it implements → self-audits → gates. The
+  shared checkout is never edited in place, so concurrent tasks cannot collide;
+- **may park a task in `needs-human`** — a terminal hold for work that needs a human
+  decision — whose only legal way back is `retreat` to `todo`. A task can therefore
+  move `ready → needs-human → todo → ready` more than once before it ever lands;
+- **lands it through fan-in**, which happens *after* the status flip: merge
+  `develop` into the task's worktree, run typecheck + the scoped gate + the full
+  suite on the merged result, and only then fast-forward-merge the task branch into
+  `develop`. A `done` task whose fan-in has not run is a claim, not a landed change
+  — its code is still only on its own branch.
+
 ## Distribution: single-file executables (SEA) — **no longer published**
```

**负控制**（改动文字里不得出现具体第三方主机名/项目名）：

```
$ grep -icE 'tokyo-alpha|ad-arm1' README.md
0        # 改前 0，改后 0
```

**硬规则 5b 扫描**（"修好 X ≠ X 只在那一处"）：在 README 里 grep 同原则的其它适用点，命中 10 行，
逐条核对后**无同类缺陷**，其中两条值得记录：

- `README:473-476`（"the outer and inner tick documents"）——**不是缺陷**：这两份 tick 文档确实仍随
  `--loop` 落盘（`quay-init.sh:1545` "the shipped tick templates (orchestrator-loop-tick.md /
  fast-mode-loop-tick.md)"，两份源文件均在）。该句描述的是**落盘文件集**，不是"outer/inner 会话模型仍现行"。
- `README:50`（"driven by the outer loop under `experiments/`"）——**疑似同类残留**（outer 会话角色已退役），
  但它属于 `experiments/` 研究层、不在本任务三处缺口的范围内，按硬规则 12 **不扩范围**，仅记观察项。

## Definition of Done

- [x] AC1-AC5 全部满足，且 AC5 的 diff/证据已贴入任务体；README.md 三处更新落地后，本任务体身列出的每条取假判据命令都已实跑并贴出改前/改后输出对照，不是描述性断言。

## Touches

- README.md
- tasks/gap-readme-drivers-cold-start-dev-loop-drift.md（自身）
