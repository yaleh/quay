---
id: AC-148
title: inner 执行核逐条归属，⛔ 不得有未分类项
status: achieved
kind: criterion
goal: GOAL-002
criterion: |
  node --no-warnings --experimental-strip-types -e 'import("node:fs").then(fs=>{const t=fs.readFileSync("orchestration/AC148-inner-core-itemized-attribution.md","utf8");const n=(t.match(/^- \*\*(A\d+b?|B\d)\*\*/gm)||[]).length;process.exit(n===30?0:1)})'
expect: exit 0
origin: |
  硬规则⑤（来源完备性）的直接应用：逐条映射，不是抽查几条——本仓库已为"抽查即删"付过代价
  （2026-08-10 删 164 行，3 条无家可归）。
---

**判据（能取假）**：`orchestration/fast-mode-tick-core.md` 的 **A1–A26 + B1–B5 每一条**给出三分类
之一——**①已由某 driver 承接（指名哪个）· ②随会话消失（说明为何不再需要）· ③仍需保留（说明由
谁执行）**。

**取假**：任一条无归属，或归属写成"待定/后续再说" ⇒ 假。


