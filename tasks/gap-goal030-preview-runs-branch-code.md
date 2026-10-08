---
id: gap-goal030-preview-runs-branch-code
title: GOAL-030 ⑤：预览实例自举——在 goal 判据树上起 serve 并证明 AC-340（入口 realpath 在本树内 + 首页 200）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-340
---
**type:** execution

## Proposal

GOAL-030（goal 分支首个真实试点）的第五块：**预览实例**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.10）。AC-340 判的是「被求值树（branch-mode goal 的判据 worktree，与预览 worktree 是**同一棵树**——`previewWorktreeDir` ≡ `goalCriterionWorktreeDir`）下登记在册且存活的 `quay serve`，其入口文件 realpath 位于该树内，且其 web 首页返回 200」。本任务把预览实例**真正起起来**，证明判据在它身上取到 0，并证明这条判据**能取假**。

为什么需要本任务：AC-340 的机制已经全部存在——`packages/quay/src/goal-preview.ts` 的 `previewServeEntry`/`startPreviewServe` 以 `--watch --experimental-strip-types … serve` 跑**预览 worktree 自己的** `packages/quay/bin/quay.ts`（入口不存在就明确失败，⛔ 不回退到主检出）；`plugin/scripts/live-web-address.ts` 是「这个 root 的活 web 地址」的唯一定义点；建/停机制本身的三件同族任务已 done（见下方 traceability 段）。但**至今没有任何任务把这个真实对象起起来验过**：AC-340 是 GOAL-030 七条 AC 里唯一以「一个在跑的进程」为求值对象的，而 `quay goal merge` 的前置正是「预览这个 live-probe AC 取到 0」。

落笔当轮读数（2026-10-08，主检出 = author）：`goal/GOAL-030` 存在（tip `6a00432`，落后 develop 6 提交）；判据/预览 worktree 路径经 `resolveWorktreeNamespace(root)` 解析为 **`/home/yale/work/quay-worktrees/goal-GOAL-030`**（来自 `.quay/config.yml` 的 worktree 命名空间，⛔ 不是硬编码的 `quay-worktrees` 字面量），该目录**当前不存在**——最近一轮 goal 机械环（`.quay/goal-round.jsonl` round 272 @ 2026-10-08T02:33:31Z）对该 goal 报 `criterionWorktrees[].state = "no-branch"`，因为读那一轮时 GOAL-030 还是 draft（activation 02:36:17Z 晚于该轮）。GOAL-030 激活后，goal-driver 的 `syncGoalCriterionWorktrees`（`goal-driver.ts:3244` 的 `ensureGoalCriterionWorktree`）会在下一轮建出该 worktree，并按 `ensureWorktreeNodeModules` 装配依赖。AC-340 目前在**主检出**取 0（生产 serve 跑主检出自身入口），负对照也已在临时 worktree 上取过 1（`serve-runs-foreign-code`，见 GOAL-030 §判据形态）——但**都不是预览实例上的读数**。

做法（⛔ 不改判据、⛔ 不手搓 `git worktree add`、⛔ 不写第二套身份检查）：

