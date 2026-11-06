# goal-filing 整链审计的 live 证据 — `gap-goal-filing-chain-audit`（GOAL-914 / AC-937）

本文件是 `tasks/gap-goal-filing-chain-audit.md` 的 live 证据。它证明的不是「fixture 里能产出读数」，
而是**审计器对真实工作区真实台账跑出的、可解释的 verdict**——包括它此刻返回**非绿**这件事本身：
一个只会返回 0 的读数与「一切正常」同形（硬规则 3/4），本读数能取到 1 恰是它不是回声的证据。

审计器：`plugin/scripts/goal-filing-chain-audit.ts`（只读；不写文件、不改任务状态、不进任何判据链）。

## 1. 被测的生产载体，逐字抄录

台账 `/data/home/yale/work/quay/.quay/goal-filing.jsonl`（生产工作区根，gitignored 运行时载体）：

```jsonl
{"state":"spawned","requestId":"GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0","ac":"AC-937","goal":"GOAL-914","at":"2026-11-06T07:49:45.867Z","promptSha":"e5af4127b26ba5a4","round":"2026-11-06T07:49:45.859Z"}
{"state":"filed","requestId":"GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0","ac":"AC-937","goal":"GOAL-914","at":"2026-11-06T07:57:41.597Z","spawnedAt":"2026-11-06T07:49:45.867Z","taskId":"gap-goal-filing-chain-audit","reason":null}
```

它指向的任务文件 `tasks/gap-goal-filing-chain-audit.md` 的 frontmatter（测量时刻 = 本任务**尚未**落地）：

```
---
id: gap-goal-filing-chain-audit
title: goal-filing 整链审计：filed 行的 taskId 与任务落地状态交叉核对
status: ready
...
goal_ac: AC-937
---
```

## 2. 逐字运行记录（2026-11-07T01:04:35+08:00）

命令（cwd = 本任务的 worktree，`--root` 指生产工作区根；⛔ 审计器只读，故可安全指向主检出）：

```console
$ node --no-warnings --experimental-strip-types plugin/scripts/goal-filing-chain-audit.ts \
      --root /data/home/yale/work/quay
goal-filing-chain-audit — root=/data/home/yale/work/quay
  ledger: /data/home/yale/work/quay/.quay/goal-filing.jsonl
  scope : AC-937
  AC-937  GOAL-914  task=gap-goal-filing-chain-audit  verdict=not-done  (status=ready, goal_ac=AC-937)
summary: filed=1 landed=0 task-missing=0 goal-ac-mismatch=0 not-done=1 no-task-id=0 malformed=0 unfiled-claims=0
verdict: chain-broken
EXIT=1
```

`--json`（同一次运行形态；`--json` 与人类可读形态读的是同一个 `AuditReading`）：

```console
$ node --no-warnings --experimental-strip-types plugin/scripts/goal-filing-chain-audit.ts \
      --root /data/home/yale/work/quay --json
{
  "tool": "goal-filing-chain-audit",
  "root": "/data/home/yale/work/quay",
  "ledger": "/data/home/yale/work/quay/.quay/goal-filing.jsonl",
  "evaluated": true,
  "cause": null,
  "badLines": 0,
  "scope": {
    "requested": null,
    "acs": [
      "AC-937"
    ]
  },
  "rows": [
    {
      "requestId": "GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0",
      "ac": "AC-937",
      "goal": "GOAL-914",
      "taskId": "gap-goal-filing-chain-audit",
      "filedAt": "2026-11-06T07:57:41.597Z",
      "verdict": "not-done",
      "status": "ready",
      "taskGoalAc": "AC-937"
    }
  ],
  "unfiledClaims": [],
  "malformed": [],
  "summary": {
    "filedRows": 1,
    "landed": 0,
    "noTaskId": 0,
    "taskMissing": 0,
    "goalAcMismatch": 0,
    "notDone": 1,
    "malformedFiledRows": 0,
    "unfiledClaims": 0
  },
  "verdict": "chain-broken"
}
EXIT=1
```

## 3. 这个 verdict 怎么读（为什么 `not-done` 是此刻**正确**的读数）

- 台账里唯一一条终态 `filed` 行（`requestId = GOAL-914|AC-937|…|0`）记下的 `taskId` 是
  `gap-goal-filing-chain-audit`，也就是**本任务自己**：它是 driver 那次真实 spawn 立下的案。
- 测量时刻该任务文件是 `status: ready`（本任务还在被实现）。所以该行 verdict = `not-done`，
  `landed = 0 ≠ filedRows = 1` ⇒ `verdict = chain-broken`、退出码 `1`。
