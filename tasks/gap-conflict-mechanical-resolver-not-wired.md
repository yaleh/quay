---
id: gap-conflict-mechanical-resolver-not-wired
title: 把 conflict-resolution-rules 的机械消解接进 worker
  生产路径：resolveConflictMechanically 有行为测试但零生产调用，continue prompt 仍用 1842 字符教 agent
  手跑同样的 git 命令
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-prompt-string-assert-seven-rules-disposition
---
## Proposal

**来源**：`gap-prompt-string-assert-seven-rules-disposition` 的 `## 追加记录（落地后核出，未处理）`（该任务已 `done`）。本条是人为其解除 PARKED 后的后续动作，`depends_on` 指向它，⛔ 不是独立提议。

**发现**：`plugin/scripts/conflict-resolution-rules.ts:220` 的 `resolveConflictMechanically` 能真跑 `git checkout develop --` / `git rm` / dual-copy 字节同步，且有行为测试（`plugin/test/worker-driver-resident-s07.test.mjs:145`、`:245`）。但全仓调用点只有**该文件自己的 CLI 入口**（`:296`）与测试——**worker/driver 生产路径没有调用者**。

**影响**：`buildContinueWorkerPrompt` 的冲突消解块 = **1842 字符（冲突块占 continue prompt 约 34%）**，其中规则 (1) take-develop docs、(3) dual-copy 已是**机器可判**，prompt 却仍教 agent 手工执行同样的 git 命令。⇒ 生产路径绕过了可执行载体；这正是上一任务「可见性 ≠ 执行」的同一形态，只是这次的载体**已经存在且已测试**。

**基线**（P1 落地后）：`buildContinueWorkerPrompt` 渲染长度 = **6511**（fixture 见 P1 的 E1）；冲突块 **1842**；棘轮 `gap-worker-prompt-note-family-slimming` 当前 **8940**（阈值 9102）。

⛔ 不以 |D| 下降 / 原子数计数作为任何 AC 或 DoD 的证据。

## Plan

1. **确定接线点**：冲突发生在 worker 的 pre-merge 步（它在自己的 worktree 里 merge develop）。推荐做成**一条命令**：给 `conflict-resolution-rules.ts` 增加批量模式（例如 `--resolve-all <root>`），枚举 `git diff --name-only --diff-filter=U`，对每个文件调用既有的 `resolveConflictMechanically`，返回「已机械解决」与「仍需人工判断」两份清单。**保持既有单文件 CLI 与导出函数签名不变**。
2. **实现批量路径**：只对 `conflictAction` 返回非 `manual` 的文件执行；`manual` 文件**原样保留**并在输出里点名。⛔ 不得静默跳过、不得对 manual 文件擅自 `git checkout develop --`。
3. **改 prompt**：把 continue prompt 冲突块的机器可判规则 (1)/(3) 换成「跑这条命令 + 只处理它点名的人工文件」；保留判断型规则 (2) code union、(2b) task files、(5) modify/delete（含"先判哪边删"的语义）、(6) add+commit、FF 规则。
4. **测试**：真 git 仓库 fixture——take-develop（outline/tick doc）、dual-copy（两副本 byte-identical）、delete-side（DU/UD）各一条正臂；`manual` 文件一条负臂（未被改动且被点名）。⛔ 不许只断言返回字符串。
5. **读数**：用 P1 E1 的同一 fixture 重测 `buildContinueWorkerPrompt`，记录 before/after 与冲突块大小；确认棘轮 ≤9102 仍绿。

## Acceptance Criteria

- [ ] AC1 生产可达：批量机械消解从**真实 worker 使用的 prompt** 可达——prompt 里给出单一命令；在真 git fixture 上运行该命令，take-develop / dual-copy / delete-side 三类文件被真实解决（`git status` 无 UU；dual-copy 两副本 byte-identical）。负臂：一个 `manual` 文件被原样保留**且**在输出里点名（给出逐字读数）。
- [ ] AC2 prompt 收缩：continue prompt 冲突块里规则 (1)/(3) 的机器可判指令**不再出现**（负臂：对应文本在 `buildContinueWorkerPrompt` 输出中的命中数为 0）；判断型规则 (2)(2b)(5)(6)+FF 仍在，且既有行为测试仍绿。
- [ ] AC3 长度读数：用 P1 E1 的同一 fixture 贴出 `buildContinueWorkerPrompt` 的 before（6511）与 after 逐字数字、冲突块 before（1842）与 after；棘轮 `gap-worker-prompt-note-family-slimming` ≤9102 仍绿（给出当前值）。
- [ ] AC4 无回归：`plugin/test/worker-driver-resident-s07.test.mjs`（含 `resolveConflictMechanically` 的既有行为测试）与 `scripts/test.sh --for-task gap-conflict-mechanical-resolver-not-wired` 绿。

## Definition of Done

- 四条 AC 勾选，每条附可复跑命令与逐字读数。
- **生产路径的证据**：真实运行（不是测试里直接 import）批量命令解决真冲突的读数，贴进 `## Evidence`。
- prompt 改动写进任务体，不是只留在会话里。
- ⛔ 完成证据中不得出现「|D| 下降」或原子计数。

## Evidence

（执行者填写：fixture、批量命令、三类正臂读数、manual 负臂、before/after 长度、棘轮读数。）

## Touches

- plugin/scripts/conflict-resolution-rules.ts
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- plugin/test/worker-driver-resident-s07.test.mjs
- tasks/gap-conflict-mechanical-resolver-not-wired.md (new)
