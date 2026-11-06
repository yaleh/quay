# `goal-next` 投影的 live 证据 — `gap-goal-next-projection`（GOAL-914 / AC-935）

本文件是 `tasks/gap-goal-next-projection.md` 的 live 证据。它要证明的不是「测试能产出读数」，而是
**实现落地之后，真实的一轮 goal-driver 真的把 `goal-next` fact 写进了轮记录，且 Core CLI
`quay goal next` 从同一份 fact 读出的数组与它逐字相同**。

证据来自**真实 GOAL 记录**（`goals/` 里 GOAL-914 及其 9 条 AC，即本仓 2026-11-07 的实际存量），
不是 fixture：驱动器在一份只含 `goals/` + `tasks/` 拷贝的临时根上跑了一轮真轮次（见 §0 的复跑方式），
判据、缺口计算、投影与轮记录全部走生产同一条代码路径。

## 0. 复跑方式（可重放）

```bash
WT=/data/home/yale/work/quay-worktrees/gap-goal-next-projection
EV=$(mktemp -d /tmp/goal-next-evidence.XXXXXX)   # 任意空目录
mkdir -p "$EV/.quay"; cp -r "$WT/goals" "$EV/goals"; cp -r "$WT/tasks" "$EV/tasks"
cat > "$EV/.quay/config.yml" <<EOF
providers:
  native:
    enabled: true
    path: "$WT/packages/quay-native"
    tasks_dir: "$EV/tasks"
    mcp_entry: ["node", "$WT/packages/quay-native/bin/quay-native.ts", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "$EV/tasks"
EOF

# ① 一轮真轮次（--once；--spawn-cap 0 ⇒ 本轮不 spawn，本证据只读投影）
node --experimental-strip-types "$WT/plugin/scripts/goal-driver.ts" \
  --root "$EV" --once --spawn-cap 0 --gap-worker-cmd true \
  --round-log "$EV/.quay/goal-round.jsonl"

# ② CLI 读面
node --experimental-strip-types "$WT/packages/quay/bin/quay.ts" goal next --root "$EV" --json
```

## 1. 轮记录里的 `goal-next` fact（逐字抄录）

载体：`$EV/.quay/goal-round.jsonl`，该文件**只有一条**记录（`--once` 跑了一轮）。
轮信封：`round=1`、`run_id=goal-1793986706177`、`ts=2026-11-06T17:38:50.427Z`、`stopped_mid_round=false`、
`halted=false`。该轮 `facts[]` 的名字依次是：

```
goal-ring:verified | goal-sufficiency:verified | goal-objective:verified | goal-gaps:verified
| goal-next:verified | goal-target-health:not-evaluated
```

`goal-next` 条目的 value 与 reason **逐字**（一条紧凑 JSON，未经改写）：

```json
{"name":"goal-next","value":{"rows":[{"goal":"GOAL-914","ac":"AC-936","gapState":"stalled","rank":"stalled","owner":"worker","action":{"kind":"fix-artifacts","reason":"linked tasks cannot advance on their own; fix what blocks them"},"evidenceRefs":["gap:AC-936","task:gap-goal-request-queue:todo"]}],"evaluated":true,"cause":null},"state":"verified","reason":"active goal 1 个 ⇒ 1 行：GOAL-914/AC-936/stalled/worker/fix-artifacts"}
```

同一轮的 `goal-ring` fact 的 `value.next` **逐字等于**上面 `value.rows`（同一份数组分别落进两条 fact，
⛔ 不是 driver 侧另算一遍）：

```json
[{"goal":"GOAL-914","ac":"AC-936","gapState":"stalled","rank":"stalled","owner":"worker","action":{"kind":"fix-artifacts","reason":"linked tasks cannot advance on their own; fix what blocks them"},"evidenceRefs":["gap:AC-936","task:gap-goal-request-queue:todo"]}]
```

要点（每一项都对着 AC）：

- **每个 active GOAL 恰好一行**：本轮 active GOAL 只有 GOAL-914（`value.goalCount=1`），投影正好 1 行；
  非 active 的 GOAL（909/910/911/912/913 …）一行都没有。
- **`ac` 非空、`gapState` 在枚举内、`owner` 在枚举内、`action.kind` 非空**：`AC-936` /
  `stalled`（`GapState` 的取值）/ `worker`（`{driver,worker,human,world}`）/ `fix-artifacts`
  （`{file-task,resume-task,fix-artifacts,ask-human,wait}`）。
- **`evidenceRefs` 可追溯**：`gap:AC-936` 指本轮的缺口读数，`task:gap-goal-request-queue:todo`
  指该 AC 关联的那条在飞任务（状态逐字带上）。
