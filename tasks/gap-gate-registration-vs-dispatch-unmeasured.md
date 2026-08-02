---
id: gap-gate-registration-vs-dispatch-unmeasured
title: "15 gates registered, 6 dispatched by the live Gate phase — nothing
  measures the difference"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`.quay/config.yml` registers **15 gates**. `execute-milestone.js`'s Gate phase dispatches **6**:

```
实跑：vmeta-lag · it0-dashboard-line-budget · tree-hygiene ·
      worktree-branch-hygiene · build-evidence · split-or-commit
```

注册但不在该路径上的 9 个：`impl-row`、`line-budget`（注意实跑的是 `it0-dashboard-line-budget-check.sh`，与注册的 `it0-ceiling-line-budget-check.sh` 是**不同脚本**）、`audit-independence`、`dogfood-evidence`、`drivable-workspace`、`delivery-standalone-smoke`、`anti-gaming`、`loadbearing-test`、`it0-dod-check-tests`、`ts-typecheck`。

它们可能在别处被调用——`it0-dod-check` 内部、手工 `quay gate`、CI job。**但没有任何机械证据说明哪个是哪个**，所以无法回答一个基本问题：注册了一个 gate，它到底会不会跑？

### 为什么现在做，以及为什么是「报告」而非「门禁」

exp6 scope（`docs/proposals/exp6-queue-driven-concurrent-executor.md` §0）确认交付分两阶段。**一个 gate 未被派发，在阶段 1 不等于死代码**——`delivery-standalone-smoke`、`dogfood-evidence` 这类是产品交付度量，阶段 2 才启用。

所以这个机制**报告事实，不做判决**。判决需要人看着两阶段的上下文做。做成阻塞门禁会在阶段 1 误杀阶段 2 要用的东西——正是 ADR-021 原则 1 警告的「在模糊信号上加硬门禁」。

## Chosen mechanism

`experiments/quay-perpetual-stream/scripts/gate-dispatch-coverage.ts`（`plugin/scripts/` 符号链接镜像，遵循既有约定）：

1. 解析 `.quay/config.yml` 的 `gates:` 段，得到注册集（名称 → script/command）
2. 静态扫描派发面，得到被引用集：
   - `.claude/workflows/*.js` 与 `plugin/workflows/*.js`（Gate 阶段与其它阶段的 shell 调用）
   - `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts`（clause 内 shell-out）
   - `.github/workflows/*.yml`（CI job）
   - `experiments/quay-perpetual-stream/OUTER-LOOP.md`
3. 对每个注册 gate 输出：`dispatched-by`（引用点列表）或 `no-known-dispatcher`
4. 反向也报：**被派发但未注册**的脚本（`it0-dashboard-line-budget-check.sh` 目前就是这一类——实跑但注册的是另一个名字）
5. `--json` 输出机器可读；**恒定退出 0**

**不做**：不判定「死代码」，不删除，不阻塞。输出是一张待人工判读的表。

## Acceptance Criteria

- [x] AC1: `gate-dispatch-coverage.ts` 存在，`plugin/scripts/` 为真文件、`experiments/` 为符号链接（既有约定）
- [x] AC2: 解析 `.quay/config.yml` 得到全部 15 个注册 gate（数量可断言）——实况 16 个 name→script/command gate（含 `enforcement-with-design`），fixture 测试断言解析自配置的数量
- [x] AC3: 扫描 4 类派发面并对每个 gate 输出 `dispatched-by` 引用点（文件:行）
- [x] AC4: 无已知派发者的 gate 报 `no-known-dispatcher`，不报「dead」
- [x] AC5: 反向检测——被派发但未注册的脚本被列出（`it0-dashboard-line-budget-check.sh` 是已知实例，可作 fixture）
- [x] AC6: 注册名与实跑脚本不一致的情况被识别（`line-budget` 注册 `it0-ceiling-...` 但实跑 `it0-dashboard-...`）
- [x] AC7: `--json` 输出 `{registered:[{name,script,dispatchedBy:[...]}], undispatched:[...], unregistered:[...]}`
- [x] AC8: 恒定退出 0——grep 确认无非零 exit 路径
- [x] AC9: 零写入——grep 确认无 `writeFile`/`appendFile`
- [x] AC10: 对当前仓库跑一次，输出提交到任务体作为阶段 1 基线

## Definition of Done

- [x] 双镜像（真文件 + 符号链接），fixture 测试覆盖 AC2–AC6
- [x] 对真实仓库的一次运行输出记录在任务体
- [x] 测试带 `// @test-group engine` 声明（依赖 [[gap-test-suite-has-no-layer-grouping]]，若该任务未落地则用缺省）——依赖未落地，用缺省（plugin/test 现有文件均无 @test-group 标注）

