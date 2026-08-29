---
id: gap-scoped-gate-reason-stderr-drops-stdout
title: scoped-gate 红 reason 载体失真——stderr 优先 || 短路丢弃 stdout 真失败（掩蔽）
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

`plugin/scripts/worker-driver.ts:1875` 机械 fan-in 的 `fail("scoped-gate", (a.stderr || a.stdout || "").trim())` 用 `||` 短路：stderr 非空就取 stderr，整个 stdout 被丢弃。而 scoped 门（`bash scripts/test.sh --for-task <task> --allow-thin`）的 stderr **恒非空且恒良性**：① `refresh-worktree-quay.sh:120` 的成功行 `echo "...copied N file(s)..." >&2` 也走 stderr；② Node `MODULE_TYPELESS_PACKAGE_JSON` 进程警告走 stderr。真正的失败在 **stdout**：node:test 的 `FAIL:`/`not ok` 行 + esbuild `Could not resolve`。⇒ reason 只带良性 preamble（~2200 字符），真失败从载体上消失。非截断（`runAsync` driver-runtime.ts:517 用 spawn 完整捕获、无 maxBuffer）。

**现况（实证）**：4 个 needs-human 任务的 worker-outcome `mechanical_fan_in.reason` 全是「refresh 行 + node 警告」、无失败详情。ABI 任务实测 scoped 门 exit=1，真因是：build-plugin-dist 崩 `Could not resolve "../../packages/quay/src/abi.ts"`（plugin 脚本跨包 import Core 的 src，独立打包 dist 不可解析）+ 3 个 status 透传回归（unrecognized-status 从 unknown→author->ready）。这些真失败全在 stdout，被 stderr 优先丢弃。

**根因**：reason 载体失真（硬规则 3b/4b/9 同族）——`fail` 的 reason 构造用「stderr 优先」这个**未经验证的过滤**，把「有失败签名的 stdout」丢了，只剩「看似 informative 的良性 preamble」。

**同族**：与 `gap-mark-needs-human-commit-after-write`（e284bf328）同属「fan-in/outcome 可观测性」族，根因不同（写盘不提交 vs reason 载体失真），单独立案。

## Plan

reason 构造改为 `(stdout + "\n" + stderr)` 拼接（stdout 优先 + stderr 附尾），让真失败进 reason。

## Acceptance Criteria

- [ ] AC1（能取假，真失败进 reason）：scoped-gate red 时 reason 含 stdout 的失败签名（`FAIL:`/`Could not resolve` 等）（⛔ reason 只含 stderr 良性 preamble 无失败签名 ⇒ 假）。

## Definition of Done

fail reason 构造 stdout+stderr 拼接；AC1 全勾；scoped-gate red 的 reason 含真失败。

## Touches

- plugin/scripts/worker-driver.ts（fail reason 构造 stdout+stderr 拼接）
- plugin/test/worker-driver.test.mjs（scoped-gate red reason 含失败签名）
- tasks/gap-scoped-gate-reason-stderr-drops-stdout.md（自身）
