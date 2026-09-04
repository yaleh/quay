#!/usr/bin/env bash
# Mutation case for dispatch-preference-check (tasks/gap-ac54-dispatch-preference-file, AC54 判据1/判据2).
# Fixture: a temp workspace carrying orchestration/dispatch-preference.md with all three sections
# (默认段 / 覆盖段 / 维护者字段) → GREEN. Inject: DELETE the 覆盖段 section (heading + content) — the
# exact "删掉任一段" shape AC54 判据2 requires the checker to go RED on → MUST go RED. Restore: put
# the section back → back to GREEN.
set -u
name="dispatch-preference-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/orchestration"
cd "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/dispatch-preference-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: all three sections present → exit 0.
cat > orchestration/dispatch-preference.md <<'EOF'
# 派发倾向 —— 正本

## 默认段

manager 不在时生效：红窗优先 → gap 优先于 DIR → 其余任选。

## 覆盖段

manager 在时的当前倾向：本阶段 AC54–AC57 相关任务优先。

## 维护者字段

维护者：manager（负责更新覆盖段）。
EOF
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a three-section-complete repo (checker always-red?)" >&2
  exit 4
fi

# INJECT: delete the 覆盖段 section — the preference file is now missing a required section → MUST go RED.
cat > orchestration/dispatch-preference.md <<'EOF'
# 派发倾向 —— 正本

## 默认段

manager 不在时生效：红窗优先 → gap 优先于 DIR → 其余任选。

## 维护者字段

维护者：manager（负责更新覆盖段）。
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a preference file missing 覆盖段 did not redden the checker" >&2
  exit 3
fi

# RESTORE: put 覆盖段 back → back to GREEN.
cat > orchestration/dispatch-preference.md <<'EOF'
# 派发倾向 —— 正本

## 默认段

manager 不在时生效：红窗优先 → gap 优先于 DIR → 其余任选。

## 覆盖段

manager 在时的当前倾向：本阶段 AC54–AC57 相关任务优先。

## 维护者字段

维护者：manager（负责更新覆盖段）。
EOF
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored three-section file still reddens the checker" >&2
  exit 4
fi

exit 0
