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
#     --verify-coldstart  cross-host evidence transport (gap-third-party-evidence-no-transport-to-
#                  driving-repo-carrier): build the two .tgz at the develop tip, scp
#                  verify-deliver-coldstart.sh + the two .tgz to each host, run it there with an
#                  explicit --ac89 <remote tmp path>, scp that evidence file back, and append its
#                  lines into <repo>/.quay/productization-verification.jsonl (dedup on
#                  (ts,ac,host,project_root)). A host that produces no evidence ⇒ NOT-EVALUATED +
#                  exit 1 (硬规则 3b). Distinct from the deliver mode (no http/usage surface verify).
#     --verify-upgrade --upgrade-source <rel-to-$HOME>   GOAL-009-AC-238: the SAME transport, but the
#                  remote script runs --upgrade-existing against an ISOLATED COPY of an AGED real
#                  third-party project (already has .quay/config.yml + real tasks/ + an old vendored
#                  .quay/runtime/bin/*) instead of a fresh quay-init target. Only the
#                  ac=GOAL-009-AC-238 record is transported + dedup-appended; a host that produces no
#                  such record ⇒ NOT-EVALUATED + exit 1. ⛔ The source project is only cp -a'd (read),
#                  never written — the live project's backlog is untouched.
#     --ac207-e2e     (with --verify-coldstart) additionally run the GOAL-009-AC-207 end-to-end step
#                  on each host: scp the driving repo's .quay/profiles.yml (so the target project's
#                  worker-default launcher/model/auth derive from the single source of truth), put
#                  ~/.local/bin on the remote PATH, and pass --ac207-e2e + --driving-profiles to the
#                  remote verify. Expensive: the worker-driver spawns a real worker (claude-fjdac -p)
#                  that does a full implementation → fan-in → suite (up to AC207_POLL_SECS).
#     --selfcheck-evidence [positive|negative|both]  hermetic controls of the evidence-transport
#                  append/dedup function (offline, no build/scp/ssh) — the AC5 negative/positive
#                  controls of gap-third-party-evidence-…, exit 0/1
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
verify_coldstart=0
verify_upgrade=0  # 1 = GOAL-009-AC-238: upgrade an ISOLATED COPY of an AGED third-party project (not a fresh quay-init)
upgrade_source="" # --upgrade-source: path RELATIVE TO $HOME on the remote host of the aged project to copy (read-only)
ac207_e2e=0       # 1 = also run the GOAL-009-AC-207 end-to-end step on each host (expensive: worker-driver spawns a real worker)
selfcheck_evidence=0
selfcheck_evidence_scenario="both"
selfcheck_evidence_completeness=0
while [ $# -gt 0 ]; do
  case "$1" in
    --root) repo_root="$2"; shift 2 ;;
    --hosts) hosts="$2"; shift 2 ;;
    --force) force=1; shift ;;
    --check) check_only=1; shift ;;
    --max-age) max_age="$2"; shift 2 ;;
    --selfcheck) selfcheck=1; shift ;;
    --verify-coldstart) verify_coldstart=1; shift ;;
    --verify-upgrade) verify_upgrade=1; shift ;;
    --upgrade-source) upgrade_source="$2"; shift 2 ;;
    --ac207-e2e) ac207_e2e=1; shift ;;
    --selfcheck-evidence)
      selfcheck_evidence=1
      case "${2:-}" in positive|negative|both) selfcheck_evidence_scenario="$2"; shift 2 ;; *) shift ;; esac
      ;;
    --selfcheck-evidence-completeness) selfcheck_evidence_completeness=1; shift ;;
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

