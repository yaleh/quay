---
id: gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout
title: goal 判据执行的 60 s 超时在 goal-store.ts 四处写死，不读 QUAY_ACCEPTANCE_TIMEOUT_MS /
  gates timeoutMs / --timeout ⇒ 判据本身合法但 >60 s 的 AC 每轮被杀、无任何配置可救（GOAL-002 AC-014
  实证：测试 ~348 s 通过，goal gate 每轮 60 s 被 kill）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**缺口（立案当轮直接量，2026-09-23，主检出 `/data/home/yale/work/quay`）**：`quay goal gate <id>` 及其同族路径执行 AC 判据时，超时在 `packages/quay/src/goal-store.ts` 里是**字面量**，绕过了任务验收门已有的全部可配置面。

```
grep -nE 'timeoutMs: (60000|SWEEP_CRITERION_TIMEOUT_MS)' packages/quay/src/goal-store.ts
1745:  runAcceptance({ command: criterion, cwd: root, timeoutMs: 60000 })          # achieved 重新验证
2003:  runAcceptance({ …, timeoutMs: SWEEP_CRITERION_TIMEOUT_MS })                # 轮转扫描；:208 SWEEP_CRITERION_TIMEOUT_MS = 60_000
2370:  runAcceptance({ command: criterionCmd, cwd: gateRoot, timeoutMs: 60000 })  # goal write 激活时的可评估性检查
3107:  runAcceptance({ command: criterion, cwd: root, timeoutMs: 60000 })          # `goal gate <id>`
```

对照面（同一仓库、同一天读到）：任务验收门走 `packages/quay/src/gate/config/utils.ts:33-40` 的 `resolveRunnerOptions`，优先级 `QUAY_ACCEPTANCE_TIMEOUT_MS`（env）> gates 配置的 `timeoutMs` > 60000；`.quay/config.yml:98` 的 ts-typecheck 就是靠它抬到 120000。`gate/factories/goal.ts:43` 的 `makeGoalGate` 也走它——**同一件事有两套实现，`goal-store.ts` 里自带的那套漏了配置**。`60000` 另在 `gate/acceptance-runner.ts:156,254` 与 `gate/config/utils.ts:38` 各有一份字面量，`goal-store.ts:207` 注释明说「⛔ SAME value runAcceptance defaults to —— 是一个字面量不是两个」，而实际是至少五份。

**触发实例（来自使用方报告，非本仓库直量）**：另一个工作区的 GOAL-002 卡在 AC-014：测试本身通过（约 348 s），但 goal gate 每轮 60 s 被 kill，改该仓库配置无效——因为没有任何配置面可读。

**成因**：判据超时被当成 goal-store 的私有常量，而不是「acceptance runner 的一个可配置参数」。

**修法（提案）**：
1. 把 timeout 解析抽成 `gate/config/utils.ts` 里一个只返回毫秒的纯函数（例如 `resolveAcceptanceTimeoutMs(gateConfig?)`），`resolveRunnerOptions` 改为调它（行为不变）；默认 60000 只保留一份导出常量（例如放 `acceptance-runner.ts`，`runAcceptance` / `runAcceptanceCapture` / utils 共用）。
2. `goal-store.ts` 的四处全部改为取该函数的结果。**⛔ 只取 timeout，不取 `resolveRunnerOptions` 返回的 `cwd`**：后者优先读 `QUAY_ACCEPTANCE_CWD`，而 goal 判据的 cwd 是 git root（`root` / `gateRoot`，硬规则 4 推论二的既定选择），套用会静默换 cwd。
3. `goal gate <id>` 接受 `--timeout <ms>`（与 `--dry-run` 同处解析），优先级 `--timeout` > env > 默认，与 help.ts 已写的「gate 命令的 `--timeout`」同语义；`cli/help.ts` 的 goal 段与 `--timeout` 段同步说明 goal gate 也认它。
4. **轮转扫描的预算算术必须同步改（`goal-store.ts:120-135` 注释与 `:186-208` 常量）**：现写「≤ min(DEFAULT_SWEEP_BUDGET × criterion-timeout, DEFAULT_SWEEP_WALL_MS) = min(6×60s, 30s) = 30s」假定 criterion-timeout ≡ runAcceptance 默认值。改后 criterion-timeout 是解析值，注释里的界必须按解析值重写；`SWEEP_CRITERION_TIMEOUT_MS` 要么改成「默认值 + 解析」二者之一并保持只有一份字面量，要么删除并让 `packages/quay/test/goal-store.test.mjs` 里钉它的断言改钉新的单一来源。注意 wall 界（30 s）本来就小于单条判据超时，抬高 timeout 后一次调用可能远超 wall——这一点要在注释里如实写出（是「调用之间才检查 wall」的既有语义还是需要收紧，先读 `:1922-2010` 再定，写清结论）。
5. **不做（范围外，附理由）**：给 goal 记录加 per-AC `timeout_ms` 字段——它需要动 goal 写面校验、criterion 指纹与 dashboard 展示三处，且与本任务的「先让已有配置面在 goal 路径生效」是独立的一步；env / `--timeout` 是进程级旋钮，若使用方需要「只放宽某一条 AC」则另立任务。本任务落地后若 GOAL-002 类场景仍不够用，再以该场景的读数立案。

