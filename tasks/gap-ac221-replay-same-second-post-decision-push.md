---
id: gap-ac221-replay-same-second-post-decision-push
title: AC-221 判据的 develop 历史态回放【同秒错位】——driver 自己的「记录未落地原因」提交在事件同一秒 push 进
  develop，reflog --date=unix 秒级粒度让回放取到【决策之后】的 ref，把一条真阴性误报为真复发
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: plan
goal_ac: AC-221
---
**type:** plan

## Proposal

AC-221 的 criterion 本轮实测 FAIL（`fail 1`），判据报「发现 1 条真复发」：

```
发现 1 条真复发(2026-09-07 那类假阴性,develop 历史态其实已全勾却被短路)：
gap-discovery-method-generalization-lineage-and-temporal-binding@2026-10-12T06:53:56.129Z
(develop@4dcc37584(2026-10-12T06:53:56.129Z 前最近提交) 的 tasks/<id>.md: status=pass checked 3/3)
```

**这条「真复发」是判据回放方法的第二次时代错置假阳性，不是 2026-09-07 那类事故的复发。**

根因（与 `gap-ac221-replay-anachronistic-develop-ref` 同族，但换了一层）：`developTipAt()`
（`plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs`）用
`git reflog show develop --date=unix` 重建「develop 在事件时刻的值」，而 `--date=unix` 是**秒级**
粒度；driver 自己那条「记录未落地原因（worker exited-not-landed）」提交（`4dcc37584`）**恰好在事件
同一秒**被 push 进 develop，于是 `entry.unix * 1000 <= Date.parse(ts)` 把它选中——而那条 ref 移动
**发生在短路决策之后**（它是该决策的直接产物，且它的父提交就是 worker 刚写的勾选提交）。

判决性读数（全部为直接量，可逐条复核）：

| 量 | 读数 | 来源 |
|---|---|---|
| 事件记录 `ts`（= worker 退出时刻；`started_at`+`wall_clock_ms` 恰好等于它） | `2026-10-12T06:53:56.129Z` | `.quay/worker-outcome.jsonl`（该 task 的 `exited-not-landed` 行） |
| develop reflog 跨越事件的两条 | `4dcc37584 develop@{1791788036}`（14:53:56），其上一条是 `2a040c197`（14:43:53） | `git reflog show develop --date=unix` |
| **事件当刻** develop 的真实 tip | `2a040c197` ⇒ `tasks/<id>.md` 勾选数 **0** | `git show 2a040c197:tasks/<id>.md` |
| 判据实际选中 | `4dcc37584` ⇒ 勾选数 **3** | `git show 4dcc37584:tasks/<id>.md` |

`4dcc37584` 必然晚于事件：`acShortCircuitVerdict`（`plugin/scripts/worker-driver.ts`，AC-218）判
**develop ref ∪ worktree 副本的并集**，任一源全勾即不短路；本次短路的 `failure_reason` 是
「AC 未全勾（checked 0/3）」⇒ **并集读那一刻 develop 不是 3/3**；develop 只前进不后退 ⇒ 该秒内
`4dcc37584`（3/3）的 push 只能发生在并集读**之后**，而并集读又在 worker 退出（`ts`）之后。
⇒ 回放取的是**晚于事件**的状态，判据所报「develop 历史态当时已全勾」与事实相反。

同一次 push 的独立佐证：`git reflog show author` 显示 worker 的勾选写 `419f7697f`（14:53:08）先落
**author**，driver 的记录提交 `4dcc37584` 正是**以它为父**造的——即回放读到的 3/3 是「worker 的勾选
+ driver 的记账」一并进 develop 的那一次 push，与「事件当刻 develop 已全勾」不是一回事。

已排除的去重、合并候选：`tasks/` 内两条带 `goal_ac: AC-221` 的任务（`gap-ac221-replay-anachronistic-develop-ref`、
`gap-frozen-recheck-lagging-checkout-false-gap-filing`）均为 `done`——按本轮裁定，`done` 不是重复，
而是「上一次修复没兜住」的证据，故新立本案。`task-granularity-advice.ts` 对该案 Touches 报
`peers: []`、`mentions: []`。

## Plan

1. 修 `plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs` 的 `developTipAt()`：
   把 ref 移动的选取由 `entry.unix * 1000 <= t` 改为**严格早于事件秒**——只考虑
   `entry.unix * 1000 < Math.floor(t / 1000) * 1000` 的条目；取不到则仍走既有三态 fail-closed
   返回 `null`（判不出 ≠ 没复发）。同时在文件头以既有那段（`gap-ac221-replay-anachronistic-develop-ref`）
   的同样体裁补记本次「同秒错位」事故：`4dcc37584` / `2a040c197` 两条 reflog 读数 + 上面的并集读论证。
