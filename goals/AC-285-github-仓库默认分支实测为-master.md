---
id: AC-285
title: GitHub 仓库默认分支实测为 master
status: draft
kind: criterion
goal: GOAL-023
criterion: >-
  bash <<'CRIT'

  set -euo pipefail

  line="$(git ls-remote --symref origin HEAD 2>/dev/null | head -1)"

  if [ -z "$line" ]; then
    echo "CAUSE=symref-unreadable — git ls-remote --symref origin HEAD returned nothing; cannot determine GitHub's current default branch" >&2; exit 1
  fi

  case "$line" in
    *"refs/heads/master"*) echo "OK — origin's default branch (HEAD symref) is master: $line"; exit 0 ;;
    *) echo "CAUSE=default-branch-not-master — origin HEAD symref is: $line (expected refs/heads/master)" >&2; exit 1 ;;
  esac

  CRIT
expect: criterion exits 0 once git ls-remote --symref origin HEAD resolves to
  refs/heads/master
origin: 当前默认分支是 develop（人 2026-09-15 裁定），本方案要求改回 master 作为对外门面
---