1. **确认判据/预览 worktree 存在且停在分支 tip**：`git -C /home/yale/work/quay-worktrees/goal-GOAL-030 rev-parse HEAD` 须等于 `git rev-parse goal/GOAL-030`。该 worktree 由 goal-driver 建/刷（`ensureGoalCriterionWorktree`），依赖装配走 `ensureWorktreeNodeModules`；⛔ 执行者不得手工 `git worktree add` 补建冒充。若它缺席、或依赖没链上（`nodeModules.state` 为 `source-absent` / `failed`），如实报告（那是 goal-driver / 装配侧的缺陷），⛔ 不作弊绕过。
2. **起预览**：从主检出跑 `node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal preview GOAL-030 start --port <n> --root /data/home/yale/work/quay`。`--port` 必须显式且 ≥1（`0` 被拒：人寻址不到的预览不是预览），取一个**未被占用**且不等于生产端口的 n。读数须为 `state: "started"`（或 `already-running`）且 `pid` / `host` / `port` 非空。
3. **在预览/判据 worktree 根跑 AC-340 判据**（`quay goal show AC-340` 的 criterion，用 bash 执行，cwd = 该 worktree）⇒ `exit 0`，stdout 含 `PASS: serve pid … runs this tree's own entry`。
4. **负对照两条（两个方向都要，判据才叫能取假）**：(a) 取一份**跑主检出入口的 serve** 的登记（例如把主检出 `.quay/server.json` 原样拷进一个临时 git 树，其 pid 是活的），在该树上跑判据 ⇒ `exit 1` 且 stderr 含 `CAUSE=serve-runs-foreign-code`；(b) 在一棵**无登记**的临时 git 树上跑判据 ⇒ `exit 3`，stderr 含 `NOT-EVALUATED`。两次 exit 码进 Evidence。
5. **证据落盘**：`pid`、入口文件 realpath（来自 `/proc/<pid>/cmdline`）、`plugin/scripts/live-web-address.ts <root>` 的输出、`curl -sL -o /dev/null -w '%{http_code}' --max-time 20 http://<host>:<port>/` 的读数、两条负对照的 exit 码，写进 `## Evidence` 与 `docs/rup/goal030-preview-branch-code.md`。
6. **留给人的预览**：预览 serve 保持运行——`quay goal merge` 的前置就是它；把地址写进 Evidence 供人试用。

⛔ 非目标：不改 AC-340 判据；⛔ 不在产品里再写一套「入口是否在本树内」的检查（判据即正本，第二套实现正是本 goal 反复警告的「第三套实现」）；⛔ 不停、不重启**生产** serve（主检出 `.quay/server.json` 登记的那个 pid）；⛔ 不手搓判据 worktree、不改 `goal-preview.ts` 的行为。若预览起不来、起来后被孤儿回收器杀掉、或判据判 `serve-runs-foreign-code`（预览跑的不是分支代码）⇒ 那是 GOAL-030 §停止扩大范围「预览不可用」/「代码身份」信号，如实上报并停止扩大范围，⛔ 不伪造 PASS、⛔ 不用 `--override` 换绿。

<!-- dedup-ref -->
关联任务（traceability，非前置）：本任务是 GOAL-030 的第五块，四条兄弟任务各自守一条 AC：① `gap-goal030-kernel-task-transition-and-status-event`（goal_ac: AC-338）建 kernel 转移决策与事件；② `gap-goal030-promotion-writes-via-kernel-transition`（goal_ac: AC-336）把两条写入接线；③ `gap-goal030-branch-selfhost-probe`（goal_ac: AC-337）证沙盒里 driver / `ready-pool-check` 加载的是分支代码；④ `gap-goal030-archguard-before-after-comparability`（goal_ac: AC-339）证结构前后可比。那四条的求值面是任务 worktree 与 `/tmp` 沙盒；**本条是唯一以「预览实例」这个真实对象为求值面的**（AC-340 的求值树就是预览 worktree，也正是人试用 goal 改动的那个界面），验收面独立（进程入口身份 + HTTP 可达），故 separate、不合并。同族另外三条已 done 的任务（`gap-goal-branch-preview-instance` / `gap-goal-branch-reaper-accepts-preview-serve` / `gap-goal-branch-worktrees-lack-node-modules`）建的是机制本身，⛔ 不是本条要做的验收。

## AC

