---
id: gap-goal-ac-boilerplate-misquotes-spec-as-license-for-empty-criterion
title: 26 条 goal AC 的样板行引 SPEC-0809 §3 为 criterion 留空背书，而 §3 说的是相反的（13 条 active
  ⇒ GOAL-002 验收面无测量）
status: ready
labels:
  - gap
  - meta-driver
parent: null
children: []
extra: {}
---
## Finding

**结论**：26 条 goal-store AC 记录各带一行同样的样板，**引用 SPEC-0809 §3 来为自己的 criterion 留空背书**，而 §3 的原意恰好相反。其中 13 条当前 `status: active`，构成 meta-driver 每轮报出的 20 条偏离里的绝大部分。

**样板原文（26 条逐字相同）**：
> ⊢ criterion 留空：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。

**SPEC-goal-store-2026-08-09.md §3 的原文（逐字）**：
> **fail-closed**：`criterion` 未设 ⇒ **判红**。照抄 `makeDocumentContractGate` 的原则（*an unenforceable document must never silently PASS*）。**这条是本规格的核心价值之一**：AC28（本阶段主判据）当前不可机械判定，迁移后会立刻 fail-closed 报红——**那是对的**，它今天被散文盖住了。

⇒ §3 把「报红」定位成**逼人去补判据的压力**，并明说这些 AC 变红「那是对的」。它从未把留空列为可停留的合法状态。样板行把 fail-closed 从**压力**读成了**许可**，方向正好相反。

**这不是文字之争，它有实测后果**：13 条活跃 AC 无判据 ⇒ `isGoalAchieved` 对 GOAL-002 结构上恒为 false ⇒ 该目标的验收面**完全没有测量**；而每条 AC 的正文都写着一句"这是诚实状态"，使这个空洞看起来像是设计。

**人 2026-09-06 的裁定（独立得出同一结论）**：「对于生命周期较短的 task 来说，『空⇒fail-closed 诚实』是可行的；而对于 goal 的 AC 来说，禁止活跃 AC 无判据是必要的。」实测 AC-143 等均为 `kind: criterion`、`goal: GOAL-002` 的 **goal-store AC**（与 AC-180 同一对象）⇒ 直接落在「必须有判据」一侧。

**多数其实可测，不是真的不可机械化**：AC-152 正文明写「一条命令可验」；该观察由 meta-driver 生产轮用读代码授权得出（`mt-prod-1788703469`，2026-09-06T14:40:34Z）。所以「语义判据」这个豁免类对多数条目是**错配**，不是保护。

**来源与去重**：制造这批记录的是 `gap-goal-store-migrate-prose-phase-acs-to-records`（**status: done**）——问题仍在而任务已 done，属假完成，应被驱动而非被它挡住（⛔ 不要在它旁边新造并行机制，要修这些记录本身）。与 `gap-meta-ac-180`（AC-180 自己的判据恒绿）是**两个不同缺陷**：那条修守卫，本条修被守卫盯着的对象。

**已撤回的误分流**：meta-driver 曾把此事升级为 `GOAL-006`「两立场正面冲突，请人裁决」。已判定为假冲突并 superseded——probe 如实转述了 AC 正文的说法，**是记录在骗读者，不是 probe 在骗人**。

## AC

- [x] 无判据的活跃 AC 归零：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts list --status active --root . | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const bad=j.filter(r=>String(r.id||"").startsWith("AC-")&&r.criterion==null);console.error(bad.length+" 条无判据: "+bad.map(x=>x.id).join(","));process.exit(bad.length===0?0:1)})'` ⇒ exit 0。立条时实跑为 **exit 1、13 条**（能取假）。
- [x] 误引样板绝迹：`grep -rl 'criterion 留空' goals/ | wc -l` ⇒ `0`。立条时实跑为 **27**（含 GOAL-006 自身引用；能取假）。
- [x] 每条新补的 criterion 都**能取假**：逐条给出一次「把被测对象改坏 ⇒ 该 criterion 变红」的实跑证据，或说明该条为何只能语义判定并**改为非 active**（retired/draft），⛔ 不得保留「active 且无判据」这个组合。
- [x] 判据测的是**行为不是源码排版**：⛔ 不接受 `grep 某字符串是否存在于某文件` 这类会因重排而失效的写法（同 probe 规格的 criterion-quality 条）。

## DoD

- [x] 上述判据本轮实跑并贴出输出，⛔ 不是转述。
- [x] 26 条**全部**处理，不只处理当前 active 的 13 条——非 active 的那 13 条带着同样的假依据，一旦重新激活即复现（硬规则 5b：在某处修好 X ≠ X 只在那一处）。
- [x] GOAL-002 的验收面从「结构上无法达成」变为「可被测量」：`isGoalAchieved(GOAL-002)` 不再因缺判据而恒 false（可以仍为 false，但原因必须是判据真的没过，而不是没有判据）。
- [x] ⛔ 未把「补判据」做成给每条塞一个恒绿命令——那会把无测量换成假测量，比现状更坏（硬规则 4）。

## Touches

- `goals/AC-146-human-interface-explicit-owner.md`
- `goals/AC-145-semantic-subagent-manager-driven.md`
- `goals/AC-144-quality-gate-by-shape-driven.md`
- `goals/AC-143-observe-ledger-close-driven.md`
- `goals/AC-148-inner-kernel-item-by-item-ownership.md`
- `goals/AC-147-manager-liveness-independent-watchdog.md`
- `goals/AC-156-bare-filename-scan.md`
- `goals/AC-149-session-retirement-no-dual-source.md`
- `goals/AC-151-driver-two-level-layering.md`
- `goals/AC-160-runtime-usage-inventory-blind-spot.md`
- `goals/AC-161-user-level-marketplace-only.md`
- `goals/AC-150-promotion-driver-resource-control-alignment.md`
- `goals/AC-158-execute-archive-batch-one.md`
- `goals/AC-152-filter-composable-predicate-list.md`
- `goals/AC-155-config-merge-control-state-split.md`
- `goals/AC-162-register-plugin-no-user-enabled.md`
- `goals/AC-164-plugin-namespace-takes-traffic.md`
- `goals/AC-163-allowed-tools-plugin-prefix.md`
- `goals/AC-167-baime-executor-removal.md`
- `goals/AC-154-claude-code-profile-separation.md`
- `goals/AC-157-archive-mechanism-exclusion-wiring.md`
- `goals/AC-169-delivery-surface-doc-sync.md`
- `goals/AC-153-invariant-single-impl-not-evaluated.md`
- `goals/AC-168-quay-init-contract-closed-set.md`
- `goals/AC-165-remove-root-mcp-json.md`
- `goals/AC-166-second-copy-retirement.md`
- `tasks/gap-goal-ac-boilerplate-misquotes-spec-as-license-for-empty-criterion.md`