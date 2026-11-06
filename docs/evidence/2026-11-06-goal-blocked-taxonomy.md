# blocked 三态的 live 证据 — `gap-goal-driver-blocked-taxonomy`（GOAL-914 / AC-935 的后续）

本文件是 `tasks/gap-goal-driver-blocked-taxonomy.md` 的 live 证据。它要证明的不是「单测能造出三态」，
而是**实现落地之后，真实的一轮 goal-driver 真的把 `blocked-*` 写进了轮记录**：每条带 `blocker`
（哪条任务、哪种成因）与 `owner`，且该轮 **不再 emit `stalled`**。

证据来自**真实 GOAL 记录**（`goals/` 里 GOAL-914 及其 9 条 AC，即本仓 2026-11-07 的实际存量）与
**真实任务载体**（`tasks/` 全量拷贝），判据、缺口计算、投影与轮记录全部走生产同一条代码路径。
§1 是**生产存量零改动**的一轮；§2 只改了两个**任务状态**（任务库本就是本轮控制量），用来把另外两态
也拉进真轮读数。

## 0. 复跑方式（可重放）

```bash
WT=/data/home/yale/work/quay-worktrees/gap-goal-driver-blocked-taxonomy
EV=$(mktemp -d /tmp/goal-blocked-taxonomy-evidence.XXXXXX)   # 任意空目录
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

# ① 一轮真轮次（--once；--spawn-cap 0 ⇒ 本轮不 spawn，本证据只读读数）
node --experimental-strip-types "$WT/plugin/scripts/goal-driver.ts" \
  --root "$EV" --once --spawn-cap 0 --gap-worker-cmd true \
  --round-log "$EV/.quay/goal-round.jsonl"

# ② CLI 读面（与 ① 读同一份 fact，⛔ 不重算）
node --experimental-strip-types "$WT/packages/quay/bin/quay.ts" goal next --root "$EV" --json
```

§2 的复跑与上面逐字相同，只是在 ① 之前对**副本**追加两个控制量：

```bash
printf '\n**PARKED（证据用标记）**\n' >> "$EV/tasks/gap-goal-driver-blocked-taxonomy.md"   # ready ⇒ 被 pool 排除
sed -i 's/^status: todo$/status: needs-human/' "$EV/tasks/gap-goal-request-queue.md"        # todo ⇒ parked needs-human
```

## 1. 生产存量零改动的一轮：`blocked-promotion`（AC4 的判据行）

轮信封：`round=1`、`run_id=goal-1793990732471`、`ts=2026-11-06T18:45:55.504Z`、
`stopped_mid_round=false`。该轮 `facts[]` 的名字与状态依次是：

```
goal-ring:verified | goal-sufficiency:verified | goal-objective:verified | goal-gaps:verified
| goal-next:verified | goal-target-health:not-evaluated
```

`goal-gaps` 里 `GOAL-914` 的两条读数 **逐字**（一条阻断、一条安静态负控）：

```json
[{"goal":"GOAL-914","ac":"AC-935","state":"in-progress","taskCount":1},
 {"goal":"GOAL-914","ac":"AC-936","state":"blocked-promotion","taskCount":1,
  "blocker":{"cause":"blocked-promotion","tasks":[{"id":"gap-goal-request-queue","cause":"blocked-promotion"}]}}]
```

同一轮的 `goal-next`（`goal-ring.value.next` 与 `goal-next` fact 的 `value.rows` 是同一份数组）**逐字**：

```json
[{"goal":"GOAL-914","ac":"AC-936","gapState":"blocked-promotion","rank":"blocked-promotion",
  "owner":"worker",
  "action":{"kind":"fix-artifacts","reason":"linked todo tasks do not pass the author→ready promotion gate; fix their artifacts"},
  "evidenceRefs":["gap:AC-936","task:gap-goal-request-queue:todo"],
  "blocker":{"cause":"blocked-promotion","tasks":[{"id":"gap-goal-request-queue","cause":"blocked-promotion"}]}}]
```

要点（每一项都对着 AC）：

- **AC4｜最新 round fact 至少一条 `blocked-*`**：`AC-936 / blocked-promotion / taskCount=1`。
- **AC2｜每个 blocked 行带 blocker 与 owner**：`blocker.cause` 与 `gapState` 逐字相同（`blocked-promotion`），
  `blocker.tasks` 枚举到**具体哪条任务**（`gap-goal-request-queue`）；`owner=worker` 在
  `{driver,worker,human,world}` 内，`action.kind=fix-artifacts` 在六个 action 内。
- **AC2｜该轮不再 emit `stalled`**：`goal-gaps` 的读数与 `goal-next` 的整段序列化里都没有 `stalled`
  （旧字面量只作为**输入**留在词表里，见 `GapState` 的注释）。
