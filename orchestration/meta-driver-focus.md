# meta-driver 人工转向通道（focus）—— 正本

> 本文件是**常驻 meta-driver** 的人工转向通道正本（人给方向时改写覆盖段），与
> `orchestration/dispatch-preference.md` 同源（tasks/gap-meta-driver-no-steering-channel-focus-unreachable）：
> **git 可见**（不在 gitignored 的 `.quay/` 下，可 diff、抗 compact、跨会话重启存活）、
> **每轮读**（非启动时读——改覆盖段即刻生效，无需重启常驻驱动）、**三段齐全**（默认段 / 覆盖段 /
> 维护者字段），缺任一段即视为文件被破坏（`dispatch-preference-check.ts --file <本文件>` 报红）。
> 机制只答「**该不该判读**」：覆盖段内容进 `readingsDigest`——内容变了 ⇒ 摘要变 ⇒ 判读一次；
> 内容不变 ⇒ 摘要不变 ⇒ 不判读（⛔ 非「非空就每轮判读」）。覆盖段承载「本轮把注意力放在哪里」。

## 默认段

覆盖段无具体方向时生效——meta-driver 按默认行为运行：

- 逐个审 divergence（pass-but-unflipped / achieved-but-failing / no-criterion），给出解读与建议。
- 逐个审 `metaRecords`（寄给它的 META 记录），给出逐条三态判定。
- 覆盖段无具体方向时，**不**因此改变判读节奏（内容不变 ⇒ 摘要不变 ⇒ 不重复判读）。

## 覆盖段

人给的具体方向（本阶段）。

- **当前方向（谓词形，2026-09-07 立）：暂无具体人工方向——按默认段行为运行。**
  要提方向时，把本段改写为**谓词形**（描述「什么条件下把注意力优先放在哪里」），
  ⛔ **不列具体对象 id**（谓词形会自动到期；列 id 的散文承诺惰性过期，且与「从未设过方向」同形——
  与 `orchestration/dispatch-preference.md` 覆盖段同源纪律）。

## 维护者字段

- **维护者**：人（负责更新覆盖段；提方向 = 改写覆盖段为谓词形）。
- **默认段的维护**：meta-driver 在无覆盖方向时按默认段运行；修订须在本字段登记变更。