# ── transport_evidence_append <local-carrier> <evidence-file> ───────────────────────────────
# Append the non-empty JSON lines of <evidence-file> into <local-carrier>, deduped on the
# (ts, ac, host, project_root) signature so re-transporting the SAME evidence file is idempotent
# (Plan step 3: repeated transport must not inflate a single record into many — AC-214 freshness).
# Returns 0 + prints `EVIDENCE-TRANSPORT appended=N`; returns 1 + prints `NOT-EVALUATED` when
# <evidence-file> is missing / unreadable / has zero non-empty lines (硬规则 3b: 缺值 ≠ 合格,
# and never silent exit 0 on "no evidence").
transport_evidence_append() {
  local carrier="$1" evidence="$2" appended
  if [ ! -f "$evidence" ] || [ ! -r "$evidence" ]; then
    echo "NOT-EVALUATED evidence-file-missing-or-unreadable path=${evidence}"
    return 1
  fi
  if [ "$(grep -c '.' "$evidence" 2>/dev/null || true)" -eq 0 ]; then
    echo "NOT-EVALUATED evidence-file-zero-lines path=${evidence}"
    return 1
  fi
  mkdir -p "$(dirname "$carrier")"
  appended="$(python3 - "$carrier" "$evidence" <<'PY'
import json, sys
carrier, evidence = sys.argv[1], sys.argv[2]
def sig(r):
    return json.dumps([r.get("ts",""), r.get("ac",""), r.get("host",""), r.get("project_root","")], sort_keys=True)
existing = set()
try:
    with open(carrier, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                existing.add(sig(json.loads(line)))
            except Exception:
                pass
except FileNotFoundError:
    pass
appended = 0
with open(carrier, "a", encoding="utf-8") as out, open(evidence, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        s = sig(r)
        if s in existing:
            continue
        existing.add(s)
        out.write(line + "\n")
        appended += 1
print(appended)
PY
)"
  if [ -z "$appended" ]; then
    echo "NOT-EVALUATED evidence-parse-failed path=${evidence}"
    return 1
  fi
  case "$appended" in ''|*[!0-9]*) echo "NOT-EVALUATED evidence-parse-failed path=${evidence}"; return 1 ;; esac
  echo "EVIDENCE-TRANSPORT appended=${appended} carrier=${carrier} evidence=${evidence}"
  return 0
}

# ── check_evidence_completeness <evidence-file> "<expected-ac-list>" ───────────────────────────
# Plan 5 of gap-cross-host-evidence-run-incomplete-…: 声明该次运行【预期】产出的 ac 集合，与实际回传的
# 集合求差，缺失项逐条打印。此前「一次只回传 2 种记录」被当作成功（evidence_lines=4）——部分产出与
# 完全成功同形（硬规则 3b 同族）。三个可区分取值：
#   OK (exit 0)          —— expected 全在 present 里（完整）。
#   NOT-EVALUATED (exit 1) —— evidence 缺/空/零行，或 present∩expected 为空（全缺，与「没证据」同判）。
#   PARTIAL (exit 2)     —— 部分缺（present∩expected 非空但 missing 非空），逐条打印缺失 ac。
# 入参 $2 = 空格分隔的预期 ac 列表（如 "GOAL-009-AC-203 GOAL-009-AC-204 …"）。expected 为空 ⇒ 跳过（exit 0）。
check_evidence_completeness() {
  local evidence="$1" expected="$2" result pyrc
  [ -n "${expected}" ] || { echo "OK completeness skipped (no expected ac set declared)"; return 0; }
  if [ ! -f "${evidence}" ] || [ ! -r "${evidence}" ]; then
    echo "NOT-EVALUATED evidence-file-missing-or-unreadable path=${evidence}"
    return 1
  fi
  if [ "$(grep -c '.' "${evidence}" 2>/dev/null || true)" -eq 0 ]; then
    echo "NOT-EVALUATED evidence-file-zero-lines path=${evidence}"
    return 1
  fi
  result="$(python3 - "${evidence}" "${expected}" <<'PY'
import json, sys
evidence, expected = sys.argv[1], sys.argv[2].split()
present = set()
with open(evidence, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        a = r.get("ac", "")
        if a:
            present.add(a)
exp = set(expected)
have = present & exp
if not have:
    print("ALL-MISSING present=%d" % len(present))
    sys.exit(3)
missing = sorted(exp - present)
if missing:
    print("PARTIAL present=%d missing=%d list=%s" % (len(have), len(missing), ",".join(missing)))
    sys.exit(2)
print("COMPLETE present=%d" % len(have))
sys.exit(0)
PY
)"
  pyrc=$?
  echo "develop-deliver: evidence-completeness ${result}"
  case "$pyrc" in
    0) return 0 ;;
    2) return 2 ;;
    *) return 1 ;;
  esac
}