- **负控（真实数据，不是造的）**：`AC-935` 关联的那条 `ready` 任务（`gap-goal-driver-blocked-taxonomy`）
  在本轮**未被 pool 排除** ⇒ 读数是 `in-progress`（安静态，不进 `goal-gaps` 视图），⛔ 不被判成
  `blocked-dispatch`。同一份数据里两条 `ready` 一条被判阻断、一条没有，说明判据不是「有 ready 就算阻断」。
- **成因不是猜的**：`blocked-promotion` 的判定来自 `ready-pool-check --json` 本轮的
  `candidates[].eligible`（该 todo 不在其中），与 `isTaskStuck` 同一条谓词（`taskBlockCause`）。

CLI 读面（`quay goal next --root "$EV" --json`，`EXIT=0`）从**同一份 fact** 读出的数组与本行逐字相同。
provenance 与 provider 自述走 **stderr**，stdout 只有数组（既有契约）：

```
# stderr（两行）
goal next: projection from round 1 at 2026-11-06T18:45:55.504Z (run goal-1793990732471)
quay-native mcp: serving tasks from /tmp/goal-blocked-taxonomy-evidence.lXwBRL/tasks, ADRs from …, meta from …
# stdout（EXIT=0）
[
  {"goal":"GOAL-914","ac":"AC-936","gapState":"blocked-promotion","rank":"blocked-promotion",
   "owner":"worker","action":{"kind":"fix-artifacts","reason":"linked todo tasks do not pass the author→ready promotion gate; fix their artifacts"},
   "evidenceRefs":["gap:AC-936","task:gap-goal-request-queue:todo"],
   "blocker":{"cause":"blocked-promotion","tasks":[{"id":"gap-goal-request-queue","cause":"blocked-promotion"}]}}
]
```

## 2. 另外两态的真轮读数（只改任务状态，GOAL/AC 记录原样）

轮信封：`round=1`、`run_id=goal-1793990804948`、`ts=2026-11-06T18:47:08.017Z`、
`stopped_mid_round=false`；`facts[]` 与 §1 同名同序（六个 fact 状态逐字相同）。
控制量：①把生产里那条 `ready`（本任务自己）盖上 `PARKED` ⇒ ready-pool 排除它；②把生产里那条 `todo`
改成 `needs-human`。`goals/` 未改动。

`goal-gaps` 里的两条阻断读数 **逐字**：

```json
[{"goal":"GOAL-914","ac":"AC-935","state":"blocked-dispatch","taskCount":1,
  "blocker":{"cause":"blocked-dispatch","tasks":[{"id":"gap-goal-driver-blocked-taxonomy","cause":"blocked-dispatch"}]}},
 {"goal":"GOAL-914","ac":"AC-936","state":"blocked-needs-human","taskCount":1,
  "blocker":{"cause":"blocked-needs-human","tasks":[{"id":"gap-goal-request-queue","cause":"blocked-needs-human"}]}}]
```

`goal-next`（每 active GOAL 一行，取优先级最高者 ⇒ `blocked-needs-human`）**逐字**：

```json
[{"goal":"GOAL-914","ac":"AC-936","gapState":"blocked-needs-human","rank":"blocked-needs-human",
  "owner":"human",
  "action":{"kind":"ask-human","reason":"every task linked to this criterion is parked needs-human; a human must move it"},
  "evidenceRefs":["gap:AC-936","task:gap-goal-request-queue:needs-human"],
  "blocker":{"cause":"blocked-needs-human","tasks":[{"id":"gap-goal-request-queue","cause":"blocked-needs-human"}]}}]
```

⇒ 三态在**真轮**里各出现一次，且 **owner/action 三种不同**（`worker/fix-artifacts`、`worker/fix-dispatch`、
`human/ask-human`）——这正是把 `stalled` 拆开的目的：三种处置不再共用一个读数。

## 3. 负控（成因不互相误判）——单测层，`plugin/test/goal-driver-s01.test.mjs` AC3

真轮只能证明「每条成因各自出现」，证明不了「needs-human 不会被判成 promotion」。后者的判据在
`goal-driver-s01` 的 AC3（全部跑在 `computeGoalGaps` 的真实返回值上，⛔ 不 mock 判定）：

- `needs-human` 任务 ⇒ `blocked-needs-human`，且 `≠ blocked-promotion`、`≠ blocked-dispatch`；
- 不合格的 `todo` ⇒ `blocked-promotion`，且 `≠ blocked-needs-human`；
- 被排除的 `ready` ⇒ `blocked-dispatch`，且 `≠ blocked-promotion`；
- 混合成因（needs-human + 不合格 todo）⇒ group 取 `blocked-needs-human`（人的决定解开其余一切），
  但 `blocker.tasks` **逐条保留各自成因**（⛔ 第二种成因不被压在第一种下面）；
- 混合且有一条能自行前进 ⇒ `in-progress`、`blocker` 缺失（⛔ 不被「有 stuck」布尔化误判）。

## 4. 这次落地没有写的状态

⛔ 本任务**不写任何 task 状态**（DIR-131）：driver 只读，`blocked-*` 是**读数**不是状态迁移。
`git diff` 只含 goal 侧文件，见 AC5 的判据。
