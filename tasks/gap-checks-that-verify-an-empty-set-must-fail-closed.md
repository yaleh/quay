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

- [x] AC1: `test-coverage-check.ts` 在当前仓库上**不再返回空 glob 集**；给出改前/改后的解析结果
- [x] AC2: 解析结果为空时 **exit 非零**，消息明确区分「检查通过」与「检查未执行」
- [x] AC3: 若改为读 `test.sh --list-files`，记录为什么这比解析 shell 变量名更稳固
- [x] AC4: 逐个核实第 3 步候选清单里每个脚本的空集行为，**列出实测结果**（哪些已 fail-closed、
      哪些静默通过），不预设结论
- [x] AC5: 对静默通过的那些，加空集守卫 + `--allow-empty` 逃生口（默认拒绝）
- [x] AC6: 回归测试：构造一个解析不到目标的输入，断言 exit 非零且消息含「未执行」语义
- [x] AC7: 测试带 `// @test-group engine` 声明

## Definition of Done

- [x] AC1/AC4 的实测输出贴进任务体
- [ ] `scripts/test.sh` **连跑 2 次**全绿（一次不算——AC1 今晚就是被第二次推翻的）——**由协调方
      fan-in 承担**（本任务隔离契约禁止自启全量套件；scoped 实跑见 AC6/AC7）
- [x] 明确记录：**「没有发现问题」与「没有在检查」必须在输出上可区分**

## Touches

- scripts/test-coverage-check.ts
- plugin/test/test-coverage-check.test.mjs
- plugin/scripts/anti-drift-touches-check.ts（symlink → experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.ts）
- plugin/scripts/it0-split-or-commit-check.ts + experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts
- plugin/scripts/loadbearing-test-gate.ts + experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.ts
- plugin/scripts/wiring-coverage-check.ts + experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- experiments/quay-perpetual-stream/test/{anti-drift-touches-check,wiring-coverage-check,it0-split-or-commit-check,loadbearing-test-gate}.test.mjs

## Execution evidence

### AC1 — 改前/改后的解析结果（对当前 `scripts/test.sh`）

```text
BEFORE (pre-76ec053b old regex /files=\(([^)]*)\)/): []  -> length 0
  —— 匹配到第 234 行 runtime 数组 `local files=() f` 的空捕获
AFTER  (current glob= parse + fail-loud): ["packages/*/test/*.test.mjs",
  "plugin/test/*.test.mjs", "experiments/quay-perpetual-stream/test/*.test.mjs"]  -> 3 patterns
```

`parseCanonicalGlobs(REPO_ROOT)` 现返回 3 个 pattern；selftest 10/10、`plugin/test/test-coverage-check.test.mjs` 5/5。

### AC2 — 空集 = 检查未执行（exit 非零）

对「无 glob 行」的 scratch `scripts/test.sh`，`parseCanonicalGlobs` THROWS（fail-loud），CLI 捕获后
exit 2，消息：`cannot parse a non-empty canonical glob from scripts/test.sh … failing loudly instead
of silently reporting zero canonical files`。回归测试在 `plugin/test/test-coverage-check.test.mjs`
AC2 用例（6 种空/缺失 glob 形状逐一断言 throw）。

### AC3 — 为什么保留「解析源码 + fail-loud」而不是只读 `--list-files`

已落地的修复（76ec053b）**保留**了对 `glob=(...)`/`files=(...)` 的源码解析，但把「解析不到 → 静默
返回 []」改为「解析不到 → THROW → exit 2」。这已经满足 fail-closed：变量名再改，检查**大声失败**
而不是安静通过。`--list-files` 没有成为主解析源，但被用作 **AC5 交叉校验**（selftest 断言 canonical
集 == `scripts/test.sh --list-files` 输出，realpath 去重），专门捕捉「解析出看似正确实则错误的 glob」
这一类漂移——比单独解析更强。记录在案：若未来把 `--list-files` 提为主源，收益是彻底消除对 shell
变量名的耦合；代价是 `--list-files` 的输出契约（分组过滤、realpath 去重）本身成为新的耦合点。

### AC4 — 候选清单逐个实测（空集行为）

| 脚本 | 实测输入 | 实测输出 | exit | 判定 |
|---|---|---|---|---|
| `test-coverage-check.ts` | 无 glob 行的 `test.sh` | THROW → CLI exit 2 | 2 | **已 fail-closed**（修复后） |
| `anti-drift-touches-check.ts` | 空 manifest `[]` | `ANTI-DRIFT OK: 0 builds` | 0 | **静默通过**（已修复 → exit 1） |
| `wiring-coverage-check.ts` | 空/缺失源 section | `ok:true code:wiring-coverage-none-claimed` | 0 | **静默通过**（已修复 → exit 1） |
| `it0-split-or-commit-check.ts` | 空 tasks 目录 | `PASS: 0 task(s) checked` | 0 | **静默通过**（已修复 → exit 1） |
| `loadbearing-test-gate.ts` | 空 scripts 目录 | `0 total … PASS` | 0 | **静默通过**（已修复 → exit 1） |
| `sync-vendor.sh --check` | 缺失 src/dst 文件 | `MISSING-SRC`/`MISSING-DST` → DRIFT=1 | 1 | **已 fail-closed**（无需改） |

注意：`wiring-coverage-check` 的**非空**源 section 但 0 claims → `wiring-coverage-none-claimed` 仍
exit 0，这是显式声明（「nothing to claim」就是报告本身），不算静默通过；只有**空/缺失**源 section
（「从没去看」）被改为 fail-closed。

### AC5 — 加空集守卫 + `--allow-empty`（默认拒绝）

对 AC4 中静默通过的 4 个脚本加了守卫（比照 `--allow-thin` 先例）：

```text
anti-drift-touches-check:     [] manifest → HARD FAIL exit 1；--allow-empty → exit 0
it0-split-or-commit-check:    0 tasks     → FAIL exit 1；    --allow-empty → exit 0
loadbearing-test-gate:        0 scripts   → FAIL exit 1；    --allow-empty → exit 0
wiring-coverage-check:        empty source→ exit 1（CLI）；  --allow-empty → exit 0，code empty-source-allow-empty
```

每个守卫的报错都显式带「fail-closed: 'no problems' must not be indistinguishable from 'never
looked'; pass --allow-empty to waive」。plugin/experiments 两份拷贝同步（diff 仅剩既有 attribution
注释差异）。

### AC6/AC7 — 回归测试

- `plugin/test/test-coverage-check.test.mjs`：`// @test-group engine`；AC2 覆盖 6 种解析失败形状。
- 新守卫各有 RED/GREEN 用例（`--allow-empty` 双向），全部加入既有 `engine` 组测试文件：
  `experiments/quay-perpetual-stream/test/{anti-drift-touches-check,wiring-coverage-check,it0-split-or-commit-check,loadbearing-test-gate}.test.mjs`。
- scoped 实跑：coverage 5/5 + 4 个 checker 文件 109/109 + task-schema 22/22 全绿。
- 全量套件（`scripts/test.sh` 连跑 2 次）由协调方 fan-in 承担，本任务隔离契约禁止自启全量。
