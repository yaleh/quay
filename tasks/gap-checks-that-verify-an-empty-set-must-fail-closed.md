---
id: gap-checks-that-verify-an-empty-set-must-fail-closed
title: "A check that verifies nothing exits 0 — 'found no problems' and 'never
  looked' are indistinguishable"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`scripts/test-coverage-check.ts` 被 `.github/workflows/ci.yml:34-35` 接线，ADR-019 的 enforcement
也引用它。它解析 `scripts/test.sh` 取 canonical glob：

```ts
// scripts/test-coverage-check.ts:63-68
const m = src.match(/files=\(([^)]*)\)/);
if (!m) return [];
```

而 `scripts/test.sh` 的真实内容是：

```bash
125:  local glob=(packages/*/test/*.test.mjs plugin/test/*.test.mjs experiments/…/test/*.test.mjs)
234:  local files=() f
```

**正则匹配到了第 234 行的空数组声明 `files=()`，捕获空串** ⇒ `parseCanonicalGlobs` 返回 `[]`
⇒ 没有任何 glob 可比对 ⇒ **exit 0**。

**这个 CI 检查已经停止检测，而没有任何人察觉。** 它不是「匹配失败并报错」，是**匹配到了错误的东西
并静默降级**。

### 这是一个类，不是一个 bug

2026-08-03 的分析（`docs/analysis/instrument-failure-mode.md`）把它归为**形态 B：静默降级**——
「没有发现问题」与「没有在检查」**输出完全相同**。

**仓库里已有正确先例**：`select-tests-for-touches` 在选中集过薄时**拒绝运行**：

```
test-selection-thin: task <id> resolved tests for 0/6 Touches entries (0.00) < 0.5;
pass --allow-thin to run anyway
scripts/test.sh: --for-task <id> selected no test files (selector exit 1); add --allow-thin to force
```

它 **exit 1**，并要求显式 `--allow-thin` 才放行。这正是本任务要推广的形态。

## Chosen mechanism

**任何「验证一个集合」的检查，在集合为空时必须失败或显式声明，不得静默通过。**

1. **修 `test-coverage-check.ts` 的直接缺陷**：解析改为定位 `glob=(...)`（或改为**不解析源码**——
   让 `test.sh --list-files` 输出，检查读它，消除对 shell 变量名的耦合。**倾向后者**：
   变量名改动不该让检查失效，而 `--list-files` 是既有的、被测试 pin 住的契约）
2. **加空集守卫**：解析结果为空 ⇒ **exit 非零**并说明「解析不到 canonical glob，检查未执行」，
   而不是 exit 0
3. **审计同类**：逐个检查仓库里「计算一个待验证集合」的脚本，确认集合为空时的行为。
   候选（需逐个核实，不预设结论）：`anti-drift-touches-check`、`wiring-coverage-check`、
   `it0-split-or-commit-check`、`loadbearing-test-gate`、`sync-vendor.sh --check`
4. **`--allow-empty` 逃生口**：确有合法空集的场景，比照 `--allow-thin` 提供显式开关，
   **默认拒绝**

**不做**：不给这些检查加「宽容模式」作为默认。今晚的教训是相反方向的——
一个安静通过的检查比没有检查更糟，因为它占据了「已检查」的位置。

## Acceptance Criteria

- [ ] AC1: `test-coverage-check.ts` 在当前仓库上**不再返回空 glob 集**；给出改前/改后的解析结果
- [ ] AC2: 解析结果为空时 **exit 非零**，消息明确区分「检查通过」与「检查未执行」
- [ ] AC3: 若改为读 `test.sh --list-files`，记录为什么这比解析 shell 变量名更稳固
- [ ] AC4: 逐个核实第 3 步候选清单里每个脚本的空集行为，**列出实测结果**（哪些已 fail-closed、
      哪些静默通过），不预设结论
- [ ] AC5: 对静默通过的那些，加空集守卫 + `--allow-empty` 逃生口（默认拒绝）
- [ ] AC6: 回归测试：构造一个解析不到目标的输入，断言 exit 非零且消息含「未执行」语义
- [ ] AC7: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] AC1/AC4 的实测输出贴进任务体
- [ ] `scripts/test.sh` **连跑 2 次**全绿（一次不算——AC1 今晚就是被第二次推翻的）
- [ ] 明确记录：**「没有发现问题」与「没有在检查」必须在输出上可区分**

## Touches

- scripts/test-coverage-check.ts
- plugin/test/test-coverage-check.test.mjs
