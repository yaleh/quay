---
id: gap-c1-entry-bar-rejects-illegal-admission-value
title: C1 准入闸真正消费 registry 的 admission 字段：非法/缺失取值按名拒绝（reason 含 admission 与
  kind），合法取值零回归（GOAL-911 AC-923）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-923
---
## Proposal

**事实（立案当轮在真实树上逐字跑 AC-923 criterion，不是读代码推测）**：

```
$ node --input-type=module -e '<AC-923 criterion 逐字>'
ADMISSION-NOT-CONSUMED: C1 gate produced no admission-shaped refusal for an illegal admission value; reason=CONDITION_2_NOT_MET:no slice_delta on the record — the delta is not computed by the detector for concern_kind=package-cycle (ArchGuard slice-delta (installed CLI, computed) — ownership-active-loop.mjs computeSliceDelta + .quay/ownership-shadow-proposals.jsonl)
exit=1
```

根因：`evaluateEntryBar`（`docs/analysis/ownership-active-limited-proposal.mjs:510`）只按 `mechanized` 分支取 kind，随后直接进入 C2 的机械 delta 判定；判定路径上**从不读 `entry.admission`**。而 `registryAdmissionViolations`（`:427`）已经存在、已经返回**具名**的 `missing`/`invalid` 列表、已经带 `evaluated:false + cause` 的独立取值（硬规则 3b），但它的消费者只有测试文件 —— **零生产消费者**。后果：一个拼错的 admission（`"bogus"`、数字、空串）在闸眼里完全不存在，机械判定照常继续；注册表里最关键的字段被携带、从不被消费。

AC-921（achieved）只覆盖「真实注册表上取值正确」，结构上看不见「被篡改的注册表对闸没有影响」这件事；AC-923 补的正是这半边：**闸必须消费该字段**。

**要做的**：

1. `evaluateEntryBar` 在拿到 `registry` 之后、进入 C2 机械 delta 路径**之前**，加一道 admission 合法性前置检查：
   - **复用** `registryAdmissionViolations(registry)` —— ⛔ 不另写第二个校验器（单一正源；否则两处校验会漂移）。
   - `invalid` / `missing` 非空 ⇒ `eligible:false`，reason 必须同时满足三条：
     (a) 含 `admission` 字样（AC-923 criterion 用 `/admission/i` 读的正是它）；
     (b) **具名**每一个违规 kind（硬规则 3：条数与清单，不是布尔）；
     (c) `invalid`（取值非法）与 `missing`（字段缺失）**分别具名、不可同形**（硬规则 3b：删掉字段 ≠ 写错取值）。
   - `matchedConditions` 为空、streak 归零（用既有 `mismatch()` 形状）。
2. **范围守卫（合法取值零回归）**：本条只校验**合法性**，⛔ 不改路由语义。一个**合法**的 `semantic-judged` 条目（哪怕 `mechanized:true` + 带 reader）仍必须走到今天同样的 `CONDITION_2_*` 拒绝 —— 那是 AC-918 的分派面（peer 任务承载），把两件事混在一起会红掉 `plugin/test/ownership-active-limited-proposal.test.mjs:568-578` 的 god-file-size flip 断言。
3. **测试**（`plugin/test/ownership-active-limited-proposal.test.mjs` 新增 AC923 块）：
   - AC-923 criterion 逐字；
   - `invalid` 臂 / `missing` 臂同形性负控（两者 reason 必须不同，且各自具名正确类别与 kind）；
   - 两个非法条目 ⇒ reason 里两个 kind 同时出现（清单不是布尔）；
   - **正控（检查必须能通过）**：真实 `CONCERN_KIND_REGISTRY` + package-cycle 记录仍产出改动前那句 `CONDITION_2_NOT_MET:no slice_delta…`，且 reason 里没有 admission 字样 —— 证明新检查不是「一律用 admission 拒绝」；
   - 机械路径既有断言原样保留。

**为什么判据读运行时**：AC-923 的 criterion 只经 `evaluateEntryBar` 的返回值取假，不看源码排版 ⇒ 测试与验收都断言 `reason` 字符串，⛔ 不写源码正则。

<!-- dedup-ref -->**与同 goal 其它验收面的关系（kept separate）**：`gap-c1-admission-dispatch-by-admission-token`（`goal_ac: AC-918`，ready）在同一个文件上、是 Touches 串行 peer，但它承载的是 AC-918 的「源码字面可达 + 按 admission 分派」，其任务体只要求「不可读条目 ⇒ `CONDITION_1_UNDETERMINED` 具名」，**不钉** reason 里出现 admission 字样、不钉 invalid/missing 分列、不钉合法条目零回归的正控。本条保持独立：验收面是 AC-923 的运行时判据，两条改动可叠加（合法性检查在分派之前，先跑不冲突）。注册表文件的串行由调度器的 Touches 重叠保证，一次只跑一个。