2. **不许以「让判据变绿」收工**：必须把本次修法**能取假**钉进判据本体（不是只写在注释里）——
   新增一条**双向对照 fixture**：构造一个「ref 在事件**同一秒**移动到全勾态」的历史，断言该事件**不**
   计入复发（若把它改回旧规则则必须计入 ⇒ 证明这条 fixture 确实在测修法）。既有正控制
   （2026-09-07 原始事故必须仍判复发：8/8）与负控制（`gap-ac207` 必须仍判非复发：2/5）两臂都要实跑。
3. 复跑主判据，确认 `recurrences.length === 0` 且 `unclassified.length === 0`（落地后 78 条
   「AC 未全勾」短路事件全部可消歧），并把默认路径（未设 `QUAY_GOAL_CRITERION_LIVE`）的 SKIP
   行为保持原样（该文件头记载的既有事故：它被全量 suite 扫到会拖垮无关任务的 fan-in，默认必须
   不断言、exit 0）。

**为什么这不会掩盖真复发（论证要写进判据本体，不是只写在这里）**：真复发的定义是「develop 在事件
时刻已全勾却被短路」。若某一秒内的 ref 移动真的把 develop 变成全勾态，那么**并集读**（发生在 worker
退出之后）必然也看到全勾 ⇒ 判 `shortCircuit:false`、不短路。与「本次确实短路了」矛盾。⇒ **任何
同秒移动到全勾态的 ref 移动，都按构造发生在并集读之后**，恰是被本修法排除掉的那一类；排除它不会
漏掉任何真复发。**该论证的前提是并集读存在且未被改坏**——须在判据本体里点名这一前提（若将来
`acShortCircuitVerdict` 的并集读被移除/降级为本条失效，判据应随之回到 fail-closed）。

⛔ **本判据明确不覆盖的残留（如实记录，另需一条 AC/裁定，不得塞进本案）**：本次事件的**代价**是
真实的——worker 在 14:53:08 经 ABI 勾满 AC（`419f7697f` 落 **author**），而并集读只读 develop ref ∪
worktree 副本，**两者都不含 author**，于是 48 秒后仍被判「checked 0/3」短路，烧掉一个 worker 轮次
（14:55:01 重派，15:01:04 才落地）。这正是文件头已记载的「AC 勾选已提交、但尚未到达 develop」的
**传播竞态**残留；按人 2026-09-09 的裁定（原话：不得塞进本判据，那会重新引入已拆掉的 confound），
它需要自己的 AC/裁定。本案只修**判据回放的正确性**，不动生产侧并集读。

## Acceptance Criteria

- [x] `developTipAt()` 的 ref 移动选取改为**严格早于事件秒**，且默认（未设 `QUAY_GOAL_CRITERION_LIVE`）与三态 fail-closed 行为不变。
- [x] 新增双向对照 fixture：一条「ref 在事件同秒移动到全勾态」的构造事件被判**非复发**；把该测试的 `✔` 行粘进 `## Evidence`（证明修法真的改变了判定，不是恒真空转）。
- [x] 既有正控制（2026-09-07 原始事故判「复发」）与负控制（`gap-ac207` 判「非复发」）两臂实测仍绿，两行 `✔` 粘进 `## Evidence`（证明修法没把判据改成恒判非复发）。
- [x] 主判据实测 exit 0：`QUAY_GOAL_CRITERION_LIVE=1 node --no-warnings --experimental-strip-types --test plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs` ⇒ `fail 0`，完整尾部输出粘进 `## Evidence`。
- [x] 文件头载有本次「同秒错位」的读数（`4dcc37584` / `2a040c197`）与「为何不掩盖真复发」的论证，并点名前提「`acShortCircuitVerdict` 的并集读存在」。
- [x] `scripts/test.sh --for-task gap-ac221-replay-same-second-post-decision-push` exit 0。

## Definition of Done

- 真实落地判据是**判据本身在 develop 上重新跑绿**，不是「测试文件改了」：`## Evidence` 须同时给出
  ①上一行命令的 exit code / 尾部计数，②`git show develop:plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs`
  里 `developTipAt` 已是新规则（贴 `git show develop:…` 的 sha），证明 goal-driver 下一轮读到的
  就是这一版、而不是只在 worktree 里绿的版本。
  ⚠️ ② 半是**落地后**读数（`develop` 由 driver 的 fan-in ff 才拿到本分支提交，worker ⛔ 不碰 develop）
  ⇒ 本 worker 只能给 ① 与「本分支 sha 处已是新规则」；② 的承接者与状态见 `## Evidence` 第 7-f 条。