- **`gapState` 不是第二套读数**：它是 `computeGoalGaps` 本轮对 AC-936 的读数原样带出（`goal-ring`
  的 `value.gaps` 与 `goal-gaps` fact 里都有同一取值）；投影只额外回答「归谁、做什么」。

## 2. CLI 输出（逐字抄录）

```
$ node --experimental-strip-types packages/quay/bin/quay.ts goal next --root "$EV" --json
EXIT=0
```

stdout（**JSON 数组**；AC-935 的判据就是这个形状）：

```json
[
  {
    "goal": "GOAL-914",
    "ac": "AC-936",
    "gapState": "stalled",
    "rank": "stalled",
    "owner": "worker",
    "action": {
      "kind": "fix-artifacts",
      "reason": "linked tasks cannot advance on their own; fix what blocks them"
    },
    "evidenceRefs": [
      "gap:AC-936",
      "task:gap-goal-request-queue:todo"
    ]
  }
]
```

stderr（**溯源只在 stderr**，⛔ 不进数组——数组是判据读的形状）：

```
goal next: projection from round 1 at 2026-11-06T17:38:50.427Z (run goal-1793986706177)
quay-native mcp: serving tasks from <EV>/tasks, ADRs from <EV>/adr, meta from <EV>/meta
```

§1 的 `value.rows` 与 §2 的 stdout **逐字等价**（同一份 JSON 结构；CLI 只做 `JSON.stringify` 的
pretty-print，⛔ 不重算、不补字段、不筛行）。这就是 AC「最新一轮 round fact 含 `goal-next` fact，
且与 CLI 输出等价」的读数。

## 3. 负控 A：载体存在但**没有任何一轮产出 `goal-next` fact** ⇒ exit 3，⛔ 不是 exit 0 + 空数组

构造：取上面**同一份真实轮记录**，只删掉 `goal-next` 这一条 fact（其余字节不动），再让 CLI 读它
（`--round-log` 覆盖载体路径）：

```
$ ... goal next --root "$EV" --json --round-log /tmp/goal-next-nofact.CactNY/round.jsonl
EXIT=3
```

stdout：

```json
{
  "evaluated": false,
  "cause": "no-projection",
  "reason": "no goal-next fact in the last 54504 bytes of /tmp/goal-next-nofact.CactNY/round.jsonl — no round has produced the projection yet"
}
```

⇒ 「读不到投影」与「没有下一步」**不同形**（硬规则 3b）：前者是一个带 `evaluated:false` 与
退出码 3 的对象，后者是一个数组。⛔ 两者都不可能被读成同一件事。

## 4. 负控 B：该轮投影**缺一个 active GOAL 的行** ⇒ exit 1，并点名缺的是哪个 GOAL

构造：真实 `goals/` 的拷贝里，把 GOAL-913 的 `status: achieved` 改成 `status: active`（模拟「该轮之后
又有 GOAL 被激活」），轮记录保持 §1 那份原样（里面只有 GOAL-914 的行）：

```
$ ... goal next --root /tmp/goal-next-missing.zTTq5K --json
EXIT=1
```

stdout：

```json
{
  "ok": false,
  "cause": "missing-row",
  "missing": [
    "GOAL-913"
  ],
  "reason": "no goal-next row for active goal(s): GOAL-913"
}
```

⇒ 「投影齐全」与「投影落后于 active GOAL 集合」不同形：前者 exit 0 + 数组，后者 exit 1 + 具名清单
（`missing` 是枚举，⛔ 不是布尔）。这条负控同时说明：`quay goal next` 的覆盖面判据读的是**当前**
active GOAL 集合（经 Provider ABI 的 `goalList`），⛔ 不是照抄 fact 自报的集合——否则「缺行」这个
形态在结构上不可见。

## 5. 与自动化测试的分工

本文件的 4 段都是**真轮次 / 真 CLI 进程**的读数；对应的可重放断言在：

- `packages/quay/test/goal-analysis.test.mjs` —— 纯函数（每 active GOAL 一行、排序、枚举、
  无读数 ⇒ `not-evaluated`、纯性）与 CLI 三态（0 / 3 / 1）+ malformed-row 负控。
- `plugin/test/goal-driver.test.mjs` 的 ⑨ —— 一轮 `runGoalRound` 的轮 fact 里出现 `goal-next`，
  且 `fact.value.rows ≡ goal-ring.value.next`。

⚠️ 本证据**不**声称线上生产轮记录（`/home/yale/work/quay/.quay/goal-round.jsonl`）已经出现
`goal-next`：那要求常驻 goal-driver 进程重启并加载本分支的代码，属于落地之后的外部事件
（AC-935 的判据 `quay goal next --root . --json` 在仓库根读的是那份载体，届时才会转绿）。
本文件证明的是**机制本身**在真实记录上产出了读数。
