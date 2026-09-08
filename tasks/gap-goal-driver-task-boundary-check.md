---
id: gap-goal-driver-task-boundary-check
title: DIR-131 执行落点：给 goal/task 职责边界造一个按位置判定的静态检查（含双向负控制 + 静态层接线）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：`DIR-131`（人 2026-09-07 裁定，task-canonical 正本）的执行落点。裁定逐字：「创建 task 后到 task 落地的过程应当由 task 相关机制（如 promotion-driver 和 worker-driver）驱动。goal 机制应当负责 task 以外的 goal 相关生命周期。」

**问题**：该边界目前**只有散文载体**——`plugin/scripts/goal-driver.ts` 头注释（`:14-24`）只写了禁止半边。一个未来的实现者在 `goal-driver.ts` 里加一行 `task_write` 不会触发任何红，**与「没有违规」在记录上完全同形**（硬规则 9：守与不守在记录上无法区分 ⇒ 该给它造产物，不是把话写得更醒目）。

**现状已合规（DIR-131 立案当轮按位置实测）**：`goal-driver.ts` 对 `tasks/*.md` 只有读路径（`:233 readTaskFacts`、`:642` 算缺口、`ready-pool-check` 只读判定面），无 `task_write` / `lifecycle_*` / 写 `tasks/` 的调用点。**所以本任务是在一个已合规的现状上钉一个防回归的产物**，不是修一个已发生的违规。

## Plan

1. 新增 `plugin/scripts/goal-driver-task-boundary-check.ts`：按位置断言 `goal-driver.ts` 中不存在 task 写路径的**调用点**——`task_write`、`lifecycle_promote`、`lifecycle_retreat`、`lifecycle_complete`、以及以 `tasks/` 为目标的 `fs.write*`/`writeFileSync`。**必须排除注释与字符串字面量**（`goal-driver.ts` 头注释与 DIR-131 正文里逐字出现这些词，裸 grep 立刻假阳性——硬规则 2）。复用仓库已有的 `maskComments` 手法，⛔ 不手搓只认 `//` 的剥离器（`gap-dead-set-closure-repo-root-call-form-false-positive` 的同形教训）。
2. 双向负控制写进单测 `plugin/test/goal-driver-task-boundary-check.test.mjs`：注释形 ⇒ 绿、真实调用形 ⇒ 红且点名行号。⛔ 一个只有正向的检查是恒绿检查（硬规则 3b）。
3. 接进 `plugin/scripts/runner-static-gate.ts` 静态层（`scripts/test.sh` source 的 checker 注册正本），并加 `plugin/scripts/checker-mutation-cases/goal-driver-task-boundary-check.sh` 变异样例（本仓库新 checker 的既定配套）。
4. `goal-driver.ts` 头注释职责边界段落补**正向半边**（goal 机制负责什么：跑 AC criterion、写 evidence、I2 推导 flip、I3 陈旧三态、I4 分歧、缺口读数、经 ABI 立案）并写入 `DIR-131` 回指。
5. 登记三闸：`capability-catalog.sh` 六表登记新脚本；因改了 laydown 源，须 `quay-init-closure-ratchet.ts --reanchor` 并把 baseline 文件留在 Touches 内。

## AC

- [x] 检查存在且按位置判定：`node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 对当前 `plugin/scripts/goal-driver.ts` exit 0；把 `// task_write 不许调用` 这类**注释**加进临时副本后仍 exit 0
- [x] 负控制能取假：临时副本插入 `fs.writeFileSync(path.join(root, "tasks", "x.md"), "");` ⇒ **exit ≠ 0 且输出点名该行行号**；两个方向都实跑，输出贴进 `## Resolution`
- [x] 接进静态层：`plugin/scripts/runner-static-gate.ts` 的**非注释行**出现该脚本名（`scripts/test.sh` source 该注册正本），且一次真实 `scripts/test.sh` 执行覆盖到它（⛔ 不是手工单跑该脚本）
- [x] 散文与产物互指：`grep -c 'DIR-131' plugin/scripts/goal-driver.ts` ≥ 1，且该段落写了**正向半边**（goal 机制负责什么），不只是禁止清单
- [x] 三闸绿：`bash plugin/scripts/capability-catalog.sh --summary` 的 unclassified == 0 且计数含新脚本；`node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts --task gap-goal-driver-task-boundary-check --root . --check-registration` exit 0
- [x] `node plugin/scripts/task-schema-check.ts tasks/gap-goal-driver-task-boundary-check.md` exit 0

