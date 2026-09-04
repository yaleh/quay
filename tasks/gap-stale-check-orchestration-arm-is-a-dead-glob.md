---
id: gap-stale-check-orchestration-arm-is-a-dead-glob
title: "the strategic-doc-staleness-check's orchestration arm is a DEAD GLOB —
  it scans orchestration/*ROADMAP*.md but orchestration/ has 43 .md files and
  ZERO match *ROADMAP* (the real roadmap is in docs/proposals/, covered by the
  first arm); the naming convention is
  SPEC-/SYNTHESIS-/FINDING-/uppercase-phrase (outer-phase-goal.md,
  manager-phase-goal.md, the two loop tick docs, tonight's
  SPEC-*/SYNTHESIS-*/FINDING-* — the most strategic files), so the arm has NEVER
  matched anything since it was written; generator question: the stale criterion
  quantifies WHICH instances? the one filename it was written thinking about;
  fix: cover orchestration/*.md entirely (or derive by prefix), don't hardcode a
  single filename pattern"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者把生成器系统性跑在常驻判据上（2026-08-05，16 静态检查器 + 14 gate-scripts）——**缺口一：陈旧检查的
orchestration 臂是一条死 glob**。**不是被硌出来的**（所有检查当时都绿，照生成器问句逐条问出）。

**实测**：`strategic-doc-staleness-check.ts` 的扫描范围是 `docs/proposals/*.md` + `orchestration/*ROADMAP*.md`。
`orchestration/` 下有 **43 个 .md**，匹配 `*ROADMAP*` 的是 **0 个**——真正的 roadmap 在
`docs/proposals/quay-harness-crystallization-roadmap.md`，已被第一条臂覆盖。⇒ **第二条臂【从来没有匹配过
任何文件】**，而 orchestration/ 下那 43 个恰恰是本仓最战略性的一批：`outer-phase-goal.md`、
`manager-phase-goal.md`、两个 loop tick 文档、今晚新增的 `SPEC-*/SYNTHESIS-*/FINDING-*`。

**命名约定是 SPEC-/SYNTHESIS-/FINDING-/大写短语，glob 写的是 *ROADMAP*，两者从一开始就对不上。**

**生成器问句**：陈旧判据量化的是【哪些实例】？答案是「写它时想到的那一个文件名」。

### 选定机制（外层裁定：立案）

**扫描范围改为覆盖 orchestration/*.md 全量（或按前缀派生）**，不再硬编码单个文件名模式：

1. `strategic-doc-staleness-check.ts` 的 orchestration 臂改为 `orchestration/*.md` 全量（或按
   SPEC-/SYNTHESIS-/FINDING- 前缀派生），覆盖那 43 个战略性文档。
2. 死 glob 消除——第二条臂从「从未匹配」变「全量覆盖」。
3. **AC10 记账**：本条 pre-friction（照问句主动问出，无失败/告警），计入 AC10（管理者 1 → 3）。

## Acceptance Criteria

- [x] AC1: `strategic-doc-staleness-check.ts` orchestration 臂覆盖 `orchestration/*.md` 全量（或前缀
      派生），不再硬编码 `*ROADMAP*`；43 个文档全被扫描
- [x] AC2: **死 glob 消除**——第二条臂从 0 匹配变全量（fixture：orchestration/ 下任一 SPEC-*/FINDING-*
      被扫描）
- [x] AC3: 现有 docs/proposals 臂不变（路线图仍覆盖）
- [x] AC4: **AC10 诚实记账**——本条 pre-friction（照问句主动问出），计入 AC10（管理者 1→3）
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`

### 实跑证据（2026-08-05，worktree `gap-stale-check-orchestration-arm-is-a-dead-glob`）

AC2/AC4 实跑输出：

```text
$ node --no-warnings --experimental-strip-types plugin/scripts/strategic-doc-staleness-check.ts --root . --json
{
  "mode": "strategic-docs",
  "scanned": 88,               # 44 docs/proposals + 44 orchestration（此前 44 = 44 + 0）
  "stale_refs_found": 0,       # 无新增陈旧引用
  "known_stale_docs": [ ... 6 docs/proposals + 3 orchestration: FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md, escalations.md, tick-log.md ... ],
  "ok": true
}
```

死 glob 消除（fixture）：`orchestration/SPEC-foo.md` 含 `prepare-milestone.js` 过期引用 ⇒ 退出码 1 被检出
（`plugin/test/strategic-doc-staleness-check.test.mjs` 的 AC2 用例）。

AC4 记账：`tasks/gap-axis-generator-question-what-range-every-standing-criterion.md` 已加
`gap-stale-check-orchestration-arm-is-a-dead-glob` cross-mark（count-3 pre-friction "dead-glob"，照问句
问出；镜像既有 gate-scripts-dead cross-mark，仅记账引用）。

范围化验证（scoped，exit 0）：

```text
$ bash scripts/test.sh --for-task gap-stale-check-orchestration-arm-is-a-dead-glob --allow-thin
scoped static checks: test-framework-policy PASS; test-isolation PASS; task-contract-check: no violations
ℹ tests 10  ℹ pass 10  ℹ fail 0  ℹ cancelled 0  (exit 0)
```

## Definition of Done

- [x] AC1–AC5 全部勾上；AC2/AC4 实跑输出贴任务体
- [x] orchestration 臂全量覆盖（43 个文档可被扫描）；死 glob 消除
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-stale-check-orchestration-arm-is-a-dead-glob.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/strategic-doc-staleness-check.ts（orchestration 臂：*ROADMAP* → *.md 全量/前缀派生）
- plugin/test/strategic-doc-staleness-check.test.mjs（AC2 fixture）
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（AC4 记账引用）

## Contract

measure   orchestration_arm_coverage = `grep -c 'orchestration/' plugin/scripts/strategic-doc-staleness-check.ts` stdout 数字段
band      orchestration_arm_coverage >= 1（arm 覆盖 orchestration/*.md，非 *ROADMAP*）
invariant no_dead_glob = 1（扫描范围能实际匹配文件，非 0 匹配）
invoke    `node --experimental-strip-types plugin/scripts/strategic-doc-staleness-check.ts --root .`
control   构造 orchestration/SPEC-*.md 含过期引用 ⇒ 必须检出（死 glob 消除后）；docs/proposals 仍覆盖
resume    扫描范围修正与 fixture 分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T07:3xZ
changed: 外层受管理者生成器系统性跑测裁定立案（缺口一）。四处收紧：
(1) **死 glob 实测**——orchestration/*ROADMAP* 0 匹配，43 个战略性文档从未被扫（命名约定 SPEC-/SYNTHESIS-
    /FINDING- 从一开始就对不上）；
(2) **修复 = 全量/前缀派生**——不再硬编码单个文件名模式；
(3) **生成器问句反推**——陈旧判据量化「写它时想到的那个文件名」；
(4) **AC10 记账**——pre-friction（照问句主动问出），计入 1→3。
status: todo——常驻判据自身缺陷；排 ROUND 3 收尾后。
