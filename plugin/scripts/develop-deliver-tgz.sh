#!/usr/bin/env bash
# @instrument "After a develop merge, was a FRESH hardware-independent quay .tgz built at the develop tip and delivered+verified (quay serve http_code=200) on the verification machines B/C (DIR-123 每次 merge 后自动 deliver)?"
# develop-deliver-tgz.sh — DIR-123 (人裁定 2026-08-11) deliver mechanism, RE-ANCHORED as the
# LOW-FREQUENCY trigger (gap-deliver-verification-trigger-orphaned-after-land-path-migration): the
# per-merge hook that used to live in integration-batch-merge.sh is RETIRED (the land path moved to
# worker-driver.ts's mechanical fan-in, which never delivers). Invoke THIS script on a low-frequency
# anchor (OS cron / manager); it self-throttles (see --check/--max-age) and delivers a FRESH,
# hardware-independent quay artifact to the verification machines B/C, proving it runs.
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
# FLOW (best-effort — a remote being down must never fail the trigger):
#   1. build quay + quay-native .tgz from a detached worktree AT THE DEVELOP TIP (git worktree add
#      --detach <develop-tip>) — NOT the primary checkout HEAD, which may be integration ahead with
#      untested commits; the delivered artifact must exactly correspond to the merged commit.
#   2. scp both .tgz to B and C.
#   3. on each host: ONE `npm install -g <quay.tgz> <quay-native.tgz>` (single command so
#      quay-native's `quay:*` dep resolves to the local tgz, not the registry), with PATH prepended
#      to the host's Node ≥20.
#   4. verify the SERVED SURFACE (not just "a port is open"): `verify_http_surface` follows the `/`
#      redirect (gap-webui-root-should-show-dashboard: `/` 302s to `/dashboard` since 01437b3e6) and
#      asserts the FINAL code is 200 AND `/dashboard` returns a non-empty body carrying the stable
#      `<title>Dashboard</title>` marker. Separately, AC92 usage-verify runs the TOP-N real-use
#      mechanisms (deliver-verify-usage.sh) — the http signal and the usage_verify signal are kept
#      DISTINCT in state.json (a usage-verify fail must never mask an http pass, nor vice versa).
#   5. write develop-deliver-state.json (lastDelivered commit + per-host http_code + per-host
#      usage_verify + timestamp).
#
# LOW-FREQUENCY TRIGGER (gap-deliver-verification-trigger-orphaned-after-land-path-migration):
#   This script is NOW the low-frequency deliver trigger — the cron anchor entry point — after the
#   land path migrated off integration-batch-merge.sh (DIR-123's per-merge --deliver hook there is
#   RETIRED; nothing on the mechanical fan-in sync path calls this). Invoke it directly (or from a
#   low-frequency OS cron / manager anchor); it self-throttles on direct quantities so a caller can
#   fire it as often as it likes and it only delivers when the develop tip has moved PAST the last
#   delivered commit AND the last deliver is older than --max-age (default 6h). A remote being down
#   must never fail the caller: the deliver is still best-effort (recorded in state.json, retried
#   on the next trigger).
#
# USAGE:
#   bash plugin/scripts/develop-deliver-tgz.sh [--root <repo>] [--hosts "B C"] [--force]
#                                             [--check] [--max-age <seconds>] [--selfcheck]
#     --root       repo root (default: auto-derived from this script's location)
#     --hosts      space-separated host keys (default "B C"; B=orangevps, C=ad-arm1)
#     --force      rebuild + re-deliver even if state.json already shows develop tip delivered
#     --check      compute the trigger decision ONLY (fresh|too-soon|deliver) from direct quantities
#                  and print it (JSON + one line) — do NOT build/scp/install/verify. Exit 0.
#     --max-age    low-frequency hold in seconds: when the develop tip has moved but the last deliver
#                  is younger than this, decision=too-soon (no deliver). Default 21600 (6h).
#     --selfcheck  hermetic positive/negative controls of the verify criterion + state aggregation
#                  (offline, no build/scp/ssh) — the AC3/AC4/AC5 negative controls, exit 0/1
#
# Host table (B/C node paths verified 2026-08-11 by outer ssh probes):
#   B = orangevps.wan.hwang.men   node: ~/.nvm/versions/node/v22.23.1/bin (also v25.2.0)
#   C = ad-arm1.wan.hwang.men     node: ~/.local/opt/node-current/bin (v24.19.0)
# Both reachable BatchMode with the local ~/.ssh/id_ed25519 — zero new secrets (repo has none).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${SCRIPT_DIR}/../.." && pwd)"
verify_port=18091
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=8)

