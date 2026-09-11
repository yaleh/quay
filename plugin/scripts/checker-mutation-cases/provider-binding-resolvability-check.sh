#!/usr/bin/env bash
# Mutation case for provider-binding-resolvability-check
# (tasks/gap-pre-fix-upgraded-project-unresolvable-binding-undetected, AC3).
#
# THE OBJECT MUTATED IS THE FIXTURE, NOT THE CHECKER (same shape as the other cases here): we
# deliberately re-inject the exact defect the checker claims to catch — a provider whose `mcp_entry`
# names its runtime by a BARE word, the pre-ba960f503 binding form — and assert the checker GOES RED.
# If the checker's bare-name judgment were reverted (the pre-fix blindness: "a bare `quay-native` is
# fine, $PATH will resolve it"), the INJECT step would STAY GREEN and this case would exit 3. That is
# what makes this case the mechanical form of AC3's "把修复 revert 之后必须失败".
#
# The three fixtures differ ONLY in the runtime token, so a GREEN/RED flip cannot come from anything
# else in the project:
#   GREEN   absolute path to a file that EXISTS           → exit 0  (the migrated shape)
#   INJECT  bare word `quay-native`, no separator         → exit 1  (the stale binding form)
#   RED-2   bare word again, but the SAME name IS on $PATH → exit 1  (host-independence: the
#           verdict must not become "fine" because this host happens to resolve the name)
#   RESTORE absolute path again                           → exit 0
#
# Exit 0 = mutation behaved; 3 = STAYED-GREEN; 4 = ALWAYS-RED; 2 = infrastructure error.
set -u
name="provider-binding-resolvability-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

project="${workdir}/project"
mkdir -p "${project}/.quay" "${project}/tasks"

# The runtime the absolute fixture points at — created so "path-resolved" is a real reading.
runtime="${workdir}/vendor/quay-native/dist/quay-native.js"
mkdir -p "$(dirname "${runtime}")"
printf '// runtime\n' > "${runtime}"

write_config() { # write_config <runtime-token>
  cat > "${project}/.quay/config.yml" <<EOF
providers:
  native:
    enabled: true
    path: .
    mcp_entry:
    - node
    - $1
    - mcp
EOF
}

checker_cmd() {
  node --no-warnings --experimental-strip-types \
    "${checker_dir}/provider-binding-resolvability-check.ts" --root "${project}" >/dev/null 2>&1
}

# `node` must exist, else every branch below is meaningless (infra error, not a verdict).
command -v node >/dev/null 2>&1 || { echo "node not available" >&2; exit 2; }

# GREEN baseline: runtime named by an absolute path that exists.
write_config "${runtime}"
if checker_cmd; then :; else
  echo "baseline RED on a healthy (absolute, existing) binding — checker always-red?" >&2
  exit 4
fi

# INJECT the defect: the legacy bare-PATH form.
write_config "quay-native"
if checker_cmd; then
  echo "STAYED-GREEN — a bare-PATH binding (quay-native, no separator) did not redden the checker" >&2
  exit 3
fi

# HOST-INDEPENDENCE: the same bare name, but with a DIRECTORY CONTAINING AN EXECUTABLE NAMED
# `quay-native` prepended to $PATH. A checker that judged by "does this resolve here?" (the
# isPathBinary blind spot in packages/quay/src/config-validate.ts) would flip to GREEN — which is
# precisely the pre-fix failure mode this check exists to end. It MUST stay RED.
shim="${workdir}/pathshim"
mkdir -p "${shim}"
printf '#!/bin/sh\nexit 0\n' > "${shim}/quay-native"
chmod +x "${shim}/quay-native"
if PATH="${shim}:${PATH}" checker_cmd; then
  echo "PATH-DEPENDENT — a bare-PATH binding reported GREEN once \$PATH happened to hold the name" >&2
  exit 3
fi

# RESTORE the healthy binding.
write_config "${runtime}"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored healthy binding still reddens the checker" >&2
  exit 4
fi

exit 0
