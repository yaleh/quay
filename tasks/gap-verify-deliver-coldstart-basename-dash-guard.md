---
id: gap-verify-deliver-coldstart-basename-dash-guard
title: "verify-deliver-coldstart.sh:178 basename 缺 -- guard——/proc argv0 遇 -bash 等 dash-leading 进程名即报 'invalid option -- b'，全量 suite 环境依赖 flaky red（阻断所有 fan-in）"
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

**来源**：outer-tick-log fan-in 全量 suite RED（2026-08-17 05:23Z，exit_code=1，tests 4281 / fail 1）。唯一失败 = `plugin/test/verify-deliver-coldstart.test.mjs:46`（AC2+AC5 --selfcheck），错误 `basename: invalid option -- 'b'`。

**根因（:178）**：
```bash
for proc in /proc/[0-9]*; do
    ...
    bin="$(tr '\0' ' ' < "$proc/cmdline" 2>/dev/null | awk '{print $1}')"
    case "$(basename "$bin")" in        # ← 缺 -- guard
      claude|node)
```
`$bin` 取 /proc/<pid>/cmdline 首元素。进程 argv[0] 为 dash-leading（如 login shell `-bash`、`-su`）时，`basename "-bash"` 把 `-b` 当选项 ⇒ `invalid option -- 'b'`，exit 1。case 结构错误退出 ⇒ selfcheck 判失败。

**复现（一条命令）**：
```
$ basename "-bash"
basename: invalid option -- 'b'   # exit 1
$ basename -- "-bash"             # 正确返回 -bash
```
**环境依赖 flaky 实证**：当前机器存在 3 个 `-bash` login shell 进程（`ls /proc/*/cmdline` 实测）；verify-deliver 测试独立运行 7/7 通过（扫 /proc 时恰好无 dash-leading 进程），而全量 suite 扫描窗口内有 ⇒ red。a13 suite（同机器，几分钟前）通过 = 窗口内无 dash-leading argv0。**不是 outer-tick-log 回归**（该任务只改 outer-tick-log-check.sh，与 verify-deliver 零重叠）。

**修复**：`:178` `basename "$bin"` → `basename -- "$bin"`。核对同文件其它 basename 调用（:77 `basename "$0"`、:247/:564/:631/:632/:664 `basename "$QUAY_TGZ"` 等）——均为文件路径，不可能 dash-leading，不需改。**本任务只改 :178 一处**（5b 纪律：同载体 grep 命中数贴进提交）。

**为什么是 fan-in 阻断**：该测试只在全量 suite 跑（scoped 集不含），任一后续 fan-in（bootstrap/shell-concat/AC96）在 `-bash` 进程存在时都会撞同一红。修复后全量 suite 对该 flaky 免疫。

## Acceptance Criteria

- [x] AC1: `verify-deliver-coldstart.sh:178` 改 `basename -- "$bin"`（`git diff` 单行可查）。
- [ ] AC2: `plugin/test/verify-deliver-coldstart.test.mjs` 全量 suite 绿（含 --selfcheck 两测试）——在有 `-bash` login shell 进程的机器上跑也绿（`ls /proc/*/cmdline | grep -c '^-'` 非零时）。
- [ ] AC3: `--for-task` scoped 门绿；既有测试不回归。
- [ ] AC4: 复现验证：`basename -- "-bash"` 返回 `-bash` 无错误（与 `basename "-bash"` 报错对照）。

## Definition of Done

- [ ] verify-deliver coldstart 的 --selfcheck 在 dash-leading argv0 存在时不再 flaky red；outer-tick-log fan-in 可重跑 land。（待外部）

## Touches

- plugin/scripts/verify-deliver-coldstart.sh（:178 basename -- guard）
- tasks/gap-verify-deliver-coldstart-basename-dash-guard.md（自身）

## Test-Files

- plugin/test/verify-deliver-coldstart.test.mjs（既有 --selfcheck 测试，修复后全量绿）
