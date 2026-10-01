---
id: gap-ac251-resident-unified-host-dead-no-restore
title: AC-251 的活载体（主检出常驻统一 host）死了、且没有任何东西把它拉回来 ⇒ 判据此刻取假；修法=用仓库自己的动词把统一 host
  拉回主检出根，并留下「为什么它死了没人管」的直接量与发生率读数（GOAL-017 阶段 A2）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-251
---
## Proposal

**立案当轮的直接量（cwd = 主检出 `/data/home/yale/work/quay`，逐字，非转述）**：

```
$ node packages/quay/bin/quay.js server status --json
{ "schemaVersion": 1, "status": "not-running",
  "reason": "/data/home/yale/work/quay/.quay/server.json names pid 1709183, which is not alive
             (stale carrier — the server was killed without a graceful close)",
  "workspaceRoot": "/data/home/yale/work/quay",
  "carrierPath": "/data/home/yale/work/quay/.quay/server.json",
  "carrier": "present", "pid": 1709183, "startedAt": "2026-09-30T07:44:13.190Z",
  "services": [ { "name": "web",     "pid": null, "host": "172.28.0.1", "port": 20119,
                  "liveness": { "evaluated": false, "alive": null, "source": null, "detail": "<同上 reason>" } },
                { "name": "control", "pid": null, "host": "127.0.0.1",  "port": 21757,
                  "liveness": { "evaluated": false, "alive": null, "source": null, "detail": "<同上 reason>" } } ] }
EXIT=1

$ node packages/quay/bin/quay.js goal gate AC-251 --dry-run --json
{ "id": "AC-251", "verdict": "fail", "cause": null,
  "reason": "acceptance failed (exit 1) — AC-251: `quay server status --json` unavailable (exit 1)
             => web and control are not behind one status surface",
  "timeoutMs": 60000, "timestamp": "2026-10-01T04:40:58.703Z", "dryRun": true }

$ ls -d /proc/1709183                                   ⇒ No such file or directory
$ ps aux | grep -E 'work/quay/(packages|bin)' | grep -v grep ⇒ （空；本检出没有任何 serve host 在跑）
$ cat .quay/server.json
{ "schemaVersion": 1, "pid": 1709183, "startedAt": "2026-09-30T07:44:13.190Z",
  "services": [ { "name": "web",     "pid": 1709183, "host": "172.28.0.1", "port": 20119, "up": true  },
                { "name": "control", "pid": 1709183, "host": "127.0.0.1",  "port": 21757, "up": false } ] }
$ stat -c '%y' .quay/server.json                        ⇒ 2026-10-01 11:50:03 +0800  (= 2026-10-01T03:50:03Z)
$ cat .quay/serve.pid                                   ⇒ 1555141（同样已死；mtime 停在 2026-09-25 18:08）
$ cat .quay/server-services.json
{ "schemaVersion": 1, "pid": 1709183, "services": { "web": true, "control": false },
  "updatedAt": "2026-09-30T07:44:13.689Z" }
```

**缺口 = 判据的活载体不在，而这条判据的保证恰恰是「本工作区跑着一个统一 host」。** AC-251 的 criterion 是**活探针**：它要求
`quay server status --json` 报出 web 与 control 且 **pid 相同**、该 pid `os.kill(pid,0)` 活、且 `ss -lptnH` 命中它持有监听
socket。今天这三样一个都取不到（pid 已死、services 两项 pid 为 `null`），判据逐字 exit 1。

**为什么上一次的修复没兜住（`<!-- dedup-ref -->` 关联登记，仅追溯、不构成阻塞）**：机制本身没有坏。`gap-ac251-unified-server-web-control-same-process`（done）交付的
`quay server status/start/stop/restart` 与 `.quay/server.json` 载体**至今仍然工作**——台账里 AC-251 从
2026-09-25T03:51 到 2026-10-01T03:33 每小时一条 `goal-sweep` pass（该窗口 206 条 pass），证明机制在跑就是绿的。
**失效的不是机制，是载体本身**：常驻统一 host 于 2026-10-01 约 03:50Z 死亡（`server.json` mtime 03:50:03Z，最后一次
pass 是 03:33:18Z），而**这个工作区没有任何东西会把它拉回来** —— `plugin/scripts/driver-anchor.ts` 托管的 kind 集合是
六个 driver kind（promotion/worker/outer/goal/quality/meta），**不含** web/control；`plugin/scripts/start-drivers.ts` 有
host 死活判定与拉起，但**只在被调用时**才判。⇒ 载体缺席不是「部署回了旧代码」，而是「运行中的那个对象死了且无人接手」。