# ── selfcheck_evidence [positive|negative|both] — hermetic controls of the transport fn ──────
# AC5 of gap-third-party-evidence-…: ① a fixture evidence file carrying GOAL-009-AC-* lines appends
# into the target carrier and a repeat call appends 0 (idempotent) ② a missing / empty evidence file
# returns a distinguishable NOT-EVALUATED (non-zero) rather than success, and the carrier is unchanged.
selfcheck_evidence() {
  local scenario="${1:-both}" tmp rc=0 carrier ev after n
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck-evidence: FAIL — cannot create temp dir" >&2; return 1; }
  if [ "${scenario}" = "positive" ] || [ "${scenario}" = "both" ]; then
    carrier="${tmp}/carrier.jsonl"
    ev="${tmp}/evidence-good.jsonl"
    cat > "${ev}" <<'EVID'
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-206","host":"orangevps","project_root":"/home/verify/quay-verify-coldstart-root","goals_dir_created":true,"tasks_dir_created":true,"goal_store_readable":true,"task_store_readable":true}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/verify/quay-verify-coldstart-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":3}
EVID
    after="$(transport_evidence_append "${carrier}" "${ev}")" || rc=1
    echo "selfcheck-evidence: positive first-append → ${after}"
    printf '%s' "${after}" | grep -q 'appended=2' || rc=1
    after="$(transport_evidence_append "${carrier}" "${ev}")" || rc=1
    echo "selfcheck-evidence: positive repeat-append → ${after}"
    printf '%s' "${after}" | grep -q 'appended=0' || rc=1
    n="$(grep -c '.' "${carrier}" 2>/dev/null || true)"
    [ -n "${n}" ] || n=0
    [ "${n}" = "2" ] || { echo "selfcheck-evidence: carrier lines=${n} (expect 2 — repeat must not duplicate)" >&2; rc=1; }
    [ "${rc}" -eq 0 ] && echo "selfcheck-evidence: positive PASS (2 lines appended; repeat idempotent)"
  fi
  if [ "${scenario}" = "negative" ] || [ "${scenario}" = "both" ]; then
    carrier="${tmp}/carrier-neg.jsonl"
    if transport_evidence_append "${carrier}" "${tmp}/evidence-missing.jsonl"; then
      echo "selfcheck-evidence: negative FAIL — missing evidence returned success" >&2; rc=1
    else
      echo "selfcheck-evidence: negative missing → NOT-EVALUATED (non-zero, as required)"
    fi
    : > "${tmp}/evidence-empty.jsonl"
    if transport_evidence_append "${carrier}" "${tmp}/evidence-empty.jsonl"; then
      echo "selfcheck-evidence: negative FAIL — empty evidence returned success" >&2; rc=1
    else
      echo "selfcheck-evidence: negative empty → NOT-EVALUATED (non-zero, as required)"
    fi
    n="$(grep -c '.' "${carrier}" 2>/dev/null || true)"
    [ -n "${n}" ] || n=0
    echo "selfcheck-evidence: negative carrier lines=${n}"
    [ "${n}" = "0" ] || { echo "selfcheck-evidence: negative FAIL — carrier lines=${n} (expect 0 — carrier unchanged)" >&2; rc=1; }
    [ "${rc}" -eq 0 ] && echo "selfcheck-evidence: negative PASS (missing/empty evidence → NOT-EVALUATED, carrier unchanged)"
  fi
  rm -rf "${tmp}"
  return "${rc}"
}

if [ "${selfcheck}" -eq 1 ]; then
  selfcheck
  exit $?
fi

if [ "${selfcheck_evidence}" -eq 1 ]; then
  selfcheck_evidence "${selfcheck_evidence_scenario}"
  exit $?
fi