hosts="B C"
force=0
check_only=0
max_age=21600   # low-frequency hold: don't re-deliver within this many seconds of the last deliver (6h)
selfcheck=0
while [ $# -gt 0 ]; do
  case "$1" in
    --root) repo_root="$2"; shift 2 ;;
    --hosts) hosts="$2"; shift 2 ;;
    --force) force=1; shift ;;
    --check) check_only=1; shift ;;
    --max-age) max_age="$2"; shift 2 ;;
    --selfcheck) selfcheck=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
case "${max_age}" in
  ''|*[!0-9]*) echo "develop-deliver: --max-age must be a non-negative integer: ${max_age}" >&2; exit 2 ;;
esac

# state/worktree paths derive from the FINAL repo_root (--root override must reach them — a fixture
# --check run otherwise reads the script's own .quay/, not the fixture's).
state_file="${repo_root}/.quay/develop-deliver-state.json"
worktree_base="${repo_root}/.quay/deliver-worktree"   # under repo (gitignored .quay/), NOT /tmp (tmpfs)

# ── verify_http_surface <base_url> ──────────────────────────────────────────────────────────────
# gap-develop-deliver-asserts-http-200-but-root-now-302-redirects: the criterion is FOLLOW THE
# REDIRECT AND ASSERT THE FINAL LANDING REALLY SERVES — not "code == 200 on /". Since 01437b3e6,
# `/` 302s to `/dashboard`; `curl -sf` (no -L) read that as a 302 and failed the deliver even though
# the service is fine. The criterion:
#   1. `curl -sL` on `/` → the FINAL http code after following redirects must be 200.
#      (No `-f`: we want the code even for 4xx/5xx so the reason is recorded; a 302→404 chain yields
#      final code 404 ≠ 200 ⇒ fail — a redirect to 404 is NOT accepted, per the task's ⛔ note.)
#   2. `curl -sL` on `/dashboard` → the body must be non-empty AND carry the stable marker
#      `<title>Dashboard</title>` (AC92 spirit: 端口活着 ≠ 面在服务).
# Prints ONE machine-readable verdict line and returns 0 (pass) / 1 (fail). Self-contained: every
# call re-derives its own output (the selfcheck calls it repeatedly) — no inherited state.
verify_http_surface() {
  local base="$1" final_code body
  final_code="$(curl -sL -o /dev/null -w '%{http_code}' "${base}/" 2>/dev/null || echo "000")"
  if [ "${final_code}" != "200" ]; then
    echo "FAIL reason=root-final-code-not-200 code=${final_code}"
    return 1
  fi
  body="$(curl -sL "${base}/dashboard" 2>/dev/null || true)"
  if [ -z "${body}" ]; then
    echo "FAIL reason=dashboard-body-empty code=${final_code}"
    return 1
  fi
  case "${body}" in
    *"<title>Dashboard</title>"*) ;;
    *) echo "FAIL reason=dashboard-marker-missing code=${final_code}"; return 1 ;;
  esac
  echo "OK final_code=${final_code} dashboard=ok"
  return 0
}

# ── build_state_json <http-array> <usage-array> <tip> ───────────────────────────────────────────
# Single source for the state.json record. Reads the two per-host associative arrays by nameref and
# renders lastDelivered + hosts (http) + usage_verify + timestamp. The selfcheck feeds it synthetic
# arrays to prove every host keeps BOTH signals (no missing key) and the failure values stay
# distinct (verify-fail vs not-evaluated) — 硬规则 3b.
build_state_json() {
  local -n hc="$1" uv="$2"
  local tip="$3" json first hk
  json="{\"lastDelivered\":\"${tip}\",\"hosts\":{"
  first=1
  for hk in "${!hc[@]}"; do
    [ "${first}" -eq 0 ] && json="${json},"
    json="${json}\"${hk}\":\"${hc[$hk]}\""
    first=0
  done
  json="${json}},\"usage_verify\":{"
  first=1
  for hk in "${!uv[@]}"; do
    [ "${first}" -eq 0 ] && json="${json},"
    json="${json}\"${hk}\":\"${uv[$hk]}\""
    first=0
  done
  json="${json}},\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
  printf '%s' "${json}"
}

