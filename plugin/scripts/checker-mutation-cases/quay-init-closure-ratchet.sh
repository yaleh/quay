#!/usr/bin/env bash
# Mutation case for quay-init-closure-ratchet (gap-quay-init-closure-assertion-first, SPEC AC168 判据先行).
# Fixture: a root whose plugin/scripts/quay-init.sh is a CONTROLLED FAKE that lays down N fixed-size files
# (10 bytes each) into the --root target — a stand-in for the REAL laydown (the mutation case tests the
# checker's JUDGMENT, not the real quay-init mechanism; the real laydown is exercised by the checker's own
# production carrier + the unit test's NOT-EVALUATED path).
# GREEN: fake lays 2 files → baseline-files=2 / baseline-bytes=20 → exit 0.
# Inject: fake lays 3 files (3 > 2) → the laydown GREW ⇒ the checker MUST go RED (exit 1).
# Restore → 2 files → GREEN.
set -u
name="quay-init-closure-ratchet"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}/plugin/scripts"
cd "${workdir}"

# write_fake <n> — (re)write plugin/scripts/quay-init.sh to lay down N files of 10 bytes each.
write_fake() {
  local n="$1"
  cat > plugin/scripts/quay-init.sh <<EOF
#!/usr/bin/env bash
_root=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    --root) _root="\$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "\$_root/plugin/scripts"
_i=1
while [ "\$_i" -le "$n" ]; do
  printf '0123456789' > "\$_root/plugin/scripts/f\${_i}.txt"
  _i=\$((_i + 1))
done
exit 0
EOF
  chmod +x plugin/scripts/quay-init.sh
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/quay-init-closure-ratchet.ts" --gate --root "$workdir" --baseline-files 2 --baseline-bytes 20 >/dev/null 2>&1
}

# GREEN baseline (2 files × 10 bytes = 20 bytes) → exit 0.
write_fake 2
if checker_cmd; then :; else
  echo "baseline RED on a green fixture (checker always-red?)" >&2
  exit 4
fi

# INJECT: one MORE laid-down file (3 > 2) ⇒ the laydown grew ⇒ the ratchet MUST go RED.
write_fake 3
if checker_cmd; then
  echo "STAYED-GREEN — a grown laydown (3 files vs baseline 2) did not redden the ratchet" >&2
  exit 3
fi

# RESTORE → back to 2 files → GREEN.
write_fake 2
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored 2-file fixture still reddens the checker" >&2
  exit 4
fi

exit 0
