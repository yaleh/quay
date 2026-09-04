---
id: ADR-024
title: "A ruling and the check that mechanizes it must be traceably bound: when a
  ruling changes, every check written against the old ruling must be mechanically
  findable — otherwise the check keeps faithfully enforcing a definition that was
  already overturned"
status: accepted
date: 2026-08-06
tags:
  - architecture
  - governance
  - single-source-of-truth
applies-to:
  - plugin/scripts/verify-delivery-surface.ts
  - plugin/scripts/quay-init.sh
  - adr/
  - tasks/
---

## 裁定

**一条裁定被机械化成检查之后，二者必须有可追溯的绑定：裁定变更时，所有依据旧裁定写死的
检查必须能被机械地找出来。**

人 2026-08-06 裁定（"创建「裁定与其机械化检查必须可追溯绑定」ADR"）。触发它的是一次实测：
本仓在**内容层**反复执行「单一事实源」原则（同一个事实不许存两份），但在**决定层**没有——
一个裁定被写进检查之后，裁定改了，检查不会跟着改，也没有任何东西会报警。

## 触发的实测（不是推演）

管理者 2026-08-06 用 `quay-init --loop --dry-run` 跑出**权威铺设集**（51 个文件；带 sanity
控制：应当在铺设集里的 `fast-mode-loop-tick.md` / `ready-pool-check.ts` / `slot-refill.ts`
三者均判 IN，因此该测试有判别力，不是恒真），对照 `verify-delivery-surface.ts` **自己声称的
14 个交付物**：

| 声称是交付物 | 实际是否被 `quay-init` 铺设 | 性质 |
|---|---|---|
| `plugin/scripts/os-anchor-install.sh` | **OUT** | **裁定已改，检查未改**（见下） |
| `plugin/scripts/os-anchor-watchdog.sh` | **OUT** | 同上 |
| `.claude/launch.settings.json` | **OUT** | 待各自裁定 |
| `plugin/scripts/verify-delivery-surface.ts` | **OUT** | **检查自己不在交付里** |

**4/14 对不上。**

**其中第 1、2 条是本 ADR 的直接证据**：`d6c34cbf`（2026-08-05）已裁定
**os-anchor watchdog 不是产品交付物**（`tasks/gap-os-anchor-watchdog-lease-model-instead-of-
absence-inference.md` 第 122–140 行记着完整论据：四次全灭全是实验室自伤、根因已各自立案、
拿它论证「所有项目都需要 OS 级 watchdog」是循环论证；结论：默认不装、不进 `plugin/` 推荐路径）。
而 `verify-delivery-surface.ts` 的第 5 项「周期锚点」**至今仍把这两个文件列为 `deliverables`**，
criterion 写着「OS 级周期锚点（systemd user timer）」。

⇒ **L1 交付面检查正在把一个已被裁定不属于产品的东西算作交付项，并据此给出答案。**
这不是"器官退化"（机制失效），是**裁定与检查之间没有同步机制**——检查在忠实地执行一个
已被推翻的定义。

**第 4 条最尖锐**：声称"这是你该有的东西"的那个检查，**本身不在消费方拿到的东西里**。
消费方（archguard）此前报告 `verify-delivery-surface` 对它报 `0/6`——已知的一半原因是
它查的是 quay 自家布局（消费方布局是 `orchestration/` + `docs/analysis/`）；**这里是另一半：
消费方根本没有这个检查，它跑的是 quay 的副本。**

## 为什么这是决定层而不是内容层的问题

本仓已有的「单一事实源」实践全部在**内容**层：一个事实不许存两份（任务体 vs 文件、
状态字段 vs 正文行、排除表 vs 扫描器读的数据）。**决定**层没有对应实践：

- 一条裁定（ADR、任务体里的 ruling、人的口头裁定被记录）→ 被机械化成一个检查；
- 裁定后来改了 / 被 supersede；
- **没有任何东西能从裁定出发，找到"哪些检查是依据它写的"**；
- 于是检查继续报绿/报红，而它执行的定义已经不存在了。