# ── selfcheck — hermetic positive/negative controls (offline, no build/scp/ssh) ─────────────────
# Proves the verify criterion can take FALSE (404 / redirect-to-404 / empty body / missing marker)
# and TRUE (302→dashboard→200, direct 200), and that the state aggregation keeps every host's two
# signals present + distinct. Uses a throwaway node HTTP stub on an OS-assigned port.
selfcheck() {
  local tmp rc=0
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck: FAIL — cannot create temp dir" >&2; return 1; }
  cat > "${tmp}/stub.mjs" <<'STUB'
import http from "node:http";
const scenario = process.argv[2];
const ok = "<html><head><title>Dashboard</title></head><body>dashboard</body></html>";
const srv = http.createServer((req, res) => {
  const p = new URL(req.url, "http://127.0.0.1").pathname;
  const redirect = () => { res.writeHead(302, { Location: "/dashboard" }); res.end(); };
  const text = (body, code) => { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }); res.end(body); };
  if (scenario === "redirect-ok")     { if (p === "/") return redirect(); return text(ok, 200); }
  if (scenario === "direct-ok")       { return text(ok, 200); }
  if (scenario === "root-404")        { if (p === "/") return text("not found", 404); return text(ok, 200); }
  if (scenario === "redirect-to-404") { if (p === "/") return redirect(); return text("not found", 404); }
  if (scenario === "empty-body")      { if (p === "/") return redirect(); return text("", 200); }
  if (scenario === "no-marker")       { if (p === "/") return redirect(); return text("<html><head><title>Wrong</title></head></html>", 200); }
  return text(ok, 200);
});
srv.listen(0, "127.0.0.1", () => process.stdout.write(String(srv.address().port) + "\n"));
STUB

  # run_one_control <scenario> <expect-ok|expect-fail>
  run_one_control() {
    local scenario="$1" expect="$2" portfile pid port verdict vrc i
    portfile="${tmp}/port.${RANDOM}"
    node "${tmp}/stub.mjs" "${scenario}" > "${portfile}" 2>/dev/null &
    pid=$!
    port=""
    for i in $(seq 1 60); do
      # strip ANSI escape sequences defensively (FORCE_COLOR=3 colourises console.log even to a file)
      port="$(head -1 "${portfile}" 2>/dev/null | sed $'s/\033\[[0-9;]*m//g' | tr -d '\r\n' || echo "")"
      [ -n "${port}" ] && break
      sleep 0.05
    done
    if [ -z "${port}" ]; then
      echo "selfcheck: ${scenario} → STUB FAILED TO START (no port assigned)" >&2
      kill "${pid}" 2>/dev/null || true
      wait "${pid}" 2>/dev/null || true
      rm -f "${portfile}"
      rc=1
      return
    fi
    if verdict="$(verify_http_surface "http://127.0.0.1:${port}" 2>/dev/null)"; then
      vrc=0
    else
      vrc=$?
    fi
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    rm -f "${portfile}"
    echo "selfcheck: ${scenario} → ${verdict} (rc=${vrc}, expect ${expect})"
    case "${expect}" in
      ok)   [ "${vrc}" -eq 0 ] || rc=1 ;;
      fail) [ "${vrc}" -ne 0 ] || rc=1 ;;
    esac
  }

  run_one_control redirect-ok ok
  run_one_control direct-ok ok
  run_one_control root-404 fail
  run_one_control redirect-to-404 fail
  run_one_control empty-body fail
  run_one_control no-marker fail

  # state-aggregation control (AC4): one host verified-ok, one verify-failed, one never reached —
  # all three appear with BOTH the http and usage_verify signals, and the failure values stay
  # distinct (verify-fail vs not-evaluated, 硬规则 3b) — a single-host failure must not drop a key.
  declare -A sc_http sc_uv
  sc_http[B]="verify-fail"; sc_http[C]="200"; sc_http[D]="not-evaluated"
  sc_uv[B]="not-run";       sc_uv[C]="ok";   sc_uv[D]="not-run"
  local sc_json both_keys=0 distinct=0
  sc_json="$(build_state_json sc_http sc_uv "test-tip")"
  printf '%s' "${sc_json}" | grep -q '"B"' && printf '%s' "${sc_json}" | grep -q '"C"' && both_keys=1
  printf '%s' "${sc_json}" | grep -q '"verify-fail"' \
    && printf '%s' "${sc_json}" | grep -q '"200"' \
    && printf '%s' "${sc_json}" | grep -q '"not-evaluated"' && distinct=1
  echo "selfcheck: state-aggregation both-keys=${both_keys} distinct-values=${distinct} (expect 1/1)"
  [ "${both_keys}" -eq 1 ] || rc=1
  [ "${distinct}" -eq 1 ] || rc=1

  rm -rf "${tmp}"
  if [ "${rc}" -eq 0 ]; then
    echo "selfcheck: PASS — verify_http_surface follows / to a final 200 with a dashboard marker (302→dashboard passes; 404 / 302→404 / empty-body / no-marker fail) and the per-host state record keeps every host's http + usage_verify signals present and distinct"
  else
    echo "selfcheck: FAIL" >&2
  fi
  return "${rc}"
}

