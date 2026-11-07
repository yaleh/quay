---
id: gap-prompt-string-assert-seven-rules-disposition
title: 派发提示词 7 条 string-assert 规则逐条定处置（代码强制 / 删除 / 保留并说明），渲染长度 4376/6573 为前后基线
status: todo
labels:
  - gap
  - prompt
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：两份只读清单（**在 quay 仓之外**，绝对路径）：`/data/home/yale/.claude/domain-semantic-induction/quay-dev/inventories/prompt-rules-2026-11-07.md` 与 `/data/home/yale/.claude/domain-semantic-induction/quay-dev/inventories/decision-surface-2026-11-07.md`（口径 commit `04d611e12`），已由对端独立抽验：12 处 `file:line` 全部命中，渲染长度 4376/6573 复现一致。⚠️ 这两份文件不在 quay 仓内，worker 若读不到，**以本任务体列出的 7 条清单与基线为准**，⛔ 不因缺源文件而阻塞。

现状：63 条 prompt 规则（下界）的 `enforcement` 分布为 code 37 / none 14 / **string-assert 7** / behavior-test 5。这 7 条是「prompt 说了、测试只断言文本、行为没有保证」——本仓硬规则 9（可见性 ≠ 执行）的直接实例：worker 读到规则后不照做，套件仍绿。

7 条清单（`file:line` 是构造函数起始行，规则文本在函数体内；行号以本任务分支的当前代码为准，⚠️ 若与 `04d611e12` 不同，以当前代码重新定位并在 Evidence 记录）：
- `driverFanInNote-1/2/3` @ `plugin/scripts/worker-driver.ts:2432`
- `preMergeNote-1` @ `plugin/scripts/worker-driver.ts:2477`
- `continueDarkAxisNote-1` @ `plugin/scripts/worker-driver.ts:2803`
- `formatRelatednessNote-1/2` @ `plugin/scripts/worker-driver.ts:3378`

基线（渲染长度，⛔ 不是源码字面量）：
- `buildWorkerPrompt('gap-touches-parser-a-self-describing', '/data/home/yale/work/quay').length` = **4376**
- `buildContinueWorkerPrompt(同 task/root, {worktreePath:'/data/home/yale/work/quay-worktrees/x',branchCommits:2,branchHeadSubject:'wip',acChecked:2,acTotal:5,failureReason:'suite red: plugin/test/x.test.mjs',attempts:[]}).length` = **6573**
- 复现方式：模块有 direct-entry guard，可安全 import；命令见 `## Evidence`。

⛔ 不以 |D| 下降 / 原子数减少作为任何 AC 或 DoD 的证据。

## Plan

1. **逐条复核并分类**（先读代码，⛔ 不按函数名判断）：对 7 条各判一次——
   - `machineDecidable=yes` ⇒ 写清由哪个函数/检查器强制，并设计负臂（注入违约必须红）；
   - 规则已过期或行为已由别处保证 ⇒ 从 prompt 删除，并给出「删了不会变坏」的证据；
   - 必须由 agent 判断 ⇒ 保留，写明为何不能机器判，并尽量补一条**行为级**守卫（不是 `assert.match`）。
2. **处置落地**：`enforce` 实现检查；`remove` 删除文本；`keep` 补说明。⛔ 只把一条 `assert.match` 换成更宽的另一条 `assert.match` 不算。
3. **测试改造**：把对应字符串断言换成行为断言，或在 `remove`/`keep` 情况下删除断言并记录理由。
4. **前后读数**：用同一 fixture 重测两个基座的渲染长度，逐条记录每条处置对长度的贡献。
5. **非独立规则的合并**：若复核发现某条不是可独立违反的规则（例如 `driverFanInNote-2` 只是 `-1` 的括号细节），合并并写明依据——⛔ 不得为凑 7 而保留。
6. **已知冲突（必读，否则会红一条无关测试）**：`plugin/test/worker-driver.test.mjs:1236` 有 `gap-worker-prompt-note-family-slimming` 的**活棘轮**——`buildWorkerPrompt` + `buildContinueWorkerPrompt` 的归一化合并长度必须 ≤ **9102**（baseline 12137 的 −25%）。实测当前值 = **9064**，余量仅 **38 字符**。⇒ 任何 `keep` / 扩写必须由等量或更多的删除补偿；⛔ 不得擅自抬高 `WORKER_PROMPT_SLIM_BASELINE`（那是 re-anchor 行为，需单独裁定）。若某条规则确实必须保留且无法补偿，在 `## Evidence` 写明并提出 re-anchor 请求，⛔ 不要静默改基线。

## Acceptance Criteria

- [ ] AC1 逐条处置：7 条每条都有 `{src, rule, disposition: enforce|remove|keep, reason}` 记入任务体 `## Evidence`，无一条未分类；若合并了非独立规则，写明依据。
- [ ] AC2 `string-assert` 清零：这 7 条对应的 `assert.match` 全部消失或换成行为断言；负臂：每条 `enforce` 的规则，注入违约后检查必红（逐字读数）；每条 `remove` 的规则，给出「删除后既有行为测试仍绿」的读数。
- [ ] AC3 渲染长度前后读数：用固定 fixture 重测两个基座，贴出 before（4376 / 6573）与 after 的逐字数字，**逐条说明**每条处置对长度的贡献。⛔ 不设「必须变短」的目标；变长也可接受，但必须解释。
- [ ] AC4 无回归：`node --test plugin/test/worker-driver.test.mjs plugin/test/worker-driver-resident-s05.test.mjs` 与 `scripts/test.sh --for-task gap-prompt-string-assert-seven-rules-disposition` 绿；其中 `gap-worker-prompt-note-family-slimming` 的**长度棘轮 ≤9102 必须保持绿**（当前 9064，余量 38 字符；若因本任务变红，按 Plan 第 6 条的补偿或 re-anchor 请求处理）。

## Definition of Done

- 四条 AC 勾选，每条附可复跑命令与逐字读数。
- 7 条的最终处置写进任务体 `## Evidence`，不是只留在会话里。
- 本任务口径下 `string-assert` 从 7 降为 0。
- ⛔ 完成证据中不得出现「|D| 下降」或原子计数。

## Evidence

（执行者填写：渲染长度的复现命令、before/after、逐条处置、负臂读数。⛔ 不要写「测试绿了」代替读数。）

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- plugin/test/worker-driver-resident-s05.test.mjs
- tasks/gap-prompt-string-assert-seven-rules-disposition.md (new)