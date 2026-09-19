---
id: gap-context-slim-p1-claudemd-d-layer
title: 上下文瘦身 P1：CLAUDE.md 删 D 层并把事故叙事迁出常驻文件
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-context-slim-p0-baseline-readings
---
## Proposal
近 14 天历史（主会话 4425 + subagent 324）：规则 ID 被当短标签引用（3b 884 会话、规则4 743、推论三 539、5b 374…），引用形式都是「标签 + 一句判据」，**没有会话引用事故叙事本身**；而 Split-decision（11 会话）、退役墓碑（13–54）、C15（3）、C30（4）近乎零引用；「Glob unavailable」规则在场时该错误仍在 6 个文件出现（规则在场≠有效）；Workflow-resume 的 `scriptPath` 规则已含在 `fan-in-execute` skill 中。本任务只做 D 层与叙事迁移：①删 Split-decision 节、Glob 节、Workflow-resume 节（先核实其 `scriptPath` 规则确在 fan-in-execute skill）、正文里的退役机制叙事（收件箱、classic loop、outer 角色、prepare-milestone、.halt、gap-ff-propagate），改为指向 `orchestration/archive/AC58-retired-clauses.md#R*` 的一行指针；②认识论硬规则里的事故叙事（日期、实例、代价、复盘）迁到新文件 `docs/epistemology-casebook.md`，正文每条规则保留：规则一行 + 一句 why + 产物/检查器路径 + `→ casebook#锚点`；③**规则编号一律保留不复用**，被压缩的编号在 casebook 里保留「→ 见 X」。**⛔ 不得改变任何人的裁定内容，只改位置与冗余表述。** 删除之前必须先产出落点映射 `orchestration/context-slimming/p1-landing-map.tsv`——旧 CLAUDE.md（取自 P0 快照）的**每一行** → {保留于新 CLAUDE.md / casebook 某锚点 / archive 某锚点 / 明确判定纯重复(列出重复位置)}；任一行无去向即不许合并。
## AC
- [ ] `p1-landing-map.tsv` 覆盖 P0 快照 `CLAUDE.md.snapshot` 的全部行：`awk 'END{print NR}' snapshot` 等于映射表数据行数，且无空去向列（`awk -F'\t' '$3==""' p1-landing-map.tsv` 输出 0 行；先对一个故意留空的临时样本干跑确认该谓词能命中）。
- [ ] 新 `CLAUDE.md` 行数比快照至少少 100 行，`wc -l CLAUDE.md` 与快照对比命令输出贴进 Resolution；单行最长 ≤ 700 字符（`awk '{print length}' CLAUDE.md | sort -n | tail -1`）。
- [ ] 不含已删节：`/usr/bin/grep -c '^## Split-decision routing policy\|^## Glob tool unavailable\|^## Workflow resume anti-pattern' CLAUDE.md` 为 0（先打印命中前 3 条核对；再对快照文件跑同一谓词应 ≥3，证明谓词能命中）。
- [ ] 规则编号守恒：快照中出现的每个「硬规则」编号标识（`/usr/bin/grep -o '^[0-9]\+[bc]\?\.' snapshot | sort -u`）在新 CLAUDE.md 或 casebook 中仍能找到（差集为空）。
- [ ] `docs/epistemology-casebook.md` 存在，且新 CLAUDE.md 中每个 `casebook#` 锚点都在该文件里有对应标题。
- [ ] `scripts/test.sh --for-task gap-context-slim-p1-claudemd-d-layer` 退出 0（scoped 静态检查绿）。
## DoD
真实落地：合入 develop 后 `git show develop:CLAUDE.md | wc -l` 已下降，且 `git show develop:docs/epistemology-casebook.md` 可见；落点映射已随提交贴入。不接受只在分支上满足。
## Touches
- CLAUDE.md
- docs/epistemology-casebook.md (new)
- orchestration/context-slimming/p1-landing-map.tsv (new)
- orchestration/context-slimming/landing-map-check.sh (new)
- tasks/gap-context-slim-p1-claudemd-d-layer.md
