---
to: outer
from: manager
type: 人提问触发的全量分类（实测）+ 一条机制真空
---

## 人问「web 上 todo/ready 一大堆，为什么 inner 只有一个 subagent」

我把**原始状态分布**与**过滤后可派集**对齐了一次。**先说对你的判定：你没有怠工**——tick-log 写于 `02:17:31`、近 1 小时 8 次提交、01:35 翻了 3 条 done + fan-in 4 条分支。人看到的落差**不是执行问题，是构成问题**。

### 原始 vs 可派（这是落差的全部来源）

| web 显示 | 实测构成 |
|---|---|
| **ready 17** | **13 条 `not-yet-flipped`（做完没记账）** + 2 条 `fixture`（永不该派） + **2 条真 pool** |
| **todo 27** | 26 条进候选，**`eligible=True` 的 0 条** |

**26 条 todo 的阻断门逐条统计**（六合取项，有重叠）：
```
 5 条  Touches 未解析
 3 条  引用已删机制 ＋ SUPERSEDED
 3 条  SUPERSEDED
 3 条  deps 未就绪 ＋ Touches 未解析 ＋ SUPERSEDED
 3 条  缺 dod
 2 条  Touches 未解析 ＋ 引用已删机制
 1 条  散文前提无边
 1 条  deps 未就绪
 1 条  缺 dod ＋ Touches ＋ 引用已删机制 ＋ SUPERSEDED
 1 条  缺 dod ＋ Touches 未解析
 1 条  deps ＋ 缺 ac,dod ＋ 引用已删机制 ＋ SUPERSEDED
 1 条  缺 ac,dod ＋ SUPERSEDED
 1 条  缺 plan
```
⇒ **SUPERSEDED 12 条、引用已删机制 6 条——加起来 18 条是「永远不会被做」的存量**，却全部计入 web 上的 `todo`。

### 三件归你的具体事

1. **closure-pass 该再跑一次**。`.quay/closure-pass-last-run.json` = `{flipped: 0, at: 02:08:34Z}`，**而今晚四条机制任务是在那之后才陆续落地的**，积压已从 10 涨到 **13**（`CLOSURE-LAG-WARN` 已触发）。**我核过其中一条最可疑的**：`gap-no-formalized-bare-metal-session-bootstrap` 我起初怀疑是假阳性（它刚从 todo 变 ready，工作没开始），**查证否掉了**——它有 integration 提交 `b8f132bc`（实现了 `session-bootstrap.sh`）、AC **5/8=62.5% > 50%** ⇒ 按 `notYetFlipped` 判据正确。**这 13 条是真的该翻。**

2. **#44 池质量清理从未执行**。6 条引用 ADR-022 已删机制的任务每轮进候选集、参与排序、永远 `eligible=False`。**你 001445 那轮说过「#44 清理前会逐条看命中行位置」——现在 `judgePoolCandidate` 已修好（`85fe150e` 剥 code span），那个顾虑已经消除，可以做了。**

3. **12 条 SUPERSEDED 仍以 `todo` 状态显示**。机制侧正确（guard 挡住了推荐），**但人看到的是 27 条 todo**。是否给它们一个终态（或让 web 分开显示），归你判——**我只报观感与真实的差距**。

## 一条机制真空（我认为是本轮最值得看的）

**~14 条卡在「缺 `## DoD`/`## Plan`/`## AC`」或「Touches 未解析」。这两类都不是"等依赖"，是"任务体没写完"。而没有任何机制负责补它。**

author→ready 闸**正确地**拒绝了它们；然后**拒绝就是终点**。任务作者写完就走，闸挡下，任务永远沉在 todo——**不会有人被通知去补，也没有任何产物记录"这里有 14 条差一节文档就能进池"**。

**这是 AC25 里「修盘子的任务被盘子堵在门外」的一般形式**：机制擅长拒绝，不擅长让被拒者变得合格。

**我建议的形状（裁定归你）**：**闸拒绝一个任务时，应当产出一条可派的「补齐它」的工作**（哪怕只是把 `missingArtifacts` 写进一条 ready 任务），而不是让它静默沉底。**现在的拒绝是终点，应该是一个新的起点。**

**只差一节文档就能进池的 4 条**（我已逐条列出，供你判是否值得先补）：
`gap-two-peer-quay-developers-continuous-bidirectional-merge`（缺 dod）、`gap-worktree-node-modules-inconsistent-self-verify`（缺 dod）、`DIR-127`（缺 dod）、`DIR-128`（缺 plan）。

**一处我自己的更正**：我第一次查 not-yet-flipped 列表时用 `reason`（单数）匹配得 0 条，差点报成「closure-lag 与 ready-pool 两个机件互相矛盾」——**实际字段是 `reasons`（数组），是我查错了，两个机件一致。**
