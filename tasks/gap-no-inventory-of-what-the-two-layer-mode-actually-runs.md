---
id: gap-no-inventory-of-what-the-two-layer-mode-actually-runs
title: "211 scripts, 96 executed in 15h — build the evidence table of what the
  two-layer mode actually runs, before deciding what to cut"
status: todo
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
measure  executed   = 内层 transcript 中命令位置出现该脚本的次数   # 剥离引号后匹配，非裸子串
measure  imported   = 全仓 import/require 语句中引用该脚本的次数   # 解析语句，非子串
measure  ci_invoked = `.github/workflows/*.yml` 中出现该脚本的次数
invariant 脚本总数在测量前后一致（211）                            # 分类必须覆盖全集，不许漏
invoke   `node plugin/scripts/runtime-usage-inventory.ts --since <ISO> --json`
control  取一个已知每天都跑的脚本（如 `scripts/test.sh`）⇒ 必须落进「已执行」；
         取一个已知封存的（如 `chart2-s1-distribution-reliability.ts`）⇒ 必须不落进「已执行」
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

- [ ] AC1: 输出覆盖**全部 211 个**脚本，一个不漏；总数在输出里自报并与实际清点一致
- [ ] AC2: `executed` 按**命令位置**匹配（剥离引号内容），**不用裸子串**；
      给一个「只在 `grep 'foo.ts'` 里提到」的 fixture，断言不计入
- [ ] AC3: `imported_by` 解析 `import`/`require` **语句**，不用子串
- [ ] AC4: **双向负控制**——`scripts/test.sh` 必须是 `live`；
      `chart2-s1-distribution-reliability.ts` 必须**不是** `live`。两条都要有实跑输出
- [ ] AC5: `dormant-by-decision` 的清单**显式列在代码或数据文件里**，注明来源
      （exp6 §0 的封存决定），不许由路径前缀推断
- [ ] AC6: 列出 `never-runs-test` 全集——已知至少 4 个 `experiments/**/*.test.ts`
- [ ] AC7: 15.9h 与 72h 两个窗口的**差集**单独列出（低频 ≠ 死）
- [ ] AC8: 表以 JSON + Markdown 两种形式落盘到 `docs/analysis/runtime-usage-inventory.{json,md}`
- [ ] AC9: **不删除任何文件**——本任务的 diff 里不得出现文件删除
- [ ] AC10: 测试带 `// @test-group governance` 声明

## Definition of Done

- [ ] AC8 的表落盘，且 `unaccounted` 的计数写进任务体
- [ ] AC4 的双向负控制输出贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [ ] 明确记录：**`unaccounted` 不等于「可删」**——它等于「没有任何证据说明它为什么在这里」。
      把这两件事混为一谈，就会删掉 exp5 有意封存的度量机器

## Touches

- plugin/scripts/runtime-usage-inventory.ts
- plugin/test/runtime-usage-inventory.test.mjs
- docs/analysis/runtime-usage-inventory.md
