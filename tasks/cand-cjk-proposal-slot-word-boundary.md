---
id: cand-cjk-proposal-slot-word-boundary
title: store.check() 的 `\b` 使 `## 人的裁定` 提案槽别名永不匹配，与 ready-pool-check 判据分歧
status: ready
labels:
  - gap
  - gate
---

## Finding

**结论**：`packages/quay-native/src/store.ts` 的 `sectionAfterHeading` / `artifactSections.has()`
用 `new RegExp('^##\\s+' + h + '\\b', 'im')` 匹配标题。`\b` 只在 `\w`(`[A-Za-z0-9_]`) 与非 `\w`
之间有边界。`## 人的裁定` 末字「定」是 CJK（非 `\w`），其后是换行（也非 `\w`）→ **无边界 → 永不匹配**。
因此 `SHAPE_REGISTRY.contract.sections.proposal`(store.ts:47) 显式注册的提案槽别名 `人的裁定`
是死代码：带 `## 人的裁定` 提案槽的 contract 型任务在 author→ready 门被拒为
「missing artifacts: proposal」，尽管该节存在且内容 ≥40 非空白字符。

**与另一判据分歧（实证）**：`plugin/scripts/ready-pool-check.ts:366` 注册了同一别名，但其
`artifactsComplete` 走 `extractSection`(plugin/scripts/task-schema.ts:83，用 `^(##+)\s*${heading}\s*$`
整行精确匹配，无 `\b`)，**正确识别 `## 人的裁定`**。同一 body 实测：

- `store.check()`(即 `quay task check` / MCP `task_check` / `dod` gate 委托方)：`ok:false`，
  `artifacts:{"proposal":false,...}`，reason「missing artifacts: proposal」。
- `ready-pool-check.artifactsComplete()`：`complete:true`，`artifacts:{"proposal":true,...}`。

CLAUDE.md 明言 author→ready 的 shape 判定「is the single judge quay and meta-cc must share」，
这两个门在此分歧。

**真实存量**：`tasks/DIR-123-aarch64-build-on-ad-arm1-and-auto-build-on-develop.md` 使用
`## 人的裁定`（status:done，故当前不被卡；若回退到 todo 即被卡）。另两个 `人的裁定` 命中是行内
`**人的裁定（…）**` 非标题，不受影响。

**为什么重要**：注册的别名静默失效 = 形状门把「支持 directive 提案槽」宣称的机制执行成「不支持」，
且两个判据对同一任务给出相反结论；这是 spec/implementation 不匹配，不是文档问题。

## Acceptance Criteria

- [ ] 复现：`store.check()` 对一个带 `## 人的裁定`(≥40 非空白字符) + `## Contract`(六键) +
  `## AC` + `## DoD` 的 todo 任务返回 `ok:false` 且 reason 含「missing artifacts: proposal」。
- [ ] 修复后：同一任务 `store.check()` 返回 `ok:true`，且 `store.check()` 与
  `ready-pool-check.artifactsComplete()` 对该 body 的 proposal 判定一致。
- [ ] 修复不改动 ASCII 标题（Proposal/Contract/AC/DoD/Finding/Plan）的既有匹配行为
  （现有 `gate-shape-dispatch.test.mjs` 等门测试保持绿）。

## Touches

- packages/quay-native/src/store.ts（`sectionAfterHeading` / `artifactSections.has()` 的 `\b` 匹配）
- plugin/scripts/task-schema.ts 或 store.ts 中任一处作为单一 `\b` 语义的正本（建议统一为整行精确匹配或对 CJK 安全的边界）
- 对应单测（packages/quay-native/test/gate-shape-dispatch.test.mjs）
- tasks/cand-cjk-proposal-slot-word-boundary.md（自身：勾 AC + 贴证据）
