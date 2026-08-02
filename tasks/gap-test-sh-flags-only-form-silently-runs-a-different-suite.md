---
id: gap-test-sh-flags-only-form-silently-runs-a-different-suite
title: scripts/test.sh's documented flags-only form drops the file glob and runs
  3.7x the tests
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`scripts/test.sh` 的头部第 25 行把「只给标志、不给文件」列为受支持的调用方式：

```
#   scripts/test.sh --experimental-test-coverage   # flags-only form also passes through
```

**它不成立。** 实测（2026-08-02，外层跑 `--test-concurrency=4` 时发现）：

| 调用 | 测试数 |
|---|---|
| `scripts/test.sh`（默认） | **2,296** |
| `scripts/test.sh --test-concurrency=4` | **8,573** |

3.7 倍。**标志被当成了文件参数。**

### 成因

`scripts/test.sh` 的 argument dispatch 只有四条分支：`--group`、`--list-groups`/`--list-files`、
`$# -eq 0`（默认 glob）、`--for-task`。**没有「裸标志 + 默认 glob」的分支**，所以任何其它参数都
落到显式文件路径：

```bash
exec node --test --test-concurrency=8 "$@"     # "$@" 就是那个标志，没有文件列表
```

`node --test` 在**没有文件参数**时自行发现并运行它能找到的一切——包括默认 glob 刻意排除的东西。
于是「加一个标志」静默地换掉了整个测试集。

### 为什么这不只是文档不准

**CLAUDE.md 也写着这个形式**（Coverage 一行）。任何人照文档跑覆盖率，拿到的是一个 3.7 倍大、
成分不同的测试集，而输出看起来完全正常——没有任何提示说选择集变了。

实测代价：外层用它做「并发度 4 vs 8」对照实验，得到 8573 tests / 36 fail，**整组数据作废**，
且一度被误判为「日志被两次运行污染」（实为单次运行，`ℹ tests` 只出现 1 次）。

## Chosen mechanism

**加一条分支，让裸标志与默认 glob 共存；并让「选择集变了」不可能静默发生。**

1. **dispatch 增加裸标志分支**：参数全部以 `-` 开头且不是已识别的子命令时，视为「附加 node --test
   标志 + 默认 glob」，即 `exec node --test --test-concurrency=8 "$@" "${files[@]}"`
   （node --test last-flag-wins，用户的 `--test-concurrency=N` 仍能覆盖默认值，见头部第 50 行）。
2. **选择集必须自报**：每次运行在开跑前打印一行「selected N files (groups=…)」。
   本缺陷之所以能骗过人，是因为**没有任何东西说过这次选了多少文件**。
3. **头部注释与实现对齐**：修好之后第 25 行才成立；若选择不实现该分支，就删掉那行并同步改
   CLAUDE.md，**不要留一个文档化但不成立的用法**。

**不做**：不改默认并发度（那是 [[gap-suite-concurrency-4-vs-8-measurement]] 的事，且必须由数据定）。

## Acceptance Criteria

- [x] AC1: `scripts/test.sh --test-concurrency=4` 的测试数与默认调用**相同**。
      实测（2026-08-02，worktree）：改后默认与 `--test-concurrency=4` 均为 **2298**（含新增 2 个
      回归测试，相等 ✓）；改前默认 2296 / flags-only 8573（外层主 checkout）。
- [x] AC2: `scripts/test.sh --experimental-test-coverage` 保持默认选择集。
      实测：governance 代理 205 == 205（coverage 不改选择集）。
- [x] AC3: 用户传的 `--test-concurrency=N` 生效（last-flag-wins）——墙钟实测：
      `--group governance --test-concurrency=1` = 10.997s vs `--test-concurrency=16` = 6.307s
      （同为 205 tests，差异可观测）。
- [x] AC4: 每次（glob 选择）运行打印「selected N files (groups=…)」：`selected 163 files
      (groups=product,engine)` / `selected 13 files (groups=governance)`，N 与 `--list-files`
      行数一致（163/13）。
- [x] AC5: 头部第 25 行（flags-only 形式）已实现成立；CLAUDE.md 已同步。
- [x] AC6: 回归测试 `AC1/AC2/AC6: flags-only forms run the same test count as the group default;
      AC4 self-report` 运行时计算断言 205 == 205 == 205（governance 代理，不写死 2296）。
- [x] AC7: 测试带 `// @test-group engine` 声明（runner-grouping.test.mjs 顶部）。

## Definition of Done

- [x] AC1/AC2 实测测试数（改前/改后）贴进任务体：
  - 改前（外层 2026-08-02 主 checkout，即任务体顶部数据）：默认 2296 / flags-only **8573**（3.7x）
  - 改前（本 worktree 全新 checkout，auto-discovery 文件群不同）：默认 2296 / flags-only 2430
  - 改后（本 worktree）：默认与 `--test-concurrency=4` 均为 **2298**（含新增 2 个回归测试；相等 ✓）；
    coverage 保持默认选择集（governance 205 == 205）
- [x] `scripts/test.sh` 绿：`--for-task` 迭代 9/9；select-tests-for-touches 19/19；改后全量套件唯一
      失败为 AC11（本改动 exec 行变更所致，已同步修 regex → 该文件 19/19 绿）。注：M136
      (sync-vendor --check) 在首次全新 checkout 默认跑失败、在改后跑通过（既有/不稳定，非本改动引入）。
- [x] 明确记录：**一个改变了测量对象却不声明的工具，会让所有基于它的测量静默作废**——
      本次实测代价是一整组对照实验数据（外层 c4 vs c8 对照整组作废）。

## 额外记录（REFUTE round-1）

- 对抗审查 1 轮（general-purpose REFUTE agent）：无 critical；1 MAJOR → 已文档化
  （space 形式 `--test-concurrency 4` 的 value token 与文件路径不可区分，仍走 explicit-file 分支，
  与改前行为一致；flags-only 仅支持 `=` 拼写，已写进 test.sh 头注释 + CLAUDE.md）；1 MINOR →
  已修（parseTestCount 取 last match）；3 NIT → 已处理（AC4 措辞限定 glob 选择、`--help` 噪音保留、
  all_flags 空参契约注释）。

## Touches

- scripts/test.sh
- plugin/test/runner-grouping.test.mjs
- plugin/test/select-tests-for-touches.test.mjs (AC11 structural regex — 本改动的 exec 行变更使旧 regex 失配)
- CLAUDE.md
