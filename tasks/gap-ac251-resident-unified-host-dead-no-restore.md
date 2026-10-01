---
id: gap-ac251-resident-unified-host-dead-no-restore
title: AC-251 的活载体（主检出常驻统一 host）死了、且没有任何东西把它拉回来 ⇒ 判据此刻取假；修法=用仓库自己的动词把统一 host
  拉回主检出根，并留下「为什么它死了没人管」的直接量与发生率读数（GOAL-017 阶段 A2）
status: todo
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
（not-evaluated）」。同族 AC-28x/29x/30x 那样改是对的，因为那些判据的保证是**页面行为**、活 serve 只是它们观测用的**探针面**；
AC-251 的保证**本身就是**「本工作区跑着这一个进程」——一个运行态属性。AC 自己的 `expect` 与夹具都逐字钉死了这一点：
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

- [ ] **AC1（判据真 pass，且读的是生产载体）**：在主检出根逐字跑 `node packages/quay/bin/quay.js goal gate AC-251` ⇒ **exit 0**，贴出 JSON；**同一时刻**读 `node packages/quay/bin/quay.js server status --json`：`services[]` 里 `web.pid` 与 `control.pid` 是同一个整数、`kill -0 <pid>` 成功、`ss -lptnH | grep "pid=<pid>,"` 命中；并把 `.quay/gate-events.jsonl` 中 `item_id=AC-251` 的**最新一条**（`verdict:"pass"`，timestamp 晚于落地）逐字贴出。⛔ 判据文本与夹具逐字未改（见 AC4）。
- [ ] **AC2（「为什么上一次的修复没兜住」= 直接量，不是猜测）**：贴出 ① `.quay/server.json` 的 `pid`/`startedAt` 与 `stat -c %y`；② `ls -d /proc/<pid>` 的 `No such file or directory`；③ `.quay/serve.log` 末段逐字，并明确回答「有无 2026-10-01 的行、有无 shutdown 行」；④ 死亡窗口的 `journalctl` OOM/kill 读数 —— **读不到就写 `not-evaluated` 并写明读不到的原因**；⑤ 最后一条 pass（03:33:18Z）与 carrier mtime（03:50:03Z）的先后。**给不出对照的因果一律标为假说**。
- [ ] **AC3（观察项，⛔ 不阻塞；本任务不实现监督者）**：Evidence 中写明—— ① `plugin/scripts/driver-anchor.ts` 的托管 kind 集合（promotion/worker/outer/goal/quality/meta）**不含** web/control，`plugin/scripts/start-drivers.ts` 只在被调用时判 host 死活；② 发生率读数（硬规则 12，查历史）：台账 AC-251 fail **2** 条（均 2026-10-01）、pass **759** 条；`.quay/server.json` 在 2026-09-25→10-01 间写过 **3** 个不同 host pid（1555141 / 3652175 / 1709183）⇒ 「host 死后需外部拉回」实测 ≥2 次；③ 明确写出「登记为观察项而非阻塞项」及其理由。⛔ 本任务不得改上述两个 `plugin/scripts/*.ts`。
- [ ] **AC4（非回归 + 边界未被越过）**：① `git diff --name-only` 相对 `## Touches` 之外为空；② `bash scripts/test.sh --for-task gap-ac251-resident-unified-host-dead-no-restore` 绿；③ 逐条说明**没有**改：`goals/AC-251-*.md` 的 criterion 文本、`packages/quay/test/server-status-web-control-same-pid.test.mjs`（其 5 条 `code === 1` 断言逐字未动）、`packages/quay/src/cli/server.ts` 的 0/1/3 退出契约（`not-running` 仍 exit 1）；④ 未跑 `quay driver stop` / `quay server stop`；⑤ 未使用 `pkill -f`。

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
