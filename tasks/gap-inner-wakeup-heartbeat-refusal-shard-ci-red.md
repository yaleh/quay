---
id: gap-inner-wakeup-heartbeat-refusal-shard-ci-red
title: AC-281 落地引入的 CI 红：新分片 inner-wakeup-heartbeat-refusal.test.mjs 在 develop
  上失败（母文件同 run 绿、helper 逐字相同）——先做对照再归因
status: todo
labels:
  - gap
  - test-isolation
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-281
---
**type:** fix

## Proposal

**缺口（实测，⛔ 非推断）**：`gap-ac281-develop-ci-test-job-wallclock-under-30s` 的第 4 轮 commit
`69a0adeff`（`perf(ci): split the last four >20s test files below the AC-281 floor band`）把
`plugin/test/inner-wakeup-heartbeat.test.mjs` 里的 `AC53 EXIT:0 捕获` 那条测试**移进**了新分片
`plugin/test/inner-wakeup-heartbeat-refusal.test.mjs`。该分片在 **develop CI 上红**。

run **35294113108**（2026-09-18T01:08:35Z，`test` job，失败步 = #11 `Run tests`）原始日志：
```
test at plugin/test/inner-wakeup-heartbeat-refusal.test.mjs:197:1
  AssertionError [ERR_ASSERTION]: the caller must also see the refusal reason on stderr
      at TestContext.<anonymous> (file:///_work/quay/quay/plugin/test/inner-wakeup-heartbeat-refusal.test.mjs:222:12)
__PERFILE__ duration_ms=8167 /_work/quay/quay/plugin/test/inner-wakeup-heartbeat-refusal.test.mjs passed=false
```
**同一条 run 里母文件是绿的**：`inner-wakeup-heartbeat.test.mjs passed=true`（9.8s）、
`inner-wakeup-heartbeat-check.test.mjs passed=true`（3.3s）。

**已核实的三个事实**（立案读数的直接量）：
1. 两边的 helper 块（`makeDispatchableWorkspace` / `runWriter` / `FULL_ARGS`）**逐字相同**（`diff` 为空）；
2. 那条测试**已不在母文件里**（是移走，不是复制）⇒ 同一份测试代码，**换个文件就从绿变红**；
3. 失败的只有**第三条**断言：前两条（`w.status != 0`、`w.status == 1`）**都通过了** ⇒
   **拒绝确实发生**，只是 stderr 里**没有** `结束不变式违例` ⇒ 写入方走的是**另一条拒绝分支**。

⚠️ **本条不是"测试写错了"**：CI 上这个 job 红、develop 因此不绿，而 **AC-281 的判据要求
「最新一条 post-filing develop run 的 test job 是 success」** ⇒ **不修好它，AC-281 结构上无法达成**
（同 GOAL-022 的退出条件只差 AC-281）。

### ⛔ 机制是假说，不是结论（硬规则 4-推论四）

形态像「同一个 `test()` 换到新文件/新泳道后，受并发或前置条件影响而走了另一条拒绝路径」——
**但尚无能区分它的对照**。本任务的第一件事就是做那个对照（Plan 第 1 步），**不得带着假说直接改代码**。

### 与既有任务的关系（机制去重，不是症状关键词）

- `gap-ac281-develop-ci-test-job-wallclock-under-30s`（**done**）：本红是**它落地时引入的**；
  ⛔ 不要重开或重做那条任务的拆分工作——它已经落到 develop 了。
- 本任务的机制是**测试文件粒度的行为保持**，与「压墙钟」不同层 ⇒ 独立立案。
- 兄弟任务（并行，Touches 不相交）：`gap-suite-fan-in-execute-paths-s07-long-pole-split`
  （继续压 `fan-in-execute-paths-s07` 32.4s 的地板）。两者都要绿，AC-281 才可能收口。

## Plan

