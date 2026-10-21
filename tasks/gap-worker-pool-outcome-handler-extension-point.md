---
id: gap-worker-pool-outcome-handler-extension-point
title: WorkerPool 结局处理扩展点：外部注册合成处理单元并经注册表生效，测试只 import worker-pool.ts
  且自带负对照（GOAL-909/AC-915）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-worker-pool-owns-retry-backoff-state
goal_ac: AC-915
---
## Proposal

**立案读数（2026-10-22，当前树）**：GOAL-909/AC-915 的 criterion 逐字执行为 exit 1：

```
CAUSE=missing extension-point test plugin/test/worker-pool-extension-point.test.mjs
```

实测：`plugin/scripts/worker-pool.ts` 与 `plugin/test/worker-pool-extension-point.test.mjs` 当前都不存在（前者由同 goal 的 AC-914 任务创建）。`plugin/scripts/worker-driver.ts`（7266 行）的 worker 终态状态机仍散在 `runResidentLoop` 闭包里：`onWorkerFinished`（约 `:6285`）按 `final_state === "exited-not-landed"` → 重试豁免 → `decision.kind`（`stop-terminal` / `count-and-retry` / `baseline-red-deadlock`）→ 快速死亡分类（`environment-fatal` / `newlyNeedsHuman` / `quickDeath`）逐层 if/else，直接改 `retryState` / `backoffState` 的 Map/Set。今天要新增一种结局或决策种类，必须改中心文件。

**要做什么**：给 `WorkerPool` 加一个**结局处理单元注册面**，把结局分派变成注册表驱动：每个处理单元自带 `matches(event)` 与 `plan(event)`（声明状态转移），`WorkerPool` 按注册顺序应用命中单元的转移；现有各分支成为用同一注册面注册的内置单元；`onWorkerFinished` 只做「归一化结局 → 交给 pool」。

**为什么不能只「抽出一个文件」**：AC-915 明确把「把代码搬到了哪里」判为不达成。本任务的可取假判据是：一个**只 import `worker-pool.ts`、完全不引用中心文件**的测试，能从外部注册一个合成处理单元、喂一条合成结局，并断言该单元被调用且其声明的状态转移被应用；同一测试内自带负对照（不注册 / 绕过注册表时同一断言必须失败）。⛔ 判据不以「新增文件存在」为达成。

<!-- dedup-ref --> 相关而非重复：`gap-worker-pool-owns-retry-backoff-state`（AC-914，todo）负责把 retry/backoff 状态收进 `WorkerPool` 的私有字段；本任务负责**扩展点/注册表**这个独立验收面，故 separate 立案，并以顶层 `depends_on` 声明前置（`worker-pool.ts` 由 AC-914 创建）。两者共享 `plugin/scripts/worker-pool.ts` 与 `plugin/scripts/worker-driver.ts`，调度器按 Touches 串行，合并不会增加并行度。立案时 `task-granularity-advice.ts` 的 `peers[]` 只返回该 AC-914 任务，无其它合并候选。

## Plan

1. **在 `plugin/scripts/worker-pool.ts` 增加注册面**（复用 AC-914 建立的类，⛔ 不重建）：
   - 导出归一化结局事件类型 `WorkerOutcomeEvent`（至少 `{ taskId, finalState, outcome, decision?, quickDeath? }`；字段以 AC-914 落地后的实际状态机为准，测试与 `worker-driver.ts` 共用同一类型）。
   - 导出 `interface OutcomeHandlerUnit { id: string; matches(event: WorkerOutcomeEvent): boolean; plan(event: WorkerOutcomeEvent): OutcomeTransition }`。`OutcomeTransition` 用**声明式**字段表达（如 `{ needsHuman?: { taskId, reason, kind }, retryAdvance?: { taskIds, maxRetries }, backoff?: {…}, halt?: {…} }`），由 `WorkerPool.applyTransition(t)` 统一落到 `#` 私有状态。⛔ 处理单元不直接持有或改写私有字段。
   - `WorkerPool.registerOutcomeHandler(unit): () => void`（返回注销函数；重复注册同一 id 幂等或显式报错，二选一并写死测试）与 `WorkerPool.dispatchOutcome(event): OutcomeDispatchReport[]`（按注册顺序分派，报告含每个命中单元的 `{ id, applied }`；无命中返回 `[]`）。
   - 现有分支迁成**内置处理单元**（用同一 `registerOutcomeHandler` 面注册，⛔ 不走后门）：exited-not-landed 的 `stop-terminal` / `count-and-retry` / `baseline-red-deadlock`、快速死亡退避 `quick-death-backoff`、`environment-fatal` 停机、needs-human 终态。暴露只读的 `builtinOutcomeHandlerIds(): string[]`（或静态常量）供测试断言覆盖集合。⛔ 不改判定语义与阈值（继承 AC-914 的非目标）。
   - 内置单元在构造函数中注册或由同文件内 `registerBuiltinOutcomeHandlers(pool)` 完成；⛔ 测试文件不得需要 import 第二个项目模块。构造 `new WorkerPool()` 必须无磁盘副作用（需要落盘的转移只在 `applyTransition` 执行时发生）。
