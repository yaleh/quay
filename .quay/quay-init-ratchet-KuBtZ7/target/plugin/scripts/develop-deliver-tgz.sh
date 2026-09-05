#!/usr/bin/env bash
# @instrument "After a develop merge, was a FRESH hardware-independent quay .tgz built at the develop tip and delivered+verified (quay serve http_code=200) on the verification machines B/C (DIR-123 每次 merge 后自动 deliver)?"
# develop-deliver-tgz.sh — DIR-123 (人裁定 2026-08-11): after every develop merge, deliver a
# FRESH, hardware-independent quay artifact to the verification machines B/C and prove it runs.
#
# WHY .tgz AND NOT SEA (manager 2026-08-11 measured finding + outer verification):
#   quay's NORMAL artifact is hardware-independent: dist/quay.js is pure JS
#   (`file` → "Node.js script executable, ASCII text"), the three packages' dependency trees are
#   zero-native (@modelcontextprotocol/sdk/yaml/zod all pure JS), and package.sh's npm-pack route is
#   literally "universally available with Node.js". SEA is a SEPARATE arch-bound path whose ONLY
#   purpose is a machine with NO Node — but B (orangevps) has nvm v22.23.1/v25.2.0 and C (ad-arm1)
#   has ~/.local/opt/node-current/node v24.19.0, both ≥ the engines floor. ⇒ installing the .tgz with
#   the existing new Node covers aarch64 with ZERO arch-bound build. The "build arm64 SEA on ad-arm1"
#   complexity does not need to exist (node-free aarch64 SEA stays an explicitly-out-of-scope future
#   option, recorded in the DIR-123 task Finding).
#
# FLOW (per land closure, best-effort — a remote being down must never fail the merge):
#   1. build quay + quay-native .tgz from a detached worktree AT THE DEVELOP TIP (git worktree add
#      --detach <develop-tip>) — NOT the primary checkout HEAD, which may be integration ahead with
#      untested commits; the delivered artifact must exactly correspond to the merged commit.
#   2. scp both .tgz to B and C.
#   3. on each host: ONE `npm install -g <quay.tgz> <quay-native.tgz>` (single command so
#      quay-native's `quay:*` dep resolves to the local tgz, not the registry), with PATH prepended
#      to the host's Node ≥20.
#   4. verify: quay --help + lay down .quay/config.yml (native provider, mcp_entry quay-native) +
#      `quay serve --port <p>` + curl http_code == 200 + AC92 usage-verify
#      (deliver-verify-usage.sh: run the TOP-N real-use mechanisms — capability-catalog.sh + the
#      offline-runnable subset of three-layer-core-named scripts — assert exit 0 + non-empty output).
#   5. write develop-deliver-state.json (lastDelivered commit + per-host http_code + timestamp).
#
# USAGE:
#   bash plugin/scripts/develop-deliver-tgz.sh [--root <repo>] [--hosts "B C"] [--force]
#     --root   repo root (default: auto-derived from this script's location)
#     --hosts  space-separated host keys (default "B C"; B=orangevps, C=ad-arm1)
#     --force  rebuild + re-deliver even if state.json already shows develop tip delivered
#
# Host table (B/C node paths verified 2026-08-11 by outer ssh probes):
#   B = orangevps.wan.hwang.men   node: ~/.nvm/versions/node/v22.23.1/bin (also v25.2.0)
#   C = ad-arm1.wan.hwang.men     node: ~/.local/opt/node-current/bin (v24.19.0)
# Both reachable BatchMode with the local ~/.ssh/id_ed25519 — zero new secrets (repo has none).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${SCRIPT_DIR}/../.." && pwd)"
state_file="${repo_root}/.quay/develop-deliver-state.json"
worktree_base="${repo_root}/.quay/deliver-worktree"   # under repo (gitignored .quay/), NOT /tmp (tmpfs)
verify_port=18091
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=8)

hosts="B C"
force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --root) repo_root="$2"; shift 2 ;;
    --hosts) hosts="$2"; shift 2 ;;
    --force) force=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# host_key -> (ssh_target, node_path)  — node_path uses $HOME, NOT ~ (tilde does not expand inside