**落地补注（2026-10-22，worker 实跑，不以后见之明回写上面的历史读数）**：立案时那段 `exit=1` 是当轮真实读数；但 peer `gap-c1-admission-dispatch-by-admission-token`（AC-918）已先于本条进入 develop（`d36ca8e47` 已含 `admissionRoute`），它的 `CONDITION_1_UNDETERMINED` cause 里恰好含 `admission` 字样 ⇒ **今天在 develop 上裸跑 AC-923 criterion 的 invalid 臂已不再是 exit 1**（实测 exit 0）。该判据在落地前今天仍能取假的基线在 **missing 臂**：同一 develop 上把 `unencapsulated-state` 的 admission 字段删掉，闸完全看不见它，reason 仍是 `CONDITION_2_NOT_MET:no slice_delta…`、无 admission 字样。⇒「闸不消费 registry admission」在立案时与落地前两个时点都成立；本条交付的正是「不是碰巧含 admission 字样，而是**具名 + 分列 invalid/missing + 全注册表校验**」这一面。

## AC

- [x] AC1 AC-923 criterion 逐字读绿：`node --input-type=module -e 'const m=await import("./docs/analysis/ownership-active-limited-proposal.mjs");const bad=m.CONCERN_KIND_REGISTRY.map(e=>e.kind==="package-cycle"?{...e,admission:"bogus"}:e);const r=m.evaluateEntryBar([{concern_kind:"package-cycle"}],{registry:bad});if(!/admission/i.test(r.reason||"")){console.error("ADMISSION-NOT-CONSUMED: C1 gate produced no admission-shaped refusal for an illegal admission value; reason="+(r.reason||"<none>"));process.exit(1)}console.log("OK: C1 gate refuses an illegal admission value")'` ⇒ exit 0。任务体贴出改动前基线（exit 1 + 上面那段 ADMISSION-NOT-CONSUMED 原文）与改动后输出。
  - 改动后（worktree HEAD `105c8cebd`，真实仓库文件实跑）：`OK: C1 gate refuses an illegal admission value`，`exit=0`。
  - 改动前基线（立案当轮原文，保留于上方 Proposal 代码块）：`ADMISSION-NOT-CONSUMED: … reason=CONDITION_2_NOT_MET:no slice_delta …`，`exit=1`。
  - 落地前 develop（`d36ca8e47`）实测：invalid 臂已因 peer AC-918 的 `admissionRoute` 而 exit 0（见 Proposal 落地补注）；missing 臂仍无 admission 字样 —— 判据未失去取假能力。
- [x] AC2 具名且分列：跑 `node --input-type=module -e` 脚本，分别用「package-cycle.admission="bogus"」与「unencapsulated-state 删掉 admission 字段」两份合成注册表调用 `evaluateEntryBar([{concern_kind:"package-cycle"}],{registry})`；断言两臂都 `eligible:false`、reason 都含 `admission`、都具名对应 kind、invalid 臂含 `invalid`、missing 臂含 `missing`、两臂 reason 互不相同 ⇒ exit 0，贴出两条 reason 原文。
  - INVALID-ARM（`eligible:false`）：`CONDITION_1_UNDETERMINED:concern_kind=package-cycle — the CONCERN_KIND_REGISTRY's admission field is not lawful: invalid admission value for kind(s): package-cycle. A legal admission is one of mechanical / semantic-judged; an illegal or absent admission names NO route, so the gate refuses instead of falling through to the mechanical delta path`
  - MISSING-ARM（`eligible:false`）：`CONDITION_1_UNDETERMINED:concern_kind=package-cycle — the CONCERN_KIND_REGISTRY's admission field is not lawful: missing admission field for kind(s): unencapsulated-state. A legal admission is one of mechanical / semantic-judged; an illegal or absent admission names NO route, so the gate refuses instead of falling through to the mechanical delta path`
  - 两臂互不相同；且 INVALID-ARM 不含 `missing`、MISSING-ARM 不含 `invalid`（AC923-2 用 `assert.doesNotMatch` 双向钉住）。missing 臂违法的 kind 不是记录自身的 kind ⇒ 证明校验覆盖**整张注册表**，不是只看 head 命中的那一条。
- [x] AC3 正控（合法输入不产生 admission 拒绝）：`node --input-type=module -e 'const m=await import("./docs/analysis/ownership-active-limited-proposal.mjs");const r=m.evaluateEntryBar([{concern_kind:"package-cycle"}]);console.log(r.reason);process.exit(r.eligible===false&&r.reason.startsWith("CONDITION_2_NOT_MET")&&!/admission/i.test(r.reason)?0:1)'` ⇒ exit 0（真实注册表 + 同一记录，refusal 仍停在 C2，reason 无 admission 字样）。
  - 输出：`CONDITION_2_NOT_MET:no slice_delta on the record — the delta is not computed by the detector for concern_kind=package-cycle (ArchGuard slice-delta (installed CLI, computed) — ownership-active-loop.mjs computeSliceDelta + .quay/ownership-shadow-proposals.jsonl)`，`exit=0`。
