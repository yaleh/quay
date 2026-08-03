#!/usr/bin/env bash
# AC5 regression #6 — the rename negative control that could not fail.
#
# The day's real failure (twelve-instances-and-two-mappings.md #6): the outer loop's rename
# negative control used `resource-gate.sh` as its probe — a tool with ZERO dependency on quay,
# so it exits 0 whether or not the dev tree is present. The outer reported "passed" twice on
# that basis, and the defect (the tree having been renamed away) was invisible to the probe.
#
# This case pins the FIX: the probe must depend on quay — here it greps a path that quay's
# structure guarantees (`packages/quay/package.json` naming the `quay` package). With a
# quay-dependent probe, the defect (rename the tree away) MUST make the probe go RED, and
# restoring the rename MUST make it green again. (The zero-dependency probe shape — which
# STAYS GREEN under the same defect — is demonstrated in checker-mutation-check.test.mjs.)
set -u
name="regression-rename-negative-control-probe"
workdir="${1:?usage: $name.sh <workdir>}"

# Build a minimal quay dev tree: the marker the quay-dependent probe reads.
mkdir -p "${workdir}/packages/quay"
printf '{\n  "name": "quay",\n  "version": "0.0.0"\n}\n' > "${workdir}/packages/quay/package.json"

# The quay-dependent probe (the #6 FIX): succeeds ONLY if the quay dev tree is present.
cat > "${workdir}/probe.sh" <<'PROBE'
#!/usr/bin/env bash
# quay-dependent presence probe: the marker file quay's structure guarantees.
if [ -f "$1/packages/quay/package.json" ] && grep -q '"name": "quay"' "$1/packages/quay/package.json"; then
  exit 0
else
  exit 1
fi
PROBE
chmod +x "${workdir}/probe.sh"

probe() { bash "${workdir}/probe.sh" "$1"; }

# GREEN baseline: tree present → quay-dependent probe exits 0.
if probe "${workdir}"; then :; else
  echo "baseline RED on a present tree (probe always-red?)" >&2
  exit 4
fi

# INJECT the #6 defect: rename the quay tree away (the rename the negative control must detect).
mv "${workdir}/packages/quay" "${workdir}/packages/quay.moved"
if probe "${workdir}"; then
  echo "STAYED-GREEN — the rename went undetected (this is the #6 bug shape)" >&2
  exit 3
fi

# RESTORE: rename it back → probe exits 0.
mv "${workdir}/packages/quay.moved" "${workdir}/packages/quay"
if probe "${workdir}"; then :; else
  echo "ALWAYS-RED — restored tree still fails the probe" >&2
  exit 4
fi

echo "quay-dependent probe goes RED under the rename, GREEN on restore (#6 fix direction)."
exit 0
