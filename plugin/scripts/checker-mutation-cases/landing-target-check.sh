#!/usr/bin/env bash
# Mutation case for landing-target-check (gap-landing-target-branch-consistency-check, AC1/AC2/AC3).
# Fixture: a temp git repo with develop + integration refs at the SAME commit (develop..integration=0
# ⇒ forward branch = develop, derived — NOT hardcoded), and a task whose Proposal declares a landing
# target. GREEN baseline = "合入 develop" (== forward). Inject = "合入 integration" (≠ forward) → the
# checker MUST go RED. Restore → back to GREEN. Then: a "合入 integration" line WITH a
# `landing-exception:` note is a RECORD, not a declaration → GREEN (AC4 mechanism). Finally the
# MODEL-MIGRATION direction (AC2): advance integration past develop ⇒ the SAME formula now reads
# forward = integration, and "合入 integration" goes GREEN while "合入 develop" goes RED — the forward
# branch is derived from the host relation, never a hardcoded name.
set -u
name="landing-target-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/tasks"
cd "${workdir}"

git init -q
git config user.email t@t
git config user.name t
echo a > seed.txt
git add seed.txt
git commit -qm c1
git branch develop
git branch integration

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/landing-target-check.ts" --gate --root "$1" >/dev/null 2>&1
}

write_fixture() { # $1 = the Proposal landing line
  cat > tasks/fixture.md <<EOF
---
id: fixture
status: todo
---

## Proposal

$1
EOF
}

# GREEN baseline: landing target == forward branch (develop) → exit 0.
write_fixture "合入 develop"
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a develop-target repo (checker always-red?)" >&2
  exit 4
fi

# INJECT: change the target to integration (≠ forward develop) → MUST go RED.
write_fixture "合入 integration"
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a non-forward landing target did not redden the checker" >&2
  exit 3
fi

# RESTORE: back to develop → back to GREEN.
write_fixture "合入 develop"
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored develop-target repo still reddens the checker" >&2
  exit 4
fi

# RECONCILE (AC4): an integration mention WITH the `landing-exception:` note is a RECORD, not a
# declaration → GREEN (the marker is the sanctioned 「本次例外何时清回 0」说明, not a silent drift).
write_fixture '合入 integration `landing-exception: 史实，前锋分支迁移至 develop 后本条无漂移指令`'
if checker_cmd "${workdir}"; then :; else
  echo "RECONCILE-RED — a landing-exception-marked record still reddens the checker" >&2
  exit 4
fi

# MODEL-MIGRATION (AC2): advance integration past develop ⇒ forward branch is now derived as
# integration (integration..develop=0), so "合入 integration" is GREEN and "合入 develop" is RED.
git checkout -q integration
echo b > seed2.txt
git add seed2.txt
git commit -qm c2
write_fixture "合入 integration"
if checker_cmd "${workdir}"; then :; else
  echo "MIGRATION-RED — the derived forward branch did not migrate to integration (hardcoded develop?)" >&2
  exit 4
fi
write_fixture "合入 develop"
if checker_cmd "${workdir}"; then
  echo "MIGRATION-STAYED-GREEN — a develop target did not redden when integration became forward" >&2
  exit 3
fi

exit 0
