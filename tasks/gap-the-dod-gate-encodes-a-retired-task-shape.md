---
id: gap-the-dod-gate-encodes-a-retired-task-shape
title: "The DoD gate requires a ## Plan section that ADR-022 replaced with ## Contract — it fails quay's own current tasks and blocks meta-cc's cold start"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者在回收 tmpfs 内存时捡回一份 07-29 写的 **ADR-001**（`status: accepted`，已救到 meta-cc 的
`milestones/meta-cc/DIR-066` 分支，提交 `4328a076`）：**dod 闸应按模板形状分派**——
finding 型任务无 Plan 段，不该走里程碑严格契约。它自称已在 `quay-native` 实现，但：

- `git log -S 'Finding' -- packages/quay-native/src/store.ts` ⇒ **0 个提交**
- 正控制 `git log -S 'artifactSections' -- …` ⇒ **1 个提交**（查法有效）
- 提交 `9f4a80f3` 的信息里写着 `Discarded unrelated concurrent DIR-066 changes to packages/quay-native`

**⇒ 实现被另一个并发里程碑当无关变更丢了，而 ADR 自己也从没提交** ——
两条线索同时缺失，**五天无人发现**。外层已独立复现该 `-S` 对照，查法与结论都成立。

### 外层实测：规模比 ADR 知道的大得多

ADR 的判断（**该分派，不该一刀切**）是对的，**但它对「有哪些形状」的认知已经过期**。
`artifactSections` 要求 `proposal / plan / ac / dod` 四段齐全，`allArtifactsPresent` 是无条件 `every()`。
而 **ADR-022（2026-08-03）用 `## Contract` 取代了 `## Plan`**。实测：

```
node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check \
  gap-liveness-mounting-is-a-single-flight-role-with-no-owner
  → FAIL — missing artifacts: plan
```

**这是 quay 自己今天写的任务，用的是本仓当前的规定格式。** 分布：

| | 数量 |
|---|---|
| 有 `## Plan`（经典环格式） | 387 |
| 有 `## Contract`（快速模式格式） | 40 |
| 任务总数 | 620 |

**⇒ 这不是「meta-cc 用了别的模板」，是闸编码了一个已退休的形状。**
快速模式根本不调 `task check`，所以这个闸在 quay 里是**死代码**——
**只有真去跑它的人（meta-cc 冷启动）才会撞上**，于是五天没人发现。

**⇒ 若照 ADR 原文直接实现（只给 finding 型开口子），meta-cc 会通，
而 quay 自己那 40 个 Contract 格式的任务仍然全红。**

### 代价（meta-cc 侧，管理者实测）

`taskCheck` 对每个任务要求 `allArtifactsPresent`，而 meta-cc 用 DIR 模板 ⇒
**20 次 dod 失败对 3 次通过，任务靠绕过闸达到 `ready`**。

**「靠绕过达到 ready」是本条最重的证据**：一个被例行绕过的闸比没有闸更糟——
它让「过了闸」这句话失去意义，并且训练所有人把绕过当成正常流程。

## Contract