# double quotes in the remote `export PATH="...:..."`); both verified reachable BatchMode 2026-08-11.
declare -A host_target host_node
host_target[B]="orangevps.wan.hwang.men"
host_node[B]="\$HOME/.nvm/versions/node/v22.23.1/bin"
host_target[C]="ad-arm1.wan.hwang.men"
host_node[C]="\$HOME/.local/opt/node-current/bin"

develop_tip="$(git -C "${repo_root}" rev-parse refs/heads/develop 2>/dev/null || echo "")"
if [ -z "${develop_tip}" ]; then
  echo "develop-deliver: ERROR — cannot resolve refs/heads/develop in ${repo_root}" >&2
  exit 1
fi

# Freshness gate: skip when this exact develop tip is already delivered (unless --force).
if [ "${force}" -eq 0 ] && [ -f "${state_file}" ]; then
  prev="$(python3 -c "import json;print(json.load(open('${state_file}')).get('lastDelivered',''))" 2>/dev/null || echo "")"
  if [ "${prev}" = "${develop_tip}" ]; then
    echo "develop-deliver: develop ${develop_tip:0:8} already delivered (state fresh) — skip (pass --force to redo)"
    exit 0
  fi
fi

echo "develop-deliver: develop tip = ${develop_tip:0:12} (${develop_tip})"

# ── 1. Build the two .tgz from a detached worktree at develop-tip ──────────────────────────────
wt="${worktree_base}-${develop_tip:0:12}"
if [ -e "${wt}" ]; then
  git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
fi
echo "develop-deliver: creating detached worktree at develop tip: ${wt}"
git -C "${repo_root}" worktree add --detach "${wt}" "${develop_tip}" >/dev/null 2>&1
# symlink the main checkout's node_modules (hoisted, pure-JS deps) so build-dist/esbuild resolve
ln -s "${repo_root}/node_modules" "${wt}/node_modules" 2>/dev/null || true

build_ok=0
if [ -f "${wt}/packages/quay/scripts/package.sh" ]; then
  echo "develop-deliver: package.sh (quay .tgz)..."
  if (cd "${wt}" && bash packages/quay/scripts/package.sh) >/dev/null 2>&1; then
    quay_tgz="$(ls -1t "${wt}/packages/quay/"quay-*.tgz 2>/dev/null | head -1 || true)"
    echo "  → ${quay_tgz:-MISSING}"
    if [ -n "${quay_tgz}" ] && [ -f "${quay_tgz}" ]; then
      # quay-native: build-dist + npm pack (no package.sh — files array covers dist/)
      if (cd "${wt}/packages/quay-native" && bash scripts/build-dist.sh && npm pack --pack-destination "${wt}/packages/quay-native/") >/dev/null 2>&1; then
        qn_tgz="$(ls -1t "${wt}/packages/quay-native/"quay-native-*.tgz 2>/dev/null | head -1 || true)"
        echo "  → ${qn_tgz:-MISSING}"
        [ -n "${qn_tgz}" ] && [ -f "${qn_tgz}" ] && build_ok=1
      fi
    fi
  fi
fi

if [ "${build_ok}" -eq 0 ]; then
  echo "develop-deliver: BUILD FAILED — see worktree ${wt}" >&2
  git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
  exit 1
fi

