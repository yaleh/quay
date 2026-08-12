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

- [x] 复现：`store.check()` 对一个带 `## 人的裁定`(≥40 非空白字符) + `## Contract`(六键) +
  `## AC` + `## DoD` 的 todo 任务返回 `ok:false` 且 reason 含「missing artifacts: proposal」。
- [x] 修复后：同一任务 `store.check()` 返回 `ok:true`，且 `store.check()` 与
  `ready-pool-check.artifactsComplete()` 对该 body 的 proposal 判定一致。
- [x] 修复不改动 ASCII 标题（Proposal/Contract/AC/DoD/Finding/Plan）的既有匹配行为
  （现有 `gate-shape-dispatch.test.mjs` 等门测试保持绿）。

## Touches

- packages/quay-native/src/store.ts（`sectionAfterHeading` / `artifactSections.has()` 的 `\b` 匹配；本任务选定 store.ts 为单一 `\b` 语义正本，统一为整行精确匹配，task-schema.ts 未改）
- packages/quay-native/test/gate-shape-dispatch.test.mjs（对应单测，本任务新增 CJK proposal-slot 用例）
- tasks/cand-cjk-proposal-slot-word-boundary.md（自身：勾 AC + 贴证据）

## Evidence

**修复**：`packages/quay-native/src/store.ts` 的 `sectionAfterHeading` 与 `artifactSections.has()`
把 `\b` 匹配统一为整行精确匹配（`^##\s+<h>\s*$`，与 `task-schema.ts` `extractSection` 同语义）。
`\b` 只在 `\w` 与非 `\w` 之间有边界；CJK 末字（如「定」）与其后换行皆非 `\w` ⇒ 别名永不匹配。
整行精确匹配对 ASCII 与 CJK 一视同仁。task-schema.ts 未改（本就是整行精确匹配的正本）。

**复现（修复前，worktree 内同一 body 实测）**：
- `store.check()`：`ok:false`，`artifacts:{"proposal":false,"plan":true,"ac":true,"dod":true}`，
  reason「missing artifacts: proposal」。
- `ready-pool-check.artifactsComplete()`：`complete:true`，`artifacts.proposal:true`。

**修复后（同一 body）**：`store.check()` 返回 `ok:true`，`artifacts.proposal:true`，reason
「all required artifacts present; eligible to move to ready」；`ready-pool-check.artifactsComplete()`
仍为 `proposal:true` —— 两判据一致（AC2）。

**单测**：`packages/quay-native/test/gate-shape-dispatch.test.mjs` 新增用例
「CJK proposal-slot alias：`## 人的裁定` satisfies the contract shape's proposal artifact and agrees
with ready-pool-check」，直接断言 `store.check()` 与 `artifactsComplete()` 对同一 body 的
proposal 判定一致（AC2）。既有 11 个门测试保持绿（AC3）。

**Touches 格式化说明**：原 `- 对应单测（packages/quay-native/test/gate-shape-dispatch.test.mjs）`
把路径写在全角注释 `（…）` 内，`select-tests-for-touches.ts` 的 `stripTouchAnnotation` 会把整个
`（…）` 当作注释剥掉 ⇒ 单测文件无法被 scoped 选择器解析（`--for-task` 报 test-selection-thin，
且所选测试集不含本任务改动的单测）。已将 Touches 改为机器可解析的具体路径（声明范围不变：
store.ts + 单测 + 任务自身）。

**Scoped 门**：`scripts/test.sh --for-task cand-cjk-proposal-slot-word-boundary`（worktree 根，
`.quay/config.yml` 从主 checkout 软链以过 packaging 交叉测试）：

```
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
tick-core-static-check: PASS — execution cores are statically covered.
ℹ tests 96
ℹ pass 96
ℹ fail 0
ℹ duration_ms 18738.932592
✔ CJK proposal-slot alias (gap-cjk-proposal-slot-word-boundary): `## 人的裁定` satisfies the
  contract shape's proposal artifact and agrees with ready-pool-check (12.817656ms)
```

（完整输出见提交后的 CI/本机重跑；上表为 `scripts/test.sh --for-task …` 的 exit 0 汇总。）
