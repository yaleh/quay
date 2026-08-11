#!/usr/bin/env bash
# Mutation case for judgment-consumer-check (gap-judgment-computed-not-wired-to-action,
# AC2 类级纪律 / AC3 系统审计).
#
# The checker's Contract invariants `each_judgment_has_consumer` / `no_consumer_listed_unfinished`:
#   - 每个机械判据必须有消费它的动作——registry 每条带 `consumer`，机械核对该消费动作在 tracked 文件里
#     确实是 WIRED 的（自证/回显按硬规则 4 不是测量）。
#   - 删掉消费动作的接线 ⇒ 检查器转红（exit 1，unfinished>0）。
#
# Fixture: 一个最小 workspace——每条 registry 声明的消费动作都在对应 tracked 文件里 DECLARED
#          （tick-core / slot-refill.ts / touches-orthogonality-check.ts / obligation-ledger-check.ts
#          / test.sh）→ GREEN。
# Inject 1: 删掉执行核 B9 的 deficit 第三触发器接线（去掉 `--apply`）——这正是本检查器存在的意义
#           （22:0x deficit 算出无触发器读）→ deficit 变未完成 → 检查器 MUST 变红。
# Inject 2: 删掉 slot-refill.ts 的 not-yet-flipped/excluded 接线——18:4x 同形态（算出没人消费）
#           → not_yet_flipped 变未完成 → 检查器 MUST 变红。
# Restore: 各自恢复声明 → 回到 GREEN。
set -u
name="judgment-consumer-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/orchestration"
mkdir -p "${workdir}/plugin/scripts"
mkdir -p "${workdir}/scripts"

# ── Fixture: 最小 workspace，每条 registry consumer 均 DECLARED（GREEN baseline）───────────────
tick_core="${workdir}/orchestration/orchestrator-tick-core.md"
cat > "${tick_core}" <<'EOF'
# orchestrator tick core (fixture)
## A9 ready-pool-check
A9 ready-pool-check（not-yet-flipped 判据：excluded 中 reason 含 not-yet-flipped）。
## A10 closure-lag-check.sh
A10 closure-lag-check.sh（退出非 0 ⇒ 本 tick 报 WARN 进 tick-log）。
## B2 closure-lag-check.sh --record
B2 closure-lag-check.sh --record（零收尾也写 0）。
- **B9 队列**:queue 补充；**deficit 第三触发器** ⇒ 跑 ready-pool-check.ts --apply（自闸补晋）。
EOF

cat > "${workdir}/plugin/scripts/slot-refill.ts" <<'EOF'
// slot-refill.ts (fixture)
// step-4 check: skip not-yet-flipped / excluded candidates (18:4x wiring)
const nyf = (pool.excluded || []).filter((e) => e.reasons.includes("not-yet-flipped"));
// C8 SELF-TOUCH DISPATCH GATE: a candidate lacking self-touch is rejected → backfill the next one
const selfTouch = selfTouchCheck(text, id);
if (!selfTouch.ok) continue; // C8-rejected ⇒ backfill: the next candidate replaces it in recommended
// should_refill — the event-driven go/no-go consuming dispatchable_disjoint
export const should_refill = slots_free > 0 && dispatchable_disjoint >= 1;
export const out = { dispatchable_disjoint: pool.dispatchable_disjoint, recommended };
EOF

cat > "${workdir}/plugin/scripts/touches-orthogonality-check.ts" <<'EOF'
// touches-orthogonality-check.ts (fixture)
// SELF-TOUCH-SCAN: 5 missing self-file entry — NOT all dispatchable
process.stderr.write("SELF-TOUCH-SCAN: 22 ready task(s), 5 missing self-file entry\n");
EOF

: > "${workdir}/plugin/scripts/obligation-ledger-check.ts"

cat > "${workdir}/scripts/test.sh" <<'EOF'
run_static_checks() {
  obligation-ledger-check
}
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/judgment-consumer-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: 全 registry 声明齐全 → exit 0。
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a fully-declared workspace (checker always-red?)" >&2
  exit 4
fi

# ── INJECT 1: 删掉 B9 deficit 第三触发器的 `--apply` 接线（deficit 算出没人消费）─────────────────
cp "${tick_core}" "${workdir}/tick-core.golden.md"
grep -v -- '--apply' "${tick_core}" > "${tick_core}.mut1" && mv "${tick_core}.mut1" "${tick_core}"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — 删掉 deficit→--apply 接线（deficit 变未完成）未让检查器变红" >&2
  exit 3
fi

# ── RESTORE 1: 恢复 --apply → GREEN ──────────────────────────────────────────────────────────────
mv "${workdir}/tick-core.golden.md" "${tick_core}"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — 恢复后的（声明齐全）workspace 仍让检查器变红" >&2
  exit 4
fi

# ── INJECT 2: 删掉 slot-refill.ts 的 not-yet-flipped/excluded 接线（18:4x 同形态）─────────────────
cp "${workdir}/plugin/scripts/slot-refill.ts" "${workdir}/slot-refill.golden.ts"
grep -v 'not-yet-flipped\|excluded' "${workdir}/plugin/scripts/slot-refill.ts" > "${workdir}/slot-refill.mut2" \
  && mv "${workdir}/slot-refill.mut2" "${workdir}/plugin/scripts/slot-refill.ts"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — 删掉 not-yet-flipped/excluded 接线（not_yet_flipped 变未完成）未让检查器变红" >&2
  exit 3
fi

# ── RESTORE 2: 恢复 not-yet-flipped → GREEN ─────────────────────────────────────────────────────
mv "${workdir}/slot-refill.golden.ts" "${workdir}/plugin/scripts/slot-refill.ts"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — 恢复后的（not-yet-flipped 齐全）workspace 仍让检查器变红" >&2
  exit 4
fi

exit 0
