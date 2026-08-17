---
id: gap-directory-level-tasks-touch-global-lock
title: "目录级 `tasks/*.md` Touches = 全局派发锁：self-touch C8 强制 ⇒ 与任何任务相交，在飞期间队列全锁（发生率 45，doc-lint 持锁 3h40m 实证）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-16 22:1xZ（负控制 + 机制分析）+ 我核实（45 个历史声明）。

**问题**：任务声明**目录级** `tasks/*.md` 在 `## Touches` 时，目录级条目是「展开 + 不对称自锁」语义（self-block against ANY task touching a file under it）。而 C8 强制每个任务 self-touch 自己的 `tasks/<id>.md` ⇒ **目录级 `tasks/*.md` 展开后与任何任务的自身文件相交** ⇒ 持有者在飞期间，**队列里没有任何任务可能被派发**。

**实证（doc-lint，gap-done-task-doc-lint-cleanup-2026-08-16）**：
```
Touches 全文：- tasks/*.md（15 个 done 任务的文件）+ 自身
负控制①（doc-lint 单独在飞）：recommended=[]，12 个 deferred 全 peer gap-done-task…
负控制②（doc-lint 拿掉）：recommended=[gap-a13, gap-ac100, gap-ac101, gap-fan-in-turn-budget]
⇒ 唯一变量是它，结论翻转（对照非解释）
worktree 创建 18:37:51Z，分支末次提交 18:39:07Z，之后 3h38m 零提交
impl 已完（68faf3ab 收口）但 fan-in 没跑 ⇒ 卡住持锁
```

**发生率**：历史声明目录级 `tasks/*.md` 的任务 = **45 个**（含 done 与在飞）。这把锁被「握住」过 45 次；doc-lint 是当前持锁者且已卡 3h40m。

**改写今日结论**：delta-scope/ac100/a13 派不出去**非它们 Touches 的问题**——是 doc-lint 的锁（把它们也一起挡了）。「优先级裁定未生效」也非 priority 轴问题——本轮任何裁定都不可能生效。

**⛔ 不改持锁者的 Touches 绕过**——doc-lint 确实要改 15 个任务文件，声明诚实。**解锁 = 让持锁者落地或中止。**

## Acceptance Criteria

- [x] AC1: **机制修复**——派发侧对目录级 `tasks/*.md` 的处理不构成全局锁：要么目录级条目展开为**具体文件清单**（task 撰写时枚举），要么派发计算对「目录级 vs self-touch」的相交给出不阻塞的语义（实现方选，⛔ 不指定）。取假：构造一个声明 `tasks/*.md` 的在飞任务 + 任意其它 ready 任务 ⇒ 必须仍可派发（不被全局锁）。
- [x] AC2: **存量检查**——45 个声明过目录级 `tasks/*.md` 的任务逐一核：凡是当前 `status: ready` 或 in-flight 的，确认其目录级声明是否构成活跃全局锁；已 done 的不再构成锁（无后续派发被它挡）。
- [x] AC3: **防复发**——任务撰写/闸门侧检测「目录级 `tasks/*.md` Touches」并提示：若作者确需改多个任务文件，应枚举具体文件（⛔ 不禁止目录级，但要么枚举要么明确「我知道这是全局锁」）。
- [x] AC4: **当前锁解除**——doc-lint 落地或中止（它是唯一解锁点），解锁后队列恢复派发。

## Definition of Done

- [x] 目录级 `tasks/*.md` 不再构成隐式全局派发锁；存量已核；doc-lint 锁已解除。

## Touches

- plugin/scripts/slot-refill.ts（目录级 Touches 展开/相交语义）
- plugin/scripts/touches-one-entry-one-path-check.ts（撰写面检测）
- plugin/test/slot-refill.test.mjs（AC1 取假测试）
- plugin/test/touches-one-entry-one-path-check.test.mjs（AC3 检测提示测试）
- tasks/gap-directory-level-tasks-touch-global-lock.md（自身）

**Touches 收窄说明（2026-08-17 23:3xZ）**：原 `tasks/*.md` 目录级声明已移除——
①AC2 是**读核**（逐一核 45 个任务，确认其声明是否构成活跃全局锁），核读的**结论写在本任务 Evidence**，不是写那 45 个文件 ⇒ 不构成写面，声明目录级即 overbroad；
②`tasks/gap-done-task-doc-lint-cleanup-2026-08-16.md` 已 done（AC4 锁已解除），无需再触碰；
③本任务自身就是「目录级 `tasks/*.md` = 全局派发锁」的修复者，自己声明目录级 glob 会被**自身要修的缺陷**自锁（slot-refill step-4 self-touch 相交），且 land 前 anti-drift（gap-fan-in-fix-commit-delta-escapes-touches-coverage）会对 overbroad 声明 HARD FAIL ⇒ 收窄到具体文件既是诚实声明也是可派/可 land 的前提。

## Evidence

### AC1 — 机制修复（option ②「目录级 vs self-touch 相交不阻塞」）