## DoD

上述 AC 全绿，且 `DIR-131` 的 `extra.dirStatus` 可据此从 `pending` 转 `applied`（本任务是它的 escrow 解锁条件）。⛔ 只建文件不接静态层、或负控制未实测取假过、或 `goal-driver.ts` 头注释仍只有禁止半边 ⇒ 不算达成。⛔ 「跑了那个脚本」不等于「一次真实 `scripts/test.sh` 把它算进静态层」——后者才是判据。

## Touches

- plugin/scripts/goal-driver-task-boundary-check.ts（本任务新建的按位置判定检查器）
- plugin/test/goal-driver-task-boundary-check.test.mjs（双向负控制单测，本任务新建）
- plugin/scripts/checker-mutation-cases/goal-driver-task-boundary-check.sh（变异样例，本任务新建）
- plugin/scripts/goal-driver.ts（头注释补正向半边 + DIR-131 回指）
- plugin/scripts/runner-static-gate.ts（静态层接线——checker 注册正本，scripts/test.sh source 它）
- plugin/scripts/capability-catalog.sh（六表登记）
- docs/analysis/quay-init-closure-ratchet.baseline.json（laydown 源变更后 --reanchor）
- tasks/gap-goal-driver-task-boundary-check.md（自身）

## Resolution

**实现落地**（worker，2026-09-08）：新增 `goal-driver-task-boundary-check.ts`（按位置判定，屏蔽注释与字符串字面量，`maskComments` 手法扩展为同时标记字符串内部）、`goal-driver-task-boundary-check.test.mjs`（双向负控制，11 测试全绿）、`checker-mutation-cases/goal-driver-task-boundary-check.sh`（变异样例），接进 `runner-static-gate.ts` 的 `run_static_checks`（CODE-class，⛔ 不是 `run_operational_checks`），`capability-catalog.sh` 六表登记，`quay-init-closure-ratchet.ts --reanchor` 更新 baseline，`goal-driver.ts` 头注释补正向半边 + `DIR-131` 回指。

**AC2 负控制（两个方向实跑，输出如下）**：

注释形 ⇒ 绿（exit 0）：
```
goal-driver-task-boundary-check: PASS — goal-driver.ts has no task-write call sites (task_write/lifecycle_*/fs.write-to-tasks)
```

真实写调用形 ⇒ 红（exit 1，点名行号 858）：
```
goal-driver-task-boundary-check: RED (1 violation(s))
  - [task-write] fs.writeFileSync @ line 858: fs.writeFileSync(path.join(root, "tasks", "x.md"), "");
```

真实 task_write 动词形 ⇒ 红（exit 1，点名行号 1）：
```
goal-driver-task-boundary-check: RED (1 violation(s))
  - [task-verb] task_write @ line 1: task_write({ id: "x", status: "ready" });
```

**AC3 静态层接线修正 + 真实执行证据**：立案时 Touches/AC3 写「`scripts/test.sh` 静态层」，但 `gap-ac128-hub-split` 已把 code-class checker 注册表抽到 `plugin/scripts/runner-static-gate.ts`（`scripts/test.sh` 第 268 行 `source` 它；`select-static-checks-for-touches.ts` / `checker-mutation-check.sh` 都解析该文件为单一真相源），故接线落在 `runner-static-gate.ts` 的 `run_static_checks`（本任务 Touches 已更正为 `plugin/scripts/runner-static-gate.ts`）。真实执行证据：`bash scripts/test.sh --for-task gap-goal-driver-task-boundary-check --allow-thin` exit 0，其中包含本 checker 的静态检查行：
```
  scoped check: run_checker "goal-driver-task-boundary-check" node --no-warnings --experimental-strip-types ".../plugin/scripts/goal-driver-task-boundary-check.ts" --root "..."
goal-driver-task-boundary-check: PASS — goal-driver.ts has no task-write call sites (task_write/lifecycle_*/fs.write-to-tasks)
```

**AC5 三闸**：`capability-catalog.sh --summary` → `319 scripts | 319 declared | 0 unclassified | 314 ship`（计数含新脚本）；`select-static-checks-for-touches.ts --task gap-goal-driver-task-boundary-check --root . --check-registration` → `registrationCheck.ok = true`；laydown `quay-init-closure-ratchet.ts --reanchor` exit 0（baseline fingerprint 更新为 `2e5483d9…`）。