## Implemented (B3-1 fast-mode batch 2)

**Deliverables** (`/home/yale/work/quay` on branch `task/gap-gate-registration-vs-dispatch-unmeasured`):

- `plugin/scripts/gate-dispatch-coverage.ts` — REPORT tool (real file; zero runtime deps; zero writes AC9; constant exit 0 AC8; `--json` per AC7 + additive `mismatches` array for AC6).
- `experiments/quay-perpetual-stream/scripts/gate-dispatch-coverage.ts` — symlink → `../../../plugin/scripts/gate-dispatch-coverage.ts` (byte-identical via `cmp -s`).
- `plugin/test/gate-dispatch-coverage.test.mjs` — 9 tests covering AC1–AC6, AC8–AC10 (RED first, then GREEN).

**Behavior**: parses `.quay/config.yml` `gates:` (16 name→script/command gates + 2 ADR string entries), scans the 4 dispatch surfaces (`.claude/workflows/*.js` + `plugin/workflows/*.js`, `it0-dod-check.ts`, `.github/workflows/*.yml`, `OUTER-LOOP.md`), reports per-gate `dispatched-by` (file:line, via `script-basename` or `name` + dispatch marker) or `no-known-dispatcher`, lists reverse-direction dispatched-but-unregistered scripts, and flags registration-name vs run-script mismatches. `--json` exit-0 machine shape. Run: `node --experimental-strip-types plugin/scripts/gate-dispatch-coverage.ts [--root <dir>] [--json]`.

**Deviation from proposal prose**: the proposal says "15 gates"; the live config registers **16** name→script gates (the extra is `enforcement-with-design`, `testPass`). The tool reports the real count; the fixture test asserts the count parsed from the config (deterministic, not a hardcoded 15).

### Stage-1 baseline run (2026-08-02, against this repo's master + this branch's tool)