- [x] 判据/预览 worktree 存在且停在分支 tip：`git -C /home/yale/work/quay-worktrees/goal-GOAL-030 rev-parse HEAD` 与 `git rev-parse goal/GOAL-030` 输出相同；两个 sha 进 Evidence
- [x] 预览已起：`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal preview GOAL-030 status --json --root /data/home/yale/work/quay` 输出 `state: "running"` 且 `pid`、`port` 非空；完整输出进 Evidence
- [x] AC-340 在预览树上取 0：在该 worktree 根用 bash 执行 `quay goal show AC-340` 的 criterion，`exit 0` 且 stdout 含 `PASS:`；完整 stdout/stderr 进 Evidence
- [x] 首页可访问：`curl -sL -o /dev/null -w '%{http_code}' --max-time 20 http://<host>:<port>/` 输出 `200`
- [x] 负对照 (a) 能取假：在被求值树之外、登记了「跑主检出入口的 serve」的临时 git 树上跑同一判据，`exit 1` 且 stderr 含 `CAUSE=serve-runs-foreign-code`
- [x] 负对照 (b) 能报未评估：在没有 `.quay/server.json` 的临时 git 树上跑同一判据，`exit 3` 且 stderr 含 `NOT-EVALUATED`
- [x] 载体已落盘可读：`test -f docs/rup/goal030-preview-branch-code.md` exit 0，且该文件含 pid、入口 realpath、`<host>:<port>`、HTTP 状态码四个读数

## DoD

真实落地 = **AC-340 判据在 goal 判据 worktree（= 预览 worktree）上 `exit 0`**：一个有登记、存活、跑**本树自己入口**、且首页 200 的 `quay serve` 真的被起起来并被判据复核过（DIR-026 Reading A：不是「脚本存在」，是「对象真的跑过机制」）。读数同时固化在任务库（`## Evidence`）与 `docs/rup/goal030-preview-branch-code.md`。

本任务经 goal/GOAL-030 分支落地，⛔ 不落 develop：GOAL-030 并入前 `git show develop:tasks/gap-goal030-preview-runs-branch-code.md` 与 `git show develop:docs/rup/goal030-preview-branch-code.md` 均不存在。

**如实注记（本条判据的时效边界）**：AC-340 是 live-probe 类判据，真值由一个**在跑的进程**承载；goal-driver 在分支 tip 前移时会刷新判据 worktree，而刷新会**先停掉其上的预览 serve**（`ensureGoalCriterionWorktree` 里的 `stopPreviewServe`，§4.10 裁定㉒），`.quay/` 快照（裁定㉓）也让预览内的写操作随刷新丢弃。所以本任务证明的是「执行当刻、该分支 tip 上」的读数；此后若有同 goal 的任务把分支 tip 再推前，预览会停、AC-340 回到 exit 3，须在 `quay goal merge` 前按本任务 step 2 的**同一条命令重起**（一步；该读数属并入轮，记入 GOAL-030 验证步骤 7）。⛔ 不得为了维持 exit 0 而改判据、给判据 worktree 手搓状态、或把 serve 起在主检出上冒充预览。

## Touches

- tasks/gap-goal030-preview-runs-branch-code.md
- docs/rup/goal030-preview-branch-code.md

## Evidence

**取证时刻**：2026-10-08T03:07:36Z（预览启动）– 2026-10-08T03:08:57Z（读数固化）；本机时区 +0800。完整取证稿：`docs/rup/goal030-preview-branch-code.md`。

### ① 判据/预览 worktree 停在分支 tip（AC1）

```
$ git -C /home/yale/work/quay-worktrees/goal-GOAL-030 rev-parse HEAD
6a00432cae4f349f336436aa9de963a331887d02
$ git -C /data/home/yale/work/quay rev-parse goal/GOAL-030
6a00432cae4f349f336436aa9de963a331887d02      # 两侧相同
```

依赖装配读数 = **`linked`**：`/home/yale/work/quay-worktrees/goal-GOAL-030/node_modules -> /data/home/yale/work/quay/node_modules`（⛔ 非 `source-absent` / `failed`）。该 worktree 由 goal-driver 的 `ensureGoalCriterionWorktree` 建（⛔ 本任务没有手工 `git worktree add`）。

### ② 预览已起（AC2）

```
$ node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal preview GOAL-030 status --json --root /data/home/yale/work/quay
{
  "goal": "GOAL-030",
  "action": "status",
  "previewRoot": "/home/yale/work/quay-worktrees/goal-GOAL-030",
  "state": "running",
  "pid": 1038773,
  "host": "172.28.0.1",
  "port": 20830,
  "detail": "pid 1038773 alive, web on 172.28.0.1:20830"
}
```

