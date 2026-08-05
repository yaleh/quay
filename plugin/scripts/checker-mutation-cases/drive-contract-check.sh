#!/usr/bin/env bash
# Mutation case for drive-contract-check (gap-drive-text-carries-data-not-behavior-outer-inner-
# handoff, AC3/AC4 — the drive-text contract checker). The checker's own ## Contract control:
# "构造 `按 A→B 顺序` 无输出的文本 ⇒ violations 必须 +1；附输出 ⇒ 回落 0".
# Fixture: a temp drive text with NO order assertion → GREEN.
# Inject: the incident shape — "按 A→B 顺序" with NO checkTouchesPair output → the checker MUST go RED.
# Restore: append the checkTouchesPair output → back to GREEN.
set -u
name="drive-contract-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
drive_text="${workdir}/drive.md"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/drive-contract-check.ts" --judge "$1" >/dev/null 2>&1
}

# GREEN baseline: drive text with DATA only (task ids, no order assertion) → exit 0.
printf '本批派发 A、D 与 L0：并发上限见出厂文档，各自 worktree。\n' > "${drive_text}"
if checker_cmd "${drive_text}"; then :; else
  echo "baseline RED on a clean drive text (checker always-red?)" >&2
  exit 4
fi

# INJECT the incident shape: an explicit order assertion with NO checkTouchesPair output →
# MUST go RED. This is exactly the 2026-08-04 shape (按 A→D→B 顺序, no pair output).
printf '本批实现三个任务，按 A→B 顺序。\n' > "${drive_text}"
if checker_cmd "${drive_text}"; then
  echo "STAYED-GREEN — an order-asserting drive text without pair output did not redden the checker" >&2
  exit 3
fi

# RESTORE: append the checkTouchesPair output → back to GREEN (AC4 control, the +1 → 0 direction).
printf 'checkTouchesPair 实跑：A-B: {"disjoint":true,"overlaps":[],"reason":"disjoint file-sets"}\n' >> "${drive_text}"
if checker_cmd "${drive_text}"; then :; else
  echo "ALWAYS-RED — restored drive text (with pair output) still reddens the checker" >&2
  exit 4
fi

exit 0
