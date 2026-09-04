#!/usr/bin/env bash
# Mutation case for no-manager-tick-doc-check (gap-manager-productization-five-constraints AC4 —
# C3: the outer tick docs must contain no create/drive/check manager steps). The checker's own
# ## Contract control: "构造含 `quay manager start` 的文本 ⇒ violations 必须 +1；边界语（manager
# 跨项目不属于项目拓扑）⇒ 0"。Fixture: a clean outer tick doc (boundary context only) → GREEN.
# Inject: an actionable manager step (`quay manager start`) → the checker MUST go RED.
# Restore: revert → back to GREEN.
set -u
name="no-manager-tick-doc-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
doc="${workdir}/outer-tick.md"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/no-manager-tick-doc-check.ts" --judge "$1" >/dev/null 2>&1
}

# GREEN baseline: boundary context only (manager 跨项目不属于项目拓扑 — the legitimate mention).
printf '## 冷启动\n调 quay-topology.sh 建单窗口（outer，manager 跨项目不属于项目拓扑，不建）。\n' > "${doc}"
if checker_cmd "${doc}"; then :; else
  echo "baseline RED on a boundary-context-only doc (checker always-red?)" >&2
  exit 4
fi

# INJECT the incident shape: an actionable manager step — `quay manager start` → MUST go RED.
printf '## 冷启动\n先调 quay manager start 拉起 manager，再建单窗口。\n' > "${doc}"
if checker_cmd "${doc}"; then
  echo "STAYED-GREEN — a doc instructing the outer to create the manager did not redden the checker" >&2
  exit 3
fi

# RESTORE: revert to boundary-only → back to GREEN (the +1 → 0 direction).
printf '## 冷启动\n调 quay-topology.sh 建单窗口（outer，manager 跨项目不属于项目拓扑，不建）。\n' > "${doc}"
if checker_cmd "${doc}"; then :; else
  echo "ALWAYS-RED — restored boundary-only doc still reddens the checker" >&2
  exit 4
fi

exit 0
