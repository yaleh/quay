---
id: AC-283
title: author 分支已推送到 origin，且是本地 author 的真实祖先（解决单点失效）
status: achieved
kind: criterion
goal: GOAL-023
criterion: >-
  bash <<'CRIT'

  set -euo pipefail

  git fetch origin author >/dev/null 2>&1 || true

  sha_remote="$(git ls-remote --heads origin author 2>/dev/null | awk '{print
  $1}' || true)"

  if [ -z "$sha_remote" ]; then
    echo "CAUSE=origin-author-absent — origin has no 'author' branch yet; push it first (git push -u origin author)" >&2; exit 1
  fi

  if ! git cat-file -e "${sha_remote}^{commit}" 2>/dev/null; then
    echo "CAUSE=remote-sha-unfetched — origin/author's sha ${sha_remote} is not present in this checkout's object DB; run git fetch origin author first" >&2; exit 1
  fi

  if ! git merge-base --is-ancestor "${sha_remote}" author 2>/dev/null; then
    echo "CAUSE=remote-not-ancestor-of-local — origin/author (${sha_remote}) is not an ancestor of the local author branch; it may be a different/diverged history, not a real backup of this branch" >&2; exit 1
  fi

  echo "OK — origin/author exists (${sha_remote}) and is an ancestor of local
  author"

  exit 0

  CRIT
expect: criterion exits 0 once origin/author exists and is an ancestor of local author
origin: author 分支从未被推送过（git ls-remote --heads origin author 为空），只存在于这台机器本地
activatedAt: 2026-09-17T04:07:15.635Z
statusLog:
  - at: 2026-09-17T04:07:15.635Z
    from: draft
    to: active
    actor: manager
    reason: GOAL-023 激活，同步激活
  - at: 2026-09-17T05:00:44.924Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T04:07:15.634Z
---