这与本仓反复付过学费的另一个形态互为镜像：「写在文件里但不在决策时被调用」。
那个是**有定义没人读**；这个是**有人读但定义已作废**。

## 决定

1. **机械化一条裁定的检查，必须声明它执行的是哪条裁定**——以可机械解析的形式
   （ADR id、任务 id 或裁定 commit），而不是散文注释里的一句话。
   现状里已有雏形：`verify-delivery-surface.ts` 的每项都带 `attribution: [...]`（任务 id）
   ——**方向是对的，但没有反向检查**，所以它可以指向一条早已改变的裁定而无人发现。
2. **裁定变更时，必须能机械地列出所有下游检查**——反向查询能力是本 ADR 的核心要求，
   具体实现（注册表 / 反向索引 / 扫描器）留给落地时选择。
3. **两份必须一致的清单之间要有机械绑定，不得分别维护**——具体到本次触发的实例：
   "检查声称的交付面"与"`quay-init` 实际铺设集"是同一个事实的两个副本，
   必须由一方派生自另一方，或由一条检查断言二者相等。
4. **fail-closed**：绑定缺失（检查没声明它依据哪条裁定）应当被报出，
   而不是默认通过——否则本 ADR 会重蹈"一个从没红过的检查与永远返回空集不可区分"。

## 明确不做

- **不追溯改写既有 23 条 ADR**——本 ADR 约束的是"裁定与检查的绑定"，不是要求
  历史 ADR 补齐格式。
- **不为「交付平台一致性 / 交付物与宿主 OS」建轴或 ADR**（人 2026-08-06 明确裁定暂不建）：
  当前大量实现（路径、shell 脚本）本就不适用于 Windows，把平台一致性立为判据会
  产生一个明知达不到的判据。**但记录一个由此暴露、尚未处置的事实**：release 目前仍在
  发 `quay-sea-<ver>-windows-x64.zip`，而 Windows 并不是当前支持的目标——
  这条属于 AC16 的 release 范围问题，交给 outer 在打 v0.4.0 时一并裁定，不在本 ADR 内解决。
- **不规定具体的绑定实现形态**（注册表 vs 反向索引 vs 扫描器）——那是落地时的机制选择。
- **不代裁上表中另外两条**（`.claude/launch.settings.json`、`verify-delivery-surface.ts`
  自身是否应当进铺设集）——各自需要独立裁定，属 outer。

## 与轴的关系

**轴是 ADR 的上游**：轴回答"我们从来没看过哪个方向"（开放、未完成、由多个同型实例归纳
而来），ADR 回答"我们决定了什么、为什么"（封闭、已完成）。一根轴被反复撞到、最终收敛出
一个决定时，那个决定进 ADR，并反向引用它来自哪根轴。**没有轴的 ADR 是拍脑袋的决定；
没有 ADR 的轴是永远开着的口子。**

本 ADR 正来自这样一根轴：它不是从一个 bug 归纳出来的，而是先有"裁定改了、检查没改"这个
**形态**，再去扫描、实测出 4/14 不一致，确认它不是孤例，才收敛成这条决定。

**并且本 ADR 顺带暴露了轴自身的一个记录缺陷**（人 2026-08-06 指出）：既然轴是 ADR 的上游，
轴理应比 ADR **更**突出；而本仓现状相反——ADR 是一等公民（`adr/ADR-*.md`，
`quay-native adr list` 可查），轴只是 `orchestration/manager-phase-goal.md` 里的一个计数，
**没有独立文件、没有查询工具、没有单条记录**。这个不对称本身待处置，不在本 ADR 范围内。

## 落地与验证

**留给落地时设计**（本 ADR 只定方向与硬约束）。最小可验证形态建议：
- `verify-delivery-surface.ts` 的 `deliverables` 与 `quay-init` 的派生铺设集之间加一条
  一致性断言（当前实测差 4 项，落地后应为 0 或每项带书面豁免理由）；
- `attribution` 字段从"注释性"升级为"被检查的"：所指任务/ADR 必须存在，且其裁定状态
  未被 supersede；
- 负控制：把某项 `attribution` 指向一条已被推翻的裁定 ⇒ 检查必须报出，而不是静默通过。