**发生率（硬规则 12：查历史，⛔ 不等下一轮）**：台账 `.quay/gate-events.jsonl` 里 `item_id=AC-251` 的 fail 事件共 **2** 条
（`goal-sweep` 2026-10-01T04:35:20.649Z、`goal-cli` 2026-10-01T04:36:06.002Z），pass 事件 759 条；自 2026-09-14 以来本判据
**只取假过这一次**。同一窗口 `.quay/server.json` 先后写过 **3** 个不同的 host pid（1555141 → 3652175 → 1709183）⇒
「host 死亡后需要外部把它拉回」实测 **≥2** 次。本任务只解决「当下这次」，把「无人监督」登记为观察项（AC3）。

**范围边界（⛔ 这是本任务最容易做错的地方）**：**不得**把 AC-251 的 criterion 或夹具改成「没有 host 在跑 ⇒ exit 3
（not-evaluated）」。同族 AC-28x/29x/30x 那样改是对的，因为那些判据的保证是**页面行为**、活 serve 只是它们观测用的
**探针面**；AC-251 的保证**本身就是**「本工作区跑着这一个进程」——一个运行态属性。AC 自己的 `expect` 与夹具都逐字钉死了这一点：
`packages/quay/test/server-status-web-control-same-pid.test.mjs:241-244 / 262-265 / 347-348` 断言
`code === 1` 且 `assert.notEqual(code, 3, "「没有 server 在跑」落在未达成，不落在未评估 (AC2)")`。改成 exit 3 会让这条判据在
host 长期不在时**永远不可评估**（判据恒不取假、也恒不验到任何东西 —— 硬规则 4c 的「空转」，比取假更危险）。

<!-- dedup-ref -->
**关联（仅登记，⛔ 不构成本任务任何前置）**：`gap-ac256-worker-restart-preserves-inflight-children`（done）与
`gap-ac254-partial-stop-web-driver-round-record`（done）都依赖同一个统一 host 活着，本任务恢复它后这两条一并回到可观测；
`gap-ac292-criterion-carrier-absence-not-evaluated`（done）的 AC7 已把「本实例无监督者」记为观察项，本任务沿用同一处理方式。

## Plan

1. **动手前先读一次现场（幂等）**：在主检出根跑 `node packages/quay/bin/quay.js server status --json`。若**已经有**一个活 host
   且 `web.pid === control.pid`（别人先恢复了），⛔ **不要再起第二个** —— 直接跳到第 3 步核对读数。`quay server start` 对已在跑的
   服务是 no-op（SPEC §6.9 不变式 1），但仍要自己核一次，⛔ 不把「命令 exit 0」当成「我起了一个」。
2. **用仓库自己的动词恢复，cwd/`--root` = 主检出根**（⛔ 不是任务 worktree —— worktree 的 `.quay/` 是刷新快照，判据又按 cwd 解析
   workspace root）：`node packages/quay/bin/quay.js server start --only web`。`--only web` 是刻意的：不碰任何 driver，且与
   已持久化的期望态 `.quay/server-services.json` 的 `{web:true, control:false}` 一致；carrier 仍会同时写出 `control` 行
   （先例读数：2026-09-29 的 `--only web` host 写出的 carrier 里 `control` 为 `{"pid":<host pid>, "up":false}`），而 criterion 要的
   「该 pid 真实持有监听 socket」由 web 面满足。⛔ **绝不 `pkill -f` 任何匹配 `quay.ts serve` 的模式**；⛔ 不跑 `quay driver stop`、
   ⛔ 不跑 `quay server stop`。
   - 动手前核一次现场是否安全：`ps aux | grep -c '[q]uay-task-worker'`、`git worktree list | grep -c quay-worktrees`
     （立案当轮读数：worker **0**、任务 worktree **1**）。这两个读数写进 Evidence —— 它们是「此刻重启不伤同类探针」的依据。
3. **把载体读成「读数」而不是「自报」**（criterion 的防伪半边就在这里）：`server status --json` 的 `services[]` 里
   `web.pid` 与 `control.pid` 是**同一个整数** ∧ `kill -0 <pid>` 成功 ∧ `ss -lptnH | grep "pid=<pid>,"` 命中。三项缺一不可，
   ⛔ 只比两个自报整数不算（这正是 AC 记录 origin 里那条 2026-09-13 审计加交叉核验针对的失败形态）。