```
GATE-DISPATCH COVERAGE — report, not a gate, not a judge (gap-gate-registration-vs-dispatch-unmeasured)
surfaces scanned: 15 — .claude/workflows/diagnose-verify-failure.js, .claude/workflows/drain-directives.js, .claude/workflows/execute-milestone.js, .claude/workflows/prepare-milestone.js, .claude/workflows/run-routines.js, .claude/workflows/select-preflight.js, plugin/workflows/drain-directives.js, plugin/workflows/execute-milestone.js, plugin/workflows/prepare-milestone.js, plugin/workflows/run-routines.js, experiments/quay-perpetual-stream/scripts/it0-dod-check.ts, .github/workflows/ci.yml, .github/workflows/publish-plugin-dist.yml, .github/workflows/release.yml, experiments/quay-perpetual-stream/OUTER-LOOP.md
registered gates: 16  (ADR string entries, no script: 2)

── registered (name → script/command, per-gate dispatched-by) ──
impl-row  →  ./plugin/scripts/it0-impl-row-check.sh
    dispatched-by: it0-dod-check.ts:23/119/282/287/313/410 (script-basename), it0-dod-check.ts:293 (name), OUTER-LOOP.md:161 (name)
line-budget  →  ./experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh
    dispatched-by: .claude/workflows/execute-milestone.js:222 (script-basename), .claude/workflows/execute-milestone.js:937 (name), plugin/workflows/execute-milestone.js:222/937, it0-dod-check.ts:18/119/261/263/277 (script-basename), OUTER-LOOP.md:99 (script-basename), diagnose-verify-failure.js:120 (name)
vmeta-lag  →  ./plugin/scripts/vmeta-lag-check.sh
    dispatched-by: .claude/workflows/execute-milestone.js:844/935 (script-basename), :907 (name), plugin/workflows/*:844/935/907, OUTER-LOOP.md:161 (name)
audit-independence  →  ./plugin/scripts/audit-independence-check.sh
    dispatched-by: it0-dod-check.ts:58/792/808/827/854 (script-basename), OUTER-LOOP.md:162 (name)
dogfood-evidence  →  ./experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh
    dispatched-by: .claude/workflows/execute-milestone.js:226/1258/1313 (script-basename), plugin/workflows/*:226/1258/1313
drivable-workspace  →  ./plugin/scripts/drivable-workspace-check.sh
    dispatched-by: OUTER-LOOP.md:103 (name)
delivery-standalone-smoke  →  ./packages/quay/test/delivery-standalone-smoke.sh
    dispatched-by: no-known-dispatcher
anti-gaming  →  ./plugin/scripts/anti-gaming-guard.sh
    dispatched-by: no-known-dispatcher
loadbearing-test  →  ./plugin/scripts/loadbearing-test-gate.sh
    dispatched-by: no-known-dispatcher
tree-hygiene  →  ./plugin/scripts/tree-hygiene-check.sh
    dispatched-by: .claude/workflows/execute-milestone.js:436/939/1327 (script-basename), plugin/workflows/*, it0-dod-check.ts:49/739/740/748/762 (script-basename), :348 (name), OUTER-LOOP.md:162 (name), :245 (script-basename)
worktree-branch-hygiene  →  ./plugin/scripts/worktree-branch-hygiene-check.sh
    dispatched-by: .claude/workflows/execute-milestone.js:941/1327 (script-basename), plugin/workflows/*, it0-dod-check.ts:55/772/786 (script-basename), :348 (name), OUTER-LOOP.md:162 (name), :245 (script-basename)
build-evidence  →  ./plugin/scripts/build-evidence-gate.ts
    dispatched-by: .claude/workflows/execute-milestone.js:945 (script-basename), plugin/workflows/execute-milestone.js:945
it0-dod-check-tests  →  node --test experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs
    dispatched-by: no-known-dispatcher
ts-typecheck  →  for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done
    dispatched-by: no-known-dispatcher
split-or-commit  →  node plugin/scripts/it0-split-or-commit-check.ts .
    dispatched-by: .claude/workflows/execute-milestone.js:931/1161/1169/1172/1174 (name), :1155 (script-basename), plugin/workflows/*, OUTER-LOOP.md:98/280/286 (script-basename)
enforcement-with-design  →  node plugin/scripts/it0-enforcement-with-design-check.ts .
    dispatched-by: no-known-dispatcher

── undispatched (registered but no-known-dispatcher) ──
delivery-standalone-smoke  →  ./packages/quay/test/delivery-standalone-smoke.sh
anti-gaming  →  ./plugin/scripts/anti-gaming-guard.sh
loadbearing-test  →  ./plugin/scripts/loadbearing-test-gate.sh
it0-dod-check-tests  →  node --test experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs
ts-typecheck  →  for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done
enforcement-with-design  →  node plugin/scripts/it0-enforcement-with-design-check.ts .

── unregistered (dispatched but NOT registered) ── 24 entries incl.:
it0-dashboard-line-budget-check.sh  —  .claude/workflows/execute-milestone.js:937, plugin/workflows/execute-milestone.js:937   ← AC5/AC6 known instance
it0-ceiling-check.sh  —  .claude/workflows/execute-milestone.js:214, plugin/workflows/execute-milestone.js:214
it0-gate-hash-check.sh  —  .claude/workflows/execute-milestone.js:218, plugin/workflows/execute-milestone.js:218, OUTER-LOOP.md:126
it0-dod-check.sh  —  .claude/workflows/execute-milestone.js:519/850, plugin/workflows/*
it0-split-or-commit-check.sh  —  .claude/workflows/execute-milestone.js:1172, plugin/workflows/*
drivable-workspace-check.ts  —  OUTER-LOOP.md:103
build-evidence-collector.ts  —  execute-milestone.js:8/569/581 (+plugin mirror)
... (+ task-schema-check.sh, anti-drift-touches-check.ts, test-coverage-check.ts, version-consistency-check.ts,
delivery-manifest-check.ts, drain-dispose-corruption-check.ts, milestone-preparation-check.ts,
prepare-admission-check.ts, wiring-coverage-check.ts, routine-file-gate.ts, etc.)

── registration-name vs run-script mismatches ──
drivable-workspace: registered drivable-workspace-check.sh, live drivable-workspace-check.ts (wrapper-pair) — OUTER-LOOP.md:103
line-budget: registered it0-ceiling-line-budget-check.sh, live it0-dashboard-line-budget-check.sh (different-script) — .claude/workflows/execute-milestone.js:937, plugin/workflows/execute-milestone.js:937
split-or-commit: registered it0-split-or-commit-check.ts, live it0-split-or-commit-check.sh (wrapper-pair) — .claude/workflows/execute-milestone.js:1172, plugin/workflows/execute-milestone.js:1172
```

**Baseline headline**: 16 registered, 10 dispatched on the scanned surfaces, 6 `no-known-dispatcher`; `it0-dashboard-line-budget-check.sh` confirmed dispatched-but-unregistered; `line-budget` is the one `different-script` mismatch (ceiling vs dashboard), the other two are `wrapper-pair` sh/ts aliases. This is the stage-1 fact table a human reads against the two-phase exp6 context — no verdict, no deletion, no blocking.

## Touches

- plugin/scripts/gate-dispatch-coverage.ts
- experiments/quay-perpetual-stream/scripts/gate-dispatch-coverage.ts
- plugin/test/gate-dispatch-coverage.test.mjs
