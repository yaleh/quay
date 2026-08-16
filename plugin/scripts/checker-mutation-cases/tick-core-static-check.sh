#!/usr/bin/env bash
# Mutation case for tick-core-static-check (gap-tick-core-zero-static-coverage, AC2-AC7).
# The checker's five gates — the 2026-08-10 incidents were ALL hand-found with wc -l / grep, zero
# mechanical gate:
#   AC3 — each core's A/B/C items carry (src:N) back-references to the reason archive
#         (AC30(a) measure = coverage, target 100%; an item without (src:N) reddens —
#         the ≤80-line criterion was RETIRED 2026-08-10, manager-phase-goal.md:324).
#   AC4 — every pointer target a core references must exist.
#   AC5 — the B3 group numbering (甲乙丙丁戊) must not collide with the criteria numbering (①-⑤).
#   AC6 — an UNCONDITIONAL prohibition ("外层不直接改代码", no 收窄/单一写入者/共享树) contradicting
#         the cores' run_in_background dispatch must redden.
#   AC8 — AC60 通则③ three-layer coverage-denominator dead-exclusion: a dead/frozen-annotated item
#         without the "不计入覆盖率分母" marker stays in the denominator and MUST redden.
# Fixture: a minimal 3-core + 4-prohibition-doc baseline → GREEN.
# Inject #1: an orchestrator core item WITHOUT (src:N) → RED (AC3 coverage < 100%).
# Restore → GREEN. Inject #2: an unconditional prohibition doc → RED (AC6). Restore → GREEN.
# Inject #3: a dead-annotated item WITHOUT the exclusion marker → RED (AC8). Restore → GREEN.
set -u
name="tick-core-static-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="${workdir}/root"
mkdir -p "${root}/orchestration"

write() { # <rel> <content...>
  local rel="$1"; shift
  mkdir -p "$(dirname "${root}/${rel}")"
  printf '%s\n' "$@" > "${root}/${rel}"
}

# Minimal baseline: all four criteria PASS.
write orchestration/manager-tick-core.md \
  '# manager tick — 执行核' \
  '## A. 读数' \
  '| A1 | 读 `.quay/manager-inbox/` | 目录非空即进决策 (src:1) |' \
  '## B. 产出' \
  '- **B3 tick-log**:本组一律写 `甲乙丙丁戊`,禁用 ①-⑤。`no-action` 需举证——甲`a`;乙`b`;丙`c`;丁`d`;戊`e` (src:1)。' \
  '## C. 约束' \
  '| C1 | 约束一 (src:1) |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
write orchestration/orchestrator-tick-core.md \
  '# outer tick — 执行核' \
  '## A. 读数' \
  '| A1 | 读 `.quay/full-suite-state.json` | green⇒suiteGreen (src:1) |' \
  '## B. 产出' \
  '- **B1** 收尾 pass (src:1)。' \
  '## C. 约束' \
  '| C1 | 约束一 (src:1) |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
write orchestration/fast-mode-tick-core.md \
  '# inner (fast-mode) tick — 执行核' \
  '## A. 每轮必跑' \
  '| A1 | `.halt` 哨兵 | 存在 ⇒ 空转 (src:1) |' \
  '## B. 每轮必产出' \
  '- **B1** 写回队列文件 (src:1)。' \
  '## C. 硬约束' \
  '| C1 | 派发形态必须 `Agent(run_in_background: true)` (src:1) |' \
  '## D. 边界' \
  '一律停下等人。'
write orchestration/outer-brief-2026-08-04-third-restart.md \
  '# outer 简报' \
  '## 边界' \
  '你是**外层**——不要自己用 `Agent` 派发实现工作到共享树。**收窄（2026-08-10，理由=单一写入者/共享树）**：外层可在自己的 worktree 里执行基础设施动作。'
write orchestration/QUAY-OUTER-HANDOFF.md \
  '# 交接' \
  '## 不可协商的规则' \
  '1. **外层不直接改【共享检出】的代码**——你下指令，内层执行。（**收窄 2026-08-10，理由=单一写入者/共享树**）'
write orchestration/exp6-phase1-sustained-unattended-operation.md \
  '# exp6 阶段 1' \
  '| 3 | **外层不直接改【共享检出】的代码**。**收窄（2026-08-10，理由=单一写入者/共享树）** | 单一写入者 |'
write orchestration/orchestrator-loop-tick.md \
  '# 外层编排 loop tick 指令' \
  '**外层不直接改代码**——它下指令，内层执行。理由：保持单一写入者。'