4. **让台账自己记录，而不是自己在正文里声称**：在主检出根跑 `node packages/quay/bin/quay.js goal gate AC-251` ⇒ **exit 0**；
   随后从 `.quay/gate-events.jsonl` 里读出 `item_id=AC-251` 的**最新一条**（须为 `verdict:"pass"` 且 timestamp 晚于本任务落地时刻）
   逐字贴进 Evidence。⛔ 不要手写台账（硬规则 7 / 机制产物只由机制产生）。
5. **死亡成因：取直接量，⛔ 不猜测**（硬规则 4 推论四：能解释现象的说法不是被检验的结论）。取这几样：
   ① `.quay/serve.log` 末段逐字 —— 并明确回答「它有没有 2026-10-01 的行、有没有 shutdown 行」（立案当轮实测：末段全是
   2026-09-25 那个进程的 `STALE CODE` 行，**没有任何 2026-10-01 的行**，即那个 host 根本没往这里写日志）；
   ② `journalctl --since '2026-10-01 03:00' --until '2026-10-01 04:10'` 里的 OOM/kill 行（**读不到就写 `not-evaluated` 并写明为什么
   读不到** —— ⛔ 绝不把「读不到」写成「没有 OOM」，硬规则 3b）；
   ③ `.quay/server.json` 的 mtime 与最后一条 AC-251 pass 的时刻（03:50:03Z vs 03:33:18Z）。
   **若给不出「若原因 Y 为假则这些读数会不同」的对照，结论一律降为假说并在正文里标明是假说。**
6. **登记观察项，⛔ 不在本任务里造监督者**（见 AC3）：把「本工作区的统一 host 无监督者」连同上面第 2 / 第 5 步的读数写进
   Evidence。⛔ 不改 `plugin/scripts/driver-anchor.ts`、⛔ 不改 `plugin/scripts/start-drivers.ts` —— 给 host 加自愈属 SPEC 阶段
   之外的形态决策，本任务只提供立案它所需的读数。

## AC

- [x] **AC1（判据真 pass，且读的是生产载体）**：在主检出根逐字跑 `node packages/quay/bin/quay.js goal gate AC-251` ⇒ **exit 0**，贴出 JSON；**同一时刻**读 `node packages/quay/bin/quay.js server status --json`：`services[]` 里 `web.pid` 与 `control.pid` 是同一个整数、`kill -0 <pid>` 成功、`ss -lptnH | grep "pid=<pid>,"` 命中；并把 `.quay/gate-events.jsonl` 中 `item_id=AC-251` 的**最新一条**（`verdict:"pass"`，timestamp 晚于落地）逐字贴出。⛔ 判据文本与夹具逐字未改（见 AC4）。
- [x] **AC2（「为什么上一次的修复没兜住」= 直接量，不是猜测）**：贴出 ① `.quay/server.json` 的 `pid`/`startedAt` 与 `stat -c %y`；② `ls -d /proc/<pid>` 的 `No such file or directory`；③ `.quay/serve.log` 末段逐字，并明确回答「有无 2026-10-01 的行、有无 shutdown 行」；④ 死亡窗口的 `journalctl` OOM/kill 读数 —— **读不到就写 `not-evaluated` 并写明读不到的原因**；⑤ 最后一条 pass（03:33:18Z）与 carrier mtime（03:50:03Z）的先后。**给不出对照的因果一律标为假说**。
- [x] **AC3（观察项，⛔ 不阻塞；本任务不实现监督者）**：Evidence 中写明—— ① `plugin/scripts/driver-anchor.ts` 的托管 kind 集合（promotion/worker/outer/goal/quality/meta）**不含** web/control，`plugin/scripts/start-drivers.ts` 只在被调用时判 host 死活；② 发生率读数（硬规则 12，查历史）：台账 AC-251 fail **2** 条（均 2026-10-01）、pass **759** 条；`.quay/server.json` 在 2026-09-25→10-01 间写过 **3** 个不同 host pid（1555141 / 3652175 / 1709183）⇒ 「host 死后需外部拉回」实测 ≥2 次；③ 明确写出「登记为观察项而非阻塞项」及其理由。⛔ 本任务不得改上述两个 `plugin/scripts/*.ts`。
- [x] **AC4（非回归 + 边界未被越过）**：① `git diff --name-only` 相对 `## Touches` 之外为空；② `bash scripts/test.sh --for-task gap-ac251-resident-unified-host-dead-no-restore` 绿；③ 逐条说明**没有**改：`goals/AC-251-*.md` 的 criterion 文本、`packages/quay/test/server-status-web-control-same-pid.test.mjs`（其 5 条 `code === 1` 断言逐字未动）、`packages/quay/src/cli/server.ts` 的 0/1/3 退出契约（`not-running` 仍 exit 1）；④ 未跑 `quay driver stop` / `quay server stop`；⑤ 未使用 `pkill -f`。

