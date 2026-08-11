---
id: gap-prerequisite-gates-prose-invisible-to-mechanisms
title: "前置门散文化，任何机件都看不见——任务体把前置写成 prose（[[...]] wikilink + resume 前置四任务全 done），而 inner A15② 读 PARENT-DONE-IFF-CHILDREN（parent/child 边）、ready-pool author→ready 闸只验四件产物、派发前检查读依赖字段——三条路径都不看 prose 前置 ⇒ 只有 subagent 读正文才发现（代价=一个槽位空转一轮，且在 ready 池任何读数里不显形）；处方=前置落成真实关系边（parent/children 或 depends_on），author→ready 闸与派发前检查读同一字段，散文形态前置 fail-closed 晋升时即拦"
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**前置门散文化，任何机件都看不见它。任务体把前置写成 prose（`[[...]]` wikilink 列表 + `resume 前置四任务全 done 后才 dispatch`），而三条机制路径都不读 prose：inner A15② 依赖就绪检查读 `it0-split-or-commit-check.ts` 的 PARENT-DONE-IFF-CHILDREN（parent/child 关系边）；ready-pool-check 的 author→ready 闸只验四件产物齐全；派发前检查读依赖字段。三者与 prose 前置不接 ⇒ 只有 subagent 读正文才发现——代价是一个槽位空转一轮，且这类失败在 ready 池的任何读数里都不显形（它仍算 ready、算 dispatchable）。**

### 实证（manager 2026-08-11 04:4x + outer 复核）

- **实证任务**：`gap-quay-self-hosting-e2e-proof`。inner 派了它，subagent 读任务体后正确拒绝（前置 2/4 未满足：recovery-branch 零实现 + session-bootstrap 未 done，且拒绝伪造六键 true）；inner 心跳自认【我派发时没读任务体前置门】。
- **散文形态**：Proposal 里「**Do not dispatch until all four of these have landed**: `[[gap-send-keys-verified...]]`, `[[gap-retire-inner-state...]]`, `[[gap-cold-start-skill-has-no-recovery-branch]]`, `[[gap-no-formalized-bare-metal-session-bootstrap]]`」+ `resume 前置四任务全 done 后才 dispatch`。
- **边不完整**：frontmatter 只 `parent: gap-quay-has-never-self-hosted-its-own-cold-start`（四前置之一）——其余三个前置无关系边。
- **三条路径全盲**：①inner A15② 依赖就绪读 PARENT-DONE-IFF-CHILDREN ⇒ 只见 parent 边，不见另外三个 prose 前置；②ready-pool author→ready 闸只验四件产物齐全 ⇒ 不看前置；③派发前检查读依赖字段 ⇒ 与 prose 不接。**只有 subagent 读正文才发现。**
- **代价**：一个槽位空转一轮（派出去→subagent 拒绝→槽释放），且这类失败在 ready 池任何读数不显形（仍算 ready/dispatchable）。
- **这是 pool 质量第三个维度**：①待 fan-in（已合）②Touches 冲突真假不分（立案中）③前置门不可机检（本条）。

### 选定机制方向（实现归 inner，判定归 outer）

**把前置表达成机件能读的形态**——最省做法是复用已有关系字段（parent/children 或 frontmatter 的 depends_on），让 author→ready 闸与派发前检查读**同一个字段**：
1. **前置落成真实关系边**：任务的前置任务全部写进 frontmatter `parent`/`children`（或 `depends_on`），让 PARENT-DONE-IFF-CHILDREN 能看到全部前置——而不是只 parent 一个。
2. **散文前置 fail-closed**：author→ready 晋升时就拦（不认 prose 形态的前置），而不是等派发后由 subagent 拒绝。检查器扫正文里的「前置/depends on/until X lands」类 prose，若没有对应关系边 ⇒ 晋升闸拒收。
3. **保留 subagent 最后防线**：subagent 拒绝伪造六键 true 是对的（fail-closed 值得保留），但它是最后一道防线，不该是唯一一道。

**验证锚**：修后 (a) 任务前置全在 frontmatter 关系边；(b) 有 prose 前置但无边 ⇒ author→ready 晋升闸 FAIL；(c) 无边前置任务派发前被拦（不等到 subagent）；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实证（e2e-proof 四前置 prose + 边只 parent 一个 + subagent 拒绝 + 三路径全盲）（本任务 Proposal 已含）
- [ ] AC2: **前置落关系边**——任务前置全写进 frontmatter parent/children（或 depends_on），PARENT-DONE-IFF-CHILDREN 可见全部
- [ ] AC3: **散文前置 fail-closed**——author→ready 闸对 prose 前置无边 ⇒ 晋升时拒收（不等到派发）
- [ ] AC4: **既有不回归**——subagent 拒绝伪造六键的防线保留；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：构造 prose 前置无边任务 ⇒ 晋升闸 FAIL（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/ready-pool-check.ts（author→ready 闸：prose 前置无边 ⇒ 拒收）
- plugin/scripts/it0-split-or-commit-check.ts 或依赖就绪检查（PARENT-DONE-IFF-CHILDREN 覆盖全部前置）
- plugin/scripts/task-schema.ts（depends_on 字段支持，若新增）
- tasks/gap-quay-self-hosting-e2e-proof.md（实证任务：四前置落成关系边）
- tasks/gap-prerequisite-gates-prose-invisible-to-mechanisms.md（自身：勾 AC + 贴证据）

## Contract

measure   prose_prereq_blocked = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json` 对构造的 prose-前置-无边任务 的 stdout 中该任务是否在 excluded（reasons 含前置）
band      prose_prereq_blocked = true（prose 前置无边 ⇒ 晋升拒收）
invariant prereq_in_relation_edge = 1（前置任务全在 frontmatter 关系边）
invariant subagent_last_resort_kept = 1（subagent 拒绝伪造六键防线保留）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json`（贴 excluded reasons）
control   prose 前置无边拒收；关系边全在；subagent 防线保留；既有不回归
resume    关系边 / 晋升闸 / 检查器 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 04:4x——池质量第三维度：前置门散文化，三机制路径全盲（A15② 只读 parent 边 / author→ready 只验四件产物 / 派发前检查读依赖字段），只有 subagent 读正文才发现。实证 e2e-proof 四前置 prose + 边只一个。处方：前置落真实关系边 + prose 前置 fail-closed 晋升即拦。实现归 inner，判定归 outer