1. **先做能区分的对照（三条，各留命令与读数）**：
   ① **单独跑该分片**：`node --test plugin/test/inner-wakeup-heartbeat-refusal.test.mjs`
   —— 绿 ⇒ 支持"上下文/并发相关"；红 ⇒ 支持"真缺陷"；
   ② **负控制**：同一条命令跑**母文件** `node --test plugin/test/inner-wakeup-heartbeat.test.mjs`
   —— 必须绿（否则说明是普适的、与拆分无关的缺陷）；
   ③ **负载下跑该分片**：同时起 N 个别的测试文件（或直接用 `scripts/test.sh --for-task <id>`）
   —— 若结论相对 ① 翻转，则干扰来自**并发/资源**，而不是文件身份。
   ⛔ 三条都给不出结论 ⇒ 如实记为**未能复现**，并附 CI 上的失败证据，**不得改断言了事**。
2. **按第 1 步的结论写归因**（是文件身份 / 并发干扰 / 还是拆分把同文件内先跑的 `test()` 所建立的前置拆走了）。
   ⛔ 给不出对照的因果句，一律写成假说。
3. **按归因修复**。⛔ **不许 skip / 弱化断言**——被断言的那条正是 AC53 的机械强制力
   （「写入方的非零退出必须被调用方看见」）；删它等于把 §AC53 的守卫拆掉，是**把红藏起来**而不是修好。
4. **逐个分片自证**：修完**单独跑**该分片（绿），**且**跑一次 `scripts/test.sh --for-task` 的 scoped 面。
5. **回归**：`node --experimental-strip-types plugin/scripts/suite-bucket-reattr-ratchet-check.ts --gate`
   仍 `pass`（新分片的 AC121 reattribution 已登记，⛔ 不要把它撤掉换绿）。
6. **在任务分支上触发一次真实 CI**（`gh workflow run ci.yml --ref task/<本任务 id>`），
   读该 run `test` job 的 `__PERFILE__` 行，确认本分片 `passed=true`（**这是落地前就能拿到的真实 CI 证据**，
   ⛔ 不用本地 16 核读数替代）。
7. **落地**：走正常 fan-in；落地后触发 develop CI，确认 `test` job `conclusion == "success"`。

## AC

- [ ] **AC1（对照先于结论）**：贴出 Plan 第 1 步三条对照的**实际命令与结果**，并据此写出归因；
      ⛔ 三条都绿（不可复现）⇒ **如实记为「未能复现」**并附 CI 失败证据，⛔ 不得以改断言收场。
- [ ] **AC2（修复可被打红）**：修复后 `node --test plugin/test/inner-wakeup-heartbeat-refusal.test.mjs` 绿，
      **且**给出「把修复回退 ⇒ 同一条命令变红」的负控制读数（一条命令可查）。
- [ ] **AC3（没把守卫拆掉）**：该文件里 AC53 的三条断言（`status != 0` / `status == 1` /
      `stderr` 含 `结束不变式违例`）**逐字仍在**，`grep -c '结束不变式违例'` ≥ 3；
      举证：`git diff develop -- plugin/test/inner-wakeup-heartbeat-refusal.test.mjs` 里那三行未被删改。
- [ ] **AC4（真实 CI 上翻绿）**：在**任务分支自己的 CI run** 上，贴出该分片的
      `__PERFILE__ duration_ms=… passed=true` 行原文与 run id。⛔ 本地读数不作数。
- [ ] **AC5（生产面兑现，外层验证）**：落地并触发 develop CI 后，贴出 run id 与该 run `test` job 的
      `conclusion == "success"` ——属外层验证（待外部）

## DoD

**REAL LANDING**：不是"本地绿了"，而是 **CI 上这条分片真的绿、且 53 的机械守卫一条没少**：

1. **落地对象**：任务分支 CI run 里本分片的 `passed=true` 行 + develop run 的 `test` job `conclusion`。
2. **可被打红**：AC2 的回退负控制实跑并贴读数。
3. **守卫未丢**：AC3 的三条断言逐字在（`grep -c` ≥ 3）。
4. **归因有对照**：AC1 三条对照读数齐备；给不出就如实记为未复现。

## Touches

- plugin/test/inner-wakeup-heartbeat-refusal.test.mjs
- plugin/test/inner-wakeup-heartbeat.test.mjs
- plugin/test/inner-wakeup-heartbeat-check.test.mjs
- tasks/gap-inner-wakeup-heartbeat-refusal-shard-ci-red.md
