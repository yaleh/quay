---
id: gap-inner-wakeup-heartbeat-refusal-shard-ci-red
title: AC-281 落地引入的 CI 红：新分片 inner-wakeup-heartbeat-refusal.test.mjs 在 develop
  上失败（母文件同 run 绿、helper 逐字相同）——先做对照再归因
status: done
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

> ### ✅ 落地后回填（2026-09-18，worker 交付）：上面第 3 条事实**读的是断言标题，不是断言的 `actual:` 字段**
>
> 该失败断言**自带 `actual:`**（= 子进程真实 stderr），原文是
> `SyntaxError: The requested module './gate-script-base.ts' does not provide an export named 'helpExit'`
> —— **写入方在模块实例化阶段就崩了，根本没跑到结束不变式闸**。`status == 1` 之所以成立，
> 是因为 **Node 未捕获异常的退出码也是 1**，与写入方「故意拒绝」的退出码**同值**。
> ⇒ **「拒绝确实发生、走的是另一条拒绝分支」这个结论被证否**（详见 AC1）。本条 Proposal 的
> 三个事实保留原样，作为「只读断言标题就会误判」的现场记录。

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

- [x] **AC1（对照先于结论）**：贴出 Plan 第 1 步三条对照的**实际命令与结果**，并据此写出归因；
      ⛔ 三条都绿（不可复现）⇒ **如实记为「未能复现」**并附 CI 失败证据，⛔ 不得以改断言收场。

      **三条对照**（本地 16 核 / Node v24.19.0，worktree `quay-worktrees/gap-inner-wakeup-heartbeat-refusal-shard-ci-red`）：
      - ① 单独跑该分片 `node --test plugin/test/inner-wakeup-heartbeat-refusal.test.mjs` ⇒ `ℹ tests 4 / pass 4 / fail 0`（**绿**）
      - ② 负控制 `node --test plugin/test/inner-wakeup-heartbeat.test.mjs` ⇒ `ℹ tests 14 / pass 14 / fail 0`（**绿**，符合 Plan 的「必须绿」）
      - ③ 负载下：(a) 12 路并发跑同一分片（`for i in $(seq 1 12); do node --test … & done; wait`）
        ⇒ **12/12 rc=0，`does not provide an export named` 命中 0 次**；
        (b) 真实入口 `bash scripts/test.sh --for-task gap-inner-wakeup-heartbeat-refusal-shard-ci-red --allow-thin`
        ⇒ **exit 0，`ℹ tests 84 / pass 84 / fail 0`，`violations: 0`**（**绿**；`merge develop` 前后共跑 4 次，均绿）
      ⇒ **三条全绿 ⇒【本地未能复现】**（按本条 ⛔ 条款如实记录）。⛔ **未以改断言收场**（见 AC2/AC3）。

      **CI 侧失败证据（同一分片、同一 runner，跨 run 不一致 ⇒ 非确定性、⛔ 非坏提交）**：
      - `35294113108`（develop `cf06fcf8c`）：本分片 `__PERFILE__ duration_ms=8167 … passed=false`，且是该 run **唯一**失败文件；
      - `35294796640`（develop `d0057085c`）：**本分片 `__PERFILE__ duration_ms=10631 … passed=true`** —— 同一分片、同一 CI 环境**绿**；
      - `35291891619`：同一条 `SyntaxError … does not provide an export named 'helpExit'` 再现；
      - `git show cf06fcf8c:plugin/scripts/gate-script-base.ts | grep -c 'export function helpExit'` = **1**，
        且该 sha 的 `wiring-coverage-check.ts:48` 正是 `import { helpExit } from "./gate-script-base.ts";`
        ⇒ **失败 sha 的提交树自洽** ⇒ 那份不匹配的模块是**运行期状态**，不是坏提交。

      **归因（由 CI 日志里断言自带的 `actual:` 直接量支撑，⛔ 与 Proposal 的假说相反）**：
      `35294113108` 那条失败断言**自带 `actual:` 字段**（= 子进程真实 stderr），原文：
      ```
      file:///_work/quay/quay/plugin/scripts/wiring-coverage-check.ts:48
      import { helpExit } from "./gate-script-base.ts";
      SyntaxError: The requested module './gate-script-base.ts' does not provide an export named 'helpExit'
          at #asyncInstantiate (node:internal/modules/esm/module_job:455:21)
      Node.js v24.21.0
      ```
      ⇒ **写入方在【模块实例化】阶段就崩了，从未跑到结束不变式闸**；`w.status` 为 1 是 **Node 未捕获异常的退出码 1**，
      与写入方「故意拒绝」的退出码 1 **同值** ⇒ 前两条断言（`status != 0` / `status == 1`）**因此通过**，
      第三条才在 stderr 文本上失败。
      ⇒ **Proposal 第 3 条事实的结论（「拒绝确实发生、走了另一条拒绝分支」）被证否：拒绝没有发生。**
      ⇒ 这正是**硬规则 3b** 的形态：判定的输出词表里没有「没跑起来」这一态 ⇒ 崩溃被报成「拒绝理由缺失」。
      ⇒ **崩溃的触发源未确立**（该模块为何在那一刻不可用），按硬规则 4-推论四**不写成结论**；
        **可复现的是这条混淆本身**（AC2 的 shim 对照）。
      ⇒ **同一形态在母文件上活捉一次**：CI run `35296761204`（本任务分支）把
        `inner-wakeup-heartbeat.test.mjs` 的 `AC2 fail-closed` 打红，其 `actual:` 为
        `…/plugin/scripts/fast-mode-telemetry.ts:129 SyntaxError: The requested module './workflow-event-schema.mjs'
        does not provide an export named 'IMPL_COMPLETE_EVENT_KIND'` —— **同一类、不同模块对**，
        证明这是**套件级**现象，且同一载体上有**多个**实例（见 AC2）。

