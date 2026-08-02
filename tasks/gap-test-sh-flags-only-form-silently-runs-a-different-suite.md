---
id: gap-test-sh-flags-only-form-silently-runs-a-different-suite
title: "scripts/test.sh's documented flags-only form drops the file glob and
  runs 3.7x the tests"
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

- [ ] AC1: `scripts/test.sh --test-concurrency=4` 的测试数与默认调用**相同**（当前 8573 vs 2296）
- [ ] AC2: `scripts/test.sh --experimental-test-coverage`（文档化的那个形式）同样保持默认选择集
- [ ] AC3: 用户传的 `--test-concurrency=N` 确实生效（last-flag-wins），用一个可观测差异证明
      （如墙钟或 node 进程数），不能只看命令行
- [ ] AC4: 每次运行打印「selected N files (groups=…)」，N 与 `--list-files` 的行数一致
- [ ] AC5: 头部第 25 行的说明与实现一致；若改为不支持，则该行删除且 CLAUDE.md 同步
- [ ] AC6: 回归测试 pin 住 AC1 —— 断言两种调用的测试数相等（**运行时计算，不写死 2296**）
- [ ] AC7: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] AC1/AC2 的实测测试数（改前/改后）贴进任务体
- [ ] `scripts/test.sh` 绿
- [ ] 明确记录：**一个改变了测量对象却不声明的工具，会让所有基于它的测量静默作废**——
      本次实测代价是一整组对照实验数据

## Touches

- scripts/test.sh
- plugin/test/runner-grouping.test.mjs
- CLAUDE.md