## DoD

- **DIR-026 Reading A：一个真对象真的被操作过。** 本工作区**主检出根**上此刻跑着一个统一 host：它的 pid 同时是
  `quay server status --json` 报出的 `web.pid` 与 `control.pid`，它 `kill -0` 活、持有监听 socket，而 AC-251 的判据在这个
  活面上逐字 **exit 0**，且该 pass 已由机制（不是手写）落进 `.quay/gate-events.jsonl`，timestamp 晚于本任务落地时刻。
  **⛔ 「测试绿了」/「命令 exit 0」/「我起了个进程」都不算落地** —— 判据自己在那台活载体上取到 exit 0 才算。
- 判据文本与夹具逐字未改（AC4 ③ 逐条可核）。
- `bash scripts/test.sh --for-task gap-ac251-resident-unified-host-dead-no-restore` 绿。
- Evidence 含 AC2 的死亡直接量（或明确标注的假说）与 AC3 的观察项 + 发生率读数。
- 无依赖：`depends_on` 为空。

## Touches

- `tasks/gap-ac251-resident-unified-host-dead-no-restore.md`
- `packages/quay/src/cli/server.ts`
- `packages/quay/test/server-status-web-control-same-pid.test.mjs`

（说明：第一条是 self-touch；第二条是**唯一**可能的代码落地面 —— `quay server start` 动词与它写的 carrier 都在这里，若恢复过程中
发现该路径本身有缺陷就在此处修；第三条是**为 scoped 门选择而声明**（`--for-task` 需要一条与该判据绑定的测试），且本任务要求它
**逐字不变** —— 声明在 Touches 内不等于要改它。⛔ 明确**不在**本 Touches 内：`goals/AC-251-*.md`（criterion 文本，
改它就是本任务 Proposal 里明令禁止的那条错路）、`plugin/scripts/driver-anchor.ts` 与 `plugin/scripts/start-drivers.ts`
（观察项，非本任务目标）、`packages/quay/src/serve.ts`（不得为让判据变绿而动 web 面）。）

## Evidence

### 现场安全读数（动手前，Plan 2 要求）

```
$ ps aux | grep -c '[q]uay-task-worker'      ⇒ 1  ← 该 1 条是本 worker 自己；排除后真实在飞 worker = 0
$ git worktree list | grep -c quay-worktrees ⇒ 2  ← 其中 1 个是本任务 worktree；另一个 gap-ac292 的
                                                    末次提交停在 2026-09-29T10:44:39+08:00（死任务，非产能）
$ ps aux | grep -E 'work/quay/(packages|bin)' | grep -v grep ⇒ 无 serve host（只有一条 goal gate AC-190）
```

### AC1 — 判据在活载体上真 pass（机制产出，非手写）

主检出根（cwd = `/data/home/yale/work/quay`），`2026-10-01T04:46:42Z`：

```
$ node packages/quay/bin/quay.js goal gate AC-251 --json
{ "id": "AC-251", "verdict": "pass", "cause": null,
  "reason": "acceptance passed (exit 0)", "timestamp": "2026-10-01T04:46:42.597Z",
  "dryRun": false,
  "event": { "id": "efa5bbd8-0acb-4f51-ae7d-e9f9fca6e4f0", "item_id": "AC-251",
             "pipeline_id": "AC-251", "gate": "goal", "actor": "goal-cli",
             "verdict": "pass", "timestamp": "2026-10-01T04:46:42.597Z",
             "payload": { "reason": "acceptance passed (exit 0)" } } }
EXIT=0
```

同刻 `server status --json`：`status="degraded"`、`pid=2779056`、`startedAt=2026-10-01T04:44:34.766Z`、
`web.pid = control.pid = 2779056`。三项交叉核验（缺一不可，Plan 3）：

```
$ kill -0 2779056                       ⇒ exit 0（活）
$ ss -lptnH | grep "pid=2779056,"
LISTEN 0  511  172.28.0.1:20119  0.0.0.0:*  users:(("MainThread",pid=2779056,fd=24))
$ readlink -f /proc/2779056/cwd         ⇒ /data/home/yale/work/quay    ← 主检出根，不是任务 worktree
$ tr '\0' ' ' < /proc/2779056/cmdline   ⇒ .../bin/node --no-warnings --experimental-strip-types
                                            /data/home/yale/work/quay/packages/quay/bin/quay.ts serve
```

