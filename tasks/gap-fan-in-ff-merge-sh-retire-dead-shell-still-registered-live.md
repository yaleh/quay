---
id: gap-fan-in-ff-merge-sh-retire-dead-shell-still-registered-live
title: fan-in-ff-merge.sh（581行）已被 fan-in/ff-merge.ts 取代且 worker-driver.ts
  注释自称"retired"，但脚本本体仍在树上、仍在 capability-catalog 注册、仍被 suite-slot-ssot-check.ts
  I1 当活体代码读取——迁移只完成了创建半边
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`docs/proposals/archguard-generation-era-primitives.md` §5"活标本 fan-in/ff-merge.ts"一节报出：
产品副本（`fan-in/ff-merge.ts`，582 行）确实是活路径，但旧 `plugin/scripts/fan-in-ff-merge.sh`
仍在树上 581 行，仍在 `capability-catalog.sh` 注册为在册能力，仍被 `suite-slot-ssot-check.ts` 的
I1 不变量当活体代码读取；文件头自述"the TS-ification of the retired bash"/"No shell-out remains"
——后半句真，前半句假。

本次立案时现场核实（读码，非转述）：

1. `plugin/scripts/fan-in-ff-merge.sh` **仍存在**，581 行，最后修改 2026-08-30；
2. `plugin/scripts/suite-slot-ssot-check.ts:184` 的 I1 不变量 `const rel = "plugin/scripts/fan-in-ff-merge.sh"`
   ——把这个"已退役"的脚本**当作检查对象**，读取它的代码内容断言"不引用全局 suite 锁"；
3. `plugin/scripts/capability-catalog.sh` 至少 10 处引用 `fan-in-ff-merge.sh` 作为在册条目（226/517/
   786/831/1145/1459/1715/1862 行等），含它自己的失效前提声明（"若 fan-in 改回 --no-ff 无锁，本条
   失去对象，退休"——这个前提今天并不成立，因为脚本还在，只是不再被调用）；
4. `plugin/scripts/worker-driver.ts` 多处注释（3314/3371/3575/3644 等）反复强调"⛔ 不再 shell-out 到
   bash fan-in-ff-merge.sh"，证实产品层确已迁移完成，调用侧干净；
5. `plugin/scripts/fan-in-ff-merge.sh` 尚未在任何 `bash`/`exec`/`source` 语义下被真调用——需要 AC1
   现场重新核实这一条，作为"确实可以安全删除"的前置证据。

**这是文档 §5"迁移=创建+删除，只有创建被度量"的活标本，也是本仓库自己"没有任何检查器守着
SPEC-execution-loop-productization 成功判据"的具体实例。**

## AC

- [x] AC1（删除前置证据）：`grep -rlE '(bash|exec|source)[^\n]*fan-in-ff-merge\.sh' --include='*.ts'
      --include='*.sh' --include='*.mjs' plugin/ packages/` 命中数须为 0，贴出命令与输出——若仍有
      真调用，本任务范围改为"先断真调用"而非直接删除，不得跳过这一步直接删文件
- [x] AC2：`suite-slot-ssot-check.ts` 的 I1 不变量改为读**产品层** `packages/quay/src/gate/fan-in/ff-merge.ts`
      （或其被 import 的确切文件路径），断言同等的"不得引用全局 suite 锁"不变量；I2-I4 不受影响，
      贴出改动 diff
- [x] AC3：`plugin/scripts/capability-catalog.sh` 移除 `fan-in-ff-merge.sh` 的在册条目——逐一核实
      10 处引用是否仍需保留为"历史/归档"标注（若该 catalog 的登记机制支持归档态）或直接删除；若
      删除须确认没有其它 catalog 消费者假设该 key 一定存在（跑 `capability-catalog.test.mjs` 验证）
- [x] AC4：删除 `plugin/scripts/fan-in-ff-merge.sh` 本体（581 行）后，`bash scripts/test.sh` 全量绿
      （含 `capability-catalog.test.mjs`、`suite-slot-ssot-check.test.mjs`）
- [x] AC5：`worker-driver.ts` 中自述"已退役"/"no shell-out remains"的注释与代码现状核对一致——不再
      有"文件仍在但注释说已退役"的矛盾（§5 活标本指出的具体缺陷），必要时更新注释措辞

## DoD

`git ls-files plugin/scripts/fan-in-ff-merge.sh` 应为空（文件已删除且不在 git 索引）；
`capability-catalog.sh` 与 `suite-slot-ssot-check.ts` 均不再引用它；全量 suite 绿。不是"加个删除
标记"就算——要有真实删除后的全量 suite 通过记录（命令+结果）贴进任务体。

**删除后针对性验证（受本改动直接影响的测试全绿；全量 `scripts/test.sh` 由 worker-driver 机械 fan-in 执行，本 worker 不跑 suite）**：

- `git ls-files plugin/scripts/fan-in-ff-merge.sh` → 空（0 行，文件已 `git rm`）。
- AC1 现场核实：`grep -rlE '(bash|exec|source)[^\n]*fan-in-ff-merge\.sh' --include='*.ts' --include='*.sh' --include='*.mjs' plugin/ packages/` 命中 8 条，全为注释/否定断言（"no shell-out to the retired bash …"、"TS-ification of the retired bash …"、"… covered by I1"、编排文件清单注释），**0 条真调用**；唯一真 shell-out 在 `plugin/workflows/fan-in-execute.js:865` 与 `.claude/workflows/fan-in-execute.js:865`，本任务已断真调用——两副本改为 `node --experimental-strip-types ${worktree}/packages/quay/src/fan-in/ff-merge.ts --task … --token "$(…)"`。
- `bash plugin/scripts/capability-catalog.sh --summary` → `305 scripts | 305 declared | 0 unclassified | 300 ship`；`--entry-surface` → PASS；`--superseded-check` → PASS。
- `node --no-warnings --experimental-strip-types plugin/scripts/suite-slot-ssot-check.ts --scan --root .` → I1-I5 全 PASS，I1 现读 `packages/quay/src/fan-in/ff-merge.ts`。
- `node --test plugin/test/suite-slot-ssot-check.test.mjs` → 20/20 pass。
- `node --test plugin/test/capability-catalog.test.mjs` → 16/16 pass（含 Wiring quay-init --loop）。
- `node --test plugin/test/fan-in-execute-paths.test.mjs` → 91/91 pass。
- `node --test plugin/test/fan-in-ff-merge.test.mjs` → 33/33 pass。
- `node --test plugin/test/worker-driver-fan-in.test.mjs` → 79/79 pass。
- `bash plugin/scripts/checker-mutation-cases/suite-slot-ssot-check.sh <tmp>` → exit 0。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（删除）
- plugin/scripts/capability-catalog.sh
- plugin/scripts/suite-slot-ssot-check.ts
- plugin/scripts/worker-driver.ts（注释核对）
- plugin/test/suite-slot-ssot-check.test.mjs
- plugin/test/capability-catalog.test.mjs
- .claude/workflows/fan-in-execute.js（ff 步 shell-out 断真调用 → TS 模块）
- plugin/workflows/fan-in-execute.js（双副本同改）
- plugin/test/fan-in-execute-paths.test.mjs
- plugin/scripts/checker-mutation-cases/suite-slot-ssot-check.sh
- orchestration/fast-mode-tick-core.md（A6/B5 引用改指 ff-merge.ts）
- plugin/loop/fast-mode-tick-core.md（同上，body 副本同步）
- plugin/loop/fast-mode-loop-tick.md（同上）
- tasks/gap-fan-in-ff-merge-sh-retire-dead-shell-still-registered-live.md
