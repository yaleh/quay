---
id: gap-routine-semantic-dedup-scan-runcli-twostill-handrolled
title: "semantic-dedup-scan: Two members delegate to shared parseArgs; two still
  hand-roll the same --root/--json/--help loop."
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Two members delegate to shared parseArgs; two still hand-roll the same --root/--json/--help loop.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791631645924` · ts `2026-10-10T11:27:25.924Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`runCli`
- 涉及文件：
- `plugin/scripts/task-ac-carryover-check.ts:333`
- `plugin/scripts/task-contract-check.ts:533`
- `plugin/scripts/threshold-scope-check.ts:409`
- `plugin/scripts/tmux-test-isolation-check.ts:100`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
unify

## 处置
**修掉**——`runCli` 家族里最后两个私有 flag 循环已删除，四个成员现在全部走
`plugin/scripts/gate-script-base.ts` 的 `parseArgs`（本仓库唯一 spec-driven 参数解析器）。

- `threshold-scope-check.ts` / `tmux-test-isolation-check.ts` 的 `runCli` 不再手写
  `--root/--json/--judge`（前者另有 `--write-ratchet/--reset-baseline`）的 if/else 循环；改用
  `parseArgs(argv, { minArgs: 0, strict: true, flags: {…} })`。`strict:true` 保留原循环的未知
  `--flag` 守卫（exit 2）。两文件的入口按已折叠成员（`task-ac-carryover-check.ts` /
  `task-contract-check.ts`）的同一约定改传 `process.argv` 原值（`parseArgs` 自己拥有 `slice(2)`
  约定），不再各自 `slice(2)` 后再被解析器二次切片。
- **共享解析器不自动携带、故在本调用点显式补回的两条输入语言**（⛔ 不是"顺手加严"，是原循环本来
  就有、不补即为行为回退）：
  ① **多余 positional 仍是用法错误**——`threshold-scope-check.ts` 原本就 `unexpected positional`
  → exit 2；`tmux-test-isolation-check.ts` 原本让它**静默落空**，随后扫 `process.cwd()` 并对一个
  从未读到的输入报 PASS（硬规则 3b 的形状）。共享解析器把 positional 收进 `args` 而非拒绝，故两处
  各补一条显式守卫，家族在**同一处**停下，而不是继承弱的那条臂。
  ② **无值的 `--judge` 是用法错误**——原循环在此产出 `undefined`，随后 `path.isAbsolute(undefined)`
  抛异常；共享解析器的末位形状是 `""`。把 `""` 读成"没给"会**什么都不判却照样打印裁决**（同 3b），
  故显式 exit 2。
- 控制（按位置判定，硬规则 2）：两文件的测试各新增
  `disposition: runCli uses the SHARED parseArgs and carries no private flag loop`（断言**实际 import
  绑定** + 私循环字面头缺席）与 `disposition: an unknown --flag exits 2`；
  `threshold-scope-check.test.mjs` 另有 `disposition: a valueless --judge is a usage error…`，
  `tmux-test-isolation-check.test.mjs` 另有 `disposition: a stray positional exits 2 instead of
  silently scanning the default root`。
- **判据能取假（负控制，硬规则 4）**：把两条谓词对着**改前**的源文件（`git show HEAD~1:<f>`）干跑——
  两文件均 `parseArgs` import 不命中 + 私循环字面命中；改后两者皆反。
- 证据：`grep -c "for (let i = 0; i < args.length; i++)"` 在 `threshold-scope-check.ts` 与
  `tmux-test-isolation-check.ts` 各为 **0**；`plugin/test/threshold-scope-check.test.mjs`
  **13 tests / 13 pass / 0 fail**，`plugin/test/tmux-test-isolation-check.test.mjs`
  **12 tests / 12 pass / 0 fail**。
- **同族其余实例（硬规则 5b）**：`grep -rln "for (let i = 0; i < args.length; i++)" plugin/scripts/*.ts`
  仍命中 **46** 个文件（前 3：`ac56-recommended-deordered-check.ts:121` /
  `concurrent-batch-scheduler.ts:455` / `cap-from-gate.ts:451`）。它们**不在本 finding 的符号簇内**
  （本 finding 由 `semantic-dedup-scan` 按符号 `runCli` 聚类，只含上述 4 个文件），且已被同轮立案的
  开放任务 `gap-routine-semantic-dedup-scan-parseargs-handrolled-residuals`（status: ready）覆盖 ——
  本任务不重复处置。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `runcli-twostill-handrolled`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791631645924`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/task-ac-carryover-check.ts`
- `plugin/scripts/task-contract-check.ts`
- `plugin/scripts/threshold-scope-check.ts`
- `plugin/scripts/tmux-test-isolation-check.ts`
- `plugin/test/threshold-scope-check.test.mjs`
- `plugin/test/tmux-test-isolation-check.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-runcli-twostill-handrolled.md`