#!/usr/bin/env bash
# Mutation case for release-freshness-check --deliver (the deliver orphan detector, AC4).
# Fixture: a temp git repo (tag v0.1.0 at baseline + a develop commit that touches NO delivery dir,
#   so recut/drift stay GREEN under --threshold high) + a FRESH develop-deliver-state.json whose
#   lastDelivered == the develop tip.
# GREEN baseline: lastDelivered == tip ⇒ deliver_state=fresh ⇒ exit 0.
# INJECT 1 (missing state): rm the state.json ⇒ deliver_state=not-evaluated ⇒ exit 1 (硬规则 3b — the
#   exact "file absent read as silence" bug this detector exists to make red).
# INJECT 2 (stale state): lastDelivered = develop~1 with --deliver-ahead 0 ⇒ deliver_state=stale ⇒ exit 1.
# RESTORE: put back the fresh state.json ⇒ exit 0.
set -u
name="release-freshness-check"
workdir="${1:?usage: release-freshness-check.sh <workdir>}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHECK="${repo_root}/plugin/scripts/release-freshness-check.sh"

# ── fixture: baseline (tag v0.1.0) + develop commit NOT in a delivery dir (no drift) ──────────────
mkdir -p "${workdir}/plugin/scripts"
git -C "${workdir}" init -q
git -C "${workdir}" config user.email t@test
git -C "${workdir}" config user.name t
printf '#!/usr/bin/env bash\necho a\n' > "${workdir}/plugin/scripts/a.sh"
git -C "${workdir}" add -A
git -C "${workdir}" commit -q -m baseline
git -C "${workdir}" tag v0.1.0
git -C "${workdir}" checkout -q -b develop
printf '# readme\n' > "${workdir}/README.md"          # NOT in DELIVERY_DIRS ⇒ drift_dirs=0
git -C "${workdir}" add -A
git -C "${workdir}" commit -q -m "develop ahead (non-delivery)"

tip="$(git -C "${workdir}" rev-parse develop)"
parent="$(git -C "${workdir}" rev-parse develop~1)"
state="${workdir}/.quay/develop-deliver-state.json"
mkdir -p "${workdir}/.quay"

write_state() {
  printf '{"lastDelivered":"%s","hosts":{"B":"200"},"timestamp":"2026-09-08T00:00:00Z"}\n' "$1" > "${state}"
}

checker_cmd() {
  # $1 = --deliver-ahead value
  bash "${CHECK}" --root "${workdir}" --deliver --threshold 999999 --deliver-ahead "$1" >/dev/null 2>&1
}

# GREEN baseline: fresh state (lastDelivered == tip) → exit 0.
write_state "${tip}"
if checker_cmd 5; then :; else
  echo "baseline RED on a fresh state (checker always-red?)" >&2
  exit 4
fi

# INJECT 1: missing state.json → not-evaluated → exit 1.
rm -f "${state}"
if checker_cmd 5; then
  echo "STAYED-GREEN — a missing develop-deliver-state.json did not redden the deliver detector" >&2
  exit 3
fi

# INJECT 2: stale state (lastDelivered = develop~1, ahead=1) with --deliver-ahead 0 → exit 1.
write_state "${parent}"
if checker_cmd 0; then
  echo "STAYED-GREEN — a stale lastDelivered (ahead over threshold) did not redden the deliver detector" >&2
  exit 3
fi

# RESTORE: fresh state → exit 0.
write_state "${tip}"
if checker_cmd 5; then :; else
  echo "ALWAYS-RED — restored fresh state still reddens the deliver detector" >&2
  exit 4
fi

exit 0
