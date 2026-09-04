# 倾向变更通知留痕（发送侧）—— AC57 载体

> 本文件是倾向变更通知的**可核载体**（发送侧留痕），`tasks/gap-ac57-preference-change-notification`（AC57）。
> **为什么需要它（SPEC-dispatch-ordering-semantic-2026-08-13 §4.1）**：通知是消息不是文件——SendMessage
> **compact 后不可重读**、**无单一正本**、**无法验证用的是哪一版**。三条失败模式已在当日实证（最有价值的
> A19 规格幸存是因为 outer 抄进了任务体，不是因为消息还在）。本文件让每一次发送的通知都有**可重读、可核**
> 的留痕，回答「那条通知到底说了什么 / 它带没带倾向内容」。
> 本文件 **git 可见**（不在 gitignored 的 `.quay/` 下），抗 compact、跨会话重启存活——同倾向文件正本的立身理由。
>
> **AC57 义务（phase-goal 逐字）**：倾向变更的通知**不得包含倾向内容本身**，只说「倾向变了，去重读」+ 指纹。
> 指纹 = 倾向文件 `orchestration/dispatch-preference.md` 的 git blob hash（`git hash-object`），回答「用的是哪一版」。
>
> **发送者（manager）义务**：每次通过 SendMessage 发送倾向变更通知时，**把通知的【确切文本】逐字追加**到
> 本文件的「## 留痕记录」段（时间戳 → 接收方 + 通知全文）。检查器
> `plugin/scripts/preference-notification-check.ts` 读取本文件，验证每条记录只含通知语 + 指纹且不含倾向内容
> （泄漏 ⇒ 红）。

## 通知模板

（发送者**必须逐字使用**本模板。）

```
倾向变了，去重读
重读正本：orchestration/dispatch-preference.md
指纹：<git blob hash of orchestration/dispatch-preference.md>
```

（`指纹：` 后用 `git hash-object orchestration/dispatch-preference.md` 的 40 位 hex 填充。）

## 留痕记录

（发送者在此逐字追加每次发送的通知文本，格式见上方模板。检查器验证本段内的每条记录——含通知语 + 指纹、
不含任何倾向内容行。）
