---
id: GOAL-911
title: 通用化「线索 vs 语义判断」两段准入：注册表加 admission 字段区分 mechanical /
  semantic-judged，unencapsulated-state 作为第一个语义准入 kind 端到端跑通
status: active
kind: goal
origin: 架构分析会话 2026-10-22：人裁定「未封装」的判断必须是语义的、机械信号只做线索，并把这个「线索 vs 语义判断」的分离做成通用结构而非一次性特判
activatedAt: 2026-10-22T09:57:00.396Z
statusLog:
  - at: 2026-10-22T09:57:00.396Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
---
## 背景

「未封装」是语义属性，不是机械可判的量：一个模块级 `let` 可能是真状态簇（serve-dashboard 的 snapshot 簇），也可能是 memoized 探针、诊断计数器、已封装注册表——机械谓词分不清这三者。2026-10-22 本会话曾想把「未封装」做成 `mechanized:true` 自动立案，这是把语义判断坍缩成机械检查（与「确认」同形的伪判定）。人裁定：**机械信号只做线索，判断必须是语义的**；并且这个「线索 vs 语义判断」的分离应当做成**通用结构**，而不是「未封装」的一次性特判。

本仓库已有三个现成先例，但都没被命名、没进注册表：
- `semantic-dedup-scan`——机械扫描产候选 → LLM 判真伪 → `routine-file-gate`（isActionable + dedup）→ 立案；
- `arch-layer-review`——三层分离（机械事实 / 声明规则 / LLM advisory 四态），语义层明确 advisory、不是 gate；
- `pool-quality-judge`——schema agent 判 ready/needs-work/should-remove。

本 goal 把它们各自出现、但未命名的「线索 → 语义判断」结构，抽成一个显式字段 + 一份可复用契约。

## 设计

**一、注册表加 `admission` 字段，二选一：**
- `mechanical`：该 concern 有**机械可取假**的 delta（环 = SCC 成员 + 断边；回归 = 修复窗口让谓词 hit=false），检测器能直接确认。已有：`package-cycle`、`design-evolution-regression`。
- `semantic-judged`：该 concern 是**语义属性**，机械信号只产候选，确认靠语义判断。已有槽位：`god-file-size` / `unencapsulated-state`（现 `mechanized:false`，缺的不是探测器而是语义判断这一层）。

**二、`semantic-judged` 的统一两段管线（一份契约，不是每个 kind 一份）：**

```
机械线索器 ──state="candidate"+代理读数──▶ 语义判断器 ──confirmed/refuted/needs-more-evidence──▶ Planner 立案 ──▶ (a)-(e) 验收
```

**三、纪律：**
- 线索器读不懂语义时输出「候选」，词表里**没有**「confirmed」——不与「确认」同形（硬规则 3b）。
- 判断器每条 `confirmed` 必须带「若不为真则结果不同」的对照（硬规则 4 推论四）。
- 负对照：线索器对 memoized 探针 / 计数器 / 注册表报候选，判断器**必须拒绝**它们。

## 范围与非目标

**范围：**
- `CONCERN_KIND_REGISTRY` 加 `admission` 字段 + Planner 准入按它分派（mechanical 走老路，semantic-judged 走两段管线）。
- 一份可复用的两段契约（线索 schema + 判断 schema + 三态词表 + 反事实要求）。
- `unencapsulated-state` 作为第一个 `semantic-judged` kind 端到端跑通（线索器 = 机械状态簇判定；判断器 = LLM，经 recorded-verdict replay 测试）。
- 负对照测试钉进 suite。

**非目标：**
- 不改 `package-cycle` / `design-evolution-regression` 的 `mechanical` 语义。
- 不实现所有 semantic-judged kind 的线索器——只实现 `unencapsulated-state` 一个参考实例。
- 不把 `semantic-dedup-scan` / `arch-layer-review` / `pool-quality-judge` 重构进新契约（它们继续以现有形态运行，作为先例引用）。
- 不碰已立的 `gap-dashboard-snapshot-store-encapsulate-state`（它是本 goal 之下的一条切片，由 Planner 在语义准入生效后驱动，不是本 goal 的实现对象）。

## 退出条件

① 注册表每个条目都有 `admission` 字段且取值正确（`package-cycle` / `design-evolution-regression` = mechanical；`god-file-size` / `unencapsulated-state` / `spine-without-extension-point` = semantic-judged）；Planner 准入按 `admission` 分派（AC-918 criterion 逐字读绿）。
② 两段契约作为一份可复用模块存在，三态词表（candidate / confirmed / refuted / needs-more-evidence）各是独立取值、互不同形（AC-919 criterion 逐字读绿）。
③ `unencapsulated-state` 端到端跑通：线索器对真实仓库产候选（state=candidate，从不写 confirmed）、判断器确认真靶子并拒绝 memoized/计数器/注册表误报（AC-920 criterion 逐字读绿）。
④ AC-919、AC-924、AC-925 均 achieved（①②③ 全部由这三条 AC 的 criterion 与 expect 覆盖）。