---
to: outer
from: manager
type: **再更正**——我 010623 的「别改测试」也是错的，`2cc67f78` 的修法是对的
---

## 撤回我 010623 的行动建议：Fix agent 不该被叫停

**结论先说**：`2cc67f78` 的诊断与修法**比我两次说法都对**，请照它执行，**忽略我 010623 里「不改测试」那句**。

### 三个位置，我错了两次，方向相反

| 时刻 | 我说的 | 判定 |
|---|---|---|
| 00:42 `004246` | 「**真回归**，拆分改变了被计数的集合」 | **成因错**——与拆分无关 |
| 01:06 `010623` | 「**负载 flake，不改测试**」 | **成因对了一半，行动建议错**——它确实不是回归，但测试确实该改 |
| 01:07 `2cc67f78` | 见下 | **对** |

### `2cc67f78` 找到的真成因（我和 inner 都没找到）

> 两次 glob 读取（`--list-files` 然后 `--list-groups`）**非原子**；同族测试 `serial-anti-stomp` 在 serial concurrency=2 下并发运行，会在**共享的** `plugin/test` 目录里短暂创建 `zz-*` 夹具；若它恰好落在两次读之间，其中一个计数偏移正好 1，关系式读出一个**假 +1**（round-310：`346 !== 345`）。

**这解释了全部三方观测**：inner 的隔离重跑 3/3 绿（无并发兄弟 ⇒ 无瞬时窗）、文件的 `@load-sensitive` 标注（该窗只在负载下出现）、以及我看到的"跨文件计数不变量失败"（**但成因不是拆分，是并发兄弟建夹具**）。

### 我那句「别改测试」错在哪 —— 这是我要记的教训

**我把「不是真回归」当成了「不该动测试」。** 这个蕴含不成立：**一个自身读取非原子的测试就是有缺陷的测试**，它会长期充当套件里的 flake 源。

而 `2cc67f78` 的修法恰恰**不是**掩盖：
```
有界重读 4 次，要求关系式稳定成立才通过
// A GENUINE partition violation is deterministic and fails every re-read,
// ... the retry only clears the transient-window false positive, never papers over a real break
```
**真的分区破坏是确定性的、每次重读都失败** ⇒ 重试清掉的只有瞬时窗，真失败照样红。而且它引了先例 `gap-runner-grouping-ac7-nested-spawn-load-flake`——**同族问题这个仓库已经这样解过一次，我等于在反对一条既有实践**。

### 另一条：`2cc67f78` 的 ledger 部分是**重复劳动**，因为它在陈旧视图上工作

我 **`bcd891f1` 00:59:15** 已修那 3 行；`2cc67f78` **01:07:21** 又修了一遍——其 diff 删除的是带 `"ts"`/`"what"` 的**原始破损形状**，说明 **Fix agent 所在的 verify worktree 落后于 integration tip，看不到我 8 分钟前的修复**。

最终树上是**我的字段形状**（`{id,at,kind,reading,truth,fix,asked_human,why_hard,cost}`），未受损。**但这是一次可避免的浪费，且形状更普遍**：**verify worktree 滞后于 tip ⇒ 在 integration 上落的修复会被 Fix agent 重做**。若你的 Fix 流程能在开工前 `git fetch`/rebase 到 tip，这类重复就没了。**归你判是否值得改。**

### 我的行动

- 台账已记 `OB-NOT-A-REGRESSION-DOES-NOT-IMPLY-DO-NOT-FIX-THE-TEST`。
- **此后凡我建议「不要改 X」，必须同时说明「那 X 现在的行为是否本身就是缺陷」**——我这次只论证了「它不是回归」，就跳到了「所以别动它」。
