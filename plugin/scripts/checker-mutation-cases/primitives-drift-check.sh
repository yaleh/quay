#!/usr/bin/env bash
# Mutation case for primitives-drift-check (gap-ac253-session-primitives-shared-layer-adoption, AC2
# 取假控制). Fixture: a temp root carrying packages/quay/src/primitives/*.mjs plus a FAKE fleet git
# repo whose pinned commit holds the same bytes, and a manifest pinning that commit's SHA → GREEN.
#
# Inject → RED (one byte appended to ONE local primitive); restore → GREEN.
# Then BOTH NOT-EVALUATED directions must exit 3 and ⛔ must NOT read as 0:
#   (a) the fleet repo path does not exist;
#   (b) the pinned SHA does not resolve inside an existing fleet repo.
# (b) is the one that matters most: the repo is right there and the reference content is one
# `git show` away, so a checker that swallowed the git failure would print a green "nothing drifted"
# for a pin it never read (硬规则 3b — 读不懂输入不得返回与合格同形的值).
set -u
name="primitives-drift-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="${workdir}/root"
prims="${root}/packages/quay/src/primitives"
manifest="${root}/plugin/scripts/primitives-drift-manifest.json"
fleet="${workdir}/fake-fleet"

rm -rf "${root}" "${fleet}"
mkdir -p "${prims}" "${fleet}/packages/agent-core/src" "${root}/plugin/scripts"

# The four fixture primitives — small stand-ins for the real files; the checker is byte-oriented and
# never parses them, so the content only needs to be distinguishable per file.
for f in pty-frame delivery-audit session-liveness session-schema; do
  printf '// fixture primitive: %s\nexport const name = "%s";\n' "$f" "$f" > "${prims}/${f}.mjs"
  cp "${prims}/${f}.mjs" "${fleet}/packages/agent-core/src/${f}.mjs"
done

git -C "${fleet}" init -q
git -C "${fleet}" -c user.email=fixture@example.invalid -c user.name=fixture add -A
git -C "${fleet}" -c user.email=fixture@example.invalid -c user.name=fixture commit -q -m "fixture pin"
fleet_sha="$(git -C "${fleet}" rev-parse HEAD)"

write_manifest() {
  local sha="$1" repo="$2"
  python3 - "$prims" "$manifest" "$sha" "$repo" <<'PY'
import hashlib, json, os, sys
prims, out, sha, repo = sys.argv[1:5]
files = {}
for f in ("pty-frame.mjs", "delivery-audit.mjs", "session-liveness.mjs", "session-schema.mjs"):
    with open(os.path.join(prims, f), "rb") as fh:
        files[f] = hashlib.sha256(fh.read()).hexdigest()
json.dump({
    "fleetRepo": repo,
    "fleetSha": sha,
    "fleetSourceDir": "packages/agent-core/src",
    "localDir": "packages/quay/src/primitives",
    "files": files,
}, open(out, "w"), indent=2)
PY
}

checker_argv() {
  local fleet_arg="${1:-}"
  if [ -n "$fleet_arg" ]; then
    node --no-warnings --experimental-strip-types "${checker_dir}/primitives-drift-check.ts" \
      --root "${root}" --fleet "$fleet_arg"
  else
    node --no-warnings --experimental-strip-types "${checker_dir}/primitives-drift-check.ts" \
      --root "${root}"
  fi
}

checker_cmd() { checker_argv "${1:-}" >/dev/null 2>&1; }

checker_rc() {
  local rc=0
  checker_argv "${1:-}" >/dev/null 2>&1 || rc=$?
  echo "$rc"
}

write_manifest "${fleet_sha}" "${fleet}"

# GREEN baseline: both sides byte-identical to the pin.
if checker_cmd; then :; else
  echo "baseline RED on a byte-identical fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT: ONE appended byte in ONE local primitive → MUST go RED (判据能取假).
printf '// one byte of drift\n' >> "${prims}/session-schema.mjs"
if checker_cmd; then
  echo "STAYED-GREEN — a one-byte local edit did not redden the drift check (判据能取假 violated)" >&2
  exit 3
fi

# RESTORE: byte-identical again → GREEN again.
cp "${fleet}/packages/agent-core/src/session-schema.mjs" "${prims}/session-schema.mjs"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored (byte-identical) fixture still reddens the drift check" >&2
  exit 4
fi

# ── NOT-EVALUATED (a): the fleet repo path does not exist ────────────────────────────────────────
rc="$(checker_rc "${workdir}/does-not-exist")"
if [ "$rc" != "3" ]; then
  echo "NOT-EVALUATED(a) WRONG — absent fleet repo gave exit ${rc}, expected 3 (⛔ must not be 0 = 'no drift')" >&2
  exit 3
fi

# ── NOT-EVALUATED (b): the repo exists but the PINNED SHA does not resolve ───────────────────────
#
# The dangerous direction: the fleet checkout is present, so a naive implementation that only checks
# `fs.existsSync(fleetRepo)` would fall through, read nothing, and compare nothing against nothing.
write_manifest "0000000000000000000000000000000000000000" "${fleet}"
rc="$(checker_rc)"
if [ "$rc" != "3" ]; then
  echo "NOT-EVALUATED(b) WRONG — unresolvable pinned SHA gave exit ${rc}, expected 3 (repo present, pin unreadable must NOT read as 'consistent')" >&2
  exit 3
fi

# RESTORE the good pin → GREEN again (the negative controls did not leave the fixture red).
write_manifest "${fleet_sha}" "${fleet}"
if checker_cmd; then :; else
  echo "ALWAYS-RED — good pin restored but the drift check still exits non-zero" >&2
  exit 4
fi

echo "primitives-drift-check mutation case: PASS (green → one-byte drift RED → restored green; NOT-EVALUATED exit 3 for both an absent repo and an unresolvable pin)"
