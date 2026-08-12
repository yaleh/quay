---
id: gap-vhs-merge-dropped-cold-start-0a-recovery-routing
title: vhs merge 丢失 cold-start SKILL.md 的 0a 路由节（结构回归，round 55 红）
status: todo
labels:
  - gap
  - defect
extra:
  schema: v1
---

**type:** execution

## Proposal

vhs merge（commit 1b77a057）在 `plugin/skills/cold-start/SKILL.md` 上丢失了 **`### 0a. Mid-flight state check`**
路由节——这是决定「走 recovery 分支（0b）还是 fresh-start 分支（steps 1-9）」的**路由谓词**。
`### 0b. Recovery branch` 仍在，但路由进 0b 的 0a 没了。round 55 因此红在
`plugin/test/cold-start-skill.test.mjs`（5 条 recovery 断言）。

**证据（隔离测试 `node --test plugin/test/cold-start-skill.test.mjs` 的 5 个失败断言）：**

- `recovery — the skill defines a recovery branch distinct from the fresh-start branch` —
  `assert.match(skillSrc, /### 0a\. Mid-flight state check/)` 失败（0a 节不存在）
- `recovery AC1/AC4 — routing stated in BOTH directions` — `/if and only\s+if/`、`/All three\s+clean/`、
  `/negative control/`、`/never false-positive into recovery/` 全部失败（都在 0a 里）
- `recovery AC2 — three state classes via EXISTING tools` — `/existing tools only/` 失败（在 0a 里）
- `recovery AC3 — converges into SAME AC8c` — `/all three come back clean/i` 失败（vhs 0b 改写时丢失）
- `recovery — ghost-telemetry resolution` — `/verify against the task's REAL state/i`、
  `/DELETE the ghost record/` 失败（vhs 0b 改写时丢失）

**根因是结构回归**：测试断言的是结构（0a 在 0b 前、双向路由、existing tools only、never false-positive、
同 AC8c 收敛、ghost 解析删除记录而非补造 end），不是关键词。vhs 侧 0b 在改写时**同时**丢了三条
测试要求的短语（`all three come back clean` / `DELETE the ghost record` / `verify against the task's REAL state`），
所以只补 0a 不够，0b 也要把这三条短语恢复（round-54 原文）。

## Plan

1. 从 `cd7f6da9`（`gap-cold-start-skill-has-no-recovery-branch` 添加 0a 的 commit，lines 139-170）
   **逐字恢复** `### 0a. Mid-flight state check` 节，插到现有 `### 0b. Recovery branch` **之前**。
   0a 内容：三个 mid-flight 状态类（① orphaned task branch ② ghost telemetry ③ status drift）用
   **existing tools only** 枚举（bash 块），双向路由判定（`if and only if`），负控制
   `never false-positive into recovery`。
2. vhs 侧 fresh-start 内容（steps 1-9）**不动**——只加缺失的路由谓词，不重写。
3. **vhs 0b 头保持**（`### 0b. Recovery branch — mid-flight state exists, converge THEN cold-start`），
   但把 round-54 原文中、vhs 改写丢失的三条测试必需短语**恢复进 0b**：
   - 收敛门：`all three come back clean`
   - ghost 解析：`verify against the task's REAL state` + `DELETE the ghost record` +
     `NEVER backfill a plausible-but-fabricated \`--task-end\``（同句、同 `** —` 尾）
4. **不改测试**——`plugin/test/cold-start-skill.test.mjs` 是正确的，SKILL.md 必须满足它。

## Acceptance Criteria

- [ ] AC1: `node --test plugin/test/cold-start-skill.test.mjs` 隔离绿——**5 条 recovery 断言全过**
      （Contract / AC1/AC4 / AC2 / AC3 / ghost-telemetry），整文件 14/14
- [ ] AC2: `npx tsc --noEmit -p tsconfig.json` 0 errors
- [ ] AC3: `scripts/test.sh --for-task gap-vhs-merge-dropped-cold-start-0a-recovery-routing --allow-thin`
      绿（thin：skill doc 改动无 basename 测试对，`cold-start-skill.test.mjs` 是直接声明测试）
- [ ] AC4: 结构断言——0a 节在 0b 前；双向路由（`if and only if` + `never false-positive into recovery`）；
      `existing tools only`；0b 含 `all three come back clean` / `DELETE the ghost record` /
      `verify against the task's REAL state`（round-54 原文短语，逐字）
- [ ] AC5: 0a 节与 `cd7f6da9` lines 139-170 **逐字一致**（`git diff` 对照）；vhs 侧 fresh-start
      steps 1-9 内容未改动

## Touches

- plugin/skills/cold-start/SKILL.md
- tasks/gap-vhs-merge-dropped-cold-start-0a-recovery-routing.md

## Test-Files

- plugin/test/cold-start-skill.test.mjs

## Definition of Done

- [ ] 隔离测试 14/14 绿（含 5 条 recovery 断言）
- [ ] tsc 0 errors
- [ ] scoped gate（--for-task --allow-thin）绿
- [ ] 提交在 `task/gap-vhs-merge-dropped-cold-start-0a-recovery-routing` 分支，不 merge/push/flip status
