---
id: gap-no-inventory-of-what-the-two-layer-mode-actually-runs
title: 211 scripts, 96 executed in 15h — build the evidence table of what the
  two-layer mode actually runs, before deciding what to cut
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

裁剪 `prepare/execute` 管线的任务（[[gap-retire-the-prepare-execute-pipeline-cluster]]）把
「画依赖边界表」和「实际删除」捆在一起。**表本身才是让后续可决策的产物**，且范围不该限于那个管线——
人 2026-08-03 指出：「相当多的实现在最近十几小时的双层驱动模式下从来没有被实际使用，
而不仅是 prepare-milestone workflow」。

**外层首测（2026-08-03 02:5xZ，窗口 2026-08-02T11:00Z 起约 15.9 小时，
内层全部会话 + 28 个 subagent transcript，4355 条真实执行过的命令）**：

| | 数量 |
|---|---|
| 脚本总数（`plugin/scripts` 71 · `experiments/**/scripts` 127 · `.claude/workflows` 6 · `scripts` 7） | **211** |
| 窗口内被真实执行过 | **96** |
| 仅被 import、未直接执行 | 39 |
| **既未执行也未被 import** | **76（36%）** |

### 首测的已知偏差（必须在正式表里消除）

**这是一次粗测，两个方向都有偏差**——正式表不许继承：

1. **「被执行」被高估**：判据是「文件名出现在任一命令文本里」，`ls`、`grep`、`cat` 提到它也算。
   ⇒ 真实的死集合**可能比 76 更大**。正式表必须按**命令位置**匹配（剥离引号内容），
   这是本仓库今晚已踩过 7 次的同一个坑。
2. **「仅被 import」被高估**：判据是裸文件名子串匹配，同名或部分匹配都会命中。
3. **窗口可能太短**：里程碑节奏的脚本（`it0-*`）、CI-only 的脚本在 15.9 小时内本来就不该出现。

### 死名单里至少有三个不同的类，不能一刀切

| 类 | 例 | 处置 |
|---|---|---|
| **有意封存** | `chart2-*`、`git-lens-*`、`governance-product-ratio-*` | exp6 §0 已裁定封存待阶段 2——**不是遗留，不许删** |
| **CI-only** | 各 `*-selfcheck.sh` | 在 GitHub Actions 里跑，本地窗口看不到——**要查 `.github/workflows/` 才能判** |
| **永远不会跑的测试** | `experiments/**/*.test.ts`（`anti-gaming-guard`、`chart-saturation-check`、`derive-touches-heuristic`、`diagnose-verify-failure`） | **不在 `scripts/test.sh` 的 canonical glob 里**——写了但从来不运行。这是独立发现 |

## Contract

```
measure  executed   = `node plugin/scripts/runtime-usage-inventory.ts --since <ISO> --json` executed 计数
measure  imported   = `node plugin/scripts/runtime-usage-inventory.ts --since <ISO> --json` imported 计数
measure  ci_invoked = `node plugin/scripts/runtime-usage-inventory.ts --since <ISO> --json` ci_invoked 计数
invariant 脚本总数在测量前后一致（211）                            # 分类必须覆盖全集，不许漏
invoke   `node plugin/scripts/runtime-usage-inventory.ts --since <ISO> --json`
control  取一个已知每天都跑的脚本（如 `scripts/test.sh`）⇒ 必须落进「已执行」；取一个已知封存的（如 `chart2-s1-distribution-reliability.ts`）⇒ 必须不落进「已执行」
resume   每分析完一个脚本即写盘                                    # 211 个，中断保全
```

## Chosen mechanism

**只出表，不删任何东西。** 删除是后续任务的事，本任务的产出就是让删除变成机械执行的那张表。

### 一、`runtime-usage-inventory.ts`

对全部 211 个脚本，逐个给出五列：

| 列 | 来源 | 注意 |
|---|---|---|
| `executed` | 内层 transcript（合并 subagents）中**命令位置**的出现次数 | 剥离单/双/反引号内容后再匹配 |
| `imported_by` | 全仓 `import`/`require` **语句解析** | 不用裸子串 |
| `ci_invoked` | `.github/workflows/*.yml` | |
| `in_test_glob` | 是否落在 `scripts/test.sh` 的 canonical glob 内 | 只对 `*.test.*` 有意义 |
| `class` | 下面六选一 | |

`class` 六值，**每个都要有判据，不许凭印象**：

1. `live` —— `executed > 0`
2. `library` —— `executed == 0` 且 `imported_by > 0`
3. `ci-only` —— `executed == 0` 且 `ci_invoked > 0`
4. `dormant-by-decision` —— 在 exp6 §0 的封存清单里（**清单要显式列出，不许推断**）
5. `never-runs-test` —— `*.test.*` 且 `in_test_glob == false`
6. `unaccounted` —— 以上都不是。**这一类才是裁剪的候选**

**`unaccounted` 的计数本身是本任务的主要输出。** 它不等于「可删」——它等于「没有任何证据说明它为什么在这里」。

### 二、窗口

`--since` 默认取双层模式起点。**同时跑一个更长的窗口做对照**（如 72 小时），
若某脚本在 15.9 小时窗口里是 `unaccounted` 而在 72 小时窗口里是 `live`，
说明它是低频而非死的——**这个差集要单独列出**。

### 三、不做

- **不删除任何文件**
- 不改任何脚本的行为
- 不给 `unaccounted` 的脚本下「该删」的结论——那是读表的人的决定

## Acceptance Criteria

