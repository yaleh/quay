# Evidence — gap-ac939-ledger-binding-regression-lock

Date: 2026-11-06

## 本任务交付了什么

AC-939 的整条保证活在 `goals/AC-939-*.md` 的 `criterion` 这个 YAML 标量里。每轮 goal-driver 都会执行它
取读数，但仓库里**没有任何测试执行过这段判据** —— 把判据改回 AC-937 的扫全表形态不会有任何检查变红，
而那正是已经真实发生过的一次回归。

1. `plugin/test/ac939-goal-filing-ledger-binding.test.mjs`（新）—— 判据的回归锁：7 个用例
   （判据形态 + 正控 + 四条负控 + 变异负控）。判据正文经 goal store 读取，
   ⛔ 测试文件里没有副本。
2. 本文件 —— 主检出上判据的**真实读数**（下面第 2 节）。

变异负控是这把锁「在测量」的唯一证据：把判据的绑定段（`const ids=[...new Set(` 到判据末尾）换成
AC-937 自己的扫全表段（`const fileRe=` 到末尾，逐字取自 AC-937 的 criterion，不手写第二份）之后，
负控① 的**同一份** fixture 从 `exit 1` 变为 `exit 0`。若变异后仍红，测试自己会以
`lock is not measuring the binding` 断言失败 —— 它不会静默地把「测的不是绑定」当成通过。

```
$ node --test plugin/test/ac939-goal-filing-ledger-binding.test.mjs
✔ 判据形态：取自 goal store 且不含判据副本；仍是绑定 filed taskId 的形态（不是扫全表）
✔ 正控：filed 记下的 taskId 指向 goal_ac: AC-937 且 status: done 的任务 ⇒ exit 0 且 allDone:true
✔ 负控① 替代品：filed 的 taskId 是 todo、另一份 goal_ac: AC-937 的 done 任务顶替 ⇒ exit 1 且 pending 恰为 [T1]
✔ 负控② 无 taskId：filed 行缺 taskId 字段 ⇒ exit 1（不得被当成空集合通过）
✔ 负控③ 文件缺席：taskId 指向不存在的 tasks/<id>.md ⇒ exit 1 且 pending 含该 id
✔ 负控④ 未立案：台账只有 spawned 行、无 filed 行 ⇒ exit 1
✔ 变异负控：绑定段换回 AC-937 扫全表形态后，负控① 的同一 fixture 从 exit 1 变 exit 0
ℹ tests 7   ℹ pass 7   ℹ fail 0
```

## 1. 判据正文（逐字，读自 goal store，⛔ 不是本文件新写的）

读取方式（唯一真相源 = `goals/AC-939-*.md`；`createGoalStore` 由
`packages/quay-native/src/goal-store.ts` re-export Core 的实现）：

```sh
node --experimental-strip-types -e '
  import path from "node:path";
  import { createGoalStore } from "<repo>/packages/quay-native/src/goal-store.ts";
  process.stdout.write(createGoalStore(path.join("<repo>", "goals")).get("AC-939").criterion + "\n");
'
```

它输出的 `criterion` 正文（与 `goals/AC-939-端到端-ac-必须绑定-goal-filing-台账自己记下的-taskid-而不是任意带-goal-ac-ac-937.md`
的 YAML 标量折叠后完全一致）：

```sh
node -e "const fs=require('fs');const p='.quay/goal-filing.jsonl';if(!fs.existsSync(p)){console.error('no goal-filing ledger');process.exit(1)};const rows=fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(s=>{try{return JSON.parse(s)}catch{return null}}).filter(Boolean);const filed=rows.filter(r=>r.state==='filed'&&r.ac==='AC-937');if(filed.length<1){console.error('no filed row for AC-937');process.exit(1)};const ids=[...new Set(filed.map(r=>r.taskId).filter(v=>typeof v==='string'&&v))];if(ids.length<1){console.error('filed rows carry no taskId');process.exit(1)};const pending=ids.filter(id=>{const f='tasks/'+id+'.md';if(!fs.existsSync(f))return true;const t=fs.readFileSync(f,'utf8');return !(/^goal_ac:\s*AC-937\s*$/m.test(t)&&/^status:\s*done\s*$/m.test(t))});if(pending.length>0){console.error(JSON.stringify({filedTaskIds:ids,pending}));process.exit(1)};console.log(JSON.stringify({filedTaskIds:ids,allDone:true}));"
```

## 2. 主检出上的真实读数（cwd = `/data/home/yale/work/quay`，2026-11-06）