# The shipped tick-doc surface for the --check-drift baseline:
#   - orchestrator/fast-mode tick-core copies are byte-identical to the orchestration cores above
#     (gap-tick-core-drift-check-not-in-suite AC3 — a REAL copy must match its source);
#   - the manager tick docs are POINTERS (one line → orchestration/ 正本) — NOT copies
#     (gap-plugin-loop-manager-drifted-copies-pointerize AC2/AC3 — "该路径无内容可维护").
# The manager 正本s are the orchestration/ files written above (manager-tick-core) plus the
# manager-loop-tick 正本 written below; the shipped manager files are small pointers that
# reference them.
write plugin/loop/manager-tick-core.md \
  '> 正本: orchestration/manager-tick-core.md — 本文件只应存在这一行指针；执行核内容一律读正本。'
write plugin/loop/orchestrator-tick-core.md \
  '# outer tick — 执行核' \
  '## A. 读数' \
  '| A1 | 读 `.quay/full-suite-state.json` | green⇒suiteGreen (src:1) |' \
  '## B. 产出' \
  '- **B1** 收尾 pass (src:1)。' \
  '## C. 约束' \
  '| C1 | 约束一 (src:1) |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
write plugin/loop/fast-mode-tick-core.md \
  '# inner (fast-mode) tick — 执行核' \
  '> 落地副本：引用消费方铺出源 `docs/analysis/fast-mode-loop-tick.md`（quay-init --loop 铺出、非 byte-identical）——语义同步。' \
  '## A. 每轮必跑' \
  '| A1 | `.halt` 哨兵 | 存在 ⇒ 空转 (src:1) |' \
  '## B. 每轮必产出' \
  '- **B1** 写回队列文件 (src:1)。' \
  '## C. 硬约束' \
  '| C1 | 派发形态必须 `Agent(run_in_background: true)` (src:1) |' \
  '## D. 边界' \
  '一律停下等人。'
# manager-loop-tick 正本 + shipped pointer (the pair that was structurally invisible under the old
# tick-CORE-only pairing — AC2 makes it a falsifiable pointer check).
write orchestration/manager-loop-tick.md \
  '# manager loop tick 正本' \
  '## A. 读数' \
  '| A1 | 读 `.quay/manager-inbox/` | 目录非空即进决策 (src:1) |'
write plugin/loop/manager-loop-tick.md \
  '> 正本: orchestration/manager-loop-tick.md — 本文件只应存在这一行指针；内容一律读正本。'

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/tick-core-static-check.ts" --root "${root}" >/dev/null 2>&1
}

drift_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/tick-core-static-check.ts" --check-drift --root "${root}" >/dev/null 2>&1
}

# GREEN baseline: the minimal surface passes all four criteria.
if checker_cmd; then :; else
  echo "baseline RED on a clean minimal surface (checker always-red?)" >&2
  exit 4
fi

# INJECT #1 (AC3): an orchestrator core item WITHOUT (src:N) → coverage < 100% → RED.
write orchestration/orchestrator-tick-core.md \
  '# outer tick — 执行核' \
  '## A. 读数' \
  '| A1 | 读 `.quay/full-suite-state.json` | green⇒suiteGreen |' \
  '## B. 产出' \
  '- **B1** 收尾 pass (src:1)。' \
  '## C. 约束' \
  '| C1 | 约束一 (src:1) |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
if checker_cmd; then
  echo "STAYED-GREEN — an item without (src:N) did not redden the checker" >&2
  exit 3
fi
# RESTORE #1.
write orchestration/orchestrator-tick-core.md \
  '# outer tick — 执行核' \
  '## A. 读数' \
  '| A1 | 读 `.quay/full-suite-state.json` | green⇒suiteGreen (src:1) |' \
  '## B. 产出' \
  '- **B1** 收尾 pass (src:1)。' \
  '## C. 约束' \
  '| C1 | 约束一 (src:1) |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored (src:N-carrying) core still reddens the checker" >&2
  exit 4
fi

# INJECT #2 (AC6): an UNCONDITIONAL prohibition (no 收窄/单一写入者/共享树) while a core uses
# run_in_background → the checker MUST go RED.
write orchestration/QUAY-OUTER-HANDOFF.md \
  '# 交接' \
  '1. **外层不直接改代码**——下指令，内层执行。'
if checker_cmd; then
  echo "STAYED-GREEN — an unconditional prohibition did not redden the checker" >&2
  exit 3
fi
# RESTORE #2.
write orchestration/QUAY-OUTER-HANDOFF.md \
  '# 交接' \
  '## 不可协商的规则' \
  '1. **外层不直接改【共享检出】的代码**——你下指令，内层执行。（**收窄 2026-08-10，理由=单一写入者/共享树**）'
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored (narrowed) prohibition still reddens the checker" >&2
  exit 4
fi

