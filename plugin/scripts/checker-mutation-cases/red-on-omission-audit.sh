#!/usr/bin/env bash
# Mutation case for red-on-omission-audit (gap-red-on-omission-audit-needs-mutation-case /
# gap-ac41-red-on-omission-artifact AC41 判据 3).
#
# The checker's Contract invariant `ruling5_status` / `scope_worktree_gate`:
#   - 每条固化行为必须能指出「不做时哪个读数会变红」——registry 每条带 `redReading`，机械核对
#     该读数在 tracked 文件里确实是 DECLARED 的（自证/回显按硬规则 4 不是测量）。
#   - 删掉变红读数的声明 ⇒ 检查器转红（exit 1）。
#
# Fixture: 一个最小 workspace——每条 registry 声明的 redReading 都在对应 tracked 文件里 DECLARED
#          （tick-core / full-suite-runner.ts / execute-suite-fix.js / judge / test.sh）→ GREEN。
# Inject 1: 删掉执行核里 A15 ② 的「每 tick 写 `.quay/suite-health-last-run.json`」声明——这正是本
#          检查器存在的意义（裁定5 做了但执行要求被删 ⇒ ruling5_status + a15_heartbeat_write 变未固化）
#          → 检查器 MUST 变红。
# Inject 2: 删掉 full-suite-runner.ts 里的 `scope?: "main" | "worktree"` 字段声明（waiters 无法分辨
#          main/worktree 产生的轮次，gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1）
#          → scope_worktree_gate invariant 断 → 检查器 MUST 变红。
# Restore: 各自恢复声明 → 回到 GREEN。
set -u
name="red-on-omission-audit"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/orchestration"
mkdir -p "${workdir}/plugin/scripts"
mkdir -p "${workdir}/plugin/workflows"
mkdir -p "${workdir}/scripts"

# ── Fixture: 最小 workspace，每条 registry redReading 均 DECLARED（GREEN baseline）───────────────
tick_core="${workdir}/orchestration/orchestrator-tick-core.md"
cat > "${tick_core}" <<'EOF'
# orchestrator tick core (fixture)
## A15 执行保障 (裁定5)
A15 执行保障 (裁定5): 连续 3 轮 A15 心跳缺失（Agent 无新 ts）⇒ 置 .halt；再 3 轮 ⇒ /clear。
①每 tick 写 `.quay/suite-health-last-run.json`（含 ruling5_status 自报字段；mtime 陈旧 ⇒ 检查器 exit 1）
ruling5_status 字段每 tick 自报；越过 3/6 轮门槛 ⇒ violated。
## A1 monitor-mount-check
A1 monitor-mount-check（mounted + targetOk 判据）。
## A2 suite-chain-heartbeat
A2 suite-chain-heartbeat（runId/phase/ts；ts 陈旧 ⇒ 重新武装）。
## A6 固定 `cap=5`
A6 固定 `cap=5`（动态 cap 作废）；ready-pool-check --cap 5。
## A10 closure-lag-check.sh
A10 closure-lag-check.sh（退出非 0 ⇒ 报 WARN 进 tick-log）。
## A13 inner-wakeup-heartbeat-check
A13 inner-wakeup-heartbeat-check。
## A14 tool_name=closure-lag-check
A14 tool_name=closure-lag-check。
## A16 宣称要做的事
A16 宣称要做的事：宣称派发 / 宣称合并。
## A17 semantic-observer-judge
A17 semantic-observer-judge。
## C1 裸 tmux send-keys 次数
C1 裸 tmux send-keys 次数；非 0 即违规并记账。
## C3 resource-gate.sh --for full-suite
C3 resource-gate.sh --for full-suite。
## C14 task-contract-check
C14 task-contract-check。
## B2 closure-lag-check.sh --record
B2 closure-lag-check.sh --record（零收尾也写 0）。
scope=worktree|scope=main（fan-in 闸）
EOF

cat > "${workdir}/plugin/scripts/full-suite-runner.ts" <<'EOF'
export interface SuiteState {
  scope?: "main" | "worktree";
}
EOF

cat > "${workdir}/plugin/workflows/execute-suite-fix.js" <<'EOF'
// fan-in consumer (Merge step): requires a scope=worktree round record with state green
const gate = state === 'green' && scope === 'worktree';
EOF

cat > "${workdir}/plugin/scripts/semantic-observer-judge.ts" <<'EOF'
const redOnOmission = true;
return redOnOmission ? 1 : 0;
EOF

# 仅需存在的检查器文件（verify 只 fileExists 判有/无）
: > "${workdir}/plugin/scripts/adr016-screen-use-check.ts"
: > "${workdir}/plugin/scripts/drive-contract-check.ts"
: > "${workdir}/plugin/scripts/task-contract-check.ts"
: > "${workdir}/plugin/scripts/resource-gate.sh"

cat > "${workdir}/scripts/test.sh" <<'EOF'
run_static_checks() {
  adr016-screen-use-check
  drive-contract-check
  task-contract-check
}
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/red-on-omission-audit.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: 全 registry 声明齐全 → exit 0。
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a fully-declared workspace (checker always-red?)" >&2
  exit 4
fi

# ── INJECT 1: 删掉 A15 ② 每 tick 写 suite-health-last-run.json 的声明（裁定5 执行要求被删）──────
cp "${tick_core}" "${workdir}/tick-core.golden.md"
grep -v '①每 tick 写' "${tick_core}" > "${tick_core}.mut1" && mv "${tick_core}.mut1" "${tick_core}"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — 删掉 A15 ② 每 tick 写声明（ruling5_status / a15_heartbeat_write 变未固化）未让检查器变红" >&2
  exit 3
fi

# ── RESTORE 1: 恢复声明 → GREEN ──────────────────────────────────────────────────────────────────
mv "${workdir}/tick-core.golden.md" "${tick_core}"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — 恢复后的（声明齐全）workspace 仍让检查器变红" >&2
  exit 4
fi

# ── INJECT 2: 删掉 runner 的 scope 字段声明（waiters 无法分辨 main/worktree 轮次）────────────────
cp "${workdir}/plugin/scripts/full-suite-runner.ts" "${workdir}/runner.golden.ts"
printf 'export interface SuiteState {}\n' > "${workdir}/plugin/scripts/full-suite-runner.ts"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — 删掉 runner 的 scope 字段声明（scope_worktree_gate invariant 断）未让检查器变红" >&2
  exit 3
fi

# ── RESTORE 2: 恢复 scope 字段 → GREEN ──────────────────────────────────────────────────────────
mv "${workdir}/runner.golden.ts" "${workdir}/plugin/scripts/full-suite-runner.ts"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — 恢复后的（scope 字段齐全）workspace 仍让检查器变红" >&2
  exit 4
fi

exit 0