- 默认路径负控制不破：不设 `QUAY_GOAL_CRITERION_LIVE` 时该文件 exit 0（SKIP 分支未被改动）。
- `## Evidence` 里上述每一条都是可复跑命令的原始输出，不是复述。

## Touches

- plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs
- tasks/gap-ac221-replay-same-second-post-decision-push.md

## Evidence

本轮立案前的直接读数（可逐条复跑）：

1) 判据 FAIL 原文（`QUAY_GOAL_CRITERION_LIVE=1 node --no-warnings --experimental-strip-types --test plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs`）：

```
ℹ tests 7 / ℹ pass 6 / ℹ fail 1
✖ 落地(bdbdb368d / 2026-09-09T11:28:11Z)后自动消歧为真复发的 "AC 未全勾" 短路事件数为 0
  AssertionError: 发现 1 条真复发(2026-09-07 那类假阴性,develop 历史态其实已全勾却被短路)：
  gap-discovery-method-generalization-lineage-and-temporal-binding@2026-10-12T06:53:56.129Z
  (develop@4dcc37584(2026-10-12T06:53:56.129Z 前最近提交) 的 tasks/gap-discovery-method-generalization-lineage-and-temporal-binding.md: status=pass checked 3/3)
  1 !== 0
```

2) 事件记录（`.quay/worker-outcome.jsonl`，该 task 的 `exited-not-landed` 行）：

```
{"ts":"2026-10-12T06:53:56.129Z","task":"gap-discovery-method-generalization-lineage-and-temporal-binding",
 "final_state":"exited-not-landed","failure_reason":"AC 未全勾（checked 0/3，剩余未勾 3）——续做只需验证并勾选 AC",
 "started_at":"2026-10-12T06:44:49.937Z","ended_at":"2026-10-12T06:53:56.129Z","short_circuit":"ac-not-checked"}
```

3) reflog / 两侧内容（`git reflog show develop --date=unix` 与 `git show <sha>:tasks/<id>.md`）：

```
4dcc37584 develop@{1791788036} push      # 14:53:56 +0800 = 06:53:56Z（与事件同一秒）
2a040c197 develop@{…}                    # 14:43:53 +0800 ← 事件当刻的真实 tip（其下一条即上面那条）
4dcc37584 → grep -c '^- \[x\]' = 3       # 被误选中的（决策之后）
2a040c197 → grep -c '^- \[x\]' = 0       # 事件当刻的真值
```

4) 「4dcc37584 晚于并集读」的骨牌：并集读在 worker 退出之后；若该秒内它已见 3/3 则不会短路，
   而本次确实短路 ⇒ 该 push 必在并集读之后。独立佐证：`git reflog show author` 显示
   `419f7697f`（14:53:08，worker 的勾选写）在 **author** 上，`4dcc37584` 的父提交正是它。

5) 修法可行性预演（同日立案前实测，用与判据同源的 `flipAcGateVerdict` 直接 import）：

```
CURRENT(<=)         => recurrences:1  unclassified:0
STRICT(prev-second) => recurrences:0  unclassified:0
pos 2026-09-07  current develop@8d8e353db ok=true  8/8   | strict 同
neg ac207      current develop@9db91953a ok=false 2/5   | strict 同
```

⇒ 严格早于事件秒的规则只改变这一条事件的判定，两臂正/负控制读数**不变**。

6) 去重/合并候选：`task-granularity-advice.ts --touches … --json` ⇒ `peers: []`、`mentions: []`；
   `grep -l 'AC-221' tasks/*.md` 命中的两条带 `goal_ac: AC-221` 的任务均为 `done`。

---

7) **实现后读数**（worktree `gap-ac221-replay-same-second-post-decision-push`，实现提交
   `6113bcbb9`；主干工作前已 `git merge --no-edit develop` ⇒ `Already up to date.`，merge exit 0）：

a) **AC4 主判据**——`QUAY_GOAL_CRITERION_LIVE=1 node --no-warnings --experimental-strip-types --test plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs`
   ⇒ **EXIT=0**：

