---
to: outer
from: manager
ts: 2026-08-12T06:21:40Z
type: 全量 AC36-41 复核 — 两处更正
---

# 全量复核 AC36-41，两处需要更正我此前的说法

## ① AC36「端到端」从未被真实证明过

`gap-ac38-outer-doc-split` labels: `[gap, milestone-candidate]`
`gap-ac39-accounting-emit-layer` labels: `[gap, defect, milestone-candidate]`

**都没有 `label:delivery-critical`。** 我此前在 tick-log 里说「#59 打标签后 5 分钟被派」是错的推断——
那是你自己判断优先派的，不是 AC36 的排序轴在起作用。

机制侧已机械化：`slot-refill.ts` 有 `deliveryCritical`/`suiteBlocking` 两轴，
`plugin/scripts/ac36-sortkey-criterion-check.ts` 存在。**但判据 3（端到端：打标签后下一次 inner 派发即取它）
从没有一次真实运行验证过。** 建议找一个真实待派任务打上 `label:delivery-critical`，观察下一轮派发是否真的取它。

## ② AC41 字面判据满足，但还有 11 条标准规则没接进这套机制

`red-on-omission-audit.ts` 报 `covered=18 uncov=0 (band 0)`——AC41③ 点名的三条
（A15 裁定5 / scope=worktree 闸 / ruling5_status）都在这 18 条里，**这部分确实达成**。

**但同一次输出还列出 11 条「未固化」**：A4、C4、C5、C6、C8、C9、C10、C11、C12、C13、C15。
这些都是仓库里真实在用的硬约束（tick-core 文档、CLAUDE.md 里都有），只是没被接进这套 registry。

AC41 自己的哲学是「每条固化下来的行为必须能指出哪个读数会变红，指不出的视为未固化」——
按这个标准，AC41 只完成了它点名的那 3 条特定 invariant，精神上还差 11 条。

不确定这 11 条是否都值得接（有些可能天然不适合机械化，如 C11「停摆分类不要靠输入框内容猜」这类需要判断的规则），
**这个判断归你**，我只报读数。

## 其余 AC 状态（本轮实测，供参考，无变化）

- AC37：达成（`quay-init.sh` 7 处命中 tick-core，`plugin/loop/` 三份核齐全）
- AC38：commit 层面已 fan-in（`ba0abfde`），**但任务体自己的 frontmatter 仍解析失败**（见 `manager-045800-*`），未验证性收口
- AC39：三层 `complete` 均 `false`，未开工（真冲突卡着）
- AC40：05:04-06:1x 判负期已实测（你的会话被杀），现已恢复但尚无提交产出，`dead-loop-check` 报 `running`（粗粒度，不代表持续正确驱动已重新确立）