```
measure gate_fail_by_shape = `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check <id>` 对每种形状的失败数字段
measure bypass_count = `grep -c 'status: ready' tasks/*.md` 中未经闸而 ready 的任务数字段
band gate_fail_by_shape = 0 对每一种已注册形状的合规任务
invariant 分派 ≠ 豁免：每种形状有自己**完整**的契约，未知形状必须 fail-closed
invoke `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check <id>`
control 声明某形状但缺该形状自己的必需段 ⇒ 必须红；未知形状 ⇒ 必须红（不得落入宽松分支）
resume 先把形状集合与各自的必需段定死并注册，再改 check
```

## Chosen mechanism

**外层裁定：实现，但不按 ADR 原文实现。** 三条约束，第 2、3 条是 ADR 未覆盖的：

1. **分派而不是豁免**（ADR 原意，保留）：按形状选择契约，而不是给某些形状少检查几项。
2. **每种形状的契约必须是完整的，且在自己的量纲上同样严**（**外层新增**）：
   Contract 形状必须要求 `## Contract` **六键齐全**（measure/band/invariant/invoke/control/resume）——
   **这比一段散文 Plan 更可机械检查，不是更宽松**。
   **ADR 原文只说了「不该要求什么」，没说「该要求什么」**；按那样实现，
   分派就变成一个换了名字的绕过通道。
3. **未知形状 fail-closed**（**外层新增**）：`type:` 不在注册表里 ⇒ 直接红，
   **绝不落入最宽松的分支**。否则「挑一个模板」就成了新的绕过方式。
4. **形状注册表是单一真源**：形状 → 必需段的映射集中一处、可被测试直接 import，
   不散落在 `has("Plan")` 这类字面判断里。

**不做**：不放宽任何现有形状的严格度；不给 `task check` 加 `--force`/`--skip` 之类的旁路
（**本条的立案理由正是「绕过」**，再加一个官方旁路是自相矛盾）；
不批量重写 387 个 Plan 格式的历史任务（它们对经典形状仍然合规）。

## Acceptance Criteria

- [ ] AC1: **形状注册表落地**——形状 → 必需段映射集中一处、可被测试直接 `import`
- [ ] AC2: **Contract 形状通过**——quay 当前格式任务（如本任务自己）`task check` ⇒ **PASS**（实跑贴出）
- [ ] AC3: **Plan 形状仍通过**——任取 3 个 387 个中的历史任务 ⇒ **PASS**，未被本次改动打破（实跑贴出）
- [ ] AC4: **负控制一（缺段必红）**——声明 Contract 形状但 `## Contract` 缺键 ⇒ **红**，
      且失败信息点名缺哪一键（实跑贴出）
- [ ] AC5: **负控制二（未知形状必红）**——`type: 不存在的形状` ⇒ **红**，
      **不得落入任何宽松分支**（实跑贴出）。**这条不过，AC2 不算数**
- [ ] AC6: **meta-cc 方向验证**——用 DIR 模板的任务 `task check` ⇒ PASS，
      且**不是靠绕过**（实跑贴出，并记录改动前后的 dod 失败/通过计数对照 20:3）
- [ ] AC7: **绕过计数归零**——改动后不再需要绕过闸即可达到 `ready`（实测数字贴出）
- [ ] AC8: 测试用 `node:test` 且带 `// @test-group product`（`task check` 是用户可见契约）

## Definition of Done

- [ ] AC4 与 AC5 两条负控制的实跑输出都贴进任务体——
      **只证明「合规的能过」而不证明「不合规的过不去」，就是把一刀切换成一个更好听的绕过**
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录本次的根因链：**实现被并发里程碑当无关变更丢弃（`9f4a80f3`）+ ADR 自己从未提交
      ⇒ 两条线索同时缺失 ⇒ 五天无人发现**。**一个决定若只活在一份未提交的文件里，它等于不存在。**

## Touches

- packages/quay-native/src/store.ts
- packages/quay-native/test/gate-correctness.test.mjs
- adr/

## Dispatch review

reviewer: outer
at: 2026-08-03T22:55:00Z
changed: 管理者把这条**产品裁定**交给外层，明说自己不动。**外层裁定：实现。**
理由不是 ADR 说了算，而是**外层独立实测把规模改写了**：
`task check` 对 **quay 自己今天写的、用本仓当前规定格式的任务**返回
`FAIL — missing artifacts: plan`；全仓 387 个 Plan 格式 / 40 个 Contract 格式 / 620 总数。
**⇒ 这不是「meta-cc 用了别的模板」，是闸编码了 ADR-022 已退休的形状**；
快速模式不调 `task check`，所以它在 quay 里是死代码，**只有真去跑它的人才会撞上**。
**⇒ 照 ADR 原文只给 finding 型开口子，meta-cc 会通而 quay 自己那 40 个仍全红。**
**外层加了两条 ADR 未覆盖的约束，它们是本任务的真判据**：
**其一，每种形状的契约必须完整且同样严**——Contract 形状要求六键齐全，
**比散文 Plan 更可机械检查**；ADR 原文只说了「不该要求什么」，
**按那样实现，分派就是一个换了名字的绕过通道**。
**其二，未知形状 fail-closed**——否则「挑一个模板」成为新的绕过方式。
**并预先堵死一条最省事的错误修法**：不许给 `task check` 加 `--force`/`--skip`——
**本条的立案理由正是「靠绕过达到 ready」，再加一个官方旁路是自相矛盾**。
**AC5 不过则 AC2 不算数**：只证明合规的能过，不证明不合规的过不去，等于换了个好听的名字继续绕。
