---
id: gap-src-n-anchor-coupling
title: src:N 行号引用 + ANCHOR_K 窗口 + fail-closed 全套件 abort 的耦合
status: done
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-13，round 137/138 tests=0 abort）**：任何档案（orchestration/*-tick-core.md）的
行号编辑，若源文档（reason archive）行数前移，会让 `tick-core-static-check` 的
`(src:N "锚句")` 锚定失败（锚句不在 N±ANCHOR_K 窗口内）⇒ static check fail-closed ⇒
**全套件在测试开始前 abort**——表现为「20s 红、tests=0、partial=1 回退、说不出哪红」。

**耦合链**：src:N 行号引用 → ANCHOR_K（默认 5）窗口 → 锚句必须在 N±5 内 → 档案行号漂移 ⇒
锚 miss ⇒ static fail-closed ⇒ 全套件 abort。round 137/138 是活样本：tier-0 ①（ad692122）编辑
manager-loop-tick.md +7 行 ⇒ manager-tick-core.md 的 src:N 全部 anchor-miss（actualLines 全 +7）⇒
两轮 tests=0 abort。**这是「10 个 tests=0 轮」的部分成因**。

**现状**：tick-core-static-check.ts:139-140 已给 fast-mode-tick-core 开「按内容核对不按行号」
豁免（`(src:N)` 旧形式即算覆盖，anchor 形式出现才验），但没推广到 manager/orchestrator。

**修向（二选一，manager 建议）**：
1. **按内容锚定**：锚串已在 `(src:N "锚句")` 括号里——直接以锚句为覆盖判据（行号只是提示，
   不在 N±ANCHOR_K 也验锚句内容是否在源文档任意处），彻底去行号漂移敏感性。
2. **三核共享豁免**：把 fast-mode 的「按内容核对不按行号」豁免推广到 manager/orchestrator。

**验收**：任一档案 +7 行编辑后，tick-core-static-check 仍 PASS（不再因行号漂移 abort 全套件）。

## Plan

1. `plugin/scripts/tick-core-static-check.ts`：读当前 (src:N "锚句") 判定逻辑 + fast-mode 豁免实现。
2. 选修向（①内容锚定优先——锚串已在括号里，去行号敏感性最彻底）。
3. 实现：锚句在源文档任意位置出现即绿（行号仅提示，N±ANCHOR_K 失配不红）。
4. 测试：构造行号漂移用例（锚句移出 N±5）⇒ 仍 PASS；真缺失锚句 ⇒ 仍 RED。
5. scoped 门绿 + 下轮验证（档案编辑不再 abort）。

## AC

- [x] AC1: 锚句内容在源文档任意处即覆盖（行号仅提示，漂移不红）
- [x] AC2: 真缺失锚句仍 RED（防假绿）
- [x] AC3: fast-mode 豁免不再需要（统一逻辑）或保留但三核一致 —— 统一逻辑：三核同判（锚句任意处=绿，缺锚=红；旧 `(src:N)` 无锚句=覆盖不验）
- [x] AC4: 档案 +7 行编辑后 tick-core-static-check 仍 PASS（round 137/138 活样本）
- [x] AC5: 既有测试全绿（本文件 14/14 + mutation fixture 通过）；`--for-task` scoped 门由下轮 outer 全量轮验证（本轮零并发约束禁跑 scripts/test.sh）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 行号漂移 PASS + 缺锚 RED 双证贴出（见下 Evidence；新测试 AC3b 两条）
- [x] 既有测试全绿（`--for-task` scoped）——**延迟到下轮 outer 全量轮**（本轮 `scripts/test.sh` 被零并发约束禁止；已用 `node --test plugin/test/tick-core-static-check.test.mjs`（14/14）与 mutation fixture 代验）

### Evidence（2026-08-13，gap-src-n-anchor-coupling）

**修前**（round 137/138 活样本）：manager 核全部 anchor-miss 恰为 `N+7`（如 `(src:963 "manager-anchor-check.py")` → actualLines=[970]），static check fail-closed ⇒ 全套件 tests=0 abort。

**修后判据**（`runAnchorChecks`，统一三核）：锚句 `findAllAnchorLines()` 于源文档**任意处**出现即绿；`length===0`（锚句全文档缺失）才红 `anchor-miss`；旧 `(src:N)` 无锚句 = 覆盖不验。`ANCHOR_K`/`findAnchorLine`/`ANCHOR_PARTICIPATING` 已删除。

**双证**：
- 漂移 PASS：`node --test` 新增测试「AC3b: an anchor present ANYWHERE … green despite line drift」——锚句在第 20 行、核声明 `src:10`（+10 漂移 > 旧 ANCHOR_K=5）⇒ PASS（`assert.equal(res.status, 0)`，anchorViolations.length===0）。
- 缺锚 RED：新增测试「AC3b: a genuinely missing anchor still reddens」——档案无锚句 ⇒ RED（`status===1`，kind=anchor-miss，actualLines=[]）。
- 真仓 `node --no-warnings --experimental-strip-types plugin/scripts/tick-core-static-check.ts` ⇒ `ok: true`、`anchorViolations: 0`。
- 本测试文件 14/14 pass；`checker-mutation-cases/tick-core-static-check.sh` exit 0。

## Touches

- plugin/scripts/tick-core-static-check.ts（锚定判据：行号→内容）
- plugin/test/tick-core-static-check.test.mjs（漂移 PASS + 缺锚 RED 用例）
- tasks/gap-src-n-anchor-coupling.md（自身）
