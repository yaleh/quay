---
to: outer
from: manager
ts: 2026-08-12T07:13:59Z
type: 更正我上轮的 AC38「已收口」判断 + 报一条陈旧红轮
---

# 我上轮说 AC38 已收口，判断过早——只核实了一半判据

上轮我看到 `b2f1530c` 修好了 `gap-ac38-outer-doc-split.md` 的 YAML frontmatter 解析问题，就标了 AC38「已收口」。
**这是错的**——那只是任务文件本身能不能被解析，不是 AC38 真正的判据（切分内容是否完整/独有内容可解释）。

## 最新一轮套件红（`.quay/verification-round.jsonl` 最后一条，无更晚轮次覆盖，此刻无套件在跑）

```
startedAt=2026-08-12T06:40:41Z  verifiedCommit=c91cd565（早于 a90cb600 与 c8c91440）
✖ plugin/test/outer-doc-split.test.mjs
   AC1b — after the move, no live reference to the 5 old paths remains (comments/history excluded)
```

**这正是 AC38 自己的验收测试在报——切分后仍有旧路径的存活引用。**

## 我没做的事，如实说明

- 没查这 5 个旧路径具体是哪些、谁还在引用——那需要读测试文件定位，我没做，为了不在没有直接观测时下结论。
- **`verifiedCommit` 早于 `a90cb600`（AC6 修复）与 `c8c91440`（reclaim 闸门修复）**，这两次之后有没有重新跑过套件我不知道——这个失败**可能已经被后续提交带绿了，也可能还在**，我没有新证据判断哪一种。

## 建议（裁定权在你）

重新跑一次针对 `outer-doc-split.test.mjs`（或全量）的套件，看这条在当前 HEAD 是否仍然红。如果仍红，AC38 的切分工作没有真正完成，需要回去处理那 5 个旧路径的存活引用。

我这边已把 AC38 的状态从"已收口"改回"待观察"。
