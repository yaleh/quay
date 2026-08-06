#!/usr/bin/env bash
# Mutation case for no-manager-tick-doc-check (C3/AC4 — the outer tick docs must contain NO
# create/drive/check manager step). The checker's Contract control: "构造一条含 manager 步骤的
# tick 文本 ⇒ violations 必须 +1；移除 ⇒ 回落 0".
# Fixture: the real orchestrator-loop-tick.md (boundary prose only) → GREEN.
# Inject: the incident shape — a `quay manager start` step line → the checker MUST go RED.
# Restore: remove the injected line → back to GREEN.
set -u
name="no-manager-tick-doc-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$checker_dir/../.." && pwd)"

# Assemble a temp root whose tick docs mirror the repo's real ones.
rm -rf "$workdir/root"
mkdir -p "$workdir/root/orchestration" "$workdir/root/plugin/loop"
cp "$repo_root/orchestration/orchestrator-loop-tick.md" "$workdir/root/orchestration/orchestrator-loop-tick.md"
cp "$repo_root/plugin/loop/orchestrator-loop-tick.md" "$workdir/root/plugin/loop/orchestrator-loop-tick.md"
cp "$repo_root/plugin/loop/fast-mode-loop-tick.md" "$workdir/root/plugin/loop/fast-mode-loop-tick.md"

checker_cmd() {
  bash "$checker_dir/no-manager-tick-doc-check.sh" "$workdir/root" >/dev/null 2>&1
}

# GREEN baseline: the real tick docs carry only boundary prose → exit 0.
if checker_cmd; then :; else
  echo "baseline RED on the real tick docs (checker always-red on boundary prose?)" >&2
  exit 4
fi

# INJECT the incident shape: an explicit `quay manager start` step line → MUST go RED (C3).
printf 'quay manager start 拉起管理者会话（人工执行，非外层）。\n' >> "$workdir/root/orchestration/orchestrator-loop-tick.md"
if checker_cmd; then
  echo "STAYED-GREEN — a create/drive/check-manager step did not redden the checker" >&2
  exit 3
fi

# RESTORE: remove the injected line → back to GREEN (AC4 control, the +1 → 0 direction).
grep -v 'quay manager start 拉起管理者会话' "$workdir/root/orchestration/orchestrator-loop-tick.md" \
  > "$workdir/root/orchestration/orchestrator-loop-tick.md.new"
mv "$workdir/root/orchestration/orchestrator-loop-tick.md.new" "$workdir/root/orchestration/orchestrator-loop-tick.md"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored tick docs (step removed) still redden the checker" >&2
  exit 4
fi

exit 0