# ── selfcheck_evidence_completeness — hermetic controls of check_evidence_completeness (AC7/AC8) ──
# 两个方向：① 「预期 6 种、实际 2 种」⇒ PARTIAL（exit 2）且逐条列出 4 个缺失 ac；② 全产出 ⇒ COMPLETE
# （exit 0）。另含全缺 ⇒ NOT-EVALUATED（exit 1）。offline：temp dir + python3，无 build/scp/ssh。
selfcheck_evidence_completeness() {
  local tmp rc=0 ev partial_out complete_out rc_partial rc_complete rc_allmissing
  local expected="GOAL-009-AC-203 GOAL-009-AC-204 GOAL-009-AC-205 GOAL-009-AC-206 GOAL-009-AC-232 GOAL-015-AC-234"
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck-evidence-completeness: FAIL — cannot create temp dir" >&2; return 1; }

  # ① PARTIAL：evidence 只含 2/6 种（AC-204、AC-206）⇒ exit 2 且逐条列出 4 个缺失。
  ev="${tmp}/evidence-partial.jsonl"
  cat > "${ev}" <<'EVID'
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-204","host":"B","project_root":"/tmp/x","forbidden_count":0,"enable_declared":true}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-206","host":"B","project_root":"/tmp/x","goals_dir_created":true,"tasks_dir_created":true,"goal_store_readable":true,"task_store_readable":true}
EVID
  set +e
  partial_out="$(check_evidence_completeness "${ev}" "${expected}" 2>&1)"
  rc_partial=$?
  set -e
  echo "selfcheck-evidence-completeness: partial → rc=${rc_partial} ${partial_out}"
  [ "${rc_partial}" = "2" ] || { echo "selfcheck-evidence-completeness: FAIL — 2/6 预期种应 exit 2 (PARTIAL), got ${rc_partial}" >&2; rc=1; }
  printf '%s' "${partial_out}" | grep -q 'list=' && printf '%s' "${partial_out}" | grep -q 'missing=4' || { echo "selfcheck-evidence-completeness: FAIL — PARTIAL must print missing=4 + list" >&2; rc=1; }

  # ② COMPLETE：evidence 含全 6 种 ⇒ exit 0。
  ev="${tmp}/evidence-complete.jsonl"
  cat > "${ev}" <<'EVID'
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-203","host":"B","project_root":"/tmp/x","has_plugin_dir":false,"driver_alive":1,"carrier_records":3}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-204","host":"B","project_root":"/tmp/x","forbidden_count":0,"enable_declared":true}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-205","host":"B","project_root":"/tmp/x","shipped_from_installed_artifact":true,"transcript_confirmed":true}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-206","host":"B","project_root":"/tmp/x","goals_dir_created":true,"tasks_dir_created":true,"goal_store_readable":true,"task_store_readable":true}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-232","host":"B","project_root":"/tmp/x","goal_write_ok":true,"goal_read_back_ok":true,"goal_records":1}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-015-AC-234","host":"B","project_root":"/tmp/x","tasks_rendered":1,"goals_rendered":1,"round_records_rendered":1}
EVID
  set +e
  complete_out="$(check_evidence_completeness "${ev}" "${expected}" 2>&1)"
  rc_complete=$?
  set -e
  echo "selfcheck-evidence-completeness: complete → rc=${rc_complete} ${complete_out}"
  [ "${rc_complete}" = "0" ] || { echo "selfcheck-evidence-completeness: FAIL — 全 6 种应 exit 0 (COMPLETE), got ${rc_complete}" >&2; rc=1; }

  # ③ 全缺（evidence 有非空行但无一预期 ac）⇒ NOT-EVALUATED exit 1。
  ev="${tmp}/evidence-allmissing.jsonl"
  printf '%s\n' '{"ts":"2026-09-10T00:00:00Z","ac":"AC88","ok":true}' > "${ev}"
  set +e
  check_evidence_completeness "${ev}" "${expected}" >/dev/null 2>&1
  rc_allmissing=$?
  set -e
  echo "selfcheck-evidence-completeness: all-missing → rc=${rc_allmissing} (expect 1 — NOT-EVALUATED, 与「没证据」同判)"
  [ "${rc_allmissing}" = "1" ] || { echo "selfcheck-evidence-completeness: FAIL — 全缺应 exit 1 (NOT-EVALUATED), got ${rc_allmissing}" >&2; rc=1; }

  rm -rf "${tmp}"
  if [ "${rc}" -eq 0 ]; then
    echo "selfcheck-evidence-completeness: PASS (partial 2/6 → PARTIAL exit 2 + missing=4 list; complete 6/6 → exit 0; all-missing → NOT-EVALUATED exit 1)"
  else
    echo "selfcheck-evidence-completeness: FAIL" >&2
  fi
  return "${rc}"
}

if [ "${selfcheck_evidence_completeness}" -eq 1 ]; then
  selfcheck_evidence_completeness
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
# Factored so both the deliver mode and the --verify-coldstart mode build the SAME fresh
# hardware-independent artifact at the develop tip (NOT the primary checkout HEAD). Sets the globals
# quay_tgz / qn_tgz and leaves the build worktree in place (the caller removes it).
build_develop_tgz() {
  wt="${worktree_base}-${develop_tip:0:12}"
  if [ -e "${wt}" ]; then
    git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
  fi
  echo "develop-deliver: creating detached worktree at develop tip: ${wt}"
  git -C "${repo_root}" worktree add --detach "${wt}" "${develop_tip}" >/dev/null 2>&1
  # symlink the main checkout's node_modules (hoisted, pure-JS deps) so build-dist/esbuild resolve
  ln -s "${repo_root}/node_modules" "${wt}/node_modules" 2>/dev/null || true

  local build_ok=0
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
    return 1
  fi
  return 0
}

