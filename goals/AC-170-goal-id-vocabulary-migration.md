---
id: AC-170
title: G1 词表与 id 改造落地——GOAL-001 记录可被机器读到
status: achieved
kind: criterion
goal: GOAL-001
criterion: |
  node packages/quay/src/goal-store.ts get GOAL-001 >/dev/null 2>&1
expect: exit 0
origin: |
  人 2026-09-06 裁定「PHASE-NNN → GOAL-NNN 照做」。
  立条依据：goal-store.ts:48 PHASE_ID_RE 不匹配 GOAL-001，list() (:168) 只收
  PHASE-/AC- 前缀文件 ⇒ 本 GOAL 自己的记录当前被静默跳过。
evidence:
  at: 2026-09-06T23:25:17.590Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：`node packages/quay/src/goal-store.ts get GOAL-001` 退出码为 0。

**取假**：**今天必假**。`assertSafeId`（`goal-store.ts:116-123`）对 `GOAL-001` 抛
`invalid goal id ... must match PHASE-NNN or AC-NNN`，退出码非 0。

**⊢ 这条是 bootstrap 的第一环**：本 GOAL 的第一条判据，是让承载本 GOAL 的记录变得可读。
在它达成之前，`GOAL-001` 及其 AC 只能人工驱动。

**改动面**（规格 §2）：`goal-store.ts:48` `PHASE_ID_RE` → `GOAL_ID_RE`；`:102` `isPhaseId`；
`:168` list 前缀过滤；`:180-189` `activePhases`/`listActive`；`:192-206` `isPhaseAchieved`/checker；
`:238-245` PHASE-criterion 拒绝；`:260` kind 派生（`phase` → `goal`）；
`:54,261,270-272` `phase:` 字段 → `goal:`；`:46` 状态词表加 `draft`；
`:258` 默认 status 由 `active` 改为 `draft`；`:53-56` `OWNED_KEYS` 加 `activatedAt`/`labels`。

**⚠️ 保号约束**：`AC-NNN` 的正则与编号**不动**（`AC_ID_RE = /^AC-\d{3,}$/` 已接受三位数）。
理由见规格 §2.1——约 20 处代码注释与 4 个测试断言现有 AC 编号。