台账 `.quay/gate-events.jsonl` 中 `item_id=AC-251` 的最新一条（逐字）：

```
{"id":"efa5bbd8-0acb-4f51-ae7d-e9f9fca6e4f0","item_id":"AC-251","pipeline_id":"AC-251",
 "gate":"goal","actor":"goal-cli","verdict":"pass","timestamp":"2026-10-01T04:46:42.597Z",
 "payload":{"reason":"acceptance passed (exit 0)"}}
```

`degraded` 而非 `running` 是**读数而非失败**：`--only web` 只开 web 面，control 与 web 同 pid 但不监听
（carrier 的 `{web:true, control:false}` 与已持久化的期望态一致），criterion 要的 pid-identity 契约仍成立 ⇒ exit 0。
本任务落地前该判据最后一条 pass 是 `2026-10-01T03:33:18.846Z`（goal-sweep）；本次恢复后新增的 pass 为
`04:45:12.813Z`、`04:46:42.597Z`（我跑的两次），其间 `04:46:23.893Z` 另有一条 goal-cli pass（非本 worker 发起）
—— 三者 timestamp **均晚于本任务落地时刻**。

### AC2 — 「为什么上一次的修复没兜住」：直接量

**① carrier 内容与 mtime**（恢复前逐字）：

```
$ cat .quay/server.json
{ "schemaVersion": 1, "pid": 1709183, "startedAt": "2026-09-30T07:44:13.190Z",
  "services": [ { "name": "web",     "pid": 1709183, "host": "172.28.0.1", "port": 20119, "up": true  },
                { "name": "control", "pid": 1709183, "host": "127.0.0.1",  "port": 21757, "up": false } ] }
$ stat -c '%y' .quay/server.json  ⇒ 2026-10-01 11:50:03.171727631 +0800  (= 2026-10-01T03:50:03Z)
```

**② pid 已死**：

```
$ ls -d /proc/1709183  ⇒ ls: cannot access '/proc/1709183': No such file or directory
```

**③ `.quay/serve.log` 末段逐字**（21414 B，mtime `2026-09-29 09:31:08 +0800`）：

```
[quay serve] STALE CODE: 进程 2026-09-25T10:08:25.330Z 启动，最新 serve 相关提交 2026-09-28T11:01:18.000Z 晚于启动 — 运行中的代码已过期，请重启 server。
[quay serve] STALE CODE: 进程 2026-09-25T10:08:25.331Z 启动，最新 serve 相关提交 2026-09-28T11:01:18.000Z 晚于启动 — 运行中的代码已过期，请重启 server。
（末段 25 行全部为此两行的重复，全部属于 2026-09-25 那个进程）
```

**明确回答**：该文件里 `2026-10-01` 的行数 = **0**（`grep -c '2026-10-01'` ⇒ `0`）；
shutdown / SIGTERM / SIGINT / exiting / closing / graceful 行数 = **0**（`grep -inE 'shutdown|sigterm|sigint|exiting|closing|graceful'` 无输出）。
⇒ 死掉的那台 host（`startedAt 2026-09-30T07:44:13Z`）**从未往 serve.log 写过任何一行**；最后写它的仍是 2026-09-25 那个进程。
**这不是「没有日志」，是「日志载体对那台进程根本不生效」** —— 它使「事后读日志判死因」在本工作区结构性不可用。

**④ 死亡窗口的 OOM/kill 读数 —— ⚠️ 立案轮的窗口是【本地时区】误读，此处更正**：

`journalctl --since/--until` 按**本地时区 (+08:00)** 解释。死亡窗口 `2026-10-01T03:30Z–04:10Z` 对应**本地 `11:30–12:10`**
（按字面 `03:00–04:10` 取会落在 2026-09-30 的 19:00–20:10Z，是个**不相干的窗口**）。按正确窗口重取：

```
$ journalctl --since '2026-10-01 11:30:00' --until '2026-10-01 12:10:00' | wc -l   ⇒ 155
$ journalctl --since '2026-10-01 11:30:00' --until '2026-10-01 12:10:00' \
    | grep -icE 'out of memory|oom-kill|killed process|oom_reaper'                  ⇒ 1
（那唯一一条，逐字）
2026-10-01T11:50:06+08:00 VM-16-5-ubuntu bash[780215]:     oom-kill journal noise reduction     nameSource=auto       kind=bg
```

