#!/usr/bin/env bash
# Mutation case for tick-core-static-check (gap-tick-core-zero-static-coverage, AC2-AC7).
# The checker's four gates — the 2026-08-10 incidents were ALL hand-found with wc -l / grep, zero
# mechanical gate:
#   AC3 — each core ≤ 80 lines (AC30(a)).
#   AC4 — every pointer target a core references must exist.
#   AC5 — the B3 group numbering (甲乙丙丁戊) must not collide with the criteria numbering (①-⑤).
#   AC6 — an UNCONDITIONAL prohibition ("外层不直接改代码", no 收窄/单一写入者/共享树) contradicting
#         the cores' run_in_background dispatch must redden.
# Fixture: a minimal 3-core + 4-prohibition-doc baseline → GREEN.
# Inject #1: an orchestrator core pushed to 81 lines → RED (AC3).
# Restore → GREEN. Inject #2: an unconditional prohibition doc → RED (AC6). Restore → GREEN.
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
  '| A1 | 读 `.quay/manager-inbox/` | 目录非空即进决策 |' \
  '## B. 产出' \
  '- **B3 tick-log**:本组一律写 `甲乙丙丁戊`,禁用 ①-⑤。`no-action` 需举证——甲`a`;乙`b`;丙`c`;丁`d`;戊`e`。' \
  '## C. 约束' \
  '| C1 | 约束一 |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
write orchestration/orchestrator-tick-core.md \
  '# outer tick — 执行核' \
  '## A. 读数' \
  '| A1 | 读 `.quay/full-suite-state.json` | green⇒suiteGreen |' \
  '## B. 产出' \
  '- **B1** 收尾 pass。' \
  '## C. 约束' \
  '| C1 | 约束一 |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
write orchestration/fast-mode-tick-core.md \
  '# inner (fast-mode) tick — 执行核' \
  '## A. 每轮必跑' \
  '| A1 | `.halt` 哨兵 | 存在 ⇒ 空转 |' \
  '## B. 每轮必产出' \
  '- **B1** 写回队列文件。' \
  '## C. 硬约束' \
  '| C1 | 派发形态必须 `Agent(run_in_background: true)` |' \
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

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/tick-core-static-check.ts" --root "${root}" >/dev/null 2>&1
}

# GREEN baseline: the minimal surface passes all four criteria.
if checker_cmd; then :; else
  echo "baseline RED on a clean minimal surface (checker always-red?)" >&2
  exit 4
fi

# INJECT #1 (AC3): push the orchestrator core to 81 lines → the checker MUST go RED.
printf 'x\n%.0s' $(seq 1 81) > "${root}/orchestration/orchestrator-tick-core.md"
if checker_cmd; then
  echo "STAYED-GREEN — a >80-line core did not redden the checker" >&2
  exit 3
fi
# RESTORE #1.
write orchestration/orchestrator-tick-core.md \
  '# outer tick — 执行核' \
  '## A. 读数' \
  '| A1 | 读 `.quay/full-suite-state.json` | green⇒suiteGreen |' \
  '## B. 产出' \
  '- **B1** 收尾 pass。' \
  '## C. 约束' \
  '| C1 | 约束一 |' \
  '## D. 边界' \
  '**可以**:写 `orchestration/`。'
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored (≤80) core still reddens the checker" >&2
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

exit 0