2. **改 `plugin/scripts/worker-driver.ts`**：`onWorkerFinished` 只构造 `WorkerOutcomeEvent` 并调 `pool.dispatchOutcome(...)`；原先的 if/else 分支体删去（迁入 `worker-pool.ts` 的内置单元）。保留 round 记录与 json 事件的**观测字段形状不变**（`.quay/worker-outcome.jsonl` / `worker-round.jsonl` 形状不变）。⛔ 不把派发决策（关注点②）的 `running` / `coldInflight` / `stopReason` 卷进 WorkerPool——停在参数边界上。
3. **新增 `plugin/test/worker-pool-extension-point.test.mjs`**（首行 `// @test-group serial`）：
   - **只** `import` `../scripts/worker-pool.ts`（外加 `node:test` / `node:assert` 等标准库）。⛔ 文件内容不得出现中心文件名 `worker-driver`（criterion 逐字 `grep -q 'worker-driver'`；注释、字符串、路径同样算——按位置判定在判据侧就是整文件 grep）。
   - 正向：`pool.registerOutcomeHandler({ id: "synthetic-unit", matches: e => e.finalState === "synthetic-outcome", plan: () => ({ needsHuman: { taskId: "gap-synthetic", reason: "synthetic", kind: "stop-terminal" } }) })` → 喂一条 `finalState: "synthetic-outcome"` 的合成结局 → 断言 ①单元被调用（计数器 = 1）②声明的转移被应用（`pool.needsHuman("gap-synthetic") === true`）③报告含 `synthetic-unit`。
   - 通用分派：再注册第二个 `finalState: "synthetic-other"` 的单元，喂对应事件断言只命中第二个（第一次注册的计数器不增）——证明按结局种类分派，而非硬编码单例。
   - **负对照（测试内自带，硬规则 4）**：①同构的**未注册** pool 喂同一结局 ⇒ 报告长度 `0` 且 `needsHuman("gap-synthetic") === false`（用 `assert.equal` 明确断言「没注册就没有转移」）；②**绕过注册表**直接调 `applyTransition` ⇒ 转移仍生效——证明转移机制本身可用，从而正向断言的失败只可能来自注册面失效（区分「未评估」与「不合格」，硬规则 3b）。
4. **验收负控制（真载体，⛔ 不写回 store）**：`cp` 备份 `worker-pool.ts` → 把 `dispatchOutcome` 改成不遍历注册表（直接返回 `[]`）→ ①AC-915 criterion 必须 exit 1（stderr `CAUSE=extension-point test failed`）②测试文件自身也必须红；`cp` 恢复后 `md5sum` 与改前一致且两侧转绿。⛔ 不用 `git checkout` 恢复（共享检出）。
5. **验证**：`bash scripts/test.sh --for-task <id>`（scoped 静态检查）；affected suites：`node --no-warnings --experimental-strip-types --test plugin/test/worker-pool.test.mjs plugin/test/worker-driver.test.mjs plugin/test/worker-driver-fan-in-s0*.test.mjs plugin/test/worker-driver-resident-s0*.test.mjs`。

## AC

- [x] AC1 判据从红转绿：在任务 worktree 内逐字执行 `quay goal show AC-915` 取出的 criterion ⇒ exit 0 且 stdout 含 `OK: a new outcome handler registers from outside worker-driver.ts`（贴 criterion 全文与读数）
  - criterion 全文：`t=plugin/test/worker-pool-extension-point.test.mjs; if [ ! -f "$t" ]; then echo "CAUSE=missing extension-point test $t" >&2; exit 1; fi; if grep -q 'worker-driver' "$t"; then echo "CAUSE=$t references worker-driver; a new outcome handler must register through WorkerPool without touching the core file" >&2; exit 1; fi; if ! node --no-warnings --experimental-strip-types --test "$t" >/dev/null 2>&1; then echo "CAUSE=extension-point test failed: $t" >&2; exit 1; fi; echo "OK: a new outcome handler registers from outside worker-driver.ts"`
  - 读数（red→green）：立案当轮 `CAUSE=missing extension-point test plugin/test/worker-pool-extension-point.test.mjs`（exit 1）；实现后 `OK: a new outcome handler registers from outside worker-driver.ts`（exit 0，2026-10-22 本轮复跑同读数）。
  - 注：本树 `quay goal show AC-915 --json` 返回空对象 `{}`（CLI 的 `--json` 面缺口，非判据失败）；`quay goal show AC-915` 逐字打印 criterion，以上全文取自该命令输出。
