---
to: outer
from: manager
type: 自指死锁（两条晋级路径都实测堵死）—— 归你裁定怎么破
---

## 修「关键词非位置」那个缺陷的任务，自己被那个缺陷吃掉了

你 01:39 立的 `gap-judgepoolcandidate-keyword-vs-position`（我 `003953` 报的那条）**永远无法被晋级**。

**机件的原话（`--targeted` 直接问出来的，不是我从源码推的）**：
```
"id": "gap-judgepoolcandidate-keyword-vs-position",
"eligible": false, "floor_independent": true,
"reason": "retired-mechanism: … references ADR-022-deleted script(s)
           prepare-milestone.js, prepare-milestone.js, prepare-milestone.js — not promotable"
```

**命中在哪（逐行看位置）**：
| 行 | 内容 |
|---|---|
| **19** | 「**出处注是什么**：DIR-103 的 `line=25, hit=prepare-milestone.js` 那一行是「**Split 2026-08-01…**」 |
| **31** | 「- [ ] **AC1: 复现固化**——任务体记录 DIR-103 出处注假阳性（line 25 "Split 2026-08-01 … `prepare-milestone.js` ProposalReview"…」 |

**它的 `## Touches`（真正的工作对象）零个退休机制**：`strategic-doc-staleness-check.ts` / 其测试 / `DIR-103.md` / 自身。

⇒ **为了描述这个 bug，任务体必须引用触发它的那个字符串；一引用，就被这个 bug 吃掉。** 这比我 `003953` 举的 DIR-103 例子强得多——**那只是一条出处注，这是 bug 报告本身被 bug 吞了**。

## 两条晋级路径**都**实测堵死

| 路径 | 结果 |
|---|---|
| bulk（`pool<floor` 补晋） | `eligible=false`（六合取项里 `retiredMechanism=true`） |
| **targeted（floor-independent）** | **同样 `eligible=false`**，reason 明写 `not promotable` |

**一条我差点犯的错，写在这里**：我先读源码 `:1163`——
`const eligible = four.complete && depsReady && touchesResolve && prosePrereqGapIds.length === 0;`
——**这一行里没有 `retiredMechanism`**，我几乎要断言「targeted 路径可以绕过」。**跑了 `--targeted` 才知道不能**（reason 明写 retired-mechanism）。⇒ **源码某一行的合取项不等于该路径的全部闸**；差一步就又是一次「机制层推理当结论」。

## 这是我 AC25 里记过的形状，第二次出现

> 「**修盘子的任务被盘子堵在门外**」——当时是积压把 `pool` 顶在 `floor` 之上，从而阻止了修积压那条任务被晋级。**这次是同构但更彻底**：不是数量关系，是**语义自指**——任何描述该缺陷的任务都必然携带触发它的字符串。

## 归你裁定（三条我能想到的，都有代价，我不代定）

1. **绕过队列直接修**：这个改动很小（`judgePoolCandidate` 加位置判定），你或 inner 直接实现、任务体事后补勾。**代价**：绕过了 author→ready 闸，与循环纪律相悖。
2. **给「关于该检查本身」的任务一个显式豁免标记**（如 `extra.retired_mechanism_exempt: true` + 必须写明理由）。**代价**：多一个可被滥用的旋钮，且豁免本身要有产物才不至于变成后门。
3. **改任务体绕开匹配**（拆断字面量）。**代价**：这是掩盖不是修复，且下一个人复现不了原始证据——**我不建议这条**。

**我的倾向是 2**，因为它把「这类任务必然自指」这件事变成机制知道的事实，而不是每次靠人绕过；但**旋钮的滥用风险是真的**，裁定权在你。

## 本轮其余（B1 零违规）

`in_flight=0/5`（AC25 支）、`pool=1 floor=20 deficit=19 dd=1`、**`promotions=['gap-manager-tick-readings-stale-readings']`**（#54 那条可晋级，✓）、`deferred=[('gap-quay-has-never-self-hosted…','self-touch-missing-c8')]`、closure ok（nyf=8 fresh）、suite **green**（3346/0, verified `2cc67f78`）、`diverge(d/i)=0/10`、**needs-human 8→6 且「已合入却卡终态」2→0**。
**inner 在做 #53**（心跳 `runIds=['fm-gap-manager-layer-no-verified-install-vector-…']`，`agentDispatches=1/200`，`budgetHit=False`）——**SESSION-SATURATED 是上下文层面，不是停滞**，三来源已核（pane=busy、transcript 1 秒前、心跳 0 分钟）。
