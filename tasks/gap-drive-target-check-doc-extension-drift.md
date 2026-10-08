---
id: gap-drive-target-check-doc-extension-drift
title: CLAUDE.md 及三份 orchestration 文档把 drive-target-check.sh 误写成 .ts（扩展名漂移，4 处同源）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

四处文档（`CLAUDE.md:16`、`orchestration/manager-tick-sending.md:36`、`orchestration/manager-tick-core.md:78`、`orchestration/manager-loop-tick.md:1928`）把保留的 C 类投递 fallback 脚本写作 `drive-target-check.ts`，但仓库里实际文件是 `plugin/scripts/drive-target-check.sh`（shell 脚本，非 TypeScript；`send-keys-reliable.sh:137-138` 实际校验的也是 `[ ! -f "$SCRIPT_DIR/drive-target-check.sh" ]`，`.sh` 后缀）。

这是 CLAUDE.md 自己警告的"复制一份就是制造漂移"的实例——同一处扩展名错误被复制到四个常驻文档里。发现过程：2026-10-08 一次架构审查会话（f96878f0-fff1-4415-8dbc-a31140e2a262）核查 tmux 退役现状时，对比 `plugin/scripts/` 实际文件列表与 CLAUDE.md 的描述，发现 `drive-target-check.ts` 不存在、`drive-target-check.sh` 存在。

修复：把四处的 `drive-target-check.ts` 文本改成 `drive-target-check.sh`，不改其余措辞（这四处的上下文——"旧机件保留可用但非默认路径"——本身是准确的历史裁定记录，不需要重写，只改文件名拼写）。

## AC

- [ ] `grep -rn "drive-target-check\.ts" CLAUDE.md orchestration/manager-tick-sending.md orchestration/manager-tick-core.md orchestration/manager-loop-tick.md` 返回空（无命中）
- [ ] 上述四个文件里 `grep -c "drive-target-check\.sh"` 均 ≥1（确认改成了正确且存在的文件名，不是改成另一个不存在的名字）
- [ ] `test -f plugin/scripts/drive-target-check.sh` exit 0

## DoD

四处文档落地 develop 后，`drive-target-check.ts` 这个扩展名错误在仓库全文（不含 `.quay/`、`.claude/worktrees/` 等临时产物目录）零残留；修改后的 `.sh` 命中数与改动前的 `.ts` 命中数一致（没有漏改也没有误改到其它无关行）。

## Touches

- CLAUDE.md
- orchestration/manager-tick-sending.md
- orchestration/manager-tick-core.md
- orchestration/manager-loop-tick.md
- tasks/gap-drive-target-check-doc-extension-drift.md
