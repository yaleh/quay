---
id: gap-concurrency-literal-check-workflows-coverage
title: "concurrency-literal-check 扫描面不含 .claude/workflows/——CPUQuota=400% 活 4 天经由 QUAY_TEST_SYSTEMD_RUN_LIMITS seam 塞回源头默认（已发生的漏检）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：CPUQuota 假红根因调查（manager 2026-08-16 复核，outer 立案）。**⛔ 发生率=1 但这是【已发生的漏检】有实证**（400% 活 4 天、拖慢每一轮、制造假红）——不是「够不够立案」的问题。

**根因链（持久修法早在 08-12 就落了且有测试守着）**：
```
full-suite-runner.ts:1970  cpuQuota: string;  // "" = NO CPU limit（人 08-11 裁定「取消 CPU 配额」）
full-suite-runner.ts:2041  if (limits.cpuQuota) argv.push("-p", CPUQuota=...)   ← 默认不传
full-suite-runner.test.mjs:3766/3779/3828  三条断言：默认 argv 不含 CPUQuota
resource-gate.sh:329-330   持久修法 passes NO -p CPUQuota=
```
**⇒ 源头是对的。`execute-suite-fix.js:64` 通过 `QUAY_TEST_SYSTEMD_RUN_LIMITS` 这个 seam 把 400% 又塞回去了。**

**检查器缺口（闸存在、判据正确、覆盖面不含违规目录——今天第二次撞这个形状，与 AC90 同族）**：
```
concurrency-literal-check.ts:19/:67/:69   P3 规则 = CPUQuota=<num>% | cpuQuota: "<num>%"
concurrency-literal-check.ts:160-161      walk(plugin/scripts) · walk(scripts) ⇒ 不扫 .claude/workflows/
```
**⇒ 一个能绕过源头默认值的 seam（QUAY_TEST_SYSTEMD_RUN_LIMITS）没被覆盖面含住。**

## Plan

1. `concurrency-literal-check --gate` 扫描面**显式枚举**并包含 `.claude/workflows/`（⛔ 不是加个 glob 就算，要枚举）。
2. **负控制**：把 `CPUQuota=400%` 塞回 `.claude/workflows/` 下任一文件 ⇒ 该 gate 必须红；不红则本条不成立。
3. **更一般那半（写进 Proposal 的核心）**：`QUAY_TEST_SYSTEMD_RUN_LIMITS` 是能绕过源头默认值的 **seam**。
   **一个修法落到源头之后，还必须枚举所有能绕过它的 seam**——否则「源头默认值正确」不构成保证。
4. 修复 + 测试绿 + `--gate` 接线确认。

## Acceptance Criteria

- [ ] AC1: `concurrency-literal-check --gate` 扫描面显式枚举并含 `.claude/workflows/`（可 grep 的枚举清单，非一个 glob 糊过去）。
- [ ] AC2: 负控制成立——`CPUQuota=400%` 塞回 `.claude/workflows/` 任一文件 ⇒ gate 必红（不红则本 AC 不成立）。
- [ ] AC3: seam 枚举原则写进检查器的判据文档/注释——「源头修法落定后，枚举所有能绕过它的 seam」。
- [ ] AC4: 既有测试全绿 + `--gate` 接线（test.sh run_static_checks）确认。

## Definition of Done

- [ ] 检查器覆盖面含 `.claude/workflows/`，负控制验证，seam 绕过源头默认的路径被枚举——不再有「源头正确但 seam 塞回」的静默漏检。

## Touches

- plugin/scripts/concurrency-literal-check.ts（扫描面扩展 + seam 枚举文档）
- plugin/test/*（对应测试 + 负控制）
- scripts/test.sh（接线确认）
- tasks/gap-concurrency-literal-check-workflows-coverage.md（自身）