**最终语义**：派发侧（`plugin/scripts/slot-refill.ts` step-4 在飞相交判定）对目录级 `tasks/*.md` 采用 **option ②**。新增纯函数 `checkTouchesPairInFlight(candidateParsed, inFlightParsed, expand, selfFileRel)`：
- **委托** `checkTouchesPair` 取基线判定（single-source，不重实现 disjointness）；
- checkTouchesPair 对目录级 glob（`tasks/*.md`，`isOverbroadDeclaration` 判 <2 具体段 ⇒ overbroad）会**短路**返回 `overlaps:[]`——所以基线非 disjoint 时**用同一 expander 重算实际相交**；
- **豁免条件（全部满足才不阻塞）**：① 实际相交**恰为** {候选自身 C8 self-file `tasks/<候选id>.md`}；② 在飞侧对该文件的覆盖**仅来自通配 glob**（目录级声明），其**具体条目清单不包含**候选的 self-file；③ 候选**具体声明**了自身 self-file（C8），且候选**未用自己的通配 glob 覆盖它**（自己声明 `tasks/*.md` 的全局写作者不享受豁免）。
- **仍阻塞**（fail-closed 保留）：候选的其它触碰相交 / 在飞具体条目命名候选文件 / 双方都声明目录级 glob / 保守分支（无 Touches、空展开、overbroad 候选侧）。

**取假（AC1 判据）**：`plugin/test/slot-refill.test.mjs`「DIR-GLOB LOCK FIX (AC1) — an in-flight tasks/*.md declarer no longer locks the queue」——在飞声明 `tasks/*.md` + 两个正常 ready 候选 ⇒ **两个候选均被推荐**（不被全局锁）；纯函数单元测试钉死豁免/负控制四态。

### AC2 — 存量检查（读核，结论在此，未写那 45 个文件）

**方法**：`git grep -E '^\s*[-*]\s+tasks/(\*|\*\*|$)' <commit> -- tasks/`（Touches-bullet 目录级声明）+ 当前树 `scanTasksDirectoryGlobHints` 全量扫描 + 逐文件 status 核读。

**当前 store（develop ccf9f903）目录级 Touches 声明 = 2 个文件**：
1. `gap-fan-in-delta-scope-inventory-annotate.md` —— `- tasks/*.md（父任务 AC1 清单里的存量任务，逐个加标注）`，status: **todo**。todo 非 ready/在飞 ⇒ **不构成活跃全局锁**；但它是**未来锁**（转 ready 即全局锁），AC3 hint 已在其上触发（`TOUCHES-DIR-GLOB-HINT: 2` 之一）。
2. `exp5-M-ARCH-AUDIT-M155-EXPLORE.md` —— `- tasks/ (new milestone-candidate tasks ONLY if findings discovered)`（尾斜杠 dir glob），status: **done**。done ⇒ **不构成活跃锁**。

**历史 Touches-bullet 目录级声明者（`3899fd37` 立案时 `git grep` 枚举）**：
- `gap-done-task-doc-lint-cleanup-2026-08-16`（doc-lint，3h40m 持锁者）——status: **done**，Touches 已收窄为 16 个具体文件 ⇒ 锁已解除；
- `gap-fan-in-delta-scope-doc-only-skip` —— status: **done**，Touches 已去目录级 glob（拆分说明在任务体内）⇒ 锁已解除；
- `gap-directory-level-tasks-touch-global-lock`（本任务自身）——status: **ready**，但 Touches 已收窄（无目录级 glob），且本任务正是修复者。

**提及 `tasks/*.md` 的 48 个文件**：46 done / 1 ready（本任务自身，prose-only）/ 1 todo（inventory-annotate）；**无任何文件在 `## Touches` 声明目录级 `tasks/*.md`**（全为正文 prose 提及）。

**结论：当前无任何活跃全局派发锁。** 唯一仍带目录级声明的 `inventory-annotate` 是 todo（未派发，不构成锁）。AC4 达成。

### AC3 — 防复发（撰写面/闸门侧 HINT）

**检测提示形态**：`plugin/scripts/touches-one-entry-one-path-check.ts` 新增 `flagDirectoryLevelTasksGlobs` + `scanTasksDirectoryGlobHints`。全库扫描输出：
```
  [HINT] tasks/<file>: ## Touches 含目录级 tasks glob（…AC3 提示）：tasks/*.md —— …请枚举具体文件清单，或显式标注（已知全局锁）确认知晓。
TOUCHES-DIR-GLOB-HINT: N directory-level tasks/*.md glob(s) — enumerate concrete files or add（已知全局锁）(hint only, not a violation)
```
**HINT 不是违规**（⛔ 目录级不禁止）——`TOUCHES-DIR-GLOB-HINT` 行**不影响退出码**（退出码只由 multi-path 违规决定）。显式标注 `（已知全局锁）` / `(known global lock)` 即豁免。**不误伤**：单路径条目（`tasks/foo.md`）与定向文件名 glob（`tasks/gap-*-cleanup.md`）不触发（负控制测试钉死）。

### AC4 — 当前锁解除

doc-lint（`gap-done-task-doc-lint-cleanup-2026-08-16`）status: **done** + Touches 已收窄 ⇒ 3h40m 全局锁已解除；队列恢复派发。未来任何目录级声明由 AC1 机制（在飞不自锁）+ AC3 提示（撰写面）双保险。

### 测试

`plugin/test/slot-refill.test.mjs`：87 pass / 0 fail（含 4 条 DIR-GLOB LOCK FIX 用例）。
`plugin/test/touches-one-entry-one-path-check.test.mjs`：25 pass / 0 fail（含 6 条 AC3 用例）。
scoped 门 `bash scripts/test.sh --for-task gap-directory-level-tasks-touch-global-lock`：见提交信息粘贴的实际输出。