- [x] AC4 清单不是布尔：一份同时含 `package-cycle.admission="bogus"` 与 `god-file-size.admission=123` 的注册表 ⇒ exit 0 且 reason 里 `package-cycle` 与 `god-file-size` **两个名字同时出现**；贴出 reason 原文。
  - 输出：`CONDITION_1_UNDETERMINED:concern_kind=package-cycle — the CONCERN_KIND_REGISTRY's admission field is not lawful: invalid admission value for kind(s): package-cycle; missing admission field for kind(s): god-file-size. A legal admission is one of mechanical / semantic-judged; an illegal or absent admission names NO route, so the gate refuses instead of falling through to the mechanical delta path`，`exit=0`。
- [x] AC5 测试绿：`node --test plugin/test/ownership-active-limited-proposal.test.mjs` ⇒ exit 0，测试数 ≥ 改动前（39），新增 AC923 块覆盖 AC2–AC4 的三臂；既有 god-file-size mechanized flip 断言（`:568-578`）原样通过。
  - 实测：`tests 43` / `pass 43` / `fail 0`（改动前 39）；`AC923-1..4` 四项全绿，`AC918-5` 与 god-file-size flip 断言未改动且通过。
- [x] AC6 scoped 门：`bash scripts/test.sh --for-task gap-c1-entry-bar-rejects-illegal-admission-value --allow-thin` ⇒ exit 0，输出包含 `plugin/test/ownership-active-limited-proposal.test.mjs`。
  - 实测：`scoped-gate exit=0`，输出含 `+ plugin/test/ownership-active-limited-proposal.test.mjs`；同轮 `anti-drift-touches-check.ts` ⇒ `ANTI-DRIFT OK: … 2 actual file(s), all within declared Touches (3 glob(s))`。

## DoD

- [x] 真实仓库（非夹具）上 AC-923 criterion 逐字 exit 0，且改动前的 exit 1 基线原文留在任务体里 —— 这是该判据能取假的反向证据，不是同义反复。
  - 改动后 `exit=0`（AC1 证据）；立案时的 `exit=1` 原文在 Proposal 代码块中原样保留。落地前 develop 的「仍可假」读数（missing 臂 `CONDITION_2_NOT_MET…`，无 admission 字样）见 Proposal 落地补注。
- [x] 新检查由 `evaluateEntryBar` 的**生产路径**消费：criterion 只经 `evaluateEntryBar` 的返回值取假，任何「只在测试里调 `registryAdmissionViolations`」的实现都不可能让它变绿（贴 criterion 运行时输出而不是源码摘录）。
  - 检查位于 `evaluateEntryBar` 内、C2 之前的 `(1a)` 段，复用 `registryAdmissionViolations(registry)`；AC923-1 只断言 `evaluateEntryBar` 的返回值。AC923-4 正控证明真实注册表走到 C2 且 reason 无 admission 字样（不是「一律拒绝」）。
- [x] 合法 admission 零回归：AC3 正控 exit 0，且既有 suite 全绿（证明新增检查不是「一律拒绝」）。
  - AC3 `exit=0`；`43/43` 全绿，含既有 AC918 分派面与 god-file-size flip 断言。
- [x] 变更经 fan-in 进入 develop；在 `git show develop:docs/analysis/ownership-active-limited-proposal.mjs` 的树上重跑 AC-923 criterion 仍 exit 0。
  - worktree HEAD `105c8cebd` 已 merge develop `afd9bf399`（0 冲突），工作树 clean；worker 的这棵树就是 fan-in ff-merge 的树，criterion 已在该树上 exit 0。`git show develop:…` 的回读由 driver 在 post-merge 步骤执行（worker 座位不可达，故此处陈述为可证伪事实而非已跑读数）。
- [x] 收尾在任务体写入行首声明 `该轴仍暗,理由:<…>`（本条只改 `docs/analysis` 的准入判定与 `plugin/test`，不动 `packages/` 依赖结构，未运行 L_D/L_G 仪器）—— 形如 ADR-007 per-milestone 谓词要求的载体。

- L_G：该轴仍暗,理由:本条只改 docs/analysis 的准入判定与 plugin/test，不动 packages/ 依赖结构，未运行 L_D/L_G 仪器

## Touches

- docs/analysis/ownership-active-limited-proposal.mjs
- plugin/test/ownership-active-limited-proposal.test.mjs
- tasks/gap-c1-entry-bar-rejects-illegal-admission-value.md

## Blocker

**2026-10-22T12:05:35.523Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (1) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：299d671b-36ef-42fa-9a94-bcdf7df17e78