- **这正是 AC-937 缺的那个读面该说的话**：一条 `filed` 行只说明「driver 立了案」，不说明「案落地了」。
  在旧判据里，只要另有任一份带 `goal_ac: AC-937` 且 `done` 的任务，这一行就会被翻绿——而本读数不会。
- `evaluated: true`（而不是 2）：台账可读、`tasks/` 可读、有终态 `filed` 行 ⇒ 这是**查过之后的结论**，
  不是「没查成」。`cause: null` 与之互斥。
- `unfiledClaims: []`：本仓此刻没有第二份 `done` 任务认领 AC-937（`grep -l '^goal_ac: AC-937' tasks/*.md`
  只命中本任务），所以预置认领探针这次没有命中——⛔ 但「没命中」是被报告的（`unfiledClaims: []` 与
  `evaluated:false` 不同形）。

### 下一轮复核点（读数应如何变化）

本任务落成 `done` 之后，同一条命令必须变为 `verdict: chain-landed`、`EXIT=0`：

```console
$ node --no-warnings --experimental-strip-types plugin/scripts/goal-filing-chain-audit.ts \
      --root /data/home/yale/work/quay --json | grep -E '"verdict"|"evaluated"'
  "evaluated": true,
  "verdict": "chain-landed"
$ echo $?
0
```

若那时仍读到 `chain-broken`，说明本任务没有真的落地（或 `tasks/gap-goal-filing-chain-audit.md` 的
`goal_ac` / `status` 被改动），⛔ 不要调高阈值或改判据来把它变绿。

## 4. 负控（fixture，⛔ 不冒充生产读数）

`plugin/test/goal-filing-chain-audit.test.mjs` 里每一条腿都对着**已知为假**的输入干跑一次（硬规则 2 的
另一半：零命中也要证明谓词在真样本上会命中）。逐条实测退出码与 verdict：

| 输入（fixture） | 退出码 | verdict | 说明 |
|---|---|---|---|
| `filed{taskId:t1}` + `t1` done/AC-1 | 0 | `landed` | 正控：全链成立才绿 |
| `filed{taskId:gone}`，`tasks/gone.md` 不存在 | 1 | `task-missing` | 案挂了 |
| `filed{ac:AC-1}` + 任务写 `goal_ac: AC-2` | 1 | `goal-ac-mismatch` | 立的是 A 案、落地的是 B 案 |
| `filed{taskId:t1}` + `t1` 为 `todo` | 1 | `not-done` | 案还在 todo |
| 唯一 `filed` 行 landed，另有 done 任务认领同一 AC 却无人指向 | 1 | `chain-broken` + `unfiledClaims:[t2]` | **预置认领**（本任务要消灭的 (a) 形态） |
| `filed` 指向 todo 的 T1，另有 done 的 T2 认领同一 AC | 1 | `not-done` | AC-939 的替代品形态：⛔ 判 0 就是回归 |
| `filed` 行缺 `taskId` | 1 | `no-task-id` | 与 `task-missing` 不同形（硬规则 3b） |
| 空台账 / 只有 `spawned` 行 | 2 | `evaluated:false`，`cause=no-filed-rows` | 未评估 ≠ 绿 |
| `--ac AC-999`（从未立案） | 2 | `cause=no-filed-rows-and-no-done-claim` | 未评估 ≠ 绿 |
| 无 `tasks/` 目录 | 2 | `cause=tasks-unreadable` | 读不懂输入不得伪装成「零任务」 |
| `--ac` 点名从未立案、但已有 done 任务认领的 AC | 1 | `unfiledClaims:[preset]` | 显式范围下的预置探针 |

生产读数只有 §2 那一份；§4 的每一行都是 fixture，⛔ 不得拿它冒充「生产已跑通」。

## 5. 已知口径（读读数前必须知道的三条）

1. **缺省范围 = 台账里出现过 `filed` 行的 AC 集合**，不是「全仓所有 done 任务的 `goal_ac`」。
   本仓有 427 份任务带 `goal_ac`，多数由台账之前的机制立案；全量比对会把**历史**判成**预置**，
   使读数恒红。要审某个从未进过台账的 AC，用 `--ac` 显式点名（见 §4 最后一行）。
2. **多行文件台账的判红规则**：只要**任一条** `filed` 行的 verdict 非 `landed` ⇒ `chain-broken`。
   一条 filing 事件没落地就是没落地，⛔ 不用「另有一条 landed」把它平均掉。
3. **本审计器不做时钟推断**：它不比较 `filed.at` 与任务 mtime（那是 `reconcileGoalFiling` 的职责），
   只读台账已落盘的 `taskId` 与任务文件当前的 `goal_ac` / `status`。