⇒ 这**唯一一条是假阳性**：它是某脚本打印的「oom-kill 日志降噪」配置行，**不是 OOM-kill 记录**。死亡窗口内**没有内核 OOM-kill 记录**。

**校验谓词本身能取真**（硬规则 2 的零计数配套动作 —— 把谓词对着一个已知为真的样本干跑一次）：
同一条 `grep -icE` 在**更宽窗口**（`2026-09-30 00:00` → `2026-10-01 05:00` 本地）上取到 **21** 条，前三条逐字：

```
Sep 30 14:58:35 VM-16-5-ubuntu systemd[319121]: run-r7cb4b7b5d0be4e24bc94361b51dc2821.scope: Failed with result 'oom-kill'.
Sep 30 15:07:04 VM-16-5-ubuntu systemd[319121]: run-r425bf525968e4b3dac4f7fb501f5320f.scope: Failed with result 'oom-kill'.
Sep 30 15:21:11 VM-16-5-ubuntu systemd[319121]: run-rce11c9d324df4861b6d727e4ac69ce04.scope: Failed with result 'oom-kill'.
```

⇒ 该谓词**在用户 journal 里能命中真 OOM-kill**，所以死亡窗口的「0 条真命中」是**可信的零**，不是谓词失效。

**`dmesg -T | grep -iE 'oom|killed process'` 无输出 ⇒ 记为 `not-evaluated`，⛔ 不写成「没有 OOM」**：
`journalctl` 自己打 hint `Hint: You are currently not seeing messages from other users and the system. Users in groups 'adm',
'systemd-journal' can see all messages.` ⇒ 它**只读用户 journal**；内核级 OOM-killer 记录落在 system/kernel journal，
本用户读不到。⇒ 「死亡窗口没有系统级 OOM 记录」这句话**不可得**，标为 not-evaluated。

**⑤ 最后一条 pass 与 carrier mtime 的先后**：

```
最后一条 pass (goal-sweep) = 2026-10-01T03:33:18.846Z
carrier mtime             = 2026-10-01T03:50:03Z          ← 晚 16 分 45 秒
第一条 fail (goal-sweep)   = 2026-10-01T04:35:20.649Z      ← 晚 45 分 17 秒
恢复 (本次 server start)   = 2026-10-01T04:44:34.766Z      ← 窗口共 54 分 31 秒无人拉回
```

#### 死亡成因：**有对照的结论**（不是假说）

**结论**：统一 host 的**会话与 cgroup 分离** —— `spawnHost`（`packages/quay/src/cli/server.ts:487-519`）用
`spawn(process.execPath, args, { detached: true, stdio: "ignore" })` + `child.unref()`。`detached:true` 只做 `setsid()`：
子进程**换了会话、被 reparent 到 systemd**，但 **cgroup 仍继承调用者**。⇒ 任何一次调用者 cgroup 的 teardown 都会把
「看起来已脱离」的 host 一起杀掉。

**支撑读数（今天在场的复现，不是追溯）**：

```
$ cat /proc/self/cgroup      ← 本 worker 的 shell
0::/user.slice/user-1004.slice/user@1004.service/app.slice/quay-anchor-quay-1790764586839.scope
$ cat /proc/2779056/cgroup   ← 我本次起的新 host
0::/user.slice/user-1004.slice/user@1004.service/app.slice/quay-anchor-quay-1790764586839.scope
$ ps -o pid,ppid -p 2779056  ⇒ PPID = 319121（systemd --user）
```

**同一个 cgroup** —— 而它 PPID 已被 reparent 到 systemd。「脱离」对 **cgroup 生命周期**而言是假的。

**死亡窗口的对照**（硬规则 4 推论四：若原因 Y 为假，读数会不同）：`2026-10-01T11:50:00–03` 本地
（= `03:50:00–03:50:03Z`）systemd 正在整片 teardown 一个 `claudecodeui-server.service` + 其 `claudecodeui-session-2578273-*.scope` 家族：

```
2026-10-01T11:50:00+08:00 systemd[319121]: Stopping claudecodeui-server.service - .../npm run server...
2026-10-01T11:50:01+08:00 systemd[319121]: Stopped  claudecodeui-session-2578273-224b085f.scope - ... claude ...
2026-10-01T11:50:02+08:00 systemd[319121]: Stopped  claudecodeui-session-2578273-70bafbee.scope - ... claude ...
2026-10-01T11:50:03+08:00 systemd[319121]: Stopped  claudecodeui-session-2578273-ebc47eee.scope - ... claude ...
```