if [ "${selfcheck}" -eq 1 ]; then
  selfcheck
  exit $?
fi

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

# ── trigger decision (direct quantities; can be false) ──────────────────────────────────────────────
#   decision = fresh     lastDelivered == develop_tip  (this exact tip already delivered)
#            = too-soon  lastDelivered != tip but age <= --max-age (low-frequency hold, no deliver)
#            = deliver   state.json absent (never delivered), OR (lastDelivered != tip AND age > max-age)
# --force overrides every branch to deliver. The state comes ONLY from .quay/develop-deliver-state.json
# (the deliver's own record) — never from this script's own recent invocations (硬规则 4b).
read_state_field() {
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get(sys.argv[2],''))" "${state_file}" "$1" 2>/dev/null || echo ""
}

decision="deliver"
last_delivered=""
age_seconds=""
if [ "${force}" -eq 1 ]; then
  decision="deliver"
elif [ -f "${state_file}" ]; then
  last_delivered="$(read_state_field lastDelivered)"
  ts="$(read_state_field timestamp)"
  if [ -n "${ts}" ]; then
    age_seconds="$(python3 -c "import sys,datetime; d=datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')); print(max(0,int((datetime.datetime.now(datetime.timezone.utc)-d).total_seconds())))" "${ts}" 2>/dev/null || echo "")"
  fi
  if [ "${last_delivered}" = "${develop_tip}" ]; then
    decision="fresh"
  elif [ -n "${age_seconds}" ] && [ "${age_seconds}" -le "${max_age}" ]; then
    decision="too-soon"
  else
    decision="deliver"
  fi
else
  decision="deliver"   # state.json absent ⇒ never delivered ⇒ deliver
fi

if [ "${check_only}" -eq 1 ]; then
  printf '{"decision":"%s","lastDelivered":"%s","develop":"%s","age_seconds":%s,"max_age":%s}\n' \
    "${decision}" "${last_delivered}" "${develop_tip}" "${age_seconds:-null}" "${max_age}"
  echo "develop-deliver: check decision=${decision} (develop=${develop_tip:0:8}, lastDelivered=${last_delivered:-<none>}, age_seconds=${age_seconds:-null}, max_age=${max_age})"
  exit 0
fi

