---
id: gap-concurrency-literal-check-workflows-coverage
title: "concurrency-literal-check 扫描面不含 .claude/workflows/——CPUQuota=400% 活 4 天经由 QUAY_TEST_SYSTEMD_RUN_LIMITS seam 塞回源头默认（已发生的漏检）"
status: done
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

- [x] AC1: `concurrency-literal-check --gate` 扫描面显式枚举并含 `.claude/workflows/`（可 grep 的枚举清单，非一个 glob 糊过去）。
- [x] AC2: 负控制成立——`CPUQuota=400%` 塞回 `.claude/workflows/` 任一文件 ⇒ gate 必红（不红则本 AC 不成立）。
- [x] AC3: seam 枚举原则写进检查器的判据文档/注释——「源头修法落定后，枚举所有能绕过它的 seam」。
- [x] AC4: 既有测试全绿 + `--gate` 接线（test.sh run_static_checks）确认。

## Definition of Done

- [x] 检查器覆盖面含 `.claude/workflows/`，负控制验证，seam 绕过源头默认的路径被枚举——不再有「源头正确但 seam 塞回」的静默漏检。

## Evidence

**修法两部分**（`plugin/scripts/concurrency-literal-check.ts`）：
1. **扫描面显式枚举** `SCAN_ROOTS` 含 `.claude/workflows/*.js` + `plugin/workflows/*.js`（可 grep 的枚举清单，非 glob 糊过去）。
2. **P5 模式**——历史漏检形是 `systemdRunLimits = "MemoryMax=4G CPUQuota=400% TasksMax=200"`：`CPUQuota=400%` 在双引号字符串内，`buildNonCodeMask` 把字符串整体抹掉 ⇒ 通用 P3 看不见。P5 用 `stringLiteralSpans`（复用 `buildNonCodeMask` 的线性状态机，额外记录字符串跨度）定位真实字符串字面量，位置信号 = 同一字符串还带 sibling systemd-run 键（`MemoryMax=`/`TasksMax=`）⇒ 运行期 override 与「文档拼写」区分开。

**AC1 证据（扫描面枚举，--gate 绿 0 违规）**：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/concurrency-literal-check.ts --gate --root . --json
surface workflow files (12): .claude/workflows/{drain-directives,execute-suite-fix,fan-in-execute,manager-tick-core,pool-quality-judge,run-routines,select-preflight}.js + plugin/workflows/{drain-directives,execute-suite-fix,fan-in-execute,pool-quality-judge,run-routines}.js
gate ok: True | hits: 7 | violations: 0   (exit 0)
```

**AC2 负控制（400% 塞回 `.claude/workflows/` ⇒ gate 必红）**：
```
$ TMP=$(mktemp -d); mkdir -p "$TMP/.claude/workflows"
$ printf '%s\n' 'systemdRunLimits = "MemoryMax=4G CPUQuota=400% TasksMax=200",' > "$TMP/.claude/workflows/bad.js"
$ node --no-warnings --experimental-strip-types plugin/scripts/concurrency-literal-check.ts --gate --root "$TMP" --json
gate ok: False
violations: [{"file": ".claude/workflows/bad.js", "line": 1, "pattern": "P5",
              "text": "systemdRunLimits = \"MemoryMax=4G CPUQuota=400% TasksMax=200\","}]
gate exit code: 1
```

**AC3 证据（seam 枚举原则写进检查器判据注释）**：`concurrency-literal-check.ts` 头注释新增 `SEAM ENUMERATION (AC3, gap-concurrency-literal-check-workflows-coverage)` 段——枚举 `QUAY_TEST_SYSTEMD_RUN_LIMITS` seam（full-suite-runner.ts 的测试 seam，经 execute-suite-fix.js 塞进 suite 启动），并注明覆盖 = 扫描面含 workflow 目录 + P5 检测 override 字符串内 `CPUQuota=<num>%`。测试 `AC3: the checker documents the seam-enumeration principle` 断言该 marker 存在。

**AC4 证据（scoped 测试 24/24 绿 + 接线）**：
```
$ scripts/test.sh --for-task gap-concurrency-literal-check-workflows-coverage
ℹ tests 24  ℹ pass 24  ℹ fail 0   (exit 0)
$ bash plugin/scripts/checker-mutation-cases/concurrency-literal-check.sh <tmp>   (mutation 基线→注入→恢复) exit 0
```
接线确认：`scripts/test.sh:481` `run_checker "concurrency-literal-check" ... --gate --root ${repo_root}` 已在 `run_static_checks` 中，本次 `--gate` 对真实语料 ok:true。

## Touches

- plugin/scripts/concurrency-literal-check.ts（扫描面扩展 + seam 枚举文档）
- plugin/test/concurrency-literal-check.test.mjs（对应测试 + 负控制）
- scripts/test.sh（接线确认）
- tasks/gap-concurrency-literal-check-workflows-coverage.md（自身）