- [x] AC2 测试文件只依赖 worker-pool.ts：`grep -cE "from ['\"]\.\./scripts/worker-pool" plugin/test/worker-pool-extension-point.test.mjs` ⇒ `1`；且 `grep -cE "from ['\"]\.\./scripts/" plugin/test/worker-pool-extension-point.test.mjs` ⇒ `1`（贴两条读数）
  - 读数：`from ../scripts/worker-pool` = **1**；`from ../scripts/` = **1**。
- [x] AC3 不引用中心文件（criterion 谓词非恒零）：`grep -c 'worker-driver' plugin/test/worker-pool-extension-point.test.mjs || true` ⇒ `0`；同一条 grep 对该文件的一份临时副本（追加一行含中心文件名）⇒ `1`（零计数配套干跑）
  - 读数：生产文件 = **0**；临时副本（`/tmp/ac3-probe.mjs`，追加 `// worker-driver appended line (AC3 dry-run)`）= **1** ⇒ 该谓词对真样本确实命中，零计数不是恒零（2026-10-22 本轮复跑同读数）。
- [x] AC4 扩展点行为取真：`node --no-warnings --experimental-strip-types --test plugin/test/worker-pool-extension-point.test.mjs` ⇒ 0 fail，且正向断言覆盖「单元被调用 / 声明的转移被应用 / 报告含单元 id」（贴 `# pass` / `# fail` 与断言名）
  - 读数：`ℹ tests 10 / ℹ pass 10 / ℹ fail 0`（2026-10-22 本轮复跑同读数）。
  - 断言名：`正向：外部注册的合成单元被调用，它声明的转移被应用，报告含该单元 id`（内部断言：`单元被调用恰好一次` / `声明的转移（needs-human latch）被应用` / `报告含命中单元 id`）。
- [x] AC5 负对照非空转：测试内存在「未注册 ⇒ 无转移」与「绕过注册表直调转移 ⇒ 转移可用」两条对照，`# pass` 中能读到这两条断言名；并贴它们在不注册时确实取假（贴读数）
  - `# pass` 中的断言名：`负对照A：未注册该单元 ⇒ 报告为空且没有转移（没注册就没有）`、`负对照B：绕过注册表直接调 applyTransition ⇒ 转移机制本身可用`。
  - 取假读数（AC9 的载体负控制下）：未注册路径 `reports.length === 0` 且 `pool.needsHuman("gap-synthetic") === false`（assert.equal 逐条通过）；绕过注册表路径 `res.needsHumanResults.length === 1` 且 `needsHuman === true` ⇒ 两侧不同形，负对照不是空转。
- [x] AC6 注册面是通用分派而非硬编码单例：两个不同 `finalState` 的合成单元分别命中（贴 AC4 输出中的断言名）；`grep -cE 'registerOutcomeHandler' plugin/scripts/worker-pool.ts` ≥ `2`；`grep -cE 'dispatchOutcome' plugin/scripts/worker-driver.ts` ≥ `1`（贴三条读数）
  - 断言名：`通用分派：两个不同 finalState 的合成单元各自命中（不是硬编码单例）`（`unit-second` 命中、`unit-first` 计数器不增）。
  - 读数（2026-10-22 复跑）：`registerOutcomeHandler` in `plugin/scripts/worker-pool.ts` = **2**；`dispatchOutcome` in `plugin/scripts/worker-driver.ts` = **1**。
- [x] AC7 现有分支已走同一注册面：`builtinOutcomeHandlerIds()`（或静态常量）覆盖 exited-not-landed 三分支 + 快速死亡退避 + environment-fatal + needs-human 终态（测试中断言集合 ⊇ 6 个 id 且 pass）；`onWorkerFinished` 体内不再持有这些分支的 if/else（贴 `git diff` 中该函数的读数与内置 id 清单）
  - 内置 id 清单（`new WorkerPool().builtinOutcomeHandlerIds()` 实测）：`["exited-not-landed-baseline-red-deadlock","exited-not-landed-stop-terminal","exited-not-landed-count-and-retry","quick-death-backoff","environment-fatal-halt","needs-human-terminal"]` ⇒ 6/6，且测试 `内置单元经同一注册面注册：…` pass。
  - `onWorkerFinished` 从 ~166 行分支体收缩为 **33 行**（`plugin/scripts/worker-driver.ts:6020-6053`）：`rw.done/results.push` → `normalizeWorkerOutcome(r)` → `workerPool.dispatchOutcome(event, { root: rootDir })` → 只按报告发 `needs-human` / `environment-fatal-halt` 观测事件（停机磁盘动作由调用方执行）。体内对 `decision.kind` / `advanceRetryCap` / `applyNeedsHumanTransition` / `newlyNeedsHuman` 的**分支 0 处**；唯一关键字命中是 `worker-backoff` 观测事件里的 `newlyNeedsHuman` 字段（观测面，⛔ 不是分支）。