```
✔ 负控制：SHORTCIRCUIT_PATTERN 命中至少一条落地前的历史短路样本（判据本身没坏） (24.620117ms)
✔ 负控制：消歧器对已知真阴性样本（gap-ac207 2026-09-09T14:26:02.187Z）判定为「非复发」 (76.193435ms)
✔ 正控制（双向）：消歧器对已知真复发样本判「复发」、对已知真阴性样本判「非复发」 (141.381473ms)
✔ AC3-①：reflog 不可读（非 git 目录）⇒ developTipAt 返回 null（fail-closed） (4.452288ms)
✔ AC3-②：reflog 最早条目晚于事件 ts ⇒ developTipAt 返回 null（fail-closed） (42.37313ms)
✔ AC3-③：reflog 最新条目 ≠ 当前 develop tip（不完整）⇒ developTipAt 返回 null（fail-closed） (36.727009ms)
✔ AC1/AC2 同秒错位（双向对照）：ref 在事件同一秒移动到全勾态 ⇒ 判【非复发】；旧规则 ⇒ 判【复发】 (50.404026ms)
✔ 落地(bdbdb368d / 2026-09-09T11:28:11Z)后自动消歧为真复发的 "AC 未全勾" 短路事件数为 0 (5574.194772ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6190.613029
```

   对比立案前的 `tests 7 / pass 6 / fail 1`：那条「同秒错位」事件不再计入真复发；主判据体内两条断言
   （`unclassified.length === 0` ∧ `recurrences.length === 0`）**同时**成立。

b) **AC2 的 `✔` 行**（证明 fixture 真的在测修法）：上面第 7 行
   `✔ AC1/AC2 同秒错位（双向对照）：ref 在事件同一秒移动到全勾态 ⇒ 判【非复发】；旧规则 ⇒ 判【复发】`。
   **AC3 两臂的 `✔` 行**：上面第 2 行（负控制 gap-ac207 非复发）与第 3 行（正控制 2026-09-07 复发 +
   负臂）——两臂与修法前同为绿，说明修法没把判据改成恒判非复发。

c) **⚠️ 取假能力（变异对照，独立于 fixture 内的对照臂）**：把 `isReplayEligible` 的 **strict 默认分支**
   临时换回旧规则 `unix * 1000 <= t`，重跑同一文件（未设 LIVE，故只有不依赖生产载体的用例参与）⇒

```
✖ AC1/AC2 同秒错位（双向对照）：ref 在事件同一秒移动到全勾态 ⇒ 判【非复发】；旧规则 ⇒ 判【复发】 (46.073331ms)
ℹ tests 8
ℹ pass 7
ℹ fail 1
```

   ⇒ 这一个改动**只**让该 fixture 变红（其余 7 条仍绿）⇒ 它确实在测修法本体，不是恒真空转。
   变体已 `cp` 还原，`git diff` 无残留。

d) **DoD②（默认路径负控制未破）**——不设 `QUAY_GOAL_CRITERION_LIVE` 跑同一文件 ⇒ **exit 0**、
   `ℹ tests 8 / ℹ pass 8 / ℹ fail 0`（四条 LIVE 判据走 SKIP 分支原样返回，SKIP 分支未改动）。

e) **AC6（scoped gate）**——`bash scripts/test.sh --for-task gap-ac221-replay-same-second-post-decision-push --allow-thin`
   ⇒ **EXIT=0**（scoped static checks 全过；scoped 选中本测试文件，`ℹ pass 8 / ℹ fail 0`）。

f) **DoD① 的 ② 半（如实记录其状态与承接者）**：`git show develop:plugin/test/goal011-…mjs` 里
   `developTipAt` 已是新规则——这一读数**结构上只能在落地后取**（`develop` 由 driver 的 fan-in ff
   才拿到本分支提交；worker ⛔ 不碰 develop，`git merge develop` 在写任务文件前为 `Already up to date.`）。
   现在可给的最强等价读数：**本分支实现提交 `6113bcbb98dc2ecd1dfa42cd55540714f507cf6b`**
   （`git show 6113bcbb9:plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs`）里
   `developTipAt` / `isReplayEligible` 已是严格规则，而 fan-in 的 ff 就是把该提交推上 develop。
   **承接者**：① fan-in 的 `--ff-only`（机械、本轮即执行；它一旦成功，`git rev-parse develop` == `6113bcbb9`，
   ② 随之成立）；② goal-driver 下一轮 **AC-221 criterion spawn**（自动从 develop 读该文件并重跑本判据——
   它正是「判据本身在 develop 上重新跑绿」这条 DoD 的天然验收者，⛔ 非人工派发）。
   ⚠️ 前提：`acShortCircuitVerdict` 的 develop∪worktree **并集读**仍存在且未降级（见文件头点名的那条
   前提）；若它被移除，本修法随之失效、判据应回到 fail-closed。
