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

- [x] `grep -rn "drive-target-check\.ts" CLAUDE.md orchestration/manager-tick-sending.md orchestration/manager-tick-core.md orchestration/manager-loop-tick.md` 返回空（无命中）—— 2026-10-08 实测 exit=1（零命中）；该串在**改动前**的树上即零命中（见 Evidence）
- [x] 上述四个文件里 `grep -c "drive-target-check\.sh"` 均 ≥1（确认改成了正确且存在的文件名，不是改成另一个不存在的名字）—— 实测 CLAUDE.md=1 / manager-tick-sending.md=1 / manager-tick-core.md=1 / manager-loop-tick.md=1
- [x] `test -f plugin/scripts/drive-target-check.sh` exit 0 —— 实测 exit=0

## DoD

四处文档落地 develop 后，`drive-target-check.ts` 这个扩展名错误在仓库全文（不含 `.quay/`、`.claude/worktrees/` 等临时产物目录）零残留；修改后的 `.sh` 命中数与改动前的 `.ts` 命中数一致（没有漏改也没有误改到其它无关行）。

## Evidence

**验证型（zero-delta）收尾。** 2026-10-08 worker 在 worktree `/data/home/yale/work/quay-worktrees/gap-drive-target-check-doc-extension-drift`（branch `task/gap-drive-target-check-doc-extension-drift`，fork off develop@4670d729c）上，三条 AC 在**未改动任何文件**的树上即全部通过。

**提案前提不成立：四份文档从未把该脚本写成 `.ts`。** 三条独立证据：

1. `git log --all -S`（全 ref、全历史）搜该扩展名串（`drive-target-check` + `.ts` 后缀），**只命中本任务自身的立案提交 `c139794c7`**（任务体把待纠正的字符串写进了 Proposal/AC），没有任何 commit 曾增删它 ⇒ 该字符串从未存在于任何 tracked 文件。
2. 四份文档现值全为 `.sh`：`CLAUDE.md:16` = `supervisor-deliver.sh / send-keys-reliable.sh / drive-target-check.sh / transcript-delivery-check.ts`；`manager-tick-sending.md:36` 同形；`manager-tick-core.md:78` = `(supervisor-deliver.sh/send-keys-reliable.sh/drive-target-check.sh)`；`manager-loop-tick.md:1928` 同为 `.sh`。行内那处 `transcript-delivery-check.ts` 是**另一个**脚本，其 `.ts` 与实际文件一致。
3. 溯源：该串出自审查会话 `8a89e93c-5f7b-47b1-9f28-e50cfb256073` **自造的探针清单**——它把 `plugin/scripts/drive-target-check` + `.ts` 与同清单里确实是 `.ts` 的 `tmux-session.ts`/`pane-state-classify.ts`/`transcript-delivery-check.ts` 并列，命中 `MISSING`（对那条自造路径）后被误归因为「文档写成 `.ts`」。该会话 transcript 里该串只出现在这份探针清单与其总结报告中，**没有任何一条命令对四份文档跑过 `.ts` 的 grep**。

⇒ 结论：AC 全真但**无改动可做**——四份文档一个字符都不该动（动即「无因改动」，与「修 SOURCE 不修 artifact」相悖）。DoD 的「仓库全文零残留」在把**任务体自身的引文**排除后成立（该处是记录，不是扩展名错误）。

## Touches

- CLAUDE.md
- orchestration/manager-tick-sending.md
- orchestration/manager-tick-core.md
- orchestration/manager-loop-tick.md
- tasks/gap-drive-target-check-doc-extension-drift.md