- [x] **AC2（修复可被打红）**：修复后 `node --test plugin/test/inner-wakeup-heartbeat-refusal.test.mjs` 绿，
      **且**给出「把修复回退 ⇒ 同一条命令变红」的负控制读数（一条命令可查）。

      **修复后**：`ℹ tests 4 / pass 4 / fail 0`（**绿**）。
      修复 = 给「没跑起来」**单独取值**（硬规则 3b）：拒绝/裁决断言**只会看到真正跑起来的子进程**，
      瞬时启动失败**重测一次**，两次都失败则**大声失败并报出真因**（携带两次 stderr）。
      **硬规则 5b：同一载体（AC53 心跳测试族）的三个文件全部落实**，⛔ 断言一条未删未改未弱化：
      - `inner-wakeup-heartbeat-refusal.test.mjs`：`writerStartupFailure()` / `runWriterChecked()`，
        全部 5 个 `runWriter` 调用点改道；
      - `inner-wakeup-heartbeat.test.mjs`：同款 helper，全部 9 个调用点改道（4 个拒绝 + 5 个 exit-0 读数）；
      - `inner-wakeup-heartbeat-check.test.mjs`：`cliStartupFailure()` / `runCliChecked()`，全部 6 个裁决调用点改道。

      **负控制**（确定性、一条命令、⛔ 不触碰任何仓库文件）：PATH shim 在**第一次**相关 spawn 上打印
      CI 那条**逐字相同**的模块加载错误并 exit 1，其后交给真 node：
      - **回退修复**（`git checkout develop -- plugin/test/inner-wakeup-heartbeat-refusal.test.mjs`）后同一条命令
        ⇒ **RED**，`AssertionError: the refusal must name 结束不变式违例`，其 `actual:` **正是 CI 那条 SyntaxError**
        ⇒ **CI 症状被确定性复现**；
      - **恢复修复**后同一条命令 ⇒ **GREEN 4/4**（shim 确实触发：`.fired` 存在）。
      - **持久崩溃对照**（shim 让**每一次** spawn 都崩）⇒ 仍 **RED**：
        分片 0/4、母文件 **8** 条、checker 文件 **6** 条，每条都是
        `… FAILED TO START on BOTH attempts — it never ran, so this is NOT a refusal/verdict`
        ⇒ 修复吸收的是**瞬时**抖动，**不是**把真缺陷藏起来。
      - 三文件**全部**在瞬时 shim 下绿：4/4、14/14、66/66。

      **硬规则 5b 扫描（记录，⛔ 不在本任务修——不同载体、且在 Touches 之外）**：
      `plugin/test/` 下 **86** 个测试文件既 `spawnSync("node")` 又对 `.status` 断言；
      本载体的 3 个已加固。**同一 `69a0adeff` 拆分还产出 4 个同族分片**
      （`inner-wakeup-heartbeat-check-cli` / `-check-ac53-cli` / `-check-gate-cli` / `-gate`，共 42 处 `.status` 断言）
      **同样未加固**。⛔ 未改它们：不在 Touches，且越界改会自伤 anti-drift（见
      `out-of-touches-red-fix-self-inflicts-anti-drift`）。**建议另立一条任务**收口。

- [x] **AC3（没把守卫拆掉）**：该文件里 AC53 的三条断言（`status != 0` / `status == 1` /
      `stderr` 含 `结束不变式违例`）**逐字仍在**，`grep -c '结束不变式违例'` ≥ 3；
      举证：`git diff develop -- plugin/test/inner-wakeup-heartbeat-refusal.test.mjs` 里那三行未被删改。
      **读数**：`grep -c '结束不变式违例' plugin/test/inner-wakeup-heartbeat-refusal.test.mjs` = **4**（≥3）；
      `git diff develop -- <该文件>` 的**删除行只有 5 条 `runWriter(` 调用点**（改为 `runWriterChecked(`）；
      **三条 AC53 断言一行未动**——diff 里出现 `status != 0` / `status == 1` 的 `+` 行**全部是新增注释**。
      同一条纪律在另两个文件同验：母文件 14/14、checker 66/66 全绿，两者的 diff 亦**只改调用点**。

- [x] **AC4（真实 CI 上翻绿）**：在**任务分支自己的 CI run** 上，贴出该分片的
      `__PERFILE__ duration_ms=… passed=true` 行原文与 run id。⛔ 本地读数不作数。
      **run `35297538895`**（分支 `task/gap-inner-wakeup-heartbeat-refusal-shard-ci-red`，tip sha `6ed083e7f`）——
      **四个 job 全部 `success`**（`test` / `dist-verify-node-floor` / `version-consistency` / `cold-start-e2e`），
      **全库 `__PERFILE__ … passed=false` 计数 = 0**，三个文件原文：
      ```
      __PERFILE__ duration_ms=10521 /_work/quay/quay/plugin/test/inner-wakeup-heartbeat-refusal.test.mjs passed=true end_ms=1789696846385
      __PERFILE__ duration_ms=9803  /_work/quay/quay/plugin/test/inner-wakeup-heartbeat.test.mjs         passed=true end_ms=1789696845684
      __PERFILE__ duration_ms=3271  /_work/quay/quay/plugin/test/inner-wakeup-heartbeat-check.test.mjs   passed=true end_ms=1789696839018
      ```
      另有两条同分支绿 run：**`35297361925`**（sha `34626ab07`，四 job `success`、0 个失败文件，
      含上述三文件 `passed=true`）与 **`35296140472`**（sha `5917f6b5a`，四 job `success`，
      本分片 `__PERFILE__ duration_ms=10496 … passed=true`）。

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