# ── 2+3+4. Deliver + install + verify per host ─────────────────────────────────────────────────
declare -A http_codes
deliver_fail=0
for hk in ${hosts}; do
  target="${host_target[$hk]:-}"
  node_path="${host_node[$hk]:-}"
  if [ -z "${target}" ]; then
    echo "develop-deliver: unknown host key '${hk}'" >&2
    deliver_fail=1
    continue
  fi
  # scp both tgz
  if ! scp "${ssh_opts[@]}" "${quay_tgz}" "${qn_tgz}" "${target}:~/" >/dev/null 2>&1; then
    echo "develop-deliver: scp to ${target} (${hk}) FAILED" >&2
    http_codes[$hk]="scp-fail"
    deliver_fail=1
    continue
  fi
  remote_script=$(cat <<REMOTE
set -euo pipefail
export PATH="${node_path}:\$PATH"   # host's Node ≥20 (default PATH is v18.19.1 < engines floor)
npm install -g --no-audit --no-fund "\${HOME}/$(basename "${quay_tgz}")" "\${HOME}/$(basename "${qn_tgz}")" >/dev/null 2>&1
quay --help >/dev/null 2>&1 || { echo "INSTALL-CHECK-FAIL"; exit 1; }
WS="\${HOME}/quay-deliver-ws"
rm -rf "\$WS"; mkdir -p "\$WS/.quay" "\$WS/tasks"
cat > "\$WS/.quay/config.yml" <<'CFG'
providers:
  native:
    enabled: true
    path: "."
    tasks_dir: "./tasks"
    mcp_entry: ["quay-native", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "./tasks"
CFG
cd "\$WS"
quay serve --port ${verify_port} >/dev/null 2>&1 &
SERVE_PID=\$!
sleep 3
code=\$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:${verify_port}/ 2>/dev/null || echo "000")
kill \$SERVE_PID 2>/dev/null || true
wait \$SERVE_PID 2>/dev/null || true
echo "CODE=\$code"
[ "\$code" = "200" ] || exit 1
# AC92 (tasks/gap-ac92-delivery-verify-usage-intersection): the delivery verification surface must
# INTERSECT the actual usage surface. "端口活着" is necessary but not sufficient — run the TOP-N
# real-use mechanisms (capability-catalog.sh + the offline-runnable subset of the three-layer-core-
# named scripts) against the INSTALLED package and assert each really executes (exit 0 + non-empty).
UV_SCRIPTS="\$(npm root -g)/quay/plugin/scripts"
if [ -f "\${UV_SCRIPTS}/deliver-verify-usage.sh" ]; then
  if bash "\${UV_SCRIPTS}/deliver-verify-usage.sh" --plugin-scripts "\${UV_SCRIPTS}" --ws "\$WS" --timeout 30 >"\${WS}/deliver-verify-usage.out" 2>&1; then
    echo "USAGE-VERIFY-OK"
  else
    echo "USAGE-VERIFY-FAIL"
    tail -25 "\${WS}/deliver-verify-usage.out" >&2
    exit 1
  fi
else
  # Older installed artifact without the AC92 verification script — report as a skip, not a pass.
  echo "USAGE-VERIFY-SKIP (deliver-verify-usage.sh not in installed package)"
fi
REMOTE
)
  out="$(ssh "${ssh_opts[@]}" "${target}" "bash -s" <<< "${remote_script}" 2>&1)"
  code="$(printf '%s\n' "${out}" | grep -oE 'CODE=[0-9]+' | tail -1 | cut -d= -f2 || echo "")"
  uv_ok="$(printf '%s\n' "${out}" | grep -c 'USAGE-VERIFY-OK' || true)"
  if [ -n "${code}" ] && [ "${code}" = "200" ] && [ "${uv_ok}" -ge 1 ]; then
    echo "develop-deliver: ${hk} (${target}) OK — quay serve http_code=${code} + usage-verify OK (AC92 top-N real-use mechanisms)"
    http_codes[$hk]="${code}"
  else
    echo "develop-deliver: ${hk} (${target}) VERIFY FAILED:" >&2
    printf '%s\n' "${out}" | tail -12 >&2
    http_codes[$hk]="verify-fail"
    deliver_fail=1
  fi
done

# ── 5. Record state + cleanup ──────────────────────────────────────────────────────────────────
state_json="{\"lastDelivered\":\"${develop_tip}\",\"hosts\":{"
first=1
for hk in "${!http_codes[@]}"; do
  [ "${first}" -eq 0 ] && state_json="${state_json},"
  state_json="${state_json}\"${hk}\":\"${http_codes[$hk]}\""
  first=0
done
state_json="${state_json}},\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
mkdir -p "$(dirname "${state_file}")"
printf '%s\n' "${state_json}" > "${state_file}"
echo "develop-deliver: state written → ${state_file}"

# clean up the build worktree (keep the .tgz copies? no — scp'd already; remove worktree)
git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"

if [ "${deliver_fail}" -eq 1 ]; then
  echo "develop-deliver: PARTIAL FAILURE (some hosts failed) — state recorded; outer tick may retry" >&2
  exit 1
fi
echo "develop-deliver: OK — fresh quay ${quay_tgz##*/} delivered + verified on all hosts"