# INJECT #3 (AC8, gap-ac60-coverage-denominator-excludes-dead-prereqs): a dead-annotated item
# WITHOUT the denominator-exclusion marker (前提已死 but no 不计入覆盖率分母 on the same line) → the
# coverage denominator still counts a dead item → the checker MUST go RED (AC3 negative control).
write orchestration/manager-tick-core.md \
  '# manager tick — 执行核' \
  '## A. 读数' \
  '| A1 | 读 `.quay/manager-inbox/` | 目录非空即进决策 (src:1) |' \
  '| A7 | **前提已死** | 不能执行 (src:1) |' \
  '## B. 产出' \
  '- **B3 tick-log**:本组一律写 `甲乙丙丁戊`,禁用 ①-⑤。`no-action` 需举证——甲`a`;乙`b`;丙`c`;丁`d`;戊`e` (src:1)。' \
  '## C. 约束' \
  '| C1 | 约束一 (src:1) |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
if checker_cmd; then
  echo "STAYED-GREEN — a dead-annotated item still counted in the denominator did not redden the checker" >&2
  exit 3
fi
# RESTORE #3 → GREEN.
write orchestration/manager-tick-core.md \
  '# manager tick — 执行核' \
  '## A. 读数' \
  '| A1 | 读 `.quay/manager-inbox/` | 目录非空即进决策 (src:1) |' \
  '## B. 产出' \
  '- **B3 tick-log**:本组一律写 `甲乙丙丁戊`,禁用 ①-⑤。`no-action` 需举证——甲`a`;乙`b`;丙`c`;丁`d`;戊`e` (src:1)。' \
  '## C. 约束' \
  '| C1 | 约束一 (src:1) |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored (no dead item) core still reddens the checker" >&2
  exit 4
fi

# INJECT #4 (gap-tick-core-drift-check-not-in-suite): the DRIFT mode. The plugin/loop/ shipped
# copies are byte-identical to orchestration/ → --check-drift GREEN baseline; a single edited
# shipped copy MUST redden the drift gate.
if drift_cmd; then :; else
  echo "baseline RED on matching shipped copies (drift check always-red?)" >&2
  exit 4
fi
# Modify ONE shipped copy (add a line the orchestration/ core lacks) → the pair drifts → RED.
write plugin/loop/orchestrator-tick-core.md \
  '# outer tick — 执行核' \
  '## A. 读数' \
  '| A1 | 读 `.quay/full-suite-state.json` | green⇒suiteGreen (src:1) |' \
  '| A2 | 读 `.quay/loop-state.json` | 状态必读 (src:1) |' \
  '## B. 产出' \
  '- **B1** 收尾 pass (src:1)。' \
  '## C. 约束' \
  '| C1 | 约束一 (src:1) |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
if drift_cmd; then
  echo "STAYED-GREEN — a drifted shipped copy did not redden the drift check" >&2
  exit 3
fi
# RESTORE #3 → drift GREEN again.
write plugin/loop/orchestrator-tick-core.md \
  '# outer tick — 执行核' \
  '## A. 读数' \
  '| A1 | 读 `.quay/full-suite-state.json` | green⇒suiteGreen (src:1) |' \
  '## B. 产出' \
  '- **B1** 收尾 pass (src:1)。' \
  '## C. 约束' \
  '| C1 | 约束一 (src:1) |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
if drift_cmd; then :; else
  echo "ALWAYS-RED — restored (matching) shipped copy still reddens the drift check" >&2
  exit 4
fi

# INJECT #5 (gap-plugin-loop-manager-drifted-copies-pointerize AC2): a REINTRODUCED manager copy —
# a large shipped manager file that is not a small pointer — MUST redden the drift gate (the
# manager-loop-tick 2321-line drift was structurally invisible under the old tick-CORE-only
# pairing; the pointer criterion makes it falsifiable). A byte-perfect copy would ALSO redden
# (the criterion is "must be a pointer", not "must match the source").
write plugin/loop/manager-loop-tick.md \
  '# manager loop tick 指令（重新复制的旧副本）' \
  '## A. 读数' \
  '| A1 | 读 `.quay/manager-inbox/` | 目录非空即进决策 |' \
  '## B. 产出' \
  '- **B1** 收尾 pass。' \
  '## C. 约束' \
  '| C1 | 约束一 |' \
  '## D. 边界' \
  '一律停下等人。'
if drift_cmd; then
  echo "STAYED-GREEN — a reintroduced manager copy did not redden the pointer drift check" >&2
  exit 3
fi
# RESTORE #5 → drift GREEN again (the pointer).
write plugin/loop/manager-loop-tick.md \
  '> 正本: orchestration/manager-loop-tick.md — 本文件只应存在这一行指针；内容一律读正本。'
if drift_cmd; then :; else
  echo "ALWAYS-RED — restored manager pointer still reddens the drift check" >&2
  exit 4
fi

exit 0