启动读数：`state: "started"`, `pid` 1038773, `host` 172.28.0.1, `port` 20830（`goal preview GOAL-030 start --port 20830 --root /data/home/yale/work/quay`；端口未被占用且 ≠ 生产端口 20119）。

### ③ 入口 realpath + 活 web 地址 + 首页 HTTP 码（AC4 / AC7 的两个读数）

```
$ tr '\0' '\n' < /proc/1038773/cmdline
/data/home/yale/.nvm/versions/node/v24.21.0/bin/node
--experimental-strip-types
/home/yale/work/quay-worktrees/goal-GOAL-030/packages/quay/bin/quay.ts
serve
--port
20830
```

- **入口文件 realpath** = `/data/home/yale/work/quay-worktrees/goal-GOAL-030/packages/quay/bin/quay.ts`（在被求值树内）
- **`<host>:<port>`** = `172.28.0.1:20830`（`node --no-warnings --experimental-strip-types <wt>/plugin/scripts/live-web-address.ts <wt>` ⇒ `172.28.0.1:20830`，rc=0）
- **HTTP 状态码** = `200`（`curl -sL -o /dev/null -w '%{http_code}' --max-time 20 http://172.28.0.1:20830/`）

### ④ AC-340 判据在预览树上取 0（AC3）

```
$ cd /home/yale/work/quay-worktrees/goal-GOAL-030 && bash /tmp/ac340-crit.sh
PASS: serve pid 1038773 under /data/home/yale/work/quay-worktrees/goal-GOAL-030 runs this tree's own entry (/data/home/yale/work/quay-worktrees/goal-GOAL-030/packages/quay/bin/quay.ts) and serves http://172.28.0.1:20830/ (200 after redirects)
$ echo $?
0
```

stderr：**空**。（判据原文经 `quay goal show AC-340 --json` 取出后逐字执行，cwd = 该 worktree。）

### ⑤ 负对照：判据能取假，两个方向都验过（AC5 / AC6）

| 场景 | exit | stderr（逐字） |
|---|---|---|
| (a) 临时 git 树 + 主检出 `.quay/server.json` 原样拷贝（登记 pid 1769873 = 活着的**生产** serve，入口 = 主检出） | **1** | `CAUSE=serve-runs-foreign-code — the serve registered under /tmp/ac340-neg-a-csnC7A runs /data/home/yale/work/quay/packages/quay/bin/quay.ts, not this tree's own code` |
| (b) 临时 git 树，无 `.quay/server.json` | **3** | `NOT-EVALUATED: no live quay serve registered under /tmp/ac340-neg-b-Pe6uUH (.quay/server.json absent or pid dead) — start the preview with: quay goal preview GOAL-030 start --port <n>` |

两条都是**在被求值树之外**的树（`mktemp -d` + `git init`）上跑的，用的是**同一份**判据文件。

### ⑥ 留给人和 `quay goal merge` 的预览

`http://172.28.0.1:20830/`（pid 1038773，workspace root = `/home/yale/work/quay-worktrees/goal-GOAL-030`），**取证后保持运行**。时效边界见 DoD 的如实注记：分支 tip 前移会刷新该 worktree 并停掉预览，`quay goal merge` 前按同一条 `goal preview GOAL-030 start` 命令重起即可（一步）。⛔ 全程没有停、没有重启**生产** serve（主检出登记 pid 1769873）。

## Needs-Human

**执行 2026-10-08T03:24:43.005Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser attributed no failing file (failure-line count unavailable on this judgment)); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 72
- run_id：wk-prod-anchor
- session_id：e4530c70-fc76-458d-8b17-27462cf827d7
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-goal030-preview-runs-branch-code~wk-prod-anchor~1791429826952-5fdbdb.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-goal030-preview-runs-branch-code-wk-prod-anchor.log
