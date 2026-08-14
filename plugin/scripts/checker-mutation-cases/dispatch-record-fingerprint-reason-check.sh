#!/usr/bin/env bash
# Mutation case for dispatch-record-fingerprint-reason-check (tasks/gap-ac55-dispatch-record-
# fingerprint-reason, AC55 判据1/判据3).
# Fixture: a temp workspace carrying orchestration/dispatch-preference.md (so the WRITER can compute
# a REAL git blob hash fingerprint) → the writer appends ONE real dispatch record → GREEN. Inject:
# DELETE the fingerprint field (the exact "缺指纹" shape AC55 判据3 requires the checker to go RED on)
# → MUST go RED. Restore → GREEN. Then DELETE the reason field ("缺理由") → MUST go RED. Restore → GREEN.
set -u
name="dispatch-record-fingerprint-reason-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/orchestration"
cd "${workdir}"

# GREEN baseline: a real preference file + one real dispatch record written by the WRITER.
cat > orchestration/dispatch-preference.md <<'EOF'
# 派发倾向 —— 正本

## 默认段

manager 不在时生效：红窗优先 → gap 优先于 DIR → 其余任选。

## 覆盖段

manager 在时的当前倾向：本阶段 AC54–AC57 相关任务优先。

## 维护者字段

维护者：manager（负责更新覆盖段）。
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/dispatch-record-fingerprint-reason-check.ts" --root "$1" >/dev/null 2>&1
}
writer_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/dispatch-record.ts" --add --task-id "$1" --reason "$2" --root "${workdir}" >/dev/null 2>&1
}

# Baseline: the writer produces a REAL record (real git hash-object fingerprint) → checker GREEN.
if ! writer_cmd "gap-mutation-sample" "覆盖段本阶段 AC55 优先——与阶段目标直接相关"; then
  echo "baseline WRITE failed (writer always-fails?)" >&2
  exit 4
fi
if ! checker_cmd "${workdir}"; then
  echo "baseline RED on a real well-formed dispatch record (checker always-red?)" >&2
  exit 4
fi

# INJECT: delete the fingerprint field — the real record now lacks its fingerprint → MUST go RED.
sed -i -E 's/,"preferenceFingerprint":"[0-9a-f]{40}"//' orchestration/dispatch-record.jsonl
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a real dispatch record missing its fingerprint did not redden the checker" >&2
  exit 3
fi

# RESTORE: rewrite a fresh real record → back to GREEN.
rm -f orchestration/dispatch-record.jsonl
if ! writer_cmd "gap-mutation-sample" "覆盖段本阶段 AC55 优先——与阶段目标直接相关"; then
  echo "restore WRITE failed (writer always-fails?)" >&2
  exit 4
fi
if ! checker_cmd "${workdir}"; then
  echo "ALWAYS-RED — restored real record still reddens the checker" >&2
  exit 4
fi

# INJECT: delete the reason field — the real record now lacks its reason → MUST go RED.
sed -i -E 's/,"reason":"[^"]*"//' orchestration/dispatch-record.jsonl
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a real dispatch record missing its reason did not redden the checker" >&2
  exit 3
fi

# RESTORE: rewrite a fresh real record → back to GREEN.
rm -f orchestration/dispatch-record.jsonl
if ! writer_cmd "gap-mutation-sample" "覆盖段本阶段 AC55 优先——与阶段目标直接相关"; then
  echo "final-restore WRITE failed (writer always-fails?)" >&2
  exit 4
fi
if ! checker_cmd "${workdir}"; then
  echo "ALWAYS-RED — final restored real record still reddens the checker" >&2
  exit 4
fi

exit 0