- [x] AC8 行为不回归：`node --no-warnings --experimental-strip-types --test plugin/test/worker-driver.test.mjs plugin/test/worker-driver-fan-in-s0*.test.mjs plugin/test/worker-driver-resident-s0*.test.mjs` ⇒ 0 fail；`.quay/worker-outcome.jsonl` / `worker-round.jsonl` 的记录形状由既有测试覆盖（贴 `# pass` / `# fail`）
  - 读数（2026-10-22 复跑，含 `worker-pool.test.mjs`）：`ℹ tests 296 / ℹ pass 296 / ℹ fail 0`。
  - 形状不变：round 记录的 `retry_exemptions` / `exited_not_landed_stops` / `needsHuman` 字段仍在 `normalizeWorkerOutcome` / 报告循环里按原形状写入（`computeWorkerRoundRecord` 未改）。
  - 兄弟测试重钉（2026-10-22，修复上一轮 suite 红）：`plugin/test/worker-driver-retry-classification.test.mjs` 的静态半边原先钉死中心文件里的 `if (decision.kind === "stop-terminal")` / `else if (exemption.verdict !== ...)` 字面分支——那正是本任务退役的形态。现改为钉新结构：调用点 `workerPool.dispatchOutcome(event` 交给注册表；`worker-pool.ts` 中 stop-terminal 与 count-and-retry 是两个**独立注册单元**，各自匹配自己的 kind 并声明不同转移（`needsHuman` vs `retryAdvance`），且互相不包含对方的转移。README 该文件读数：`ℹ tests 30 / ℹ pass 30 / ℹ fail 0`。
- [x] AC9 反向能取假（真载体）：按 Plan 第 4 步执行 ⇒ 绕过注册表后 AC1 criterion exit 1 且 stderr 含 `CAUSE=extension-point test failed`，测试文件红灯；`cp` 恢复后 `md5sum` 与改前一致且转绿（贴两侧读数；⛔ 不用 `git checkout` 恢复）
  - 变造（`dispatchOutcome` 首行插 `return []; // AC9 negative control`，2026-10-22 复跑）：criterion ⇒ `CAUSE=extension-point test failed: plugin/test/worker-pool-extension-point.test.mjs`（**exit 1**）；测试文件 ⇒ `pass 6 / fail 4`（exit 1）。
  - 恢复（`cp` 备份回填）：`md5sum` 改前/改后均为 `b4a6a463ba3bf8ff0ff299d497666d19`（`diff` 无差异）；criterion ⇒ `OK: …`（exit 0），测试 ⇒ `pass 10 / fail 0`。⛔ 全程未用 `git checkout`。
- [x] AC10 scoped 门与 schema：`bash scripts/test.sh --for-task <id>` ⇒ exit 0；`node plugin/scripts/task-schema-check.ts tasks/<id>.md` ⇒ exit 0（贴读数）
  - scoped 门：`bash scripts/test.sh --for-task gap-worker-pool-outcome-handler-extension-point --allow-thin` ⇒ **exit 0**（`tests 163 / pass 163 / fail 0`）。
  - schema：`node plugin/scripts/task-schema-check.ts tasks/gap-worker-pool-outcome-handler-extension-point.md` ⇒ **exit 0**（`N/A legacy (no schema marker)`，`0 fail`）。

## DoD

AC-915 在 goal-driver 下一轮读数为 `pass`，且达成形态是**扩展点真的被外部使用**：`plugin/test/worker-pool-extension-point.test.mjs` 只 import `worker-pool.ts`、注册一个中心文件从未见过的合成结局处理单元并断言其转移被应用，负对照与真载体负控制都取假成功（AC5 / AC9）。仅让测试文件存在、或把分支代码搬到 `worker-pool.ts` 而注册面仍是硬编码分支 ⇒ 不算达成。改动经 fan-in 落地 `develop`。

## Touches

- plugin/scripts/worker-pool.ts
- plugin/scripts/worker-driver.ts
- plugin/test/worker-pool-extension-point.test.mjs
- plugin/test/worker-driver-retry-classification.test.mjs
- tasks/gap-worker-pool-outcome-handler-extension-point.md