## AC

- [ ] 四处字面量收敛：`grep -cE 'timeoutMs: (60000|SWEEP_CRITERION_TIMEOUT_MS)' packages/quay/src/goal-store.ts` 输出 `0`，且 `grep -nE '\b60_?000\b' packages/quay/src/goal-store.ts` 的命中里不再有任何 `runAcceptance` 的 `timeoutMs`（先打印前 3 条命中内容再引用计数，硬规则 2）。
- [ ] `60000` 默认值只在一处定义：`grep -rnE '=\s*60_?000\b|timeoutMs = 60000|: 60000\)' packages/quay/src/gate packages/quay/src/goal-store.ts` 中默认值的字面量定义恰好 1 处，其余引用该导出常量。
- [ ] env 生效（读生产载体的负控制配对）：新测试 `packages/quay/test/goal-criterion-timeout-resolution.test.mjs` 用 `makeWorkspace()` 建真 workspace，写一条判据 `sleep 2` 的 goal AC，`QUAY_ACCEPTANCE_TIMEOUT_MS=1000 quay goal gate <id> --dry-run --json` 得 `verdict:"fail"` 且 reason 含 `timed out after 1000ms`；同一判据在 `QUAY_ACCEPTANCE_TIMEOUT_MS=5000` 下得 `verdict:"pass"`。（两个方向都断言——只断言一个方向的用例通过不了「关掉修复仍能过」的反例判据。）
- [ ] `--timeout <ms>` 生效且优先于 env：`QUAY_ACCEPTANCE_TIMEOUT_MS=5000 quay goal gate <id> --dry-run --timeout 1000 --json` 对 `sleep 2` 判据得 `timed out after 1000ms`；无 env 无 flag 时仍为 60000（用 reason 里的毫秒数断言，不真等 60 s）。
- [ ] cwd 不被改：设 `QUAY_ACCEPTANCE_CWD=/tmp` 后，判据 `pwd` 打印的仍是 git root（不是 `/tmp`）——断言 goal 路径只取了 timeout（本条防「套用 resolveRunnerOptions 全量」的回归）。
- [ ] 四个入口都走同一来源：新测试对重新验证（`:1745`）、轮转扫描（`:2003`）、激活检查（`:2370`）、`goal gate`（`:3107`）各至少一条断言，各自在 `QUAY_ACCEPTANCE_TIMEOUT_MS=1000` 下对 `sleep 2` 判据得到含 `timed out after 1000ms` 的结果（不是四条只查同一个函数）。
- [ ] 扫描预算注释与常量一致：`goal-store.ts` 头部关于「≤ min(… × criterion-timeout, …)」的推导不再含字面 `6 × 60s`（或含则明确标注为「默认值下」并给出解析值下的式子）；`packages/quay/test/goal-store.test.mjs` 原有对 `SWEEP_CRITERION_TIMEOUT_MS` 的断言随之更新且 `bash scripts/test.sh packages/quay/test/goal-store.test.mjs` 通过。
- [ ] `resolveRunnerOptions` 行为不变：既有 `gate/config` 相关测试全部通过，`bash scripts/test.sh --for-task gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout --allow-thin` 通过，且 `cli/help.ts` 的 goal 段出现 `--timeout`（`node packages/quay/bin/quay.js help goal 2>&1 | grep -c -- '--timeout'` ≥ 1）。

## DoD

真实落地判据（DIR-026 Reading A：fixture 是必要不充分）：在**主检出的真实 workspace** 上，对一条真实存在、运行时长 >60 s 的 goal AC 判据（可用一条 `sleep 70` 的临时 `draft` AC，用毕 `retire`/删除），`QUAY_ACCEPTANCE_TIMEOUT_MS=120000 node packages/quay/bin/quay.js goal gate <that-id> --dry-run --json` 返回 `verdict:"pass"`，而同一命令去掉 env 返回含 `timed out after 60000ms` 的 `fail`——两条读数贴进任务 AC 勾选记录，且时间窗只计实现提交之后。另需：goal-driver/轮转扫描在生产进程里读到的是同一解析函数（`grep -rn resolveAcceptanceTimeoutMs packages/quay/src` 命中 goal-store.ts 的四处调用点，贴前 3 条）。

## Touches

- `packages/quay/src/goal-store.ts`
- `packages/quay/src/gate/config/utils.ts`
- `packages/quay/src/gate/acceptance-runner.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/test/goal-store.test.mjs`
- `packages/quay/test/goal-criterion-timeout-resolution.test.mjs` (new)
- `tasks/gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout.md`

<!-- dedup-ref --> 相关但机制不同：`gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass`（引入轮转扫描与 `SWEEP_CRITERION_TIMEOUT_MS` 的任务，本任务只改其超时来源，不动其轮转/预算判定逻辑）；`gap-goal-achieved-but-failing-no-handler`（`:1745` 处 `timeoutMs: 60000` 曾在该任务的递归事故里被引用，判据递归防护不在本任务范围）。