# ── verify_coldstart_mode — cross-host evidence transport (gap-third-party-evidence-no-transport-…) ──
# Plan step 1: scp verify-deliver-coldstart.sh + the two .tgz to each host, run it there with an
# explicit --ac89 <remote tmp path>, scp that evidence file back, and append its lines into the
# local carrier (dedup on (ts,ac,host,project_root)). Plan step 2: a host that yields no evidence
# file (verify failed before writing / scp-back failed) is NOT-EVALUATED and the run exits non-zero
# (硬规则 3b — never a silent exit 0 on "no evidence").
verify_coldstart_mode() {
  local build_date local_carrier fail partial hk target remote_script out remote_rc remote_evidence remote_lines evidence_local ck_rc ac207_extra ac207_path_export
  build_date="$(git -C "${repo_root}" log -1 --format=%cI refs/heads/develop 2>/dev/null || echo "")"
  local_carrier="${repo_root}/.quay/productization-verification.jsonl"
  echo "develop-deliver: --verify-coldstart develop=${develop_tip:0:12} build_date=${build_date} carrier=${local_carrier}"
  # Plan 5：该次跨机运行预期产出的 GOAL 记录集合（6 种）——与 scp 回的 evidence 求差，部分缺 ⇒ PARTIAL。
  # ⛔ 不是硬编码的「6」数字：是本次 verify-coldstart 模式【声明要产出】的 ac 种类（AC-204/203/206/232/234
  # 为默认步骤，AC-205 因 --ac205-session 传入而预期；AC-207 仅 --ac207-e2e 时预期，不在此列）。
  expected_acs="GOAL-009-AC-203 GOAL-009-AC-204 GOAL-009-AC-205 GOAL-009-AC-206 GOAL-009-AC-232 GOAL-015-AC-234"
  fail=0
  partial=0
  for hk in ${hosts}; do
    target="${host_target[$hk]:-}"
    if [ -z "${target}" ]; then
      echo "develop-deliver: ${hk} — unknown host key (NOT-EVALUATED)"
      fail=1
      continue
    fi
    echo "develop-deliver: ${hk} (${target}) — scp verify-deliver-coldstart.sh + its \$SCRIPT_DIR siblings + SPEC + both .tgz"
    # verify-deliver-coldstart.sh resolves its sibling tools by \$SCRIPT_DIR (pane-state-classify.ts,
    # quay-init-closure-assertion.ts → gate-script-base.ts + repo-root.ts) and its L1 closed-set by the
    # SPEC — all five + the SPEC must travel with the script or the remote verify aborts under `set -e`
    # before writing the AC89 evidence (the closure is enumerated here, not tar'd, so a new \$SCRIPT_DIR
    # dependency is an explicit edit, not a silent remote failure).
    if ! scp "${ssh_opts[@]}" \
        "${SCRIPT_DIR}/verify-deliver-coldstart.sh" \
        "${SCRIPT_DIR}/pane-state-classify.ts" \
        "${SCRIPT_DIR}/quay-init-closure-assertion.ts" \
        "${SCRIPT_DIR}/gate-script-base.ts" \
        "${SCRIPT_DIR}/repo-root.ts" \
        "${SCRIPT_DIR}/runner-state-write.ts" \
        "${SCRIPT_DIR}/write-json-atomic.ts" \
        "${SCRIPT_DIR}/../../orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md" \
        "${quay_tgz}" "${qn_tgz}" "${target}:~/" >/dev/null 2>&1; then
      echo "develop-deliver: ${hk} (${target}) — scp FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    # --ac207-e2e: the target project's worker must actually spawn, which needs (a) the driving repo's
    # .quay/profiles.yml on the remote so resolve_driving_profiles can derive worker-default
    # launcher/model/auth (single source of truth, 硬规则 4c — ⛔ not a second hardcoded copy here), and
    # (b) ~/.local/bin on PATH so the claude-fjdac/claude wrappers resolve (the ssh non-interactive PATH
    # has neither). Built into the remote script below; both are literal-inserted (single-quoted value,
    # so $HOME/$PATH stay literal and expand on the remote, not here).
    ac207_extra=""
    ac207_path_export=""
    if [ "${ac207_e2e}" -eq 1 ]; then
      if ! scp "${ssh_opts[@]}" "${repo_root}/.quay/profiles.yml" "${target}:~/quay-driving-profiles.yml" >/dev/null 2>&1; then
        echo "develop-deliver: ${hk} (${target}) — driving-profiles scp FAILED (NOT-EVALUATED)"
        fail=1
        continue
      fi
      # AC207_POLL_SECS: the e2e task's first worker attempt can fail the fan-in suite cert (non-inert
      # delta) and need a retry, pushing task-done past the verify script's 1800s default poll window
      # (实测 2026-09-11: done@~30min, poll 1800s 过期 ~19s 早 → 记录未写)。3600s 给足双次尝试余量。
      ac207_path_export='export PATH="$HOME/.local/bin:$PATH"; export AC207_POLL_SECS="${AC207_POLL_SECS:-3600}"'
      ac207_extra=' --ac207-e2e --driving-profiles "$HOME/quay-driving-profiles.yml"'
    fi
    remote_script=$(cat <<REMOTE
${ac207_path_export}
EV="\${HOME}/quay-verify-coldstart-evidence-${develop_tip:0:8}.jsonl"
rm -f "\${EV}"
bash "\${HOME}/verify-deliver-coldstart.sh" \
  --tgz "\${HOME}/$(basename "${quay_tgz}")" \
  --tgz-native "\${HOME}/$(basename "${qn_tgz}")" \
  --build-sha "${develop_tip}" \
  --build-date "${build_date}" \
  --host "${hk}" \
  --ac89 "\${EV}" \
  --spec "\${HOME}/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md" \
  --prefix "\${HOME}/quay-verify-coldstart-${develop_tip:0:8}.npm" \
  --project "quay-verify-coldstart-${develop_tip:0:8}" \
  --root "\${HOME}/quay-verify-coldstart-${develop_tip:0:8}-root" \
  --worktree-root "\${HOME}/quay-verify-coldstart-${develop_tip:0:8}-worktrees" \
  --ac205-session${ac207_extra}
RC=\$?
echo "VERIFY-RC \${RC}"
if [ -f "\${EV}" ]; then
  echo "EVIDENCE-PATH \${EV}"
  echo "EVIDENCE-LINES \$(wc -l < "\${EV}")"
else
  echo "EVIDENCE-ABSENT \${EV}"
fi
REMOTE
)
    set +e
    out="$(ssh "${ssh_opts[@]}" "${target}" "bash -s" <<< "${remote_script}" 2>&1)"
    remote_rc=$?
    set -e
    # 持久化远端 stdout（Plan 4，优先做）：out 落成本地日志并在结果里打印路径——此前只 grep 三个标记
    # （VERIFY-RC / EVIDENCE-PATH / EVIDENCE-LINES）其余全丢，fail-closed 的步骤（如 AC-232 的 NOTE 行、
    # AC-203 的 driver_alive 打印行）无从诊断。日志名含 <host>-<tip8> 唯一标识该次运行。
    remote_log="${repo_root}/.quay/verify-coldstart-remote-${hk}-${develop_tip:0:8}.log"
    mkdir -p "$(dirname "${remote_log}")"
    printf '%s\n' "${out}" > "${remote_log}"
    echo "develop-deliver: ${hk} (${target}) remote stdout persisted → ${remote_log} (${remote_rc:+rc=${remote_rc}})"
    remote_evidence="$(printf '%s\n' "${out}" | grep -oE 'EVIDENCE-PATH .*' | tail -1 | sed 's/^EVIDENCE-PATH //' || echo "")"
    remote_lines="$(printf '%s\n' "${out}" | grep -oE 'EVIDENCE-LINES [0-9]+' | tail -1 | sed 's/^EVIDENCE-LINES //' || echo "")"
    echo "develop-deliver: ${hk} (${target}) remote verify rc=${remote_rc} evidence_lines=${remote_lines:-<none>}"
    if [ "${remote_rc}" -ne 0 ]; then printf '%s\n' "${out}" | tail -8; fi
    if [ -z "${remote_evidence}" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (remote produced no evidence path)"
      fail=1
      continue
    fi
    evidence_local="${repo_root}/.quay/verify-coldstart-evidence-${hk}-${develop_tip:0:8}.jsonl"
    rm -f "${evidence_local}"
    echo "develop-deliver: ${hk} (${target}) — scp back: scp ${ssh_opts[*]} ${target}:${remote_evidence} ${evidence_local}"
    if ! scp "${ssh_opts[@]}" "${target}:${remote_evidence}" "${evidence_local}" >/dev/null 2>&1; then
      echo "develop-deliver: ${hk} (${target}) — evidence scp-back FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    if ! transport_evidence_append "${local_carrier}" "${evidence_local}"; then
      echo "develop-deliver: ${hk} (${target}) — evidence NOT-EVALUATED (no transport)"
      rm -f "${evidence_local}"
      fail=1
      continue
    fi
    # Plan 5：按 ac 种类核对回传完整性（transport 成功 ≠ 完整——「部分产出与完全成功同形」是硬规则 3b 同族）。
    check_evidence_completeness "${evidence_local}" "${expected_acs}"
    ck_rc=$?
    if [ "${ck_rc}" = "2" ]; then
      echo "develop-deliver: ${hk} (${target}) — PARTIAL (transport OK but some expected records missing)"
      partial=1
    elif [ "${ck_rc}" != "0" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (all expected records absent from evidence)"
      fail=1
    fi
    rm -f "${evidence_local}"
  done
  # clean up the build worktree (both .tgz already scp'd to every host)
  git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
  if [ "${partial}" -eq 1 ]; then
    echo "develop-deliver: --verify-coldstart PARTIAL (some hosts transported evidence but are missing expected records — see per-host lines above)" >&2
    exit 2
  fi
  if [ "${fail}" -eq 1 ]; then
    echo "develop-deliver: --verify-coldstart PARTIAL FAILURE (some hosts NOT-EVALUATED — no transport for those hosts)" >&2
    exit 1
  fi
  echo "develop-deliver: --verify-coldstart OK — evidence transported into ${local_carrier}"
  return 0
}

# ── verify_upgrade_mode — GOAL-009-AC-238：既有旧痕迹项目的升级路径取证 ────────────────────────
# 与 verify_coldstart_mode 的区别是本质的：那条跑远端 ② 的「rm -rf $ROOT 后全新 quay-init」
# （GOAL-009 现有 9 条 AC 的证据全部出自该形态的一次性靶子）；本模式把远端脚本切到
# --upgrade-existing，对一个【已经跑过 quay-native、带真实存量数据 + 旧版本 vendored runtime】的
# 真实第三方项目做【隔离副本】升级，只取回 ac=GOAL-009-AC-238 那一条记录。
# ⛔ upgrade_source 是【远端】路径（相对 $HOME），副本在该主机上创建；源目录只被 cp -a 读，从不写。
verify_upgrade_mode() {
  local build_date local_carrier fail hk target remote_script out remote_rc remote_log remote_evidence evidence_local ck_rc
  build_date="$(git -C "${repo_root}" log -1 --format=%cI refs/heads/develop 2>/dev/null || echo "")"
  local_carrier="${repo_root}/.quay/productization-verification.jsonl"
  echo "develop-deliver: --verify-upgrade develop=${develop_tip:0:12} build_date=${build_date} source=\$HOME/${upgrade_source:-<unset>}"
  if [ -z "${upgrade_source}" ]; then
    echo "develop-deliver: --verify-upgrade requires --upgrade-source <path relative to \$HOME on the remote host>" >&2
    return 2
  fi
  fail=0
  for hk in ${hosts}; do
    target="${host_target[$hk]:-}"
    if [ -z "${target}" ]; then
      echo "develop-deliver: ${hk} — unknown host key (NOT-EVALUATED)"
      fail=1
      continue
    fi
    echo "develop-deliver: ${hk} (${target}) — scp verify-deliver-coldstart.sh + \$SCRIPT_DIR siblings + both .tgz"
    # 同 verify_coldstart_mode：\$SCRIPT_DIR 的兄弟依赖必须一并 scp，否则远端在 set -e 下于写证据前夭折
    # （显式枚举，不 tar —— 新增一个 \$SCRIPT_DIR 依赖是一次显式编辑，不是一次静默的远端失败）。
    if ! scp "${ssh_opts[@]}" \
        "${SCRIPT_DIR}/verify-deliver-coldstart.sh" \
        "${SCRIPT_DIR}/pane-state-classify.ts" \
        "${SCRIPT_DIR}/quay-init-closure-assertion.ts" \
        "${SCRIPT_DIR}/gate-script-base.ts" \
        "${SCRIPT_DIR}/repo-root.ts" \
        "${SCRIPT_DIR}/runner-state-write.ts" \
        "${SCRIPT_DIR}/write-json-atomic.ts" \
        "${SCRIPT_DIR}/../../orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md" \
        "${quay_tgz}" "${qn_tgz}" "${target}:~/" >/dev/null 2>&1; then
      echo "develop-deliver: ${hk} (${target}) — scp FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    remote_script=$(cat <<REMOTE
EV="\${HOME}/quay-verify-upgrade-evidence-${develop_tip:0:8}.jsonl"
rm -f "\${EV}"
bash "\${HOME}/verify-deliver-coldstart.sh" \
  --tgz "\${HOME}/$(basename "${quay_tgz}")" \
  --tgz-native "\${HOME}/$(basename "${qn_tgz}")" \
  --build-sha "${develop_tip}" \
  --build-date "${build_date}" \
  --host "${hk}" \
  --ac89 "\${EV}" \
  --evidence "\${HOME}/quay-verify-upgrade-evidence-${develop_tip:0:8}.json" \
  --prefix "\${HOME}/quay-verify-upgrade-${develop_tip:0:8}.npm" \
  --project "quay-verify-upgrade-${develop_tip:0:8}" \
  --root "\${HOME}/quay-verify-upgrade-${develop_tip:0:8}-root" \
  --upgrade-existing \
  --upgrade-source "\${HOME}/${upgrade_source}"
RC=\$?
echo "VERIFY-RC \${RC}"
if [ -f "\${EV}" ]; then
  echo "EVIDENCE-PATH \${EV}"
  echo "EVIDENCE-LINES \$(wc -l < "\${EV}")"
else
  echo "EVIDENCE-ABSENT \${EV}"
fi
REMOTE
)
    set +e
    out="$(ssh "${ssh_opts[@]}" "${target}" "bash -s" <<< "${remote_script}" 2>&1)"
    remote_rc=$?
    set -e
    remote_log="${repo_root}/.quay/verify-upgrade-remote-${hk}-${develop_tip:0:8}.log"
    mkdir -p "$(dirname "${remote_log}")"
    printf '%s\n' "${out}" > "${remote_log}"
    echo "develop-deliver: ${hk} (${target}) remote stdout persisted → ${remote_log} (rc=${remote_rc})"
    remote_evidence="$(printf '%s\n' "${out}" | grep -oE 'EVIDENCE-PATH .*' | tail -1 | sed 's/^EVIDENCE-PATH //' || echo "")"
    if [ -z "${remote_evidence}" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (remote produced no evidence path)"
      printf '%s\n' "${out}" | tail -12
      fail=1
      continue
    fi
    evidence_local="${repo_root}/.quay/verify-upgrade-evidence-${hk}-${develop_tip:0:8}.jsonl"
    rm -f "${evidence_local}"
    if ! scp "${ssh_opts[@]}" "${target}:${remote_evidence}" "${evidence_local}" >/dev/null 2>&1; then
      echo "develop-deliver: ${hk} (${target}) — evidence scp-back FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    if ! transport_evidence_append "${local_carrier}" "${evidence_local}"; then
      echo "develop-deliver: ${hk} (${target}) — evidence NOT-EVALUATED (no transport)"
      rm -f "${evidence_local}"
      fail=1
      continue
    fi
    # 传输成功 ≠ 产出完整：按 ac 种类核对取回的内容里确有 AC-238 那一条（硬规则 3b 同族）。
    check_evidence_completeness "${evidence_local}" "GOAL-009-AC-238"
    ck_rc=$?
    if [ "${ck_rc}" != "0" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (ac=GOAL-009-AC-238 absent from transported evidence)"
      fail=1
    else
      echo "develop-deliver: ${hk} (${target}) — ac=GOAL-009-AC-238 transported into ${local_carrier} ✓"
    fi
    rm -f "${evidence_local}"
  done
  git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
  if [ "${fail}" -eq 1 ]; then
    echo "develop-deliver: --verify-upgrade FAILED (a host produced no AC-238 record — see per-host lines above)" >&2
    return 1
  fi
  echo "develop-deliver: --verify-upgrade OK — GOAL-009-AC-238 record transported into ${local_carrier}"
  return 0
}

if [ "${verify_upgrade}" -eq 1 ]; then
  if ! build_develop_tgz; then
    exit 1
  fi
  verify_upgrade_mode
  exit $?
fi

if [ "${verify_coldstart}" -eq 1 ]; then
  if ! build_develop_tgz; then
    exit 1
  fi
  verify_coldstart_mode
  exit $?
fi

# ── Deliver mode: build + install + verify the served surface ──────────────────────────────
if ! build_develop_tgz; then
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