- [x] AC1: 输出覆盖**全部脚本**，一个不漏；总数自报 205 distinct-by-realpath / 220 raw，与清点一致
      （任务体首测 211 是 2026-08-03 02:5xZ 的**原始文件数**粗测，且其 glob 排除了 7 个 `*.test.*`；
      当前 HEAD 含 `plugin/scripts/task-contract-check.ts`（+1）并特意包含那 7 个 `*.test.*`（AC6 需要），
      故 distinct 205 / raw 220，与 211 不可直接相减）
- [x] AC2: `executed` 按**命令位置**匹配（剥离单/双/反引号），**不用裸子串**；
      fixture「只在 `grep 'foo.ts'` 里提到」断言不计入（测试 `AC2: quote-stripped...`）
- [x] AC3: `imported_by` 解析 `import`/`require` **语句**（剥离注释后），不用子串
      （测试 `AC3: import/require statement specifiers...`）
- [x] AC4: **双向负控制**——`scripts/test.sh` 必须 `live`；`chart2-s1-distribution-reliability.ts`
      必须**不是** `live`。实跑输出见下方 DoD
- [x] AC5: `dormant-by-decision` 清单**显式列在代码**（`plugin/scripts/runtime-usage-inventory.ts`
      的 `DORMANT_BY_DECISION` 常量，13 项全路径），注明来源（exp6 §0 + 任务体），不许路径前缀推断
- [x] AC6: 列出 `never-runs-test` 全集（8 个 `*.test.*` 不在 canonical glob 内，含 5 个
      `experiments/**/scripts/*.test.ts` + 2 个 `experiments/**/scripts/*.test.mjs` +
      2 个 `scripts/*.test.ts`）
- [x] AC7: 15.9h 与 72h 窗口**差集**单独列出（51 个低频 ≠ 死，其中 31 个 unaccounted→live）
- [x] AC8: 表以 JSON + Markdown 落盘到 `docs/analysis/runtime-usage-inventory.{json,md}`
- [x] AC9: **不删除任何文件**——diff 无文件删除（`git diff --stat --diff-filter=D` 为空）
- [x] AC10: 测试带 `// @test-group governance` 声明（`plugin/test/runtime-usage-inventory.test.mjs` 首行）

## Definition of Done

- [x] AC8 的表落盘，且 `unaccounted` 的计数（**81**）写进任务体（见下方「执行结果」）
- [x] AC4 的双向负控制输出贴进任务体（见下方「执行结果」）
- [x] `scripts/test.sh --for-task gap-no-inventory-of-what-the-two-layer-mode-actually-runs`
      连跑 2 次全绿（18/18 tests pass，split-or-commit + test-framework-policy 静态检查 PASS）
- [x] 明确记录：**`unaccounted` 不等于「可删」**——它等于「没有任何证据说明它为什么在这里」。
      把这两件事混为一谈，就会删掉 exp5 有意封存的度量机器

## 执行结果（2026-08-03，fan-in 前快照）

表落盘：`docs/analysis/runtime-usage-inventory.{json,md}`（`plugin/scripts/runtime-usage-inventory.ts`
生成，`--since 2026-08-02T11:00:00Z --until 2026-08-03T02:54:00Z --inner-sessions
3bbd3095-…,82ecfb6a-…,47eb704e-…`，long 窗口 72h）。

- **脚本总数**：205 distinct / 220 raw（任务体首测 211，差值见 AC1）。
- **class 分布**：live 36 · library 72 · ci-only 1 · dormant-by-decision 7 ·
  never-runs-test 8 · **unaccounted 81**。
- **unaccounted ≠ 可删**：`unaccounted` = 「没有任何证据解释它为什么在这里」，是后续决策的
  **候选池**，不是删除清单。示例：`.claude/workflows/*.js` 6 个在 15.9h 窗口全部 unaccounted，
  但 72h 窗口 5 个 live（prepare-milestone ×280 / execute-milestone ×47）——经典循环在用，fast-mode
  有意绕过；诊断为低频而非死。
- **AC4 双向负控制（实跑输出）**：
  - 正向：`scripts/test.sh` → **live**（主窗口执行 241 次命令位置命中，effective 242）。
  - 负向：`experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts` →
    **不是 live**（主窗口执行 0，class `library`——被其 governance 测试 import，优先级排在
    `dormant-by-decision` 之前；它在 exp6 §0 封存清单上，见 `DORMANT_BY_DECISION`）。
  - 注：sealed 但被测试 import 的 5 个脚本（chart2-s1/2/3、governance-product-ratio-check、
    outward-vt-check）按任务体优先级显示为 `library` 而非 `dormant-by-decision`；markdown
    「Sealed by exp6 §0」一节列出全部 13 项封存清单及其实际 class，避免误导。
- **never-runs-test 全集（8）**：`anti-gaming-guard.test.ts`、`chart-saturation-check.test.ts`、
  `derive-touches-heuristic.test.ts`、`diagnose-verify-failure.test.ts`、
  `milestones-since-transition.test.ts`、`it0-split-or-commit-check.test.mjs`、
  `scripts/delivery-manifest-check.test.ts`、`scripts/version-consistency-check.test.ts`。
- **主→长窗口差集（51）**：见 `docs/analysis/runtime-usage-inventory.md`「Main → long window diff」。
- **测试**：`scripts/test.sh --for-task gap-no-inventory-of-what-the-two-layer-mode-actually-runs`
  两次全绿（18/18），含真 transcript 的 AC4 实跑断言与合成 fixture 的 AC7 差集断言。

## Touches

- plugin/scripts/runtime-usage-inventory.ts
- plugin/test/runtime-usage-inventory.test.mjs
- docs/analysis/runtime-usage-inventory.md

## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