**carrier 的 mtime 正是 `03:50:03Z`** —— 与 teardown 的最后一声同一秒。

**对照**：同一个 driver anchor（pid 3653553，起于 `2026-09-30 18:36:26` 本地，**早于**该 teardown）**穿过了这个窗口继续心跳**：

```
promotion-round: … 03:49:47.043Z → 03:50:34.305Z → 03:51:24.502Z …   ← 跨过 03:50Z
goal-round:      … 03:49:22.008Z → 03:51:48.601Z …
```

⇒ 若 `03:50Z` 那次是**全机**杀进程，anchor 也会死。它没死 ⇒ 那次 kill 是 **cgroup 内**的。
结合「host 的 cgroup = 调用者 cgroup」（上面当场复现），host 死亡的**必要条件**得到确认：**它当时在那个被 teardown 的 cgroup 里**。

**残留缺口（诚实标注）**：死掉的 pid 1709183 的 `/proc/<pid>/cgroup` **无法回读**（进程已不存在），
所以「它当时属于哪个 cgroup」这一步是**由排除法 + 机制读数推出**的，不是直接读到的。
写成**结论而非假说**的依据是：机制读数（`detached:true` 不迁移 cgroup）**今天当场复现**，且对照排除了全机杀。
⇒ 若该机制为假（即 `detached` 真能脱离 cgroup），今天新起的 host 就**不会**落在 `quay-anchor-…scope` 里 —— 它落进去了。

**无人拉回：直接量**。本工作区的常驻机件集合里**没有** web/control 的监督者（见 AC3①）。
⇒ host 死后，从 `03:50:03Z` 到本次恢复 `04:44:34Z`，**没有任何机件会去拉起它**。

### AC3 — 观察项（⛔ 不阻塞；本任务不实现监督者）

**① 无人监督（直接量）**：`plugin/scripts/driver-anchor.ts` 托管的 kind 集合 = 六个 driver
（promotion/worker/outer/goal/quality/meta），**不含** web/control；`plugin/scripts/start-drivers.ts` 有 host 死活判定与拉起，
但**只在被调用时**才判。**本任务未改这两个文件**（worktree `git diff --name-only` 为空，见 AC4①）。

**② 发生率（硬规则 12：查历史，不等下一轮）** —— ⚠️ **立案轮的「fail 共 2 条」是窗口数、被写成了总数，此处更正**：

| 量 | 立案轮读数 | 本次实测（恢复前） |
|---|---|---|
| AC-251 `fail` 事件总数 | 「2 条」 | **36 条**（09-13: 32 / 09-14: 2 / 10-01: 2）|
| 其中落在 2026-10-01 死亡窗口 | 2 条 | **2 条**（`04:35:20.649Z` goal-sweep、`04:36:06.002Z` goal-cli）|
| 其余 34 条 | 未提 | **全部早于判据达成**（09-13 与 09-14 早段，origin 已注明当时「结构上必然取假」）|
| AC-251 `pass` 事件 | 759 条 | 759 条（恢复后 762，含本次 3 条）|

⇒ 立案轮的「2」**不是错的**，但它只在「2026-10-01 死亡窗口」这一层成立；写成「共 2 条」会把 09-13/09-14 的
34 条历史 fail 与本次缺陷混为一谈。**「自 2026-09-14 以来只取假过这一次」这句实质成立**：`>2026-09-14` 的 fail
**只有** 2026-10-01 那 2 条。

`.quay/server.json` 在 `2026-09-25 → 10-01` 间写过 **3 个不同 host pid**（1555141 → 3652175 → 1709183）
⇒ 「host 死后需要外部把它拉回」**实测 ≥2 次**（本次是第 3 次）。

**③ 登记为观察项而非阻塞项**：本任务**只**恢复当下的活载体、并提供立案后续所需的读数；
给 host 加自愈（把它纳入 anchor 的托管集合 / 让它起在自己的 systemd scope 里）属 **SPEC 阶段之外的形态决策**，
按 Proposal 的范围边界**本任务不实现**，也**不改**上述两个 `plugin/scripts/*.ts`。

**⚠️ 前向含义（一并登记）**：本次恢复**本身不持久** —— 新 host 落在
`quay-anchor-quay-1790764586839.scope`（driver anchor 的 cgroup），该 scope 被 teardown 时它会**以完全相同的方式再死一次**。
这正是上面那条机制的推论，不是新的猜测。

### AC4 — 非回归 + 边界未被越过

