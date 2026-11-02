---
id: gap-worker-verify-condenser
title: worker 验证循环下沉：复用 fan-in 的失败文件解析 + 基线 A/B，把 verify 轮压成紧凑 must-fix
  表并只重跑失败文件（验证面不变）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

轮数台账（`docs/analysis/rounds-ledger-2026-11-03.md`，2026-11-03）给出的读数：

- 全局 10,392 轮里 **verify 1,812（17.4%）+ fix 912（8.8%）= 26.2%**；
- 35 个返工会话中 **71.4% 是 fan-in-red**；fan-in 失败步骤里 suite 相关 ≈95%（suite-end 80 / rerun 44 / suite 37 / baseline-red 30 / suite-incomplete 23 / suite-recovery 13），merge-develop 仅 9、scoped-gate 仅 1；
- 返工合计 21% 的 worker 加权成本（38.6M eq/周）。

这些轮花在哪里：worker 每轮验证都要**读原始 suite 日志自己找失败文件**，并且**对既存红（baseline-red）与本轮回归不加区分**——台账里 baseline-red 失败步骤出现 30 次，说明确实有任务在追不属于自己的红。fan-in 侧已经有全部机械件（`worker-fan-in.ts` 已 export：`readFailedTestFiles` / `parseSuiteLogFailures` / `parseFailureSignatures` / `compareFailureSignatures` / `readDevelopRedSet` / `scopedGateCommandFor` / `resolveRerunCommand` / `mechSh`），但 **worker 侧一个都没用上**。

本任务把 fan-in 已有的「失败文件解析 + 只重跑失败文件 + 基线 A/B」暴露成 worker 可调用的一个验证入口，目标函数按人 2026-11-03 裁定：**成本/落地任务优先、墙钟其次；只做机械替代，⛔ 不砍验证面。**

具体形态：
- 第一次验证：跑**逐字相同**的 `loop.scoped_command`（覆盖不变），把原始日志压成紧凑失败表 `{file, test, cause}`；
- 若失败：用既有基线 A/B（在 develop 基线树上重跑同一批失败文件）分类 `baseline-red` 与 `must-fix`；
- 后续迭代：只重跑 `must-fix` 文件（`loop.rerun_command` 的 `{files}` 整元素 splice）；
- 退出前：**必须再跑一次完整 scoped gate**，退出状态永远由完整门判定；
- 基线树不可用 / 解析不出失败行 ⇒ `not-evaluated`，并保守地把全部失败当 `must-fix`（不跳过、不静默判绿）。

<!-- dedup-ref -->
与已 done 的 `gap-fan-in-suite-red-no-in-round-rerun-of-red-files` / `gap-in-round-suite-rerun-never-executed-in-production` 保持独立：那两条修的是 **fan-in 侧**的本轮重跑；本条给的是 **worker 会话内**的验证入口，复用它们的实现而不改其语义；与 `gap-fanin-rerun-attribution-blind-to-spec-reporter`（done，解析器修复）互补：本条消费该解析器，不重写。

## Plan

1. 在 `plugin/scripts/worker-driver.ts` 的既有参数入口新增子命令（与 `--write-scoped-gate-cache` 同族，⛔ 不新建 shipped `plugin/scripts/*.ts`，避免 catalog/outline/laydown 三重注册面）：
   - `--verify-run --task <id> --worktree <p> --root <p>`：解析并执行 `scopedGateCommandFor(task, worktree)`，输出紧凑失败表 + 分类；
   - `--verify-rerun --task <id> --worktree <p>`：只对仍 `must-fix` 的文件执行 `resolveRerunCommand` 模板；
   - `--json`：机器可核输出；缺声明/解析失败用独立取值。
2. 复用 `worker-fan-in.ts` 的既有 export：失败解析、签名比较、develop 红集、命令解析。⛔ 不复制实现。
3. 基线 A/B：有可用基线树 ⇒ 分类 `baseline-red` / `must-fix`；无基线树 ⇒ `not-evaluated` 且全部记 `must-fix`（保守）。
4. worker prompt（create 与 continue 两个构造点）把"自己跑 scoped gate 并读日志"改为"调用该入口"；保留"退出前跑完整 scoped gate"的强制要求。
5. 测试 + 真实运行证据（红/绿各一次 + 负控制）。
6. 不宣称轮数下降：本轮只交付机械件与真实运行；轮数效果由下一轮台账对照（不在本条 AC 内）。

## Acceptance Criteria

- [ ] AC1 `node --test plugin/test/worker-verify.test.mjs`（新）exit 0；fixture 至少覆盖：①TAP 与 spec-reporter 两种格式的失败文件解析；②多文件失败；③无失败行 ⇒ `not-evaluated`，不得判绿；④基线树不可用 ⇒ `not-evaluated` + 全部记 `must-fix`；⑤同一文件在基线也红 ⇒ `baseline-red`，不在 `must-fix` 列表。
- [ ] AC2 `--verify-run` 实际执行的 argv 必须与 `scopedGateCommandFor(task, worktree)` 逐元素相等（断言，不是"等价"）；验证覆盖面因此与现状完全一致。
- [ ] AC3 `--verify-rerun` 调用的 argv 来自 `resolveRerunCommand`，`{files}` 按整元素 splice 只放入 `must-fix` 文件；`must-fix` 为空时 exit 0 且输出 `nothing-to-rerun`；`loop.rerun_command` 未声明 ⇒ `not-evaluated` 并退回完整 scoped gate，⛔ 不得跳过验证。
- [ ] AC4 worker prompt 的 create 与 continue 两个构造点都指向该入口，且仍逐字包含"退出前跑完整 scoped gate"；`plugin/test/worker-driver.test.mjs` 断言四根既有不变量（worktree 绝对路径 / `task_write` / anti-drift argv / exit 指令）仍在。
- [ ] AC5 真实运行证据（贴进任务体）：在本仓库取一次真实红（临时 worktree 内故意改坏一个测试文件）与一次全绿，记录两次的 argv、`must-fix` / `baseline-red` 分类、重跑文件数与耗时；负控制证明被改坏的文件仍被判 `must-fix`。
- [ ] AC6 验证面不变：fan-in 侧全量 suite 路径零改动；grep 证明未新增任何"跳过 scoped gate / 跳过 suite"的分支；退出前的完整 gate 是硬路径（缺它则测试失败）。
- [ ] AC7 `git diff --check` exit 0，改动只在声明 Touches 内；不修改 `.quay/profiles.yml`、`.quay/config.yml`、任何 gate/AC/DoD。

## Definition of Done

- 真实红/绿两次运行落进任务体，`must-fix` 集合等于真实回归集合，`baseline-red` 集合等于基线红集合；只有 fixture 通过不算交付。
- worker 的 create/continue prompt 实际使用该入口，且退出前完整 scoped gate 仍被执行。
- 覆盖面无缩水：fan-in 全量 suite、scoped gate 的全部检查项、AC/DoD 门逐项不变。
- 变更经相应检查，并通过约定的落地流程进入 develop。

- 该轴仍暗,理由:只加 worker 侧验证入口并复用既有 fan-in 机械件，不改包/依赖结构，无 L_D/L_G 可测读数。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- plugin/scripts/worker-fan-in.ts
- plugin/test/worker-verify.test.mjs (new)
- tasks/gap-worker-verify-condenser.md