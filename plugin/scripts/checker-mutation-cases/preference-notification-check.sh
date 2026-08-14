#!/usr/bin/env bash
# Mutation case for preference-notification-check (tasks/gap-ac57-preference-change-notification, AC57 通知面).
# Fixture: a temp workspace carrying orchestration/dispatch-preference.md (three sections) + a
# notification-log whose 「## 留痕记录」 holds ONE AC57-clean record (notice + matching fingerprint, no
# preference content) → GREEN. Inject: REPLACE that record with one that CARRIES a verbatim preference
# content line — the exact "携带了倾向内容本身" shape AC57's falsifiability requires the checker to go
# RED on → MUST go RED. Restore: put the clean record back → back to GREEN.
set -u
name="preference-notification-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/orchestration"
cd "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/preference-notification-check.ts" --root "$1" >/dev/null 2>&1
}

# Fixture preference file (three-section, minimal) — the leak baseline + the fingerprint's subject.
cat > orchestration/dispatch-preference.md <<'EOF'
# 派发倾向 —— 正本

## 默认段

manager 不在时生效：红窗优先 → gap 优先于 DIR → 其余任选。

## 覆盖段

manager 在时的当前倾向：本阶段 AC54–AC57 相关任务优先。

## 维护者字段

维护者：manager（负责更新覆盖段）。
EOF

fp="$(git hash-object orchestration/dispatch-preference.md)"

# The AC57-clean record: notice + the fixture's fingerprint, NO preference content.
cat > orchestration/preference-notification-log.md <<EOF
# 倾向变更通知留痕（发送侧）—— AC57 载体

## 通知模板

（发送者必须逐字使用本模板。）

\`\`\`
倾向变了，去重读
重读正本：orchestration/dispatch-preference.md
指纹：<git blob hash of orchestration/dispatch-preference.md>
\`\`\`

## 留痕记录

### 2026-08-14T00:00:00Z → inner

倾向变了，去重读
重读正本：orchestration/dispatch-preference.md
指纹：${fp}
EOF

if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on an AC57-clean notification log (checker always-red?)" >&2
  exit 4
fi

# INJECT: the record now CARRIES a VERBATIM preference-content line (a full copy of the fixture's
# 默认段 policy) — the exact "携带了倾向内容本身" shape AC57's falsifiability requires RED on → MUST go RED.
cat > orchestration/preference-notification-log.md <<EOF
# 倾向变更通知留痕（发送侧）—— AC57 载体

## 通知模板

（发送者必须逐字使用本模板。）

\`\`\`
倾向变了，去重读
重读正本：orchestration/dispatch-preference.md
指纹：<git blob hash of orchestration/dispatch-preference.md>
\`\`\`

## 留痕记录

### 2026-08-14T00:00:00Z → inner

倾向变了，去重读
重读正本：orchestration/dispatch-preference.md
指纹：${fp}
补充：manager 不在时生效：红窗优先 → gap 优先于 DIR → 其余任选。
EOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a notification carrying preference content did not redden the checker" >&2
  exit 3
fi

# RESTORE: put the clean record back → back to GREEN.
cat > orchestration/preference-notification-log.md <<EOF
# 倾向变更通知留痕（发送侧）—— AC57 载体

## 通知模板

（发送者必须逐字使用本模板。）

\`\`\`
倾向变了，去重读
重读正本：orchestration/dispatch-preference.md
指纹：<git blob hash of orchestration/dispatch-preference.md>
\`\`\`

## 留痕记录

### 2026-08-14T00:00:00Z → inner

倾向变了，去重读
重读正本：orchestration/dispatch-preference.md
指纹：${fp}
EOF
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored AC57-clean log still reddens the checker" >&2
  exit 4
fi

exit 0
