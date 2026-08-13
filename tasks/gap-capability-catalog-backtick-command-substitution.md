---
id: gap-capability-catalog-backtick-command-substitution
title: capability-catalog 反引号命令替换回归——QUESTION 双引号值被多行输出打断（round 143 红）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（outer 2026-08-13，round 143 红，11 条 catalog 断言全倒）**：AC51 提交 b61afa53 把
`` `bash scripts/test.sh --static-checks-doc` ``（带反引号）写进了 `capability-catalog.sh:208` 的
`QUESTION[precommit-guard.ts]` 双引号值里。bash 在双引号内执行命令替换 ⇒ **每次跑 catalog 都在加载时
执行整个 doc-check 套件（实测 ~2.4s）并把多行输出注入 question 值** ⇒ tab 分隔的 ROWS 结构被新行打断
⇒ `--json` 的 Python unpack 在第 8 行 IndexError（实测 `len(parts)=2`）⇒ 全部 catalog 断言失败。

**根因定位**：`capability-catalog.sh:208` QUESTION 值里的反引号。已确认全仓 `QUESTION[]` 只有这一条带反引号。

## Plan

1. 把 `capability-catalog.sh:208` 值里的反引号去掉（命令名写成普通文本，不带反引号）。
2. 验证 `bash plugin/scripts/capability-catalog.sh --json` 退出 0 且无 IndexError；`--table` 摘要数字与修复前一致。

## AC

- [ ] AC1: `capability-catalog.sh` 无 QUESTION 值含反引号（命令替换注入点清除）
- [ ] AC2: `--json` 退出 0、无 IndexError、行结构完整（tab 分隔 ROWS 不被新行打断）
- [ ] AC3: `--table` 摘要数字与修复前一致（无 catalog 项丢失）
- [ ] AC4: capability-catalog.test.mjs 全绿；`--for-task` scoped 门绿
- [ ] AC5: 机械检查（outer 2026-08-13 追加 scope）——capability-catalog.sh 数据值（QUESTION[] 等）含命令替换（反引号 `` ` `` 或 `$(`）⇒ 静态红：capability-catalog.sh 顶部新增 AC5 fail-fast 门 + capability-catalog.test.mjs 负控制（反引号与 `$(` 双方向注入均 exit 非零）

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修复前后 `--json`/`--table` 对比贴出（见 Evidence）

## Touches

- plugin/scripts/capability-catalog.sh（:208 反引号移除；顶部新增 AC5 命令替换静态门 + 头注释退出状态说明）
- plugin/test/capability-catalog.test.mjs（AC5 负控制测试：反引号 / `$(` 双方向）
- tasks/gap-capability-catalog-backtick-command-substitution.md（自身）