if [ "${decision}" != "deliver" ]; then
  echo "develop-deliver: skip — decision=${decision} (develop ${develop_tip:0:8}; pass --force to redo)"
  exit 0
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
# The loop must NOT abort on a single host's failure: each host records its own http + usage_verify
# signal (distinct failure values), and the run only fails at the END after every host is attempted.
declare -A http_codes usage_verify
deliver_fail=0
for hk in ${hosts}; do
  target="${host_target[$hk]:-}"
  node_path="${host_node[$hk]:-}"
  if [ -z "${target}" ]; then
    echo "develop-deliver: ${hk} — unknown host key (not-evaluated)"
    http_codes[$hk]="not-evaluated"
    usage_verify[$hk]="not-run"
    deliver_fail=1
    continue
  fi
  # scp both tgz
  if ! scp "${ssh_opts[@]}" "${quay_tgz}" "${qn_tgz}" "${target}:~/" >/dev/null 2>&1; then
    echo "develop-deliver: ${hk} (${target}) — scp FAILED (not-evaluated)"
    http_codes[$hk]="not-evaluated"
    usage_verify[$hk]="not-run"
    deliver_fail=1
    continue
  fi
  remote_script=$(cat <<REMOTE
set -euo pipefail
$(declare -f verify_http_surface)
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
# verify the served surface (follow the / redirect, assert final 200 + dashboard content). The
# verdict is EMITTED (not swallowed) so the local side can print the actual code + reason.
http_verdict="\$(verify_http_surface "http://localhost:${verify_port}" 2>/dev/null || echo "FAIL reason=verify-criterion-unhandled code=000")"
kill \$SERVE_PID 2>/dev/null || true
wait \$SERVE_PID 2>/dev/null || true
echo "HTTP-VERDICT \${http_verdict}"
# AC92 (tasks/gap-ac92-delivery-verify-usage-intersection): the delivery verification surface must
# INTERSECT the actual usage surface. Kept a SEPARATE signal from http — a usage-verify fail must
# not mask an http pass, nor vice versa (recorded independently by the local side).
UV_SCRIPTS="\$(npm root -g)/quay/plugin/scripts"
if [ -f "\${UV_SCRIPTS}/deliver-verify-usage.sh" ]; then
  if bash "\${UV_SCRIPTS}/deliver-verify-usage.sh" --plugin-scripts "\${UV_SCRIPTS}" --ws "\$WS" --timeout 30 >"\${WS}/deliver-verify-usage.out" 2>&1; then
    echo "USAGE-VERIFY-OK"
  else
    echo "USAGE-VERIFY-FAIL"
    tail -25 "\${WS}/deliver-verify-usage.out" >&2
  fi
else
  # Older installed artifact without the AC92 verification script — report as a skip, not a pass.
  echo "USAGE-VERIFY-SKIP (deliver-verify-usage.sh not in installed package)"
fi
REMOTE
)
  # Capture the remote output WITHOUT `set -e` aborting the whole multi-host loop on the remote's
  # non-zero exit (a verify/install failure is a per-host result, not a reason to skip the rest).
  set +e
  out="$(ssh "${ssh_opts[@]}" "${target}" "bash -s" <<< "${remote_script}" 2>&1)"
  remote_rc=$?
  set -e
  http_verdict="$(printf '%s\n' "${out}" | grep -oE 'HTTP-VERDICT .*' | tail -1 | sed 's/^HTTP-VERDICT //' || echo "")"
  uv_ok="$(printf '%s\n' "${out}" | grep -c 'USAGE-VERIFY-OK' || true)"
  uv_skip="$(printf '%s\n' "${out}" | grep -c 'USAGE-VERIFY-SKIP' || true)"

  # http verdict → final code + pass/fail (the verdict line already carries `final_code=<n>`).
  http_ok=0; http_code=""
  case "${http_verdict}" in
    OK\ *) http_ok=1; http_code="$(printf '%s' "${http_verdict}" | grep -oE 'final_code=[0-9]+' | head -1 | cut -d= -f2)"; ;;
  esac

  # usage-verify state (separate from http): ok / skip / fail / not-run.
  if [ "${uv_ok}" -ge 1 ]; then
    usage_verify[$hk]="ok"
  elif [ "${uv_skip}" -ge 1 ]; then
    usage_verify[$hk]="skip"
  elif [ "${http_ok}" -eq 0 ]; then
    usage_verify[$hk]="not-run"   # serve failed ⇒ the remote aborted before usage-verify
  else
    usage_verify[$hk]="fail"
  fi

  if [ "${http_ok}" -eq 1 ]; then
    echo "develop-deliver: ${hk} (${target}) OK — final_code=${http_code} (follow redirects) + usage-verify=${usage_verify[$hk]}"
    http_codes[$hk]="${http_code}"
  else
    echo "develop-deliver: ${hk} (${target}) VERIFY FAILED — ${http_verdict:-remote-error-no-verdict}"
    if [ -z "${http_verdict}" ]; then
      # remote crashed before emitting a verdict (install/init failure) — surface its stderr.
      printf '%s\n' "${out}" | tail -12
    fi
    http_codes[$hk]="verify-fail"
    deliver_fail=1
  fi
done

# ── 5. Record state + cleanup ──────────────────────────────────────────────────────────────────
state_json="$(build_state_json http_codes usage_verify "${develop_tip}")"
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