判据里的路径是相对路径（`tasks/…`、`.quay/…`），所以 cwd 必须是仓库根。执行方式与生产一致：
把判据正文整条交给 shell（`packages/quay/src/core/acceptance-runner.ts` 以 `shell: true` 跑
acceptance 命令）。

```sh
$ cd /data/home/yale/work/quay
$ sh   -c "$(cat /tmp/ac939-crit.txt)"      # /tmp/ac939-crit.txt = 上面第 1 节那段 criterion 正文
{"filedTaskIds":["gap-goal-filing-chain-audit"],"pending":["gap-goal-filing-chain-audit"]}
$ echo $?
1

$ bash -c "$(cat /tmp/ac939-crit.txt)"
{"filedTaskIds":["gap-goal-filing-chain-audit"],"pending":["gap-goal-filing-chain-audit"]}
$ echo $?
1
```

- stdout：空
- stderr：`{"filedTaskIds":["gap-goal-filing-chain-audit"],"pending":["gap-goal-filing-chain-audit"]}`
- 退出码：**1**

读数时刻的基线：`git rev-parse HEAD` = `cef28ffed1c8c1b5b5c0bf896c18c91fc1ff3655`（分支 `author`），
`git rev-parse develop` = `aab5db17abf05bd161a5957fc821e807115a6215`。

### 2a. `filedTaskIds` 与 `pending`

两者都恰好是 `["gap-goal-filing-chain-audit"]` —— 台账里 AC-937 只有一条 `filed` 行，它记的 `taskId`
就是这一个，而它尚未落地，所以它同时出现在 `pending` 里。

`.quay/goal-filing.jsonl` 逐字（读数时刻全文，两行）：

```jsonl
{"state":"spawned","requestId":"GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0","ac":"AC-937","goal":"GOAL-914","at":"2026-11-06T07:49:45.867Z","promptSha":"e5af4127b26ba5a4","round":"2026-11-06T07:49:45.859Z"}
{"state":"filed","requestId":"GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0","ac":"AC-937","goal":"GOAL-914","at":"2026-11-06T07:57:41.597Z","spawnedAt":"2026-11-06T07:49:45.867Z","taskId":"gap-goal-filing-chain-audit","reason":null}
```

### 2b. `pending` 里的那个任务此刻是什么状态

`tasks/gap-goal-filing-chain-audit.md` 的 frontmatter（逐字）：

```yaml
---
id: gap-goal-filing-chain-audit
title: goal-filing 整链审计：filed 行的 taskId 与任务落地状态交叉核对
status: todo
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-driver-filing-ledger
goal_ac: AC-937
---
```

- `status`: **`todo`**（判据要求 `done` ⇒ 故 pending）
- `goal_ac`: `AC-937`（判据里的 `goal_ac` 那一半满足）
- `depends_on`: `["gap-goal-driver-filing-ledger"]`
  —— 该依赖此刻 `status: ready`（`grep -m1 '^status:' tasks/gap-goal-driver-filing-ledger.md`），
  即阻塞它的那一环已经就绪，`gap-goal-filing-chain-audit` 自身可以进入执行。

### 2c. 下一轮怎么判「翻了没有」

不必重新推导，只跑同一段 criterion：

- **仍红（exit 1）且 `pending:["gap-goal-filing-chain-audit"]`** ⇒ `gap-goal-filing-chain-audit`
  还是 `todo`（或文件没了/改名的同形后果）。
- **绿（exit 0，`allDone:true`）** ⇒ 该任务的 frontmatter 同时满足 `goal_ac: AC-937` 且 `status: done`。

⚠️ 本任务**不**把 AC-939 判成绿：它的翻转路径是 `gap-goal-filing-chain-audit` 落地。这里只把读数钉下来，
没有用替代品、没有改判据、没有改任何任务的 `status`。

## 3. 变异负控的「同一份 fixture 前后对照」读数

负控① 的 fixture：台账 `filed` 记 `taskId: "T1"`（`tasks/T1.md` 是 `todo`），另有 `tasks/T2.md` 带
`goal_ac: AC-937` 且 `status: done`，台账从未记过它。

| 判据文本 | 退出码 | 说明 |
|---|---|---|
| AC-939 原文（从 goal store 读） | **1** | 绑定成立才绿：`T1` 没落地 |
| 把绑定段换成 AC-937 的扫全表段（逐字取自 AC-937 的 criterion） | **0** | 顶替品 `T2` 把判据顶绿 —— 这就是 AC-937 的回归形态 |

两行是**同一份 fixture**、同一个解释器（`bash -c`，cwd = fixture 根）。第二行若也是 1，测试会以
`lock is not measuring the binding` 失败 —— 那把锁就没有区分力，只是回声。
