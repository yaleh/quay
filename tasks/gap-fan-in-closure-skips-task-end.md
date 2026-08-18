---
id: gap-fan-in-closure-skips-task-end
title: "fan-in closure 跳过 --task-end——landed 任务 telemetry 括号未闭合（SSOT+phase-overlap 两例 start=1 end=0）+ 6 例双 end 过度写"
status: ready
labels:
  - gap
  - defect
  - instrumentation
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`fan-in closure` 未写 `--task-end`：SSOT + phase-overlap 都 LANDED（status done）但 `.workflow-events/` 里只有 `start` 无 `end`（start=1 end=0），使遥测显示「仍在飞」假象（manager 定位 + outer 核实，A20 `reconcile_compliant=false stale_brackets=2`）。另 6 个任务 `start=1 end=2`（双 end 过度写）。telemetry 写路径**双向**都有系统性问题（欠写 end + 过写 end）——「mandatory-write-skipped-adjacent-write-done」又一实例。

## Acceptance Criteria

- [x] AC1: landed 任务的 `--task-end` 被 closure 正确写入（fan-in 成功后 bracket 闭合）。
- [x] AC2: 负控制——fan-in land 后 `reconcile_compliant=true`、`stale_brackets=0`（无新 unclosed bracket）。
- [x] AC3: 双 end 过度写根因定位（为何 end 写两次）。

## Definition of Done

- [ ] 一个 landed 任务的 `--task-end` 真实写入（bracket 闭合，非 fixture）。（待外部）

## Evidence

**AC1/AC2 — 欠写根因（`--close-task` 静默跳过 `--task-end`）**：`closure-lag-check.sh --close-task` 旧实现用
`node … --report --json … | node -e '…inProgress 查 runId…'` 的【shell 管道】。真实 workspace 里 `--report --json`
payload = 68587 字节（243 个事件文件），而生产者 `fast-mode-telemetry.ts` 在 `console.log` 后立即 `process.exit()`
⇒ 异步 stdout 管道写未 flush 即截断在 64KB 管道缓冲（实测 `| node -e` 恰得 65536 字节、`JSON.parse` 抛
"Unterminated string at position 65536"，`wc -c` 恒 65536 而 `cat > file` 得 68594）。`node -e` 的 `catch(_){}`
吞掉解析错误 ⇒ runId 空 ⇒ `--close-task` 以 exit 0「no open bracket」**静默不写 end**（start=1 end=0，SSOT
`gap-suite-concurrency-ff-gate-and-slot-ssot` + phase-overlap `gap-phase-overlap-field-always-false-negative`
两例，其 end 后被 `--reconcile` 以 outcome=abandoned 补写，`reconcileReason=worktree-gone-and-no-process`）。

**修法**：`--close-task` 改查 `--run-id-for --taskId <id>`（单行短输出，结构上不可能截断 64KB；且跳过
`--report` 的逐任务 git-history 重读），lookup 非 0 ⇒ exit 2 独立「cannot evaluate」（硬规则 3b，不再与
「no open bracket」同形）。

**AC3 — 过写根因（双 end）**：`--task-end` 非【写时幂等】。两个收尾写者（inner fan-in `--close-task` 与 outer
`--close-terminal`/step-② `--task-end`）各自 read-then-write：都先查 inProgress[]（都看到「open」）再都写 end ⇒
start=1 end=2（6 例，两端相隔 0.9–2.2s = 顺序双写，非夹具）。修法在唯一写收敛点 `--task-end` 加 `hasEndEvent`
守卫——runId 已有 end 事件即跳过（exit 0，独立 "idempotent" 消息，守/不守可区分，硬规则 ⑨）。

**测试**：`bash scripts/test.sh --for-task gap-fan-in-closure-skips-task-end` 全绿（95 pass / 0 fail），新增
`double-end — --task-end is write-idempotent` 与 `under-write — --run-id-for returns the open bracket's runId`
两测；手工验证 `--close-task` 闭括号（start+end 各一，无双 end）。

## Touches

- tasks/gap-fan-in-closure-skips-task-end.md
- plugin/scripts/fast-mode-telemetry.ts
- plugin/scripts/closure-lag-check.sh
- plugin/test/closure-lag-check.test.mjs
