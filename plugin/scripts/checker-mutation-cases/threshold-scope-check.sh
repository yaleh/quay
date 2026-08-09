#!/usr/bin/env bash
# Mutation case for threshold-scope-check (gap-quantified-stop-conditions-have-no-scope, AC2/AC3/AC11
# — the driver-doc prose hygiene checker). The checker's own ## Contract controls:
#   control  `needs-human ≥ 3`（无集合无窗口）必须报出，`窗口内新增 needs-human ≥ 3` 必须不报——双向
#   AC11    人为加一条指向不存在文件的引用 ⇒ 必须报出；改成真实存在的路径 ⇒ 必须不报
# Fixture: a windowed threshold (the positive control) → GREEN.
# Inject: the incident shape — bare `needs-human ≥ 3` → the checker MUST go RED.
# Restore: name the window → back to GREEN.
# Then a stale-path cycle: a nonexistent-path reference → RED; a real path → GREEN.
set -u
name="threshold-scope-check"
workdir="${1:?usage: $name.sh <workdir>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # plugin/scripts
repo_root="$(cd "${script_dir}/../.." && pwd)"                 # repo root
fixture="${workdir}/driver.md"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${script_dir}/threshold-scope-check.ts" --root "${repo_root}" --judge "$1" >/dev/null 2>&1
}

# GREEN baseline: the POSITIVE control — the threshold NAMES its window.
printf '停止条件：窗口内新增 needs-human ≥ 3（2026-08-03 外层裁定：不是总数）。\n' > "${fixture}"
if checker_cmd "${fixture}"; then :; else
  echo "baseline RED on the windowed positive control (checker always-red?)" >&2
  exit 4
fi

# INJECT the incident shape: the same stop condition WITHOUT its window → MUST go RED.
# This is exactly the 2026-08-03 shape that froze dispatch (needs-human 积压 ≥ 3, no set/window).
printf '停止条件：needs-human 积压 ≥ 3。\n' > "${fixture}"
if checker_cmd "${fixture}"; then
  echo "STAYED-GREEN — an unscoped count threshold did not redden the checker" >&2
  exit 3
fi

# RESTORE: add the window → back to GREEN (AC2 control, the +1 → 0 direction).
printf '停止条件：窗口内新增 needs-human ≥ 3。\n' > "${fixture}"
if checker_cmd "${fixture}"; then :; else
  echo "ALWAYS-RED — restored (windowed) stop condition still reddens the checker" >&2
  exit 4
fi

# Stale-path cycle (AC11): a nonexistent-path reference → RED; a real path → GREEN.
printf '请核对 `nowhere/exists.js`。\n' > "${fixture}"
if checker_cmd "${fixture}"; then
  echo "STAYED-GREEN — a reference to a nonexistent file did not redden the checker" >&2
  exit 3
fi
printf '请核对 `scripts/test.sh`。\n' > "${fixture}"
if checker_cmd "${fixture}"; then :; else
  echo "ALWAYS-RED — a real-path reference still reddens the checker" >&2
  exit 4
fi

exit 0