**① 改动范围**：worktree `git diff --name-only` ⇒ **空**（本任务**无代码改动**）。恢复过程**未发现** `quay server start`
路径本身有缺陷：`outcome` 报 `started`（而非 `already-running`）、carrier 写对、criterion 逐字 exit 0 ⇒ 不动 `server.ts`。

**② scoped 门绿**：

```
$ bash <wt>/scripts/test.sh --for-task gap-ac251-resident-unified-host-dead-no-restore --allow-thin
warning: test-selection-thin: task … resolved tests for 1/3 Touches entries (0.33) < 0.5; pass --allow-thin to run anyway
ℹ tests 94   ℹ pass 94   ℹ fail 0        EXIT=0
```

**⚠️ 诚实标注**：该次运行跑的是 **scoped 静态检查层**（DIR-070-B/C、M143、M179、M120、M172 等 plugin 形状检查）；
`grep -c 'server-status-web-control-same-pid'` = **0** ⇒ **AC-251 绑定的那个夹具并未被选中**（即 thin 警告所说的 1/3）。
⇒ **另行直跑该夹具**（AC4③ 要求它逐字不变，且这也是「本任务没把判据/夹具改坏」的正面证据）：

```
$ node --experimental-strip-types --test packages/quay/test/server-status-web-control-same-pid.test.mjs
✔ AC1/AC3 — the unified server reports web+control under ONE live pid …
✔ AC2 — graceful stop retires the carrier ⇒ exit 1 (≠0, ≠3); a SIGKILL leaves it stale …
✔ AC3 — `ps -p <status 报出的 pid> -o args=` is the unified server entry, and web.pid === control.pid === that pid
✔ AC5 — two workspaces each report their OWN server's pid …
✔ 硬规则 3b — a corrupt / wrong-schema carrier is NOT-EVALUATED (exit 3) …
✔ SPEC §6.10/§8-8 — a live host whose services do not answer reads `degraded` …
✔ `quay server status` is reachable and documented …
✔ SPEC §6.9/§8-9 — the stage-B verbs are reachable AND the stage-A `serve` flag surface did not grow
✔ AC4 — the built dist bundle is a working unified server too
ℹ tests 9   ℹ pass 9   ℹ fail 0          EXIT=0
```

**③ 逐条说明「没有改」**（三者与 `develop` 逐字相同；md5 取自 `git show develop:<path> | md5sum`）：

| 文件 | 断言 / 契约 | 读数 |
|---|---|---|
| `goals/AC-251-web-与-control-…-pid-相同-spe.md` | criterion 文本 + `expect:` | **未改**（md5 `a48784c33e74`）|
| `packages/quay/test/server-status-web-control-same-pid.test.mjs` | 5 条 `code === 1`（:242/:262/:347/:418/:426）+ 2 条 `assert.notEqual(code, 3)`（:241/:263）| **未改**（md5 `3db46c689770`），且 9/9 绿 |
| `packages/quay/src/cli/server.ts` | 0/1/3 退出契约（`not-running` 仍 exit 1）| **未改**（md5 `f2c6473c8746`）|

⇒ **未走** Proposal 明令禁止的那条错路（把 criterion 改成「无 host ⇒ exit 3 not-evaluated」）。

**④ 未跑 `quay driver stop` / `quay server stop`**：本任务只调用 `server status`、`server start --only web`、`goal gate`
（外加只读探针）。
**⑤ 未使用 `pkill -f`**：全程未发任何 `pkill`/`kill` 信号；新 host 由 `quay server start` 自身 spawn。

### 附：恢复过程发现的两条旁证（登记，本任务不修）

1. **`server.ts:764` 的 detail 措辞把两种情况合并了**：`"face opened inside the existing host"` 在
   **本趟刚 spawn 出一个新 host** 的分支上也会打印（本次实测输出逐字即此串，而当时并无既有 host）。
   `outcome` 字段（`started` vs `already-running`）是**正确可区分**的，只有 detail 文案把「在既存 host 里开面」
   与「刚起了个 host 再开面」写成同一句话（硬规则 3b 的形态）。
   **本任务不改**：AC4③ 钉住该文件的退出契约，且本任务的范围边界是「读数」而非形态决策；建议单独立案修文案。
2. **`.quay/serve.log` 对 spawn 出来的 host 不生效**（AC2③ 的直接量）：那台 host 一行日志都没写。
   这使「事后读日志判死因」在本工作区结构性不可用，也是 AC2④ 只能靠 journal 的原因。